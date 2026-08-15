// dsh 生命周期管理：定位 CLI → spawn `dsh web --port 0` → 解析 URL 行 →
// HTTP 探活 → 崩溃自动重启（指数退避）→ 退出杀进程树。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

/** 常见 npm 全局前缀（dsh 包探测顺序；开发环境优先本仓库自带的 .dsh-runtime） */
function candidatePrefixes() {
  const list = [
    process.env.npm_config_prefix,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
    'F:\\npm',
    'C:\\Program Files\\nodejs',
  ]
  // 开发/测试专用：仓库内独立安装的 dsh 运行时（打包版会换成 resources 路径）
  const local = join(fileURLToPath(new URL('..', import.meta.url)), '.dsh-runtime')
  if (existsSync(join(local, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    list.unshift(local)
  }
  return list.filter(Boolean)
}

/** 结构健康检查：bin.js 存在，且 cordis 依赖可解析（嵌套或提升布局均可）。 */
function installHealthy(prefix) {
  const dshDir = join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  const bin = join(dshDir, 'lib', 'bin.js')
  if (!existsSync(bin)) return false
  const cordisNested = join(dshDir, 'node_modules', '@deepseek-ai', 'cordis', 'package.json')
  const cordisHoisted = join(prefix, 'node_modules', '@deepseek-ai', 'cordis', 'package.json')
  return existsSync(cordisNested) || existsSync(cordisHoisted)
}

let resolvedCache = null

/**
 * 定位 dsh CLI。
 * 顺序：AURORA_DSH_BIN 显式指定 → 结构健康的 npm 前缀安装（node
 * <pkg>/lib/bin.js 直接执行，规避 CVE-2024-27980 对 .cmd spawn 的 EINVAL
 * 限制）→ `where dsh`（仅接受 .exe）→ 回退 shell:true 的裸 'dsh'。
 * 结果按进程缓存：首次成功探测后不再重复扫描。
 */
export function resolveDsh() {
  if (resolvedCache) return resolvedCache
  if (process.env.AURORA_DSH_BIN) {
    // 支持完整命令行（如 `"C:\Program Files\nodejs\node.exe" "<path>\bin.js"`），
    // 按空白拆分并支持双引号包裹（Windows 路径含空格）。
    const parts = []
    const re = /"([^"]*)"|(\S+)/g
    let m
    while ((m = re.exec(process.env.AURORA_DSH_BIN)) !== null) {
      parts.push(m[1] ?? m[2])
    }
    if (parts.length === 0) {
      resolvedCache = { cmd: process.env.AURORA_DSH_BIN, args: [], shell: false, source: 'env' }
    } else {
      resolvedCache = { cmd: parts[0], args: parts.slice(1), shell: false, source: 'env' }
    }
    return resolvedCache
  }
  const nodeExe = join('C:\\Program Files\\nodejs', 'node.exe')
  for (const prefix of candidatePrefixes()) {
    const bin = join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(bin) && existsSync(nodeExe) && installHealthy(prefix)) {
      resolvedCache = { cmd: nodeExe, args: [bin], shell: false, source: 'package' }
      return resolvedCache
    }
  }
  const where = spawnSync('where', ['dsh'], { encoding: 'utf8', windowsHide: true })
  const line = (where.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && /\.exe$/i.test(s))
  if (line && existsSync(line)) {
    resolvedCache = { cmd: line, args: [], shell: false, source: 'where' }
    return resolvedCache
  }
  resolvedCache = { cmd: 'dsh', args: [], shell: true, source: 'path' }
  return resolvedCache
}

/** HTTP 探活：dsh 服务就绪即 URL 可用（同源 127.0.0.1，不受代理环境影响）。 */
export async function probeUrl(url, timeoutMs = 4000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' })
    return res.ok || res.status === 304
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export class DshManager extends EventEmitter {
  /** @param opts.dshHome 传给 dsh 子进程的 DSH_HOME */
  constructor(opts) {
    super()
    this.opts = opts
    this.proc = null
    this.url = null
    this.source = null
    this.restartCount = 0
    this.restartDelayMs = 0
    this.restartTimer = null
    this.stopping = false
    this.running = false
  }

  get dshHome() {
    return this.opts.dshHome
  }

  log(msg) {
    if (this.opts.log) this.opts.log(`[dsh] ${msg}`)
  }

  /** 杀整棵进程树（Windows：dsh → node → 子代理），同步等待完成。 */
  killTree() {
    if (!this.proc || this.proc.exitCode !== null) return
    const pid = this.proc.pid
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      try {
        this.proc.kill()
      } catch {
        /* 已退出 */
      }
    }
  }

  /** 启动（或重启）dsh web。resolve 时 url 已就绪且探活通过。 */
  start() {
    this.stopping = false
    return new Promise((resolve, reject) => {
      const { cmd, args, shell, source } = resolveDsh()
      this.source = source
      // 快速失败：非 shell 模式的可执行文件不存在 → 立即报错（引导页依赖此路径）
      if (!shell && !existsSync(cmd)) {
        this.log(`not found: ${cmd}`)
        reject(new Error(`未检测到 dsh（${cmd} 不存在）`))
        return
      }
      this.log(`launch: ${cmd} ${[...args, 'web', '--port', '0'].join(' ')} (source=${source})`)
      let child
      try {
        child = spawn(cmd, [...args, 'web', '--port', '0'], {
          shell,
          env: { ...process.env, DSH_HOME: this.dshHome },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch (err) {
        this.log(`spawn failed: ${err.message}`)
        reject(err)
        return
      }
      this.proc = child
      let settled = false
      const fail = (err) => {
        if (settled) return
        settled = true
        this.running = false
        reject(err)
      }
      const urlRe = /dsh web:\s+(https?:\/\/\S+)/
      let buf = ''
      child.stdout.on('data', async (chunk) => {
        const text = chunk.toString()
        buf += text
        if (this.opts.pipeStdout) process.stdout.write(text)
        const m = buf.match(urlRe)
        if (m && !settled) {
          const url = m[1]
          const ok = await probeUrl(url, 8000)
          if (!ok) {
            fail(new Error(`dsh web 服务未就绪: ${url}`))
            return
          }
          settled = true
          this.url = url
          this.running = true
          this.restartCount = 0
          this.restartDelayMs = 0
          this.log(`ready: ${url}`)
          this.emit('ready', url)
          resolve(url)
        }
      })
      child.stderr.on('data', (c) => {
        const s = c.toString()
        if (s.trim()) this.log(`stderr: ${s.trim().slice(0, 300)}`)
      })
      child.on('error', (err) => fail(new Error(`spawn dsh failed: ${err.message}`)))
      child.on('exit', (code) => {
        this.proc = child
        this.running = false
        const unexpected = !settled || !this.stopping
        this.log(`exit(${code})${unexpected ? ' [unexpected]' : ''}`)
        if (settled) this.emit('exit', { code, unexpected })
        else if (!this.stopping) fail(new Error(`dsh exited early with code ${code}`))
      })
      setTimeout(() => fail(new Error('等待 dsh web URL 超时(30s)')), 30000)
    })
  }

  /** 崩溃自动重启（指数退避：1s→2s→4s→8s→16s→30s 封顶，成功后清零）。 */
  scheduleRestart() {
    if (this.stopping || this.restartTimer) return
    const delays = [1000, 2000, 4000, 8000, 16000, 30000]
    const delay = delays[Math.min(this.restartCount, delays.length - 1)]
    this.restartCount++
    this.restartDelayMs = delay
    this.log(`schedule restart #${this.restartCount} in ${delay}ms`)
    this.emit('restart-scheduled', { count: this.restartCount, delay })
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null
      try {
        await this.start()
      } catch (err) {
        this.log(`restart failed: ${err.message}`)
        this.emit('restart-failed', err)
        this.scheduleRestart()
      }
    }, delay)
  }

  /** 停止并阻止自动重启。 */
  async stop() {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.killTree()
    this.running = false
  }
}
