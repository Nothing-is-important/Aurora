// Aurora 原生客户端主进程：进程内 DSH 引擎 + IPC 桥接（会话/流式/工具事件）
import { app, BrowserWindow, ipcMain, Menu, globalShortcut } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { bootEngine, disposeEngine, runtimeDir } from './engine.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SMOKE = process.env.SMOKE === '1'

// 独立 userData：不与 main 分支 Aurora（%APPDATA%\aurora）共享存储
app.setPath('userData', join(app.getPath('appData'), 'aurora-native'))

const DEV_URL = process.env.AURORA_DEV_URL ?? null // vite dev server（可选）

let win = null
let ctx = null
let quitting = false
let bootUrl = null

function mintSessionId() {
  return `aurora-${randomUUID()}`
}

// ---------- 引擎桥接 ----------
function engine() {
  if (!ctx) throw new Error('engine not booted')
  return ctx
}

/** 会话标题：日志里第一条用户消息的截断 */
function titleOf(session) {
  const evs = session?.events ?? []
  const first = evs.find((e) => e.type === 'user/message')
  const text = first?.data?.content ?? ''
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t ? (t.length > 24 ? t.slice(0, 24) : t) : '新会话'
}

async function listSessions() {
  const c = engine()
  const out = []
  const seen = new Set()
  try {
    const persisted = await c.sessionQuery.listSessions()
    for (const header of persisted) {
      if (seen.has(header.id)) continue
      seen.add(header.id)
      const live = c.sessions.get(header.id)
      out.push({
        id: header.id,
        title: live ? titleOf(live) : '历史会话',
        createdAt: header.createdAt,
        live: !!live,
      })
    }
  } catch (err) {
    console.error('[bridge] listSessions persisted failed:', err.message)
  }
  for (const s of c.sessions.list()) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push({ id: s.id, title: titleOf(s), createdAt: s.header?.createdAt ?? Date.now(), live: true })
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/** 打开会话：取活动 agent，必要时 resume；把完整历史事件回放给渲染层 */
async function openSession(sessionId) {
  const c = engine()
  let session = c.sessions.get(sessionId)
  if (!session) {
    const handle = await c.agents.resume({ resumeSessionId: sessionId })
    session = handle.agent.session
  }
  return { events: session.events, live: !!c.agents.get(sessionId) }
}

/** 发送用户消息：无活动 agent 则创建；有则 followup */
async function sendMessage(sessionId, text) {
  const c = engine()
  let agent = c.agents.get(sessionId)
  if (!agent) {
    // 会话已持久化但无活动 agent → resume；否则全新创建
    let session = c.sessions.get(sessionId)
    if (session) {
      const handle = await c.agents.resume({ resumeSessionId: sessionId })
      agent = handle.agent
    } else {
      const handle = await c.agents.create({
        sessionId,
        meta: { cwd: app.getPath('documents') },
      })
      agent = handle.agent
    }
  }
  agent.followup({ role: 'user', content: text })
  return { sessionId }
}

function stopAgent(sessionId) {
  const agent = engine().agents.get(sessionId)
  if (agent) agent.cancel({ kind: 'user' })
}

// ---------- Aurora 应用设置（userData/settings.json：DSH 数据目录等） ----------
let appSettings = {}
function saveAppSettings() {
  const file = join(app.getPath('userData'), 'settings.json')
  writeFileSync(file, JSON.stringify(appSettings, null, 2), 'utf8')
}

ipcMain.handle('app:settings:get', () => ({ dshHome: appSettings.dshHome ?? '' }))
ipcMain.handle('app:settings:set', async (_e, patch) => {
  const oldHome = appSettings.dshHome
  Object.assign(appSettings, patch)
  saveAppSettings()
  const newHome = appSettings.dshHome
  if (newHome && newHome !== oldHome) {
    // 数据目录变更：重启引擎（会话与凭据全部来自新目录）
    try {
      await disposeEngine()
    } catch {
      /* 引擎可能已停 */
    }
    ctx = null
    try {
      const booted = await bootEngine(newHome)
      ctx = booted.ctx
      if (sessionEventsOff) sessionEventsOff()
      sessionEventsOff = registerSessionEvents()
      return { restarted: true }
    } catch (err) {
      console.error('[aurora-native] re-boot failed:', err.message)
      return { restarted: false, error: err.message }
    }
  }
  return { restarted: false }
})

// ---------- 模型与凭据桥 ----------
function llmState() {
  const c = engine()
  const configured = (c.llm.listConfigurableProviders?.() ?? []).map((p) => ({
    id: p.provider,
    name: p.displayName,
    settingsNs: p.settingsNs,
  }))
  const live = new Set(c.llm.listProviders?.().map((p) => p.id) ?? [])
  let current = { provider: '', model: '' }
  try {
    current = c.agentDefaultModel.currentSelection() ?? { provider: '', model: '' }
  } catch {
    /* 无选择 */
  }
  // 每个提供商的模型目录（从 settings 命名空间的解析值取 models）
  const providers = configured.map((p) => {
    let models = []
    try {
      const desc = c.settings.describe({ redactSecrets: true }).find((x) => x.ns === p.settingsNs)
      models = Array.isArray(desc?.value?.models)
        ? desc.value.models.map((m) => ({ id: m.id, name: m.name ?? m.id, contextWindow: m.contextWindow }))
        : []
    } catch {
      /* 目录缺失 */
    }
    return { ...p, live: live.has(p.id), models }
  })
  return { providers, current }
}

function registerSessionEvents() {
  const off = ctx.on('session/event', (session, event) => {
    if (!win || win.isDestroyed()) return
    win.webContents.send('chat:event', {
      sessionId: session.id,
      event: { type: event.type, seq: event.seq, time: event.time, data: event.data },
    })
  })
  return off
}

let sessionEventsOff = null

function registerBridge() {
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:open', (_e, sessionId) => openSession(sessionId))
  ipcMain.handle('chat:send', (_e, sessionId, text) => sendMessage(sessionId, text))
  ipcMain.on('chat:stop', (_e, sessionId) => stopAgent(sessionId))
  ipcMain.handle('llm:state', () => llmState())
  ipcMain.handle('llm:select', (_e, provider, model) => {
    engine().agentDefaultModel.saveSelection({ provider, model })
    return llmState()
  })
  ipcMain.handle('credentials:has', async (_e, ref) => {
    const hit = await engine().credentials.resolve(ref)
    return hit !== undefined
  })
  ipcMain.handle('credentials:set', async (_e, ref, value) => {
    await engine().credentials.set(ref, String(value))
    return true
  })
  ipcMain.handle('credentials:unset', async (_e, ref) => {
    await engine().credentials.unset(ref)
    return true
  })
  ipcMain.on('win:minimize', () => win?.minimize())
  ipcMain.on('win:toggle-maximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('win:close', () => win?.close())

  if (sessionEventsOff) sessionEventsOff()
  sessionEventsOff = registerSessionEvents()
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0f', symbolColor: '#d5d5dc', height: 40 },
    backgroundColor: '#0b0b0f',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    win = null
  })
  const load = () => {
    if (DEV_URL) {
      void win.loadURL(DEV_URL)
    } else {
      void win.loadFile(join(__dirname, '..', 'dist', 'index.html'))
    }
  }
  load()
}

// ---------- 启动 ----------
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  try {
    // 读取 Aurora 应用设置（DSH 数据目录）
    const appSettingsFile = join(app.getPath('userData'), 'settings.json')
    try {
      if (existsSync(appSettingsFile)) {
        appSettings = JSON.parse(readFileSync(appSettingsFile, 'utf8'))
      }
    } catch {
      appSettings = {}
    }
    const dshHome = (appSettings.dshHome && String(appSettings.dshHome).trim()) || join(app.getPath('userData'), 'dsh-home')
    mkdirSync(dshHome, { recursive: true })
    const booted = await bootEngine(dshHome)
    ctx = booted.ctx
    bootUrl = booted.url
    console.log('[aurora-native] engine booted', bootUrl ? `(web at ${bootUrl})` : '(headless)', 'home =', dshHome)
    registerBridge()
    createWindow()
    globalShortcut.register('CommandOrControl+Shift+A', () => {
      if (!win) return
      if (win.isVisible()) win.hide()
      else {
        win.show()
        win.focus()
      }
    })
    if (SMOKE) await runSmoke()
  } catch (err) {
    console.error('[aurora-native] boot failed:', err)
    app.exit(1)
  }
})

// ---------- 冒烟 ----------
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

async function runSmoke() {
  const results = {}
  const failures = []
  const ok = (key, cond, detail) => {
    results[key] = detail !== undefined ? detail : cond
    if (!cond) failures.push(key)
  }
  try {
    ok('engineBooted', !!ctx)
    ok('webServing', bootUrl ? (await fetch(bootUrl)).ok : false, bootUrl)

    // 会话创建 + 事件流 + 历史回放
    const sid = mintSessionId()
    await sendMessage(sid, '冒烟：你好，请回复 OK')
    ok('agentLive', !!engine().agents.get(sid))

    // followup 入队后循环异步认领。全新 home 无模型配置：轮次会跑到
    // LLM 解析处并以 error 收尾（与官方客户端未配 Key 时行为一致），
    // 此断言验证「队列 → 轮次 → 引擎错误通道」全链路真实运行。
    const session = engine().sessions.get(sid)
    ok('sessionCreated', !!session)
    const turnRan = await waitFor(
      () => (engine().sessions.get(sid)?.events ?? []).some((e) => e.type === 'turn/end'),
      20000,
    )
    ok('turnLifecycleRan', turnRan)
    const endReasons = (engine().sessions.get(sid)?.events ?? [])
      .filter((e) => e.type === 'turn/end')
      .map((e) => e.data?.reason?.kind)
    ok('turnEndReasonValid', endReasons.some((k) => ['error', 'aborted', 'completed'].includes(k)), endReasons)

    // 停止
    stopAgent(sid)
    await sleep(500)
    const endEvents = (session?.events ?? []).filter((e) => e.type === 'turn/end')
    ok('turnEndedAfterStop', endEvents.length > 0, endEvents.map((e) => e.data?.reason?.kind))

    // 列表
    const list = await listSessions()
    ok('sessionListed', list.some((s) => s.id === sid), list.length)

    // 模型目录 + 默认模型选择
    const st = llmState()
    ok('llmProvidersListed', st.providers.length >= 1, st.providers.map((p) => p.id))
    ok(
      'llmModelsCatalogued',
      st.providers.some((p) => p.models.length >= 1),
      st.providers.map((p) => ({ id: p.id, models: p.models.length })),
    )
    const first = st.providers.find((p) => p.models.length > 0)
    if (first) {
      await engine().agentDefaultModel.saveSelection({ provider: first.id, model: first.models[0].id })
      const cur = llmState().current
      ok('llmSelectionSaved', cur.provider === first.id && cur.model === first.models[0].id, cur)
    }

    // 凭据 roundtrip（写入 .credentials.yaml → 读取存在 → 删除）
    const credRef = 'AURORA_SMOKE_KEY'
    await engine().credentials.set(credRef, 'sk-smoke')
    ok('credentialStored', (await engine().credentials.resolve(credRef)) !== undefined)
    await engine().credentials.unset(credRef)
    ok('credentialCleared', (await engine().credentials.resolve(credRef)) === undefined)

    // 渲染层加载
    await sleep(3000)
    ok('windowLoaded', win && win.webContents.getURL().length > 0, win?.webContents.getURL())
    const dom = await win.webContents.executeJavaScript(`({
      title: document.title,
      input: !!document.querySelector('textarea'),
      sidebar: !!document.querySelector('[data-session-list]'),
      sendBtn: !!document.querySelector('[data-send]'),
    })`).catch((e) => ({ error: String(e) }))
    ok('auroraUiRendered', dom.input === true && dom.sidebar === true, dom)

    // UI 交互：打开设置 → 面板/密钥框/模型选项就位 → 关闭
    const uiFlow = await win.webContents
      .executeJavaScript(`(async () => {
        const out = {}
        out.modelPill = !!document.querySelector('[data-model-pill]')
        document.querySelector('[data-open-settings]')?.click()
        await new Promise((r) => setTimeout(r, 700))
        out.settingsOpen = !!document.querySelector('[data-settings]')
        out.apiKeyInput = !!document.querySelector('[data-api-key]')
        out.modelOptions = document.querySelectorAll('[data-model-option]').length
        out.dshHomeInput = !!document.querySelector('[data-dsh-home]')
        // 关闭（点遮罩）
        const backdrop = document.querySelector('[data-settings]')
        backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 300))
        out.settingsClosed = !document.querySelector('[data-settings]')
        return out
      })()`)
      .catch((e) => ({ error: String(e) }))
    ok(
      'settingsUiWorks',
      uiFlow.settingsOpen === true &&
        uiFlow.apiKeyInput === true &&
        uiFlow.modelOptions >= 1 &&
        uiFlow.dshHomeInput === true &&
        uiFlow.settingsClosed === true &&
        uiFlow.modelPill === true,
      uiFlow,
    )

    const img = await win.webContents.capturePage()
    const shot = join(app.getPath('userData'), 'smoke-screenshot.png')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(shot, img.toPNG())
    ok('screenshotTaken', img.getSize().width > 0 && img.getSize().height > 0, shot)
  } catch (err) {
    ok('smokeRun', false, String(err))
  }

  results.failures = failures
  console.log('[SMOKE] report: ' + JSON.stringify(results, null, 2))
  console.log(failures.length === 0 ? '[SMOKE] OK' : '[SMOKE] FAIL:\n  - ' + failures.join('\n  - '))
  await disposeEngine()
  app.exit(failures.length === 0 ? 0 : 2)
}

app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})
app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (ctx) void disposeEngine()
})
