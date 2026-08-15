// Aurora DSH 壳客户端 — Electron 主进程
// 原生窗口/托盘/快捷键/通知包裹 `dsh web`（DeepSeek Harness 官方 Web 界面）。
// 冒烟模式：SMOKE=1 时自动跑审计序列，打印 [SMOKE] report 并以 0/2 退出。
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, Notification, dialog, shell, screen } from 'electron'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DshManager, probeUrl } from './src/dsh-manager.mjs'
import { loadSettings } from './src/settings.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SMOKE = process.env.SMOKE === '1'
const SMOKE_MISSING = process.env.SMOKE_MISSING === '1'
const INSTALL_GUIDE_URL = 'https://github.com/deepseek-ai/deepseek-harness'
const APP_NAME = 'Aurora DSH'

if (SMOKE) {
  // 冒烟用独立 userData：每次运行唯一目录（避免上一场景残留的 GPU/dsh
  // 进程持有句柄导致 EPERM），与真实用户数据完全隔离。
  app.setPath('userData', join(__dirname, `.smoke-userdata-${process.pid}-${Date.now()}`))
}

const MISSING_RE = /未检测到 dsh|ENOENT|spawn/i

// ---------- 单实例 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let win = null
let tray = null
let settings = null
let manager = null
let quitting = false
let currentState = { phase: 'starting', title: 'DeepSeek Harness 服务', message: '正在启动 DeepSeek Harness 服务…' }
let stateSaver = null

const log = (...args) => console.log('[aurora-dsh]', ...args)

function defaultDshHome() {
  return join(app.getPath('userData'), 'dsh-home')
}

function publishState(patch) {
  currentState = { ...currentState, ...patch }
  if (win && !win.isDestroyed()) {
    win.webContents.send('shell:state', currentState)
  }
  if (tray) {
    const phaseText = { starting: '启动中…', ready: '运行中', restarting: '重启中…', 'no-dsh': '未检测到 dsh', error: '异常' }[currentState.phase] ?? ''
    tray.setToolTip(`${APP_NAME} — DeepSeek Harness ${phaseText}${manager?.url ? ' · ' + manager.url : ''}`)
  }
}

function makeTrayIcon() {
  const png = join(__dirname, 'assets', 'icon.png')
  let img = nativeImage.createFromPath(png)
  if (img.isEmpty()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#0a84ff"/><path d="M9 12h14M9 16h14M9 20h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`
    img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))
  }
  return img.resize({ width: 16, height: 16 })
}

// ---------- 窗口 ----------
function windowStateOrDefault() {
  const saved = settings.get('windowState')
  if (!saved || typeof saved.width !== 'number') return null
  // 校验仍在某个显示器可视区域内，防止分辨率变化后窗口跑到屏幕外
  try {
    const area = screen.getDisplayMatching({ x: saved.x ?? 0, y: saved.y ?? 0, width: saved.width, height: saved.height }).workArea
    const x = saved.x ?? area.x
    const y = saved.y ?? area.y
    if (x > area.x + area.width - 80 || y > area.y + area.height - 80) return null
  } catch {
    return null
  }
  return saved
}

function createWindow() {
  const saved = windowStateOrDefault()
  win = new BrowserWindow({
    width: saved?.width ?? 1320,
    height: saved?.height ?? 860,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101014', symbolColor: '#d5d5dc', height: 40 },
    backgroundColor: '#101014',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (saved?.maximized) win.maximize()

  win.once('ready-to-show', () => {
    if (!settings.get('startHidden') || SMOKE) win.show()
  })
  win.on('close', (e) => {
    if (!quitting && settings.get('closeToTray')) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })

  // 窗口状态记忆（移动/缩放防抖 600ms）
  const persistState = () => {
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    settings.set('windowState', { ...b, maximized: win.isMaximized() })
  }
  win.on('resize', () => {
    clearTimeout(stateSaver)
    stateSaver = setTimeout(persistState, 600)
  })
  win.on('move', () => {
    clearTimeout(stateSaver)
    stateSaver = setTimeout(persistState, 600)
  })
  win.on('maximize', persistState)
  win.on('unmaximize', persistState)

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (url.startsWith('http')) log(`load failed: ${code} ${desc} ${url}`)
  })
  return win
}

function loadRemote() {
  if (!win || win.isDestroyed() || !manager.url) return
  void win.loadURL(manager.url).catch((err) => log('loadURL failed:', err.message))
}

function showOffline(phase, message) {
  publishState({ phase, message })
  if (!win || win.isDestroyed()) return
  const current = win.webContents.getURL()
  if (!current.startsWith('file:') || !current.includes('offline.html')) {
    void win.loadFile(join(__dirname, 'pages', 'offline.html')).catch(() => {})
  }
}

// ---------- 托盘 ----------
function createTray() {
  tray = new Tray(makeTrayIcon())
  tray.setToolTip(`${APP_NAME} — DeepSeek Harness`)
  tray.on('double-click', () => {
    if (!win) createWindow()
    win.show()
    win.focus()
  })
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (!win) createWindow()
        win.show()
        win.focus()
      },
    },
    { label: '隐藏窗口', click: () => win?.hide() },
    { type: 'separator' },
    { label: '重启 DeepSeek Harness 服务', click: () => void restartDsh() },
    { label: '切换 DSH 数据目录…', click: () => void chooseDshHome() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: settings.get('autostart'),
      click: (item) => {
        settings.set('autostart', item.checked)
        applyAutostart(item.checked)
      },
    },
    {
      label: '启动时最小化到托盘',
      type: 'checkbox',
      checked: settings.get('startHidden'),
      click: (item) => settings.set('startHidden', item.checked),
    },
    {
      label: '关闭窗口时最小化到托盘',
      type: 'checkbox',
      checked: settings.get('closeToTray'),
      click: (item) => settings.set('closeToTray', item.checked),
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
}

function applyAutostart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  } catch (err) {
    log('setLoginItemSettings failed:', err.message)
  }
}

async function chooseDshHome() {
  const r = await dialog.showOpenDialog(win ?? undefined, {
    title: '选择 DeepSeek Harness 数据目录（DSH_HOME）',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) return
  settings.set('dshHome', r.filePaths[0])
  void restartDsh()
}

async function restartDsh() {
  publishState({ phase: 'restarting', message: '正在重启 DeepSeek Harness 服务…' })
  showOffline('restarting', '正在重启 DeepSeek Harness 服务…')
  await manager.stop()
  try {
    await manager.start()
    loadRemote()
  } catch (err) {
    log('manual restart failed:', err.message)
    showOffline('error', `启动失败：${err.message}`)
  }
}

// ---------- 通知 ----------
function notify(title, body) {
  if (SMOKE) return
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body }).show()
  } catch {
    /* 通知失败不影响功能 */
  }
}

// ---------- dsh 生命周期接线 ----------
function wireDsh() {
  const home = settings.get('dshHome') || defaultDshHome()
  mkdirSync(home, { recursive: true })
  manager = new DshManager({ dshHome: home, log, pipeStdout: SMOKE })
  manager.on('ready', (url) => {
    publishState({ phase: 'ready', title: 'DeepSeek Harness', message: `运行中 · ${url}` })
    if (manager.restartCount > 0) notify('DeepSeek Harness 服务已恢复', url)
    loadRemote()
  })
  manager.on('exit', ({ unexpected }) => {
    if (unexpected) {
      notify('DeepSeek Harness 服务已断开', '正在自动重启…')
      showOffline('restarting', 'DeepSeek Harness 服务已断开，正在自动重启…')
      manager.scheduleRestart()
    }
  })
  manager.on('restart-scheduled', ({ count, delay }) => {
    publishState({ phase: 'restarting', message: `服务已断开，第 ${count} 次自动重启（${(delay / 1000).toFixed(0)}s 后）…` })
  })
  manager.on('restart-failed', (err) => {
    showOffline('error', `自动重启失败：${err.message}`)
  })
}

// ---------- 冒烟审计 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(cond, timeoutMs, stepMs = 500) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await cond()) return true
    } catch {
      /* 继续等 */
    }
    await sleep(stepMs)
  }
  return false
}

async function domProbe() {
  try {
    return await win.webContents.executeJavaScript(`({
      title: document.title,
      textarea: document.querySelectorAll('textarea').length,
      buttons: document.querySelectorAll('button').length,
      hasHarness: (document.body.innerText || '').includes('DeepSeek Harness') || document.title.includes('DeepSeek Harness'),
      noDshVisible: !!document.getElementById('view-no-dsh') && !document.getElementById('view-no-dsh').classList.contains('hidden'),
      retryBtn: !!document.getElementById('btn-retry'),
      stateText: document.body.innerText.slice(0, 200),
    })`)
  } catch (err) {
    return { probeError: String(err) }
  }
}

let smokeResults = null

async function runSmoke(extra = {}) {
  smokeResults = { ...extra }
  const failures = []
  const ok = (key, cond, detail) => {
    smokeResults[key] = detail !== undefined ? detail : cond
    if (!cond) failures.push(key)
  }

  // phase1: 设置读写
  try {
    settings.set('smokeKey', 'smokeValue')
    ok('settingsRw', settings.get('smokeKey') === 'smokeValue')
    settings.set('smokeKey', '')
  } catch (err) {
    ok('settingsRw', false, String(err))
  }

  // phase2: 托盘 + 快捷键
  ok('trayCreated', !!tray)
  ok('shortcutRegistered', globalShortcut.isRegistered('CommandOrControl+Shift+A'))

  // phase3-4: dsh 就绪 + 远程页面加载
  ok('dshReady', !!manager.url, manager.url ?? null)
  if (manager.url) {
    ok('probeUrl', await probeUrl(manager.url, 8000))
    await waitFor(() => win && win.webContents.getURL().startsWith('http'), 15000)
    await sleep(6000)
    const dom = await domProbe()
    ok('remoteLoaded', win.webContents.getURL().startsWith('http'), win.webContents.getURL())
    ok('pageHasHarness', dom.hasHarness === true, dom)
    ok('pageHasTextarea', dom.textarea >= 1, dom)
  }

  // phase5: 窗口状态持久化（对比实际 getBounds——Electron 会对 setBounds 做边框取整）
  try {
    win.setBounds({ x: 140, y: 90, width: 1200, height: 780 })
    await sleep(900)
    const actual = win.getBounds()
    const st = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')).windowState
    ok(
      'windowStateSaved',
      st && st.x === actual.x && st.y === actual.y && st.width === actual.width && st.height === actual.height,
      { saved: st, actual },
    )
  } catch (err) {
    ok('windowStateSaved', false, String(err))
  }

  // phase6: 崩溃自动重启（杀掉 dsh → 退避重启 → 新 URL → 页面恢复）
  if (manager.url) {
    const oldUrl = manager.url
    manager.killTree()
    const restarted = await waitFor(() => manager.running && manager.url && manager.url !== oldUrl, 60000)
    ok('crashRestartRecovered', restarted, { oldUrl, newUrl: manager.url, restartCount: manager.restartCount })
    if (restarted) {
      await waitFor(() => win.webContents.getURL().startsWith('http'), 20000)
      await sleep(6000)
      const dom2 = await domProbe()
      ok('reloadedAfterRestart', dom2.hasHarness === true && dom2.textarea >= 1, dom2)
    }
  }

  // phase7: 截图存证
  try {
    const img = await win.webContents.capturePage()
    const out = join(__dirname, 'smoke-screenshot.png')
    writeFileSync(out, img.toPNG())
    ok('screenshotSaved', existsSync(out) && img.getSize().width > 0, out)
  } catch (err) {
    ok('screenshotSaved', false, String(err))
  }

  // phase8: 退出清理
  await manager.stop()
  ok('stoppedCleanly', !manager.running)

  smokeResults.failures = failures
  console.log('[SMOKE] report: ' + JSON.stringify(smokeResults, null, 2))
  if (failures.length === 0) {
    console.log('[SMOKE] OK')
    app.exit(0)
  } else {
    console.log('[SMOKE] FAIL:\n  - ' + failures.join('\n  - '))
    app.exit(2)
  }
}

// ---------- SMOKE_MISSING 场景：离线引导页 ----------
async function runMissingSmoke() {
  smokeResults = {}
  const failures = []
  const ok = (key, cond, detail) => {
    smokeResults[key] = detail !== undefined ? detail : cond
    if (!cond) failures.push(key)
  }
  await waitFor(() => win && win.webContents.getURL().includes('offline.html'), 10000)
  // 等引导视图真正切换（dsh 启动失败的时机可能晚于页面加载）
  const guideShown = await waitFor(async () => (await domProbe()).noDshVisible === true, 40000, 1000)
  const dom = await domProbe()
  ok('offlinePageLoaded', win.webContents.getURL().includes('offline.html'), win.webContents.getURL())
  ok('noDshGuideVisible', guideShown && dom.noDshVisible === true, dom)
  ok('retryBtnExists', dom.retryBtn === true, dom)
  // 点击「重新检测」→ 仍然缺失 → 引导页保持
  await win.webContents.executeJavaScript(`document.getElementById('btn-retry').click()`)
  await sleep(2000)
  const dom2 = await domProbe()
  ok('retryStaysOnGuide', dom2.noDshVisible === true, dom2)
  smokeResults.failures = failures
  console.log('[SMOKE] report: ' + JSON.stringify(smokeResults, null, 2))
  console.log(failures.length === 0 ? '[SMOKE] OK' : '[SMOKE] FAIL:\n  - ' + failures.join('\n  - '))
  app.exit(failures.length === 0 ? 0 : 2)
}

// ---------- 启动 ----------
async function boot() {
  settings = loadSettings(app.getPath('userData'))
  createTray()
  wireDsh()

  // 全局快捷键：Ctrl+Shift+A 显示/隐藏窗口
  const sh = globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!win) createWindow()
    if (win.isVisible()) win.hide()
    else {
      win.show()
      win.focus()
    }
  })
  log('global shortcut registered:', sh)

  createWindow()
  showOffline('starting', '正在启动 DeepSeek Harness 服务…')

  if (SMOKE_MISSING) {
    // 模拟 dsh 缺失场景：AURORA_DSH_BIN 指向不存在的路径
    process.env.AURORA_DSH_BIN = join(__dirname, '.missing', 'dsh.exe')
    try {
      await manager.start()
    } catch (err) {
      log('missing scenario: start failed:', err.message)
      showOffline('no-dsh', err.message)
    }
    return
  }

  try {
    await manager.start()
  } catch (err) {
    log('initial start failed:', err.message)
    const missing = MISSING_RE.test(err.message)
    showOffline(missing ? 'no-dsh' : 'error', missing ? '未检测到 dsh，请先安装。' : `启动失败：${err.message}`)
    if (SMOKE) await runSmoke({ fatal: err.message })
  }
}

// ---------- IPC ----------
ipcMain.handle('shell:get-state', () => currentState)
ipcMain.on('shell:retry-dsh', () => {
  void (async () => {
    showOffline('restarting', '正在重新检测并启动…')
    try {
      await manager.start()
    } catch (err) {
      const missing = MISSING_RE.test(err.message)
      showOffline(missing ? 'no-dsh' : 'error', missing ? '未检测到 dsh，请先安装。' : `启动失败：${err.message}`)
    }
  })()
})
ipcMain.on('shell:open-install-guide', () => {
  void shell.openExternal(INSTALL_GUIDE_URL)
})
ipcMain.on('shell:minimize', () => win?.minimize())
ipcMain.on('shell:toggle-maximize', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('shell:close', () => win?.close())

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  try {
    await boot()
    if (SMOKE && SMOKE_MISSING) {
      await runMissingSmoke()
    } else if (SMOKE && !SMOKE_MISSING && smokeResults === null) {
      if (manager?.url) await runSmoke()
      // 无 url 时 boot() 的 catch 已调用 runSmoke({fatal})
    }
  } catch (err) {
    log('boot error:', err)
    console.error(err)
    app.exit(2)
  }
})

// 单实例唤起
app.on('second-instance', () => {
  if (!win) createWindow()
  win.show()
  win.focus()
})

app.on('activate', () => {
  if (!win) createWindow()
  win.show()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  quitting = true
  if (manager) void manager.stop()
})

process.on('exit', () => {
  if (manager) manager.killTree()
})

// 冒烟兜底：120 秒强制退出
if (SMOKE) {
  setTimeout(() => {
    console.error('[SMOKE] watchdog force exit(2)')
    app.exit(2)
  }, 120000)
}
