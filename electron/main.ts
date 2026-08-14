import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import type { NativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import {
  closeDb,
  deleteModel,
  getSetting,
  initDb,
  listModels,
  saveModel,
  setSetting,
} from './db'
import { registerChatIpc } from './chat'

const SMOKE = process.env.SMOKE === '1'
const DEV_URL = process.env.VITE_DEV_SERVER_URL

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

  if (SMOKE) void runSmoke(win, errors)
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
;(() => {
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const asides = document.querySelectorAll('aside')
  return {
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
    userMsg: !!document.querySelector('[data-role="user"]'),
    assistantMsg: !!document.querySelector('[data-role="assistant"]'),
    reasoning: !!document.querySelector('[data-reasoning]'),
    codeBlock: !!document.querySelector('.code-block'),
    hljs: !!document.querySelector('.hljs'),
    katex: !!document.querySelector('.katex'),
    copyBtn: !!document.querySelector('button[aria-label="复制代码"]'),
    stopBtn: !!document.querySelector('button[aria-label="停止"]'),
    errorCard: !!document.querySelector('[data-error]'),
    modelPill: (document.querySelector('[data-model-pill]') || {}).textContent || '',
    sendBtn: !!document.querySelector('button[aria-label="发送"]'),
    newChatBtn: !!document.querySelector('button[aria-label="新对话"]'),
    suggestionChips: document.querySelectorAll('[data-suggestion]').length,
  }
})()
`

async function runSmoke(w: BrowserWindow, errors: string[]): Promise<void> {
  const shotsDir = path.join(__dirname, '../../shots')
  fs.mkdirSync(shotsDir, { recursive: true })
  const failures: string[] = []
  const report: Record<string, unknown> = {}

  // 等待渲染层完成两阶段验证：① Mock 对话完整流式 ② 中途停止截断
  let stopVerified: { stoppedEarly: boolean; errored: boolean } | null = null
  let stopResolve: (() => void) | null = null
  const stopDone = new Promise<void>((resolve) => {
    stopResolve = resolve
  })
  ipcMain.on('smoke:stop-verified', (_e, p) => {
    stopVerified = p
    if (stopResolve) {
      stopResolve()
      stopResolve = null
    }
  })
  await Promise.race([stopDone, new Promise((r) => setTimeout(r, 35000))])
  report.stopVerified = stopVerified

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
  if (dom.sendBtn !== true || dom.newChatBtn !== true) failures.push('关键按钮缺失')
  if (dom.darkClass !== true) failures.push('深色截图阶段 dark 类未应用')
  // 聊天核心断言
  const sv = stopVerified as { stoppedEarly: boolean; errored: boolean } | null
  if (sv?.stoppedEarly !== true)
    failures.push(
      '中途停止验证失败: ' + (sv ? JSON.stringify(sv) : '未收到结果'),
    )
  if (sv?.errored !== false) failures.push('停止后消息进入了错误状态')
  if (dom.reasoning !== true) failures.push('思维链面板缺失')
  if (dom.codeBlock !== true) failures.push('代码块缺失')
  if (dom.hljs !== true) failures.push('语法高亮未应用')
  if (dom.katex !== true) failures.push('KaTeX 公式未渲染')
  if (dom.copyBtn !== true) failures.push('复制按钮缺失')
  if (dom.stopBtn !== false) failures.push('对话结束后停止按钮仍存在')
  if (dom.errorCard !== false) failures.push('出现了错误卡片')
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

app.whenReady().then(async () => {
  await initDb({ file: SMOKE ? 'aurora-smoke.db' : 'aurora.db', fresh: SMOKE })
  registerChatIpc(listModels)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeDb()
})
