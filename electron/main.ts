import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
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
  getSetting,
  initDb,
  listConversations,
  listMessages,
  listModels,
  renameConversation,
  saveModel,
  setConversationPinned,
  setSetting,
  upsertMessage,
} from './db'
import { registerChatIpc } from './chat'

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
  win.on('closed', () => {
    win = null
  })

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
    trafficLights: document.querySelectorAll('.traffic-light').length,
    closeBtn: !!document.querySelector('button[aria-label="关闭"]'),
    titlebarH: rect(document.querySelector('.drag'))?.h,
    sidebarW: rect(asides[0])?.w,
    inspectorW: rect(asides[1])?.w,
    chatW: rect(document.querySelector('main'))?.w,
    messages: document.querySelectorAll('[data-role]').length,
    msgsDetail: Array.from(document.querySelectorAll('[data-role]')).map((el) =>
      (el.getAttribute('data-role') + ':' + (el.textContent || '').slice(0, 20)).replace(/\\s+/g, ' ')
    ),
    smokeSends: window.__smokeSends || [],
    smokeMsgOps: (window.__smokeMsgOps || []).slice(-14),
    userMsg: !!document.querySelector('[data-role="user"]'),
    assistantMsg: !!document.querySelector('[data-role="assistant"]'),
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

  // 检查器信息 tab 与导出按钮
  const infoTab = Array.from(document.querySelectorAll('aside button')).find((b) =>
    (b.textContent || '').includes('信息')
  )
  if (infoTab) infoTab.click()
  await sleep(300)
  out.exportMdBtn = !!document.querySelector('[data-export-md]')
  out.exportJsonBtn = !!document.querySelector('[data-export-json]')
  out.usageMeta = (document.querySelector('[data-usage]') || {}).textContent || ''
  out.usageSummary = (document.querySelector('[data-usage-summary]') || {}).textContent || ''

  // 复制消息（主进程稍后验证剪贴板）
  const copyBtn = document.querySelector('button[aria-label="复制消息"]')
  if (copyBtn) copyBtn.click()
  await sleep(400)

  const waitFor = async (cond, timeout) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (cond()) return true
      await sleep(250)
    }
    return false
  }

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
  report.exportVerified = exportVerified

  // 浅色阶段
  nativeTheme.themeSource = 'light'
  await new Promise((r) => setTimeout(r, 1200))
  const light = await w.webContents.capturePage()
  fs.writeFileSync(path.join(shotsDir, 'smoke-light.png'), light.toPNG())

  const lightStats = sampleStats(light, { x: 0, y: 0, w: 1280, h: 820 })
  const tlRegion = { x: 0, y: 0, w: 120, h: 44 }
  const red = countNearColor(light, tlRegion, [255, 95, 87], 28)
  const yellow = countNearColor(light, tlRegion, [254, 188, 46], 28)
  const green = countNearColor(light, tlRegion, [40, 200, 64], 28)
  report.lightMeanLum = +lightStats.mean.toFixed(3)
  report.lightVariance = +lightStats.variance.toFixed(4)
  report.trafficPixels = { red, yellow, green }

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
  if (red < 3 || yellow < 3 || green < 3)
    failures.push(`交通灯像素不足 red=${red} yellow=${yellow} green=${green}`)
  if (lightStats.mean < 0.55) failures.push('浅色界面整体偏暗')
  if (darkStats.mean > 0.28) failures.push('深色界面整体偏亮')
  if (!(lightStats.mean > darkStats.mean + 0.15))
    failures.push('浅深色亮度差不足，主题切换未生效')
  if (lightStats.variance < 0.002) failures.push('画面方差过低，疑似空白')
  if (dom.root !== true) failures.push('root 未渲染')
  if (dom.trafficLights !== 3) failures.push(`交通灯数量错误: ${dom.trafficLights}`)
  if (dom.closeBtn !== true) failures.push('关闭按钮缺失')
  if (dom.titlebarH !== 44) failures.push(`标题栏高度错误: ${dom.titlebarH}`)
  if (!(dom.sidebarW >= 240 && dom.sidebarW <= 300))
    failures.push(`侧边栏宽度异常: ${dom.sidebarW}`)
  if (!(dom.inspectorW >= 260 && dom.inspectorW <= 340))
    failures.push(`检查器宽度异常: ${dom.inspectorW}`)
  if (dom.chatW < 600) failures.push(`对话区宽度异常: ${dom.chatW}`)
  if (dom.overflowX === true) failures.push('存在水平溢出')
  if (dom.messages !== 4) failures.push(`冒烟消息数量错误: ${dom.messages}`)
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
  if (dom.errorCard !== false) failures.push('出现了错误卡片')
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
    dom.settingsModelIdInput !== true
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
  // Token 统计断言
  const usageMeta = String(dom.usageMeta)
  if (!usageMeta.includes('tokens') || !usageMeta.includes('耗时') || !usageMeta.includes('≈¥'))
    failures.push(`消息用量 meta 缺失: ${usageMeta}`)
  if (!String(dom.usageSummary).includes('242'))
    failures.push(`用量总览缺失: ${String(dom.usageSummary).slice(0, 60)}`)
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
  registerChatIpc(listModels)
  bootLog('chat ipc registered')
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
  globalShortcut.unregisterAll()
  closeDb()
})
