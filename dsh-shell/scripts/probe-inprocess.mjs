// 进程内嵌入探针 v2：自定义 boot（跳过 runProfile 的 HMR/watch 段，
// 生产桌面客户端不需要插件热重载，也绕开 --expose-internals 依赖）。
// 输出：URL、HTTP 200、引擎服务清单、Typert API 端点契约。
// 用法：electron scripts/probe-inprocess.mjs
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join } from 'node:path'

const runtimeDir = join(process.env.LOCALAPPDATA ?? app.getPath('temp'), 'Aurora DSH', 'runtime')
const DSH_DIR = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh')
const NM = join(runtimeDir, 'node_modules', '@deepseek-ai')
// 注意：DSH_HOME 目录内会生成指向运行时 node_modules 的符号链接，
// 绝不能对旧 home 做递归删除（rm 会穿过链接删掉运行时的真实文件）。
// 每次探针用唯一的新目录。
const home = join(app.getPath('temp'), `aurora-dsh-inproc-home-${process.pid}-${Date.now()}`)

const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

app.whenReady().then(async () => {
  mkdirSync(home, { recursive: true })
  process.env.DSH_HOME = home

  let urlLine = null
  const origLog = console.log
  console.log = (...args) => {
    const line = args.join(' ')
    if (line.includes('dsh web:')) urlLine = line
    origLog(...args)
  }

  try {
    const appBoot = await import(pathToFileURL(join(NM, 'dsh-app-boot', 'lib', 'index.js')).href)
    const cmdline = await import(pathToFileURL(join(NM, 'dsh-cmdline', 'lib', 'index.js')).href)
    const launchEnv = await import(pathToFileURL(join(NM, 'dsh-launch-environment', 'lib', 'index.js')).href)

    const installAnchor = join(DSH_DIR, 'package.json')
    appBoot.healProfilesModuleFallback(installAnchor, home)
    const profile = appBoot.loadProfile('dsh', 'web', installAnchor, home, { userLayer: true })
    writeFileSync(join(profile.dir, 'cordis.yml'), PROFILE_ROOT_CONFIG)

    const homePatches = appBoot.loadOptionalPatches('dsh', join(home, 'cordis.patch.yml')) ?? []
    const bundlePatches = profile.layers.flatMap((layer) => layer.patches)
    const rows = new Map()
    for (const row of appBoot.composeEntries([bundlePatches, profile.patches, homePatches, []])) {
      if (typeof row.id === 'string') rows.set(row.id, row)
    }
    const shippedPresets = join(DSH_DIR, 'config', 'agent-presets')
    const overlays = []
    if (rows.has('agent-presets')) {
      overlays.push({
        id: 'agent-presets',
        config: { ...(rows.get('agent-presets')?.config ?? {}), roots: [{ path: shippedPresets, trust: 'system' }] },
      })
    }
    const patches = structuredClone([...bundlePatches, ...profile.patches, ...homePatches, ...overlays])

    const t0 = Date.now()
    const ctx = await appBoot.boot('dsh', join(profile.dir, 'cordis.yml'), patches, (hostCtx) => {
      hostCtx.provide(launchEnv.DSH_LAUNCH_ENVIRONMENT_KEY, appBoot.loadLayeredEnv('dsh'))
      cmdline.provideCmdline(hostCtx, { args: ['--port', '0'], exit: () => {} })
    })
    console.log(`[probe] booted in ${Date.now() - t0}ms`)
    console.log('[probe] url line:', urlLine)

    if (urlLine) {
      const url = urlLine.match(/dsh web:\s+(https?:\/\/\S+)/)?.[1]
      const res = await fetch(url)
      console.log('[probe] http status:', res.status)
    }

    const services = Object.entries(ctx.reflect.props)
      .filter(([, d]) => d.type === 'service')
      .map(([k]) => k)
      .sort()
    console.log('[probe] services:', JSON.stringify(services))

    try {
      const typert = ctx.get('typert')
      let endpoints = []
      if (typert?.local?.list) {
        const listed = typert.local.list()
        endpoints = Array.isArray(listed) ? listed.map((d) => d?.id ?? d) : []
      } else if (typert?.local?.entries instanceof Map) {
        endpoints = [...typert.local.entries.keys()]
      }
      console.log('[probe] typert endpoints:', JSON.stringify(endpoints.slice(0, 80)))
      console.log('[probe] endpoint count:', endpoints.length)
    } catch (err) {
      console.log('[probe] typert unavailable:', err.message)
    }

    await ctx.fiber.dispose()
    console.log('[probe] disposed cleanly')
    app.exit(0)
  } catch (err) {
    console.error('[probe] FAILED:', err)
    app.exit(1)
  }
})
