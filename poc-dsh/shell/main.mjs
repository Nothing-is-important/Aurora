// Aurora Route-1 PoC: 原生 Electron 外壳包裹 `dsh web`
// 流程：spawn `dsh web --port 0` → 解析 stdout 的 `dsh web: http://…` 行
//       → BrowserWindow(无边框 + Windows 原生按钮) 加载该地址 → 截图存证。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SMOKE = process.argv.includes('--smoke')
const REPO_HOME = join(__dirname, '..', '.home')
// PoC 默认使用仓库内独立 DSH_HOME（与机器上现有 dsh 部署互不干扰）；
// 显式设置 AURORA_DSH_HOME 可指向任意已有部署（如 F:\.dsh 复用真实会话）。
const DSH_HOME = process.env.AURORA_DSH_HOME ?? REPO_HOME

// ---------- 定位 dsh CLI ----------
// Electron 主进程的 PATH 可能不含 npm 全局 bin；且 Node 20.12+ 出于安全
// (CVE-2024-27980) 禁止 spawn 直接执行 .cmd/.bat（EINVAL）。
// 因此优先直接执行 `node <dsh>/lib/bin.js`：
// 顺序：AURORA_DSH_BIN 显式指定 → 常见 npm 全局前缀下的 @deepseek-ai/dsh
// 包 → `where dsh`（仅接受 .exe）→ 最后回退 shell:true 的裸 'dsh'。
function resolveDsh() {
  if (process.env.AURORA_DSH_BIN) {
    return { cmd: process.env.AURORA_DSH_BIN, args: [], shell: false }
  }
  const prefixes = [
    process.env.npm_config_prefix,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
    'F:\\npm',
    'C:\\Program Files\\nodejs',
  ].filter(Boolean)
  const nodeExe = join('C:\\Program Files\\nodejs', 'node.exe')
  for (const prefix of prefixes) {
    const bin = join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(bin) && existsSync(nodeExe)) {
      return { cmd: nodeExe, args: [bin], shell: false }
    }
  }
  const where = spawnSync('where', ['dsh'], { encoding: 'utf8', windowsHide: true })
  const line = (where.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && /\.exe$/i.test(s))
  if (line && existsSync(line)) {
    return { cmd: line, args: [], shell: false }
  }
  return { cmd: 'dsh', args: [], shell: true }
}

// ---------- 单实例 ----------
if (!app.requestSingleInstanceLock()) {
  console.log('[poc] another instance is running, quit')
  app.quit()
}

let win = null
let tray = null
let dshProc = null
let shuttingDown = false

function killDshTree() {
  if (!dshProc || dshProc.exitCode !== null) return
  const pid = dshProc.pid
  try {
    // Windows: 同步杀整棵进程树（dsh → cmd → node → 子代理进程），
    // 避免 Electron 退出后孤儿 dsh 服务继续占端口。
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    dshProc.kill()
  }
}

/** 启动 `dsh web --port 0`，等 stdout 出现 `dsh web: http://…`，返回 URL。 */
function startDshWeb() {
  return new Promise((resolve, reject) => {
    const { cmd, args, shell } = resolveDsh()
    console.log(`[poc] launching: ${cmd} ${args.join(' ')} web --port 0 (shell=${shell})`)
    const child = spawn(cmd, [...args, 'web', '--port', '0'], {
      shell,
      env: { ...process.env, DSH_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    })
    dshProc = child
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const urlRe = /dsh web:\s+(https?:\/\/\S+)/
    let buf = ''
    const onData = (chunk) => {
      buf += chunk.toString()
      const m = buf.match(urlRe)
      if (m && !settled) {
        settled = true
        resolve(m[1])
      }
      if (process.env.POC_VERBOSE) process.stdout.write(chunk)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (c) => {
      const s = c.toString()
      if (s.trim()) console.error('[dsh:stderr]', s.trim().slice(0, 500))
    })
    child.on('error', (err) => fail(new Error(`spawn dsh failed: ${err.message}`)))
    child.on('exit', (code) => {
      if (!settled) fail(new Error(`dsh exited early with code ${code}`))
      else console.log(`[poc] dsh exited (${code})`)
      if (!shuttingDown) app.quit()
    })
    setTimeout(() => fail(new Error('timeout waiting for dsh web URL (30s)')), 30000)
  })
}

function makeTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#0a84ff"/><path d="M9 12h14M9 16h14M9 20h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`
  return nativeImage
    .createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))
    .resize({ width: 16, height: 16 })
}

function createTray() {
  tray = new Tray(makeTrayIcon())
  tray.setToolTip('Aurora · DeepSeek Harness 本地客户端 (PoC)')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: () => win?.show() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  tray.on('double-click', () => win?.show())
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  let url
  try {
    url = await startDshWeb()
  } catch (err) {
    console.error('[poc] FATAL:', err.message)
    app.exit(1)
    return
  }
  console.log(`[poc] dsh web ready at ${url}`)

  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // 隐藏标题栏 + Windows 原生窗口按钮（最小化/最大化/关闭）
      color: '#101014',
      symbolColor: '#d5d5dc',
      height: 40,
    },
    backgroundColor: '#101014',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    win = null
  })
  win.webContents.on('did-finish-load', async () => {
    console.log('[poc] page loaded:', win.webContents.getURL())
    // 给前端 bundle 一点启动时间再截图
    setTimeout(async () => {
      let domInfo = {}
      try {
        domInfo = await win.webContents.executeJavaScript(`({
          title: document.title,
          text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
          textareas: document.querySelectorAll('textarea').length,
          inputs: document.querySelectorAll('input').length,
          buttons: document.querySelectorAll('button').length,
          scripts: document.scripts.length,
          rootChildren: (document.getElementById('root')?.children.length ?? -1),
        })`)
      } catch (err) {
        domInfo = { domError: String(err) }
      }
      console.log('[poc] dom:', JSON.stringify(domInfo))
      const img = await win.webContents.capturePage()
      const out = join(__dirname, 'poc-screenshot.png')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(out, img.toPNG())
      console.log('[poc] screenshot saved:', out)
      if (SMOKE) {
        console.log('[poc] SMOKE OK')
        app.quit()
      }
    }, 6000)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url2) => {
    console.error(`[poc] load failed ${code} ${desc} ${url2}`)
  })

  createTray()
  await win.loadURL(url)

  ipcMain.on('shell:minimize', () => win?.minimize())
  ipcMain.on('shell:toggle-maximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('shell:close', () => win?.close())
})

app.on('window-all-closed', () => {
  // 关窗不退出：常驻托盘，dsh 服务继续在后台
  if (!shuttingDown) console.log('[poc] all windows closed, staying in tray')
})

app.on('before-quit', () => {
  shuttingDown = true
  killDshTree()
})

process.on('exit', () => killDshTree())

// 冒烟：45 秒兜底退出（正常路径是截图后退出）
if (SMOKE) {
  setTimeout(() => {
    console.error('[poc] SMOKE watchdog exit')
    app.exit(2)
  }, 45000)
}

// 提示 DSH_HOME 来源
console.log('[poc] DSH_HOME =', DSH_HOME, existsSync(DSH_HOME) ? '(existing)' : '(will be created)')
