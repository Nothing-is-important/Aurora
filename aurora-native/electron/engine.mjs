// DSH 引擎进程内嵌入：自定义 boot（跳过 HMR/watch，生产客户端不需要热重载）
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

let bootedCtx = null
let bootPromise = null

export function runtimeDir() {
  return join(process.env.LOCALAPPDATA ?? process.env.TEMP, 'Aurora DSH', 'runtime')
}

const NM = () => join(runtimeDir(), 'node_modules', '@deepseek-ai')
const DSH_DIR = () => join(runtimeDir(), 'node_modules', '@deepseek-ai', 'dsh')

async function importRuntime(rel) {
  return import(pathToFileURL(join(NM(), ...rel.split('/'))).href)
}

/**
 * 启动（或复用）进程内 DSH web 组合。
 * @param home DSH_HOME 数据目录（会话/存储/配置落在这里）
 * @returns { ctx, url } Cordis 根上下文 + 本地 Web 地址
 */
export async function bootEngine(home) {
  if (bootedCtx) return bootedCtx
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    mkdirSync(home, { recursive: true })
    process.env.DSH_HOME = home

    const appBoot = await importRuntime('dsh-app-boot/lib/index.js')
    const cmdline = await importRuntime('dsh-cmdline/lib/index.js')
    const launchEnv = await importRuntime('dsh-launch-environment/lib/index.js')

    const installAnchor = join(DSH_DIR(), 'package.json')
    appBoot.healProfilesModuleFallback(installAnchor, home)
    const profile = appBoot.loadProfile('dsh', 'web', installAnchor, home, { userLayer: true })
    writeFileSync(join(profile.dir, 'cordis.yml'), PROFILE_ROOT_CONFIG)

    const homePatchFile = join(home, 'cordis.patch.yml')
    let homePatches = []
    try {
      if (existsSync(homePatchFile) && readFileSync(homePatchFile, 'utf8').trim()) {
        homePatches = appBoot.loadOptionalPatches('dsh', homePatchFile) ?? []
      }
    } catch (err) {
      console.warn('[engine] home patch parse failed (ignored):', err.message)
    }
    const bundlePatches = profile.layers.flatMap((layer) => layer.patches)
    const rows = new Map()
    for (const row of appBoot.composeEntries([bundlePatches, profile.patches, homePatches, []])) {
      if (typeof row.id === 'string') rows.set(row.id, row)
    }
    const overlays = []
    if (rows.has('agent-presets')) {
      overlays.push({
        id: 'agent-presets',
        config: {
          ...(rows.get('agent-presets')?.config ?? {}),
          roots: [{ path: join(DSH_DIR(), 'config', 'agent-presets'), trust: 'system' }],
        },
      })
    }
    const patches = structuredClone([...bundlePatches, ...profile.patches, ...homePatches, ...overlays])

    // 捕获 `dsh web: http://…` URL 行
    let urlLine = null
    const origLog = console.log.bind(console)
    console.log = (...args) => {
      const line = args.join(' ')
      if (line.includes('dsh web:')) urlLine = line
      origLog(...args)
    }

    const ctx = await appBoot.boot('dsh', join(profile.dir, 'cordis.yml'), patches, (hostCtx) => {
      hostCtx.provide(launchEnv.DSH_LAUNCH_ENVIRONMENT_KEY, appBoot.loadLayeredEnv('dsh'))
      cmdline.provideCmdline(hostCtx, { args: ['--port', '0'], exit: () => {} })
    })
    const url = urlLine?.match(/dsh web:\s+(https?:\/\/\S+)/)?.[1] ?? null
    console.log = origLog
    bootedCtx = { ctx, url }
    return bootedCtx
  })()
  return bootPromise
}

export async function disposeEngine() {
  if (!bootedCtx) return
  const { ctx } = bootedCtx
  bootedCtx = null
  bootPromise = null
  await ctx.fiber.dispose()
}
