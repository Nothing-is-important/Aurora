import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
} from 'electron'
import type { NativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import {
  closeDb,
  createConversation,
  deleteConversation,
  deleteMessagesFrom,
  deleteModel,
  getConversationSystemPrompt,
  getSetting,
  initDb,
  listConversations,
  listMessages,
  listModels,
  renameConversation,
  saveModel,
  setConversationPinned,
  setConversationSystemPrompt,
  setSetting,
  upsertMessage,
} from './db'
import { registerChatIpc, getSmokeChatRequests } from './chat'
import { isShellAllowed, runPython } from './tools'
import { mcpManager } from './mcp'
import { kbManager } from './kb'
import { spawnSync } from 'child_process'

const SMOKE = process.env.SMOKE === '1'
const DEV_URL = process.env.VITE_DEV_SERVER_URL

function bootLog(msg: string): void {
  if (!SMOKE) return
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'boot.log'),
      `[${new Date().toISOString()}] ${msg}\n`,
    )
  } catch {
    /* ignore */
  }
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let trayCreated = false

// ---- 系统托盘 ----
function createTray(): boolean {
  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png')
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) return false
    const small = img.resize({ width: 16, height: 16 })
    tray = new Tray(small)
    tray.setToolTip('Aurora — DeepSeek 桌面工作台')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示 Aurora',
          click: () => {
            win?.show()
            win?.focus()
          },
        },
        {
          label: '最小化到托盘',
          click: () => win?.hide(),
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => app.quit(),
        },
      ]),
    )
    tray.on('click', () => {
      if (!win) return
      if (win.isVisible() && win.isFocused()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    })
    return true
  } catch (err) {
    bootLog('tray failed: ' + String(err))
    return false
  }
}

// ---- 窗口状态记忆 ----
let boundsTimer: ReturnType<typeof setTimeout> | null = null

function saveWindowBounds(): void {
  if (!win || SMOKE) return
  try {
    setSetting(
      'windowBounds',
      JSON.stringify({ bounds: win.getBounds(), maximized: win.isMaximized() }),
    )
  } catch {
    /* ignore */
  }
}

function scheduleBoundsSave(): void {
  if (SMOKE) return
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(saveWindowBounds, 500)
}

function restoreWindowBounds(): void {
  if (SMOKE) return
  try {
    const raw = getSetting('windowBounds')
    if (!raw || !win) return
    const s = JSON.parse(raw) as {
      bounds?: { x: number; y: number; width: number; height: number }
      maximized?: boolean
    }
    const b = s.bounds
    if (b && typeof b.width === 'number' && b.width >= 800) {
      const display = screen.getDisplayMatching(b)
      const wa = display.workArea
      const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - 400)
      const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - 200)
      win.setBounds({ x, y, width: b.width, height: b.height })
      if (s.maximized) win.maximize()
    }
  } catch {
    /* ignore */
  }
}

// ---- 数据自动备份（每日一份，保留 7 份）----
function doAutoBackup(): string | null {
  try {
    const dir = path.join(app.getPath('userData'), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    if (getSetting('lastBackupDate') === today) return null
    const src = path.join(
      app.getPath('userData'),
      SMOKE ? 'aurora-smoke.db' : 'aurora.db',
    )
    if (!fs.existsSync(src)) return null
    const dest = path.join(
      dir,
      `${SMOKE ? 'aurora-smoke' : 'aurora'}-${today}.db`,
    )
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest)
    setSetting('lastBackupDate', today)
    const backups = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .sort()
      .reverse()
    for (const f of backups.slice(7)) {
      try {
        fs.unlinkSync(path.join(dir, f))
      } catch {
        /* ignore */
      }
    }
    return dest
  } catch (err) {
    bootLog('backup failed: ' + String(err))
    return null
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d12' : '#ececf1',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: SMOKE ? ['--smoke'] : [],
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => win?.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false))
  win.on('resize', scheduleBoundsSave)
  win.on('move', scheduleBoundsSave)
  win.on('closed', () => {
    win = null
  })
  restoreWindowBounds()

  const errors: string[] = []
  win.webContents.on(
    'console-message',
    (event: unknown, level: unknown, message: unknown) => {
      const lvl =
        typeof level === 'number'
          ? level
          : ((event as { level?: number })?.level ?? 0)
      const text =
        typeof message === 'string'
          ? message
          : ((event as { message?: string })?.message ?? '')
      if (lvl >= 3) errors.push(text)
    },
  )

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (SMOKE) {
    // 兜底：110 秒未完成强制退出，避免打包版静默挂起
    setTimeout(() => {
      bootLog('watchdog: force exit(2)')
      app.exit(2)
    }, 110000)
    void runSmoke(win, errors)
  }
}

// ---- 像素审计工具（BGRA）----
function sampleStats(
  img: NativeImage,
  region: { x: number; y: number; w: number; h: number },
): { mean: number; variance: number } {
  const buf = img.toBitmap()
  const { width } = img.getSize()
  const { x, y, w, h } = region
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let py = y; py < y + h; py += 3) {
    for (let px = x; px < x + w; px += 3) {
      const i = (py * width + px) * 4
      const lum = (buf[i] * 0.114 + buf[i + 1] * 0.587 + buf[i + 2] * 0.299) / 255
      sum += lum
      sumSq += lum * lum
      n++
    }
  }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  return { mean, variance }
}

function countNearColor(
  img: NativeImage,
  region: { x: number; y: number; w: number; h: number },
  target: [number, number, number],
  tolerance: number,
): number {
  const buf = img.toBitmap()
  const { width } = img.getSize()
  const [tr, tg, tb] = target
  let count = 0
  for (let py = region.y; py < region.y + region.h; py += 1) {
    for (let px = region.x; px < region.x + region.w; px += 1) {
      const i = (py * width + px) * 4
      const dr = buf[i + 2] - tr
      const dg = buf[i + 1] - tg
      const db = buf[i] - tb
      if (dr * dr + dg * dg + db * db <= tolerance * tolerance) count++
    }
  }
  return count
}

const DOM_AUDIT = `
;(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (cond, timeout) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (cond()) return true
      await sleep(250)
    }
    return false
  }
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const asides = document.querySelectorAll('aside')
  const out = {
    root: !!document.getElementById('root'),
    darkClass: document.documentElement.classList.contains('dark'),
    overflowX: document.body.scrollWidth > document.body.clientWidth,
    // Windows 风格窗口按钮：存在于右上角
    winMinBtn: !!document.querySelector('button[aria-label="最小化"]'),
    winMaxBtn: !!document.querySelector('button[aria-label="最大化"]'),
    winCloseBtn: !!document.querySelector('button[aria-label="关闭"]'),
    winCloseX: (() => {
      const r = rect(document.querySelector('button[aria-label="关闭"]'))
      return r ? r.x : 0
    })(),
    titlebarH: rect(document.querySelector('.drag'))?.h,
    sidebarW: rect(asides[0])?.w,
    inspectorW: rect(asides[1])?.w,
    chatW: rect(document.querySelector('main'))?.w,
    messages: document.querySelectorAll('[data-role]').length,
    msgsDetail: Array.from(document.querySelectorAll('[data-role]')).map((el) =>
      (el.getAttribute('data-role') + ':' + (el.textContent || '').slice(0, 20)).replace(/\\s+/g, ' ')
    ),
    smokeSends: window.__smokeSends || [],
    smokeMsgOps: (window.__smokeMsgOps || []).slice(-40),
    userMsg: !!document.querySelector('[data-role="user"]'),
    assistantMsg: !!document.querySelector('[data-role="assistant"]'),
    toolStepCards: document.querySelectorAll('[data-tool-step]').length,
    refCards: document.querySelectorAll('[data-ref]').length,
    assistantBubbleW: (() => {
      const el = document.querySelector('[data-role="assistant"] > div')
      return el ? Math.round(el.getBoundingClientRect().width) : 0
    })(),
    assistantWrapperW: (() => {
      const el = document.querySelector('[data-role="assistant"]')
      return el ? Math.round(el.getBoundingClientRect().width) : 0
    })(),
    reasoning: !!document.querySelector('[data-reasoning]'),
    codeBlock: !!document.querySelector('.code-block'),
    hljs: !!document.querySelector('.hljs'),
    katex: !!document.querySelector('.katex'),
    copyBtn: !!document.querySelector('button[aria-label="复制代码"]'),
    stopBtn: !!document.querySelector('button[aria-label="停止"]'),
    errorCard: !!document.querySelector('[data-error]'),
    modelPill: (document.querySelector('[data-model-pill]') || {}).textContent || '',
    sidebarItems: document.querySelectorAll('[data-conv-item]').length,
    activeConv: (document.querySelector('[data-conv-item][data-active="true"]') || {}).textContent || '',
    convSearch: !!document.querySelector('[data-conv-search]'),
    titlebarTitle: (document.querySelector('[data-titlebar-title]') || {}).textContent || '',
    attachBtn: !!document.querySelector('[data-attach]'),
    sendBtn: !!document.querySelector('button[aria-label="发送"]'),
    newChatBtn: !!document.querySelector('button[aria-label="新对话"]'),
    suggestionChips: document.querySelectorAll('[data-suggestion]').length,
  }
  // 设置弹窗开关验证
  const settingsBtn = document.querySelector('button[title="设置"]')
  if (settingsBtn) settingsBtn.click()
  await sleep(450)
  out.settingsOpen = !!document.querySelector('[data-settings]')
  out.settingsModelRows = document.querySelectorAll('[data-settings-model]').length
  out.settingsNameInput = !!document.querySelector('[data-settings-name]')
  out.settingsBaseUrlInput = !!document.querySelector('[data-settings-baseurl]')
  out.settingsApiKeyInput = !!document.querySelector('[data-settings-apikey]')
  out.settingsModelIdInput = !!document.querySelector('[data-settings-modelid]')
  out.settingsProxyInput = !!document.querySelector('[data-proxy-input]')
  const closeSettings = document.querySelector('button[aria-label="关闭设置"]')
  if (closeSettings) closeSettings.click()
  await sleep(350)
  out.settingsClosed = !document.querySelector('[data-settings]')

  // 命令面板：Ctrl+K 打开 → 输入过滤 → Esc 关闭
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  await sleep(400)
  out.paletteOpen = !!document.querySelector('[data-command-palette]')
  out.paletteItems = document.querySelectorAll('[data-palette-item]').length
  const q = document.querySelector('[data-palette-input]')
  if (q) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(q, '冒烟')
    q.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await sleep(300)
  out.paletteFiltered = document.querySelectorAll('[data-palette-item]').length
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(300)
  out.paletteClosed = !document.querySelector('[data-command-palette]')

  // 检查器：折叠/展开往返（黑屏回归断言）
  const collapseBtn = document.querySelector('button[title="收起面板"]')
  if (collapseBtn) collapseBtn.click()
  await sleep(350)
  out.collapseWorks =
    !document.querySelector('[data-inspector-open]') &&
    !!document.getElementById('root')
  const expandBtn = document.querySelector('button[aria-label="展开面板"]')
  if (expandBtn) expandBtn.click()
  await sleep(350)
  out.expandWorks = !!document.querySelector('[data-inspector-open]')

  // 检查器：引用 tab / 工具 tab / 信息 tab
  const refsTab = Array.from(document.querySelectorAll('aside button')).find((b) =>
    (b.textContent || '').includes('引用')
  )
  if (refsTab) refsTab.click()
  await sleep(300)
  out.inspectorRefs = document.querySelectorAll('[data-inspector-ref]').length
  const toolsTab = Array.from(document.querySelectorAll('aside button')).find((b) =>
    (b.textContent || '').includes('工具调用')
  )
  if (toolsTab) toolsTab.click()
  await sleep(300)
  out.inspectorToolStep = !!document.querySelector('[data-inspector-toolstep]')
  const infoTab = Array.from(document.querySelectorAll('aside button')).find((b) =>
    (b.textContent || '').includes('信息')
  )
  if (infoTab) infoTab.click()
  await sleep(300)
  out.exportMdBtn = !!document.querySelector('[data-export-md]')
  out.exportJsonBtn = !!document.querySelector('[data-export-json]')
  out.usageMeta = (document.querySelector('[data-usage]') || {}).textContent || ''
  out.usageSummary = (document.querySelector('[data-usage-summary]') || {}).textContent || ''

  // 导出按钮 UI 点击流程（冒烟模式直写 userData/exports）
  const exportMdBtn = document.querySelector('[data-export-md]')
  if (exportMdBtn) exportMdBtn.click()
  out.exportUiDone = await waitFor(() => !!document.querySelector('[data-export-done]'), 8000)
  await sleep(600)

  // 模板菜单
  const promptBtn = document.querySelector('[data-prompt-btn]')
  if (promptBtn) promptBtn.click()
  await sleep(300)
  out.promptMenuOpen = !!document.querySelector('[data-prompt-menu]')
  out.templateItems = document.querySelectorAll('[data-template-item]').length
  const chatTpl = Array.from(document.querySelectorAll('[data-template-item]')).find(
    (b) => (b.textContent || '').includes('翻译助手')
  )
  if (chatTpl) chatTpl.click()
  await sleep(300)
  out.promptMenuClosed = !document.querySelector('[data-prompt-menu]')
  out.inputHasTemplate = (
    (document.querySelector('textarea[placeholder="给 Aurora 发送消息…"]') || {}).value || ''
  ).includes('翻译成中文')

  // 复制消息（主进程稍后验证剪贴板）
  const copyBtn = document.querySelector('button[aria-label="复制消息"]')
  if (copyBtn) copyBtn.click()
  await sleep(400)

  // 错误重试：点击错误卡片的"重试"按钮
  const retryBtn = document.querySelector('[data-error-retry]')
  out.retryBtnExists = !!retryBtn
  if (retryBtn) retryBtn.click()
  out.retryStarted = await waitFor(() => !!document.querySelector('button[aria-label="停止"]'), 8000)
  out.retryDone = await waitFor(() => !document.querySelector('button[aria-label="停止"]'), 20000)
  await sleep(300)
  out.retryWorks = !document.querySelector('[data-error]')
  out.msgAfterRetry = document.querySelectorAll('[data-role]').length

  // 编辑消息并重发（分支截断）
  const editBtn = document.querySelector('button[aria-label="编辑消息"]')
  if (editBtn) editBtn.click()
  await sleep(300)
  const editInput = document.querySelector('[data-msg-edit-input]')
  if (editInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(editInput, '编辑后的冒烟消息')
    editInput.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const editSave = document.querySelector('[data-msg-edit-save]')
  if (editSave) editSave.click()
  out.editStarted = await waitFor(() => !!document.querySelector('button[aria-label="停止"]'), 8000)
  out.editFlowDone = await waitFor(() => !document.querySelector('button[aria-label="停止"]'), 20000)
  await sleep(300)
  out.editMsgs = document.querySelectorAll('[data-role]').length
  out.editNoError = !document.querySelector('[data-error]')

  // 重新生成助手回复
  const regenBtn = document.querySelector('button[aria-label="重新生成"]')
  if (regenBtn) regenBtn.click()
  out.regenStarted = await waitFor(() => !!document.querySelector('button[aria-label="停止"]'), 8000)
  out.regenFlowDone = await waitFor(() => !document.querySelector('button[aria-label="停止"]'), 20000)
  await sleep(300)
  out.regenMsgs = document.querySelectorAll('[data-role]').length
  out.regenNoError = !document.querySelector('[data-error]')

  // Ctrl+N 新对话（清空消息区）
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
  await sleep(400)
  out.ctrlNCleared = document.querySelectorAll('[data-role]').length === 0
  out.ctrlNActiveNull = !document.querySelector('[data-conv-item][data-active="true"]')

  // 模型下拉切换（最后执行，避免影响前面的 mock 流）
  const pill = document.querySelector('[data-model-pill]')
  if (pill) pill.click()
  await sleep(300)
  const modelItems = document.querySelectorAll('[data-model-item]')
  out.modelMenuItems = modelItems.length
  if (modelItems[1]) modelItems[1].click()
  await sleep(300)
  out.modelPillAfterSwitch = (
    (document.querySelector('[data-model-pill]') || {}).textContent || ''
  )
  const pill2 = document.querySelector('[data-model-pill]')
  if (pill2) pill2.click()
  await sleep(300)
  const modelItems2 = document.querySelectorAll('[data-model-item]')
  if (modelItems2[0]) modelItems2[0].click()
  await sleep(300)
  out.modelPillRestored = (
    (document.querySelector('[data-model-pill]') || {}).textContent || ''
  )
  return out
})()
`

async function runSmoke(w: BrowserWindow, errors: string[]): Promise<void> {
  bootLog('runSmoke start')
  const shotsDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'shots')
    : path.join(__dirname, '../../shots')
  fs.mkdirSync(shotsDir, { recursive: true })

  const failures: string[] = []
  const report: Record<string, unknown> = {}

  // MCP：配置内置 mock 服务器并验证握手与工具调用
  const mockMcpScript = app.isPackaged
    ? path.join(process.resourcesPath, 'mock-mcp-server.mjs')
    : path.join(__dirname, '../../scripts/mock-mcp-server.mjs')
  const mcpStatus = await mcpManager.configure([
    {
      id: 'mock_server',
      name: 'Mock MCP',
      command: 'node',
      args: [mockMcpScript],
      enabled: true,
    },
  ])
  report.mcpStatus = mcpStatus
  if (mcpStatus.connected.includes('mock_server')) {
    report.mcpToolCount = mcpManager.getToolDefs().length
    const echo = await mcpManager.callTool('mcp__mock_server__echo', {
      text: 'aurora-mcp-ok',
    })
    report.mcpEchoResult = echo.ok ? echo.result : `ERR: ${echo.error}`
  }

  // 知识库：真实建库与 BM25 检索验证
  const kbDir = path.join(app.getPath('userData'), 'kb-smoke')
  fs.mkdirSync(kbDir, { recursive: true })
  fs.writeFileSync(
    path.join(kbDir, 'aurora-notes.md'),
    '# Aurora 笔记\n\nAurora 是苹果风格的 DeepSeek 桌面工作台，支持流式对话、工具调用与知识库检索。\n',
    'utf-8',
  )
  fs.writeFileSync(
    path.join(kbDir, 'meeting.md'),
    '# 会议纪要\n\n本周讨论了知识库检索的引用溯源方案，确定使用本地 BM25 索引，文档不出本机。\n',
    'utf-8',
  )
  const kbRow = await kbManager.addFolder(kbDir)
  report.kbFiles = kbRow.fileCount
  const kbSearch = kbManager.search('知识库 检索', 5)
  report.kbSearchHits = kbSearch.refs.length
  report.kbSearchTitle = kbSearch.refs[0]?.title ?? ''
  const todayStr = new Date().toISOString().slice(0, 10)
  report.autoBackupOk = fs.existsSync(
    path.join(app.getPath('userData'), 'backups', `aurora-smoke-${todayStr}.db`),
  )
  // 代理设置存取验证（真实网络请求不测，仅验证配置链路）
  setSetting('proxyUrl', 'http://127.0.0.1:7890')
  report.proxySettingOk = getSetting('proxyUrl') === 'http://127.0.0.1:7890'
  setSetting('proxyUrl', '')

  // 等待渲染层完成三阶段验证：① Mock 完整流式 ② 中途停止截断 ③ 会话切换/持久化
  let stopVerified: { stoppedEarly: boolean; errored: boolean } | null = null
  ipcMain.on('smoke:stop-verified', (_e, p) => {
    stopVerified = p
  })
  let convVerified: {
    listCount: number
    firstTitle: string
    emptyOk: boolean
    restoredCount: number
  } | null = null
  let convResolve: (() => void) | null = null
  const convDone = new Promise<void>((resolve) => {
    convResolve = resolve
  })
  ipcMain.on('smoke:conv-verified', (_e, p) => {
    convVerified = p
    if (convResolve) {
      convResolve()
      convResolve = null
    }
  })
  await Promise.race([convDone, new Promise((r) => setTimeout(r, 45000))])
  bootLog('conv-verified: ' + JSON.stringify(convVerified))
  if (!convVerified) {
    const diag = await w.webContents
      .executeJavaScript(
        `({ ready: document.readyState, root: !!document.getElementById('root'), scripts: document.scripts.length, title: document.title, url: location.href })`,
        true,
      )
      .catch((e) => String(e))
    bootLog('conv-timeout diag: ' + JSON.stringify(diag))
    bootLog('conv-timeout errors: ' + JSON.stringify(errors.slice(0, 10)))
  }
  report.stopVerified = stopVerified
  report.convVerified = convVerified

  // 等待导出验证
  let exportVerified: { mdOk: boolean; jsonOk: boolean; pathOk: boolean } | null = null
  let exportResolve: (() => void) | null = null
  const exportDone = new Promise<void>((resolve) => {
    exportResolve = resolve
  })
  ipcMain.on('smoke:export-verified', (_e, p) => {
    exportVerified = p
    if (exportResolve) {
      exportResolve()
      exportResolve = null
    }
  })
  await Promise.race([exportDone, new Promise((r) => setTimeout(r, 40000))])
  bootLog('export-verified: ' + JSON.stringify(exportVerified))
  report.exportVerified = exportVerified

  // 等待系统提示词注入验证
  let promptVerified: { sent: boolean; sysOk: boolean } | null = null
  let promptResolve: (() => void) | null = null
  const promptDone = new Promise<void>((resolve) => {
    promptResolve = resolve
  })
  ipcMain.on('smoke:prompt-verified', (_e, p) => {
    promptVerified = p
    if (promptResolve) {
      promptResolve()
      promptResolve = null
    }
  })
  await Promise.race([promptDone, new Promise((r) => setTimeout(r, 40000))])
  bootLog('prompt-verified: ' + JSON.stringify(promptVerified))
  report.promptVerified = promptVerified

  // 等待工具调用端到端验证
  let toolsVerified: { done: boolean; steps: number } | null = null
  let toolsResolve: (() => void) | null = null
  const toolsDone = new Promise<void>((resolve) => {
    toolsResolve = resolve
  })
  ipcMain.on('smoke:tools-verified', (_e, p) => {
    toolsVerified = p
    if (toolsResolve) {
      toolsResolve()
      toolsResolve = null
    }
  })
  await Promise.race([toolsDone, new Promise((r) => setTimeout(r, 40000))])
  bootLog('tools-verified: ' + JSON.stringify(toolsVerified))
  report.toolsVerified = toolsVerified
  // 立即检查工作目录文件与 DB 步骤落盘（后续编辑测试会截断消息）
  const helloPath = path.join(app.getPath('userData'), 'workspace', 'hello.py')
  report.helloExists = fs.existsSync(helloPath)
  report.helloContent = fs.existsSync(helloPath)
    ? fs.readFileSync(helloPath, 'utf-8').slice(0, 60)
    : ''
  const convBeforeEdit = listConversations().find((c) =>
    c.title.startsWith('冒烟测试'),
  )
  report.toolStepsInDb = convBeforeEdit
    ? listMessages(convBeforeEdit.id).some(
        (m) => m.toolStepsJson && m.toolStepsJson.length > 10,
      )
    : false

  // 等待系统命令端到端验证
  let shellVerified: { done: boolean; shellOk: boolean } | null = null
  let shellResolve: (() => void) | null = null
  const shellDone = new Promise<void>((resolve) => {
    shellResolve = resolve
  })
  ipcMain.on('smoke:shell-verified', (_e, p) => {
    shellVerified = p
    if (shellResolve) {
      shellResolve()
      shellResolve = null
    }
  })
  await Promise.race([shellDone, new Promise((r) => setTimeout(r, 40000))])
  bootLog('shell-verified: ' + JSON.stringify(shellVerified))
  report.shellVerified = shellVerified
  // 白名单单元验证 + Python 可用性检测与直执行
  report.whitelistUnitOk =
    isShellAllowed('git status', []) === false &&
    isShellAllowed('git status', ['git ']) === true &&
    isShellAllowed('echo hi', ['echo*']) === true
  const pyCheck = spawnSync('python', ['--version'], { encoding: 'utf-8' })
  report.pythonAvailable = pyCheck.status === 0
  if (report.pythonAvailable) {
    const pr = await runPython('print(6*7)')
    report.pythonResult = pr.ok ? pr.result : `ERR: ${pr.error}`
  }

  // 等待联网搜索端到端验证
  let netVerified: { done: boolean; refsOk: boolean } | null = null
  let netResolve: (() => void) | null = null
  const netDone = new Promise<void>((resolve) => {
    netResolve = resolve
  })
  ipcMain.on('smoke:net-verified', (_e, p) => {
    netVerified = p
    if (netResolve) {
      netResolve()
      netResolve = null
    }
  })
  await Promise.race([netDone, new Promise((r) => setTimeout(r, 40000))])
  report.netVerified = netVerified
  // 真实网络探测（仅记录，不作断言）
  try {
    const probe = await fetch('https://www.bing.com', {
      signal: AbortSignal.timeout(5000),
    })
    report.realNetworkOk = probe.ok
  } catch {
    report.realNetworkOk = false
  }

  // 等待 MCP Agent 端到端验证
  let mcpVerified: { done: boolean; mcpOk: boolean } | null = null
  let mcpResolve: (() => void) | null = null
  const mcpDone = new Promise<void>((resolve) => {
    mcpResolve = resolve
  })
  ipcMain.on('smoke:mcp-verified', (_e, p) => {
    mcpVerified = p
    if (mcpResolve) {
      mcpResolve()
      mcpResolve = null
    }
  })
  await Promise.race([mcpDone, new Promise((r) => setTimeout(r, 40000))])
  report.mcpVerified = mcpVerified

  // 等待知识库 Agent 端到端验证
  let kbVerified: { done: boolean; refsOk: boolean } | null = null
  let kbResolve: (() => void) | null = null
  const kbDone = new Promise<void>((resolve) => {
    kbResolve = resolve
  })
  ipcMain.on('smoke:kb-verified', (_e, p) => {
    kbVerified = p
    if (kbResolve) {
      kbResolve()
      kbResolve = null
    }
  })
  await Promise.race([kbDone, new Promise((r) => setTimeout(r, 40000))])
  report.kbVerified = kbVerified

  // 等待错误与重试验证
  let errorVerified: { done: boolean; errorShown: boolean } | null = null
  let errResolve: (() => void) | null = null
  const errDone = new Promise<void>((resolve) => {
    errResolve = resolve
  })
  ipcMain.on('smoke:error-verified', (_e, p) => {
    errorVerified = p
    if (errResolve) {
      errResolve()
      errResolve = null
    }
  })
  await Promise.race([errDone, new Promise((r) => setTimeout(r, 40000))])
  report.errorVerified = errorVerified

  // 浅色阶段
  nativeTheme.themeSource = 'light'
  await new Promise((r) => setTimeout(r, 1200))
  const light = await w.webContents.capturePage()
  fs.writeFileSync(path.join(shotsDir, 'smoke-light.png'), light.toPNG())

  const lightStats = sampleStats(light, { x: 0, y: 0, w: 1280, h: 820 })
  report.lightMeanLum = +lightStats.mean.toFixed(3)
  report.lightVariance = +lightStats.variance.toFixed(4)

  // 深色阶段
  nativeTheme.themeSource = 'dark'
  await new Promise((r) => setTimeout(r, 1000))
  const dark = await w.webContents.capturePage()
  fs.writeFileSync(path.join(shotsDir, 'smoke-dark.png'), dark.toPNG())
  const darkStats = sampleStats(dark, { x: 0, y: 0, w: 1280, h: 820 })
  report.darkMeanLum = +darkStats.mean.toFixed(3)
  report.globalShortcut = globalShortcut.isRegistered('CommandOrControl+Shift+A')

  // DOM 审计
  const dom = (await w.webContents.executeJavaScript(DOM_AUDIT, true)) as Record<
    string,
    any
  >
  report.dom = dom

  // ---- 断言 ----
  if (lightStats.mean < 0.55) failures.push('浅色界面整体偏暗')
  if (darkStats.mean > 0.28) failures.push('深色界面整体偏亮')
  if (!(lightStats.mean > darkStats.mean + 0.15))
    failures.push('浅深色亮度差不足，主题切换未生效')
  if (lightStats.variance < 0.002) failures.push('画面方差过低，疑似空白')
  if (dom.root !== true) failures.push('root 未渲染')
  if (dom.winMinBtn !== true || dom.winMaxBtn !== true || dom.winCloseBtn !== true)
    failures.push('Windows 窗口按钮缺失')
  if (dom.winCloseX < 1100) failures.push(`关闭按钮不在右上角: x=${dom.winCloseX}`)
  if (dom.titlebarH !== 32) failures.push(`标题栏高度错误: ${dom.titlebarH}`)
  if (!(dom.sidebarW >= 240 && dom.sidebarW <= 300))
    failures.push(`侧边栏宽度异常: ${dom.sidebarW}`)
  if (!(dom.inspectorW >= 260 && dom.inspectorW <= 340))
    failures.push(`检查器宽度异常: ${dom.inspectorW}`)
  if (dom.chatW < 600) failures.push(`对话区宽度异常: ${dom.chatW}`)
  if (dom.overflowX === true) failures.push('存在水平溢出')
  if (dom.messages !== 18) failures.push(`冒烟消息数量错误: ${dom.messages}`)
  // 气泡宽度固定：应铺满消息容器（不随内容长度变化）
  if (dom.assistantBubbleW < 600)
    failures.push(`助手气泡未固定全宽: ${dom.assistantBubbleW}`)
  if (
    dom.assistantWrapperW > 0 &&
    Math.abs(dom.assistantBubbleW - dom.assistantWrapperW) > 4
  )
    failures.push(`气泡宽 ${dom.assistantBubbleW} ≠ 容器宽 ${dom.assistantWrapperW}`)
  if (dom.sendBtn !== true || dom.newChatBtn !== true) failures.push('关键按钮缺失')
  if (dom.darkClass !== true) failures.push('深色截图阶段 dark 类未应用')
  // 聊天核心断言
  const sv = stopVerified as { stoppedEarly: boolean; errored: boolean } | null
  if (sv?.stoppedEarly !== true)
    failures.push(
      '中途停止验证失败: ' + (sv ? JSON.stringify(sv) : '未收到结果'),
    )
  if (sv?.errored !== false) failures.push('停止后消息进入了错误状态')
  // 会话管理断言
  const cv = convVerified as {
    listCount: number
    firstTitle: string
    emptyOk: boolean
    restoredCount: number
  } | null
  if (!cv) failures.push('会话切换验证未在超时内完成')
  else {
    if (cv.listCount !== 2) failures.push(`会话数量错误: ${cv.listCount}`)
    if (!cv.firstTitle.startsWith('冒烟测试'))
      failures.push(`自动标题异常: ${cv.firstTitle}`)
    if (cv.emptyOk !== true) failures.push('切换到新会话后消息未清空')
    if (cv.restoredCount !== 4)
      failures.push(`切回后消息恢复数量错误: ${cv.restoredCount}`)
  }
  // 数据库落盘断言（编辑/重生成后：2 条消息）
  const convs = listConversations()
  if (convs.length !== 2) failures.push(`DB 会话数错误: ${convs.length}`)
  const firstConv = convs.find((c) => c.title.startsWith('冒烟测试'))
  if (firstConv) {
    const msgs = listMessages(firstConv.id)
    if (msgs.length !== 2)
      failures.push(`DB 消息数错误(编辑后应为 2): ${msgs.length}`)
    const hasEdited = msgs.some((m) => m.content.includes('编辑后的冒烟消息'))
    if (!hasEdited) failures.push('DB 中未找到编辑后的消息')
    const hasCode = msgs.some((m) => m.content.includes('快速示例'))
    if (!hasCode) failures.push('DB 中未找到流式内容')
    const hasReasoning = msgs.some((m) => m.reasoning.length > 10)
    if (!hasReasoning) failures.push('DB 中思维链内容缺失')
    const hasUsage = msgs.some((m) => {
      try {
        const u = JSON.parse(m.usageJson)
        return u.total_tokens === 242
      } catch {
        return false
      }
    })
    if (!hasUsage) failures.push('DB 中 usage 落盘缺失')
    const hasDuration = msgs.some((m) => m.durationMs > 0)
    if (!hasDuration) failures.push('DB 中耗时落盘缺失')
  } else {
    failures.push('DB 中未找到冒烟会话')
  }
  // 剪贴板验证（复制消息按钮）
  const clip = clipboard.readText()
  report.clipboard = clip.slice(0, 30)
  if (clip !== '冒烟测试：请演示一个包含代码、公式和列表的综合示例')
    failures.push(`剪贴板内容不符: ${clip.slice(0, 30)}`)
  if (dom.reasoning !== true) failures.push('思维链面板缺失')
  if (dom.codeBlock !== true) failures.push('代码块缺失')
  if (dom.hljs !== true) failures.push('语法高亮未应用')
  if (dom.katex !== true) failures.push('KaTeX 公式未渲染')
  if (dom.copyBtn !== true) failures.push('复制按钮缺失')
  if (dom.stopBtn !== false) failures.push('对话结束后停止按钮仍存在')
  if (dom.errorCard !== true) failures.push('预期错误卡片缺失（错误场景未生效）')
  if (dom.sidebarItems !== 2) failures.push(`侧边栏会话数错误: ${dom.sidebarItems}`)
  if (!String(dom.activeConv).includes('冒烟测试'))
    failures.push(`侧边栏激活项异常: ${dom.activeConv}`)
  if (dom.convSearch !== true) failures.push('会话搜索框缺失')
  if (!String(dom.titlebarTitle).startsWith('冒烟测试'))
    failures.push(`标题栏标题异常: ${dom.titlebarTitle}`)
  // 设置弹窗断言
  if (dom.settingsOpen !== true) failures.push('设置弹窗未打开')
  if (dom.settingsModelRows < 3) failures.push(`设置模型列表数量异常: ${dom.settingsModelRows}`)
  if (
    dom.settingsNameInput !== true ||
    dom.settingsBaseUrlInput !== true ||
    dom.settingsApiKeyInput !== true ||
    dom.settingsModelIdInput !== true ||
    dom.settingsProxyInput !== true
  )
    failures.push('设置表单字段缺失')
  if (dom.settingsClosed !== true) failures.push('设置弹窗未关闭')
  // 导出验证
  const ev = exportVerified as {
    mdOk: boolean
    jsonOk: boolean
    pathOk: boolean
  } | null
  if (!ev) failures.push('导出验证未在超时内完成')
  else {
    if (ev.mdOk !== true) failures.push('Markdown 导出内容异常')
    if (ev.jsonOk !== true) failures.push('JSON 导出内容异常')
    if (ev.pathOk !== true) failures.push('导出路径缺失')
  }
  // 附件按钮
  if (dom.attachBtn !== true) failures.push('附件按钮缺失')
  // 命令面板与快捷键断言
  if (dom.paletteOpen !== true) failures.push('命令面板未打开')
  if (dom.paletteItems < 5) failures.push(`命令面板条目过少: ${dom.paletteItems}`)
  if (dom.paletteFiltered < 1 || dom.paletteFiltered > 2)
    failures.push(`命令面板过滤异常: ${dom.paletteFiltered}`)
  if (dom.paletteClosed !== true) failures.push('命令面板 Esc 未关闭')
  if (dom.ctrlNCleared !== true) failures.push('Ctrl+N 未清空消息')
  if (dom.ctrlNActiveNull !== true) failures.push('Ctrl+N 后激活会话未清除')
  // 对话增强断言
  if (dom.exportMdBtn !== true || dom.exportJsonBtn !== true)
    failures.push('导出按钮缺失')
  if (dom.exportUiDone !== true) failures.push('导出按钮点击无反馈')
  if (dom.collapseWorks !== true) failures.push('检查器折叠失败（可能崩溃）')
  if (dom.expandWorks !== true) failures.push('检查器展开失败')
  if (dom.modelMenuItems < 3) failures.push(`模型菜单条目过少: ${dom.modelMenuItems}`)
  if (String(dom.modelPillAfterSwitch) === String(dom.modelPillRestored))
    failures.push('模型切换未生效')
  // Token 统计断言
  const usageMeta = String(dom.usageMeta)
  if (!usageMeta.includes('tokens') || !usageMeta.includes('耗时') || !usageMeta.includes('≈¥'))
    failures.push(`消息用量 meta 缺失: ${usageMeta}`)
  if (!String(dom.usageSummary).includes('484'))
    failures.push(`用量总览缺失: ${String(dom.usageSummary).slice(0, 60)}`)
  // 提示词系统断言
  const pv = promptVerified as { sent: boolean; sysOk: boolean } | null
  if (!pv || pv.sent !== true || pv.sysOk !== true)
    failures.push('系统提示词注入验证失败: ' + JSON.stringify(pv))
  const lastReq = getSmokeChatRequests().slice(-1)[0]
  if (
    !lastReq ||
    lastReq.messages[0]?.role !== 'system' ||
    lastReq.messages[0]?.content !== '会话级冒烟覆盖提示词'
  )
    failures.push(
      '请求未包含会话级系统提示词: ' + JSON.stringify(lastReq?.messages?.[0]),
    )
  if (dom.promptMenuOpen !== true) failures.push('模板菜单未打开')
  if (dom.templateItems < 6) failures.push(`模板条目过少: ${dom.templateItems}`)
  if (dom.promptMenuClosed !== true) failures.push('模板菜单未关闭')
  if (dom.inputHasTemplate !== true) failures.push('模板未填入输入框')
  // 工具调用断言
  const tv = toolsVerified as { done: boolean; steps: number } | null
  if (!tv || tv.done !== true)
    failures.push('工具调用端到端验证失败: ' + JSON.stringify(tv))
  if (tv && tv.steps < 1) failures.push(`工具步骤数异常: ${tv.steps}`)
  if (report.helloExists !== true)
    failures.push('工作目录 hello.py 未落盘')
  if (!String(report.helloContent).includes('hello from aurora'))
    failures.push(`hello.py 内容异常: ${report.helloContent}`)
  if (report.toolStepsInDb !== true) failures.push('DB 中工具步骤未落盘')
  if (dom.toolStepCards < 5) failures.push(`消息内工具步骤卡片不足: ${dom.toolStepCards}`)
  if (dom.inspectorToolStep !== true) failures.push('检查器工具 tab 步骤缺失')
  // 系统命令断言
  const shv = shellVerified as { done: boolean; shellOk: boolean } | null
  if (!shv || shv.done !== true)
    failures.push('系统命令端到端验证失败: ' + JSON.stringify(shv))
  if (shv && shv.shellOk !== true) failures.push('shell 步骤结果未包含 aurora-shell-ok')
  if (report.whitelistUnitOk !== true) failures.push('命令白名单匹配逻辑异常')
  if (report.pythonAvailable === true && !String(report.pythonResult).includes('42'))
    failures.push(`run_python 输出异常: ${report.pythonResult}`)
  // 联网能力断言
  const nv = netVerified as { done: boolean; refsOk: boolean } | null
  if (!nv || nv.done !== true)
    failures.push('联网搜索端到端验证失败: ' + JSON.stringify(nv))
  if (nv && nv.refsOk !== true) failures.push('搜索引用数量不足 3')
  if (dom.refCards < 4) failures.push(`消息内引用卡片不足: ${dom.refCards}`)
  if (dom.inspectorRefs < 4) failures.push(`检查器引用 tab 不足: ${dom.inspectorRefs}`)
  // MCP 断言
  const ms = report.mcpStatus as { connected?: string[]; errors?: string[] } | undefined
  if (!ms || !ms.connected || !ms.connected.includes('mock_server'))
    failures.push('MCP 服务器未连接: ' + JSON.stringify(report.mcpStatus))
  if (Number(report.mcpToolCount) < 1) failures.push(`MCP 工具未注册: ${report.mcpToolCount}`)
  if (!String(report.mcpEchoResult).includes('aurora-mcp-ok'))
    failures.push(`MCP echo 结果异常: ${report.mcpEchoResult}`)
  const mcv = mcpVerified as { done: boolean; mcpOk: boolean } | null
  if (!mcv || mcv.done !== true)
    failures.push('MCP Agent 端到端验证失败: ' + JSON.stringify(mcv))
  if (mcv && mcv.mcpOk !== true) failures.push('MCP 步骤结果未回显 aurora-mcp-ok')
  // 知识库断言
  if (report.kbFiles !== 2) failures.push(`知识库文件数异常: ${report.kbFiles}`)
  if (Number(report.kbSearchHits) < 1) failures.push('知识库检索无命中')
  if (!String(report.kbSearchTitle).includes('aurora') && !String(report.kbSearchTitle).includes('meeting'))
    failures.push(`知识库检索标题异常: ${report.kbSearchTitle}`)
  const kbv = kbVerified as { done: boolean; refsOk: boolean } | null
  if (!kbv || kbv.done !== true)
    failures.push('知识库 Agent 端到端验证失败: ' + JSON.stringify(kbv))
  if (kbv && kbv.refsOk !== true) failures.push('知识库引用未渲染')
  // 错误与重试断言
  const erv = errorVerified as { done: boolean; errorShown: boolean } | null
  if (!erv || erv.done !== true || erv.errorShown !== true)
    failures.push('错误场景验证失败: ' + JSON.stringify(erv))
  if (dom.retryBtnExists !== true) failures.push('错误重试按钮缺失')
  if (dom.retryStarted !== true || dom.retryDone !== true)
    failures.push('重试流程未完成')
  if (dom.retryWorks !== true) failures.push('重试后错误卡片未消失')
  if (dom.msgAfterRetry !== 18) failures.push(`重试后消息数错误: ${dom.msgAfterRetry}`)
  // 自动备份断言
  if (report.autoBackupOk !== true) failures.push('自动备份未生成')
  if (report.proxySettingOk !== true) failures.push('代理设置存取异常')
  report.trayOk = trayCreated
  report.notifySupported = Notification.isSupported()
  if (trayCreated !== true) failures.push('系统托盘创建失败')
  if (dom.editStarted !== true || dom.editFlowDone !== true)
    failures.push('编辑重发流程未完成')
  if (dom.editMsgs !== 2) failures.push(`编辑后消息数错误: ${dom.editMsgs}`)
  if (dom.editNoError !== true) failures.push('编辑重发出现错误')
  if (dom.regenStarted !== true || dom.regenFlowDone !== true)
    failures.push('重新生成流程未完成')
  if (dom.regenMsgs !== 2) failures.push(`重新生成后消息数错误: ${dom.regenMsgs}`)
  if (dom.regenNoError !== true) failures.push('重新生成出现错误')
  if (report.globalShortcut !== true)
    failures.push(`全局快捷键未注册: ${report.globalShortcut}`)
  if (errors.length > 0) failures.push('控制台错误: ' + errors.join(' | '))

  console.log('[SMOKE] report: ' + JSON.stringify(report, null, 2))
  if (failures.length > 0) {
    console.error('[SMOKE] FAIL:\n  - ' + failures.join('\n  - '))
    app.exit(1)
  } else {
    console.log('[SMOKE] OK')
    app.exit(0)
  }
}

// ---- 窗口控制 ----
ipcMain.on('window:minimize', () => win?.minimize())
ipcMain.on('window:maximize-toggle', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('window:close', () => win?.close())
ipcMain.handle('window:is-maximized', () => win?.isMaximized() ?? false)

// ---- 主题 ----
ipcMain.handle('theme:get', () => nativeTheme.themeSource)
ipcMain.on('theme:set', (_e, source: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = source
})
nativeTheme.on('updated', () => {
  win?.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors)
})

// ---- 模型与设置 ----
ipcMain.handle('models:list', () => listModels())
ipcMain.handle('models:save', (_e, m) => {
  saveModel(m)
  return true
})
ipcMain.handle('models:delete', (_e, id: string) => {
  deleteModel(id)
  return true
})
ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  setSetting(key, value)
  return true
})

// ---- 会话与消息 ----
ipcMain.handle('conversations:list', () => listConversations())
ipcMain.handle('conversations:create', (_e, title: string) =>
  createConversation(title),
)
ipcMain.handle('conversations:rename', (_e, id: string, title: string) => {
  renameConversation(id, title)
  return true
})
ipcMain.handle('conversations:delete', (_e, id: string) => {
  deleteConversation(id)
  return true
})
ipcMain.handle('conversations:setPinned', (_e, id: string, pinned: boolean) => {
  setConversationPinned(id, pinned)
  return true
})
ipcMain.handle('conversations:getSystemPrompt', (_e, id: string) =>
  getConversationSystemPrompt(id),
)
ipcMain.handle('conversations:setSystemPrompt', (_e, id: string, text: string) => {
  setConversationSystemPrompt(id, text)
  return true
})
ipcMain.handle('messages:list', (_e, conversationId: string) =>
  listMessages(conversationId),
)
ipcMain.handle('messages:upsert', (_e, m) => {
  upsertMessage(m)
  return true
})
ipcMain.handle('messages:deleteFrom', (_e, conversationId: string, fromId: string) => {
  deleteMessagesFrom(conversationId, fromId)
  return true
})

// ---- 剪贴板（走主进程，避免渲染层 clipboard 权限问题）----
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  clipboard.writeText(text)
  return true
})

// ---- 打开外部链接 ----
ipcMain.handle('app:openExternal', (_e, url: string) => {
  if (SMOKE) return true // 冒烟不真打开
  if (/^https?:\/\//i.test(url)) {
    void shell.openExternal(url)
  } else if (url.startsWith('file:///')) {
    void shell.openPath(decodeURI(url.slice(8)))
  }
  return true
})

// ---- 知识库 ----
ipcMain.handle('kb:list', () => kbManager.list())
ipcMain.handle('kb:addFolder', async () => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: '选择知识库文件夹',
    properties: ['openDirectory'],
  })
  if (res.canceled || !res.filePaths[0]) return null
  return await kbManager.addFolder(res.filePaths[0])
})
ipcMain.handle('kb:remove', (_e, id: string) => {
  void kbManager.remove(id)
  return true
})
ipcMain.handle('kb:rebuild', (_e, id: string) => kbManager.rebuild(id))

// ---- MCP ----
ipcMain.handle('mcp:configure', async (_e, servers) => {
  return await mcpManager.configure(servers)
})

// ---- 会话导出 ----
ipcMain.handle(
  'conversation:export',
  async (_e, convId: string, format: 'md' | 'json') => {
    const conv = listConversations().find((c) => c.id === convId)
    const msgs = listMessages(convId)
    const title = conv?.title ?? '对话'
    let content: string
    let defaultName: string
    if (format === 'json') {
      content = JSON.stringify(
        {
          title,
          exportedAt: new Date().toISOString(),
          messages: msgs,
        },
        null,
        2,
      )
      defaultName = `${title}.json`
    } else {
      const lines = [
        `# ${title}`,
        '',
        `> 导出时间：${new Date().toLocaleString()}`,
        '',
      ]
      for (const m of msgs) {
        lines.push(`## ${m.role === 'user' ? '用户' : 'Aurora'}`)
        if (m.reasoning) {
          lines.push('', '<details><summary>思考过程</summary>', '')
          lines.push(...m.reasoning.split('\n').map((l) => `> ${l}`))
          lines.push('', '</details>')
        }
        lines.push('', m.content, '')
      }
      content = lines.join('\n')
      defaultName = `${title}.md`
    }
    // 冒烟模式直接落盘返回内容，避免原生保存对话框
    if (SMOKE) {
      const dir = path.join(app.getPath('userData'), 'exports')
      fs.mkdirSync(dir, { recursive: true })
      const p = path.join(dir, defaultName)
      fs.writeFileSync(p, content, 'utf-8')
      return { path: p, content }
    }
    if (!win) return { path: '', content: '' }
    const res = await dialog.showSaveDialog(win, {
      title: '导出会话',
      defaultPath: defaultName,
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (res.canceled || !res.filePath) return { path: '', content: '' }
    fs.writeFileSync(res.filePath, content, 'utf-8')
    return { path: res.filePath, content: '' }
  },
)

// ---- 文件选择 ----
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
const TEXT_EXT = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.py', '.js', '.ts', '.tsx',
  '.jsx', '.css', '.scss', '.html', '.xml', '.yml', '.yaml', '.log', '.sh',
  '.c', '.h', '.cpp', '.java', '.go', '.rs', '.sql', '.ini', '.toml',
]
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

ipcMain.handle('dialog:pickFiles', async () => {
  if (!win) return []
  const res = await dialog.showOpenDialog(win, {
    title: '选择附件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: IMAGE_EXT.map((e) => e.slice(1)) },
      { name: '文本与代码', extensions: TEXT_EXT.map((e) => e.slice(1)) },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (res.canceled) return []
  return res.filePaths.map((fp) => {
    const stat = fs.statSync(fp)
    const ext = path.extname(fp).toLowerCase()
    const isImage = IMAGE_EXT.includes(ext)
    const isText = TEXT_EXT.includes(ext)
    const out: Record<string, unknown> = {
      name: path.basename(fp),
      path: fp,
      size: stat.size,
      mime: MIME[ext] ?? 'application/octet-stream',
      isImage,
      isText,
    }
    if (isImage) {
      out.dataUrl = `data:${MIME[ext]};base64,${fs
        .readFileSync(fp)
        .toString('base64')}`
    }
    if (isText && stat.size < 200 * 1024) {
      out.content = fs.readFileSync(fp, 'utf-8')
    }
    return out
  })
})

// ---- 模型连接测试 ----
ipcMain.handle('models:test', async (_e, m) => {
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8000)
    const url = `${String(m.baseUrl).replace(/\/+$/, '')}/models`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${m.apiKey}` },
      signal: ac.signal,
    })
    clearTimeout(timer)
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as {
        data?: unknown[]
      } | null
      return {
        ok: true,
        models: Array.isArray(j?.data) ? j.data.length : null,
      }
    }
    return { ok: false, message: `HTTP ${res.status}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('abort')) {
      return { ok: false, message: '连接超时（8 秒）' }
    }
    return { ok: false, message: msg.slice(0, 200) }
  }
})

app.whenReady().then(async () => {
  bootLog('whenReady')
  try {
    await initDb({ file: SMOKE ? 'aurora-smoke.db' : 'aurora.db', fresh: SMOKE })
    bootLog('initDb ok')
  } catch (err) {
    bootLog('initDb failed: ' + String(err))
    throw err
  }
  await kbManager.init()
  bootLog('kb init ok')
  const backupPath = doAutoBackup()
  bootLog('auto backup: ' + (backupPath ?? 'skipped'))
  trayCreated = createTray()
  registerChatIpc(listModels)
  bootLog('chat ipc registered')
  // 恢复用户配置的 MCP 服务器（冒烟模式由 runSmoke 显式配置）
  if (!SMOKE) {
    try {
      await mcpManager.restoreFromSettings()
    } catch (err) {
      bootLog('mcp restore failed: ' + String(err))
    }
  }
  createWindow()
  bootLog('window created')

  // 全局唤起：Ctrl+Shift+A 显示/隐藏窗口
  const registered = globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!win) return
    if (win.isFocused()) {
      win.minimize()
    } else {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
  if (!registered) bootLog('globalShortcut register failed')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  saveWindowBounds()
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = null
  closeDb()
})
