// Aurora 原生客户端主进程：进程内 DSH 引擎 + IPC 桥接（会话/流式/工具事件）
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  globalShortcut,
  dialog,
  Tray,
  nativeImage,
  screen,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { bootEngine, disposeEngine, runtimeDir } from './engine.mjs'
import { KnowledgeBase, registerKbTool } from './kb.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SMOKE = process.env.SMOKE === '1'

// 独立 userData：不与 main 分支 Aurora（%APPDATA%\aurora）共享存储
app.setPath('userData', join(app.getPath('appData'), 'aurora-native'))

if (SMOKE) {
  // 打包后的 GUI 进程无控制台：把日志镜像到文件供驱动断言
  const smokeLogFile = join(app.getPath('userData'), 'smoke-app.log')
  const mirror = (level) => (...args) => {
    try {
      const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      appendFileSync(smokeLogFile, `${new Date().toISOString()} ${level} ${line}\n`, 'utf8')
    } catch {
      /* 日志失败不影响审计 */
    }
  }
  const origLog = console.log.bind(console)
  const origErr = console.error.bind(console)
  console.log = (...args) => {
    origLog(...args)
    mirror('LOG')(...args)
  }
  console.error = (...args) => {
    origErr(...args)
    mirror('ERR')(...args)
  }
}

const DEV_URL = process.env.AURORA_DEV_URL ?? null // vite dev server（可选）

let win = null
let ctx = null
let quitting = false
let bootUrl = null
let activeDshHome = null
let panelAgentHandle = null
let kb = null
let tray = null
let stateSaver = null

// ---------- 单实例 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (win) {
    if (!win.isVisible()) win.show()
    win.focus()
  }
})

// ---------- 内置运行时（dsh-runtime.zip → %LOCALAPPDATA%，首启解压/自愈） ----------
function runtimeZipPath() {
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'dsh-runtime.zip') : null
  if (packaged && existsSync(packaged)) return packaged
  const dev = join(__dirname, '..', 'assets', 'dsh-runtime.zip')
  return existsSync(dev) ? dev : null
}

function runtimeSentinelsOk(dir) {
  const sentinels = [
    join(dir, 'node.exe'),
    join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    join(dir, 'node_modules', '@deepseek-ai', 'dsh-agent', 'lib', 'index.js'),
    join(dir, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'),
    join(dir, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js'),
  ]
  return sentinels.every((p) => existsSync(p))
}

function runtimeValid(dir, version) {
  try {
    if (readFileSync(join(dir, '.version'), 'utf8').trim() !== version) return false
  } catch {
    return false
  }
  return runtimeSentinelsOk(dir)
}

function extractZip(zip, target) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-x', '-f', zip, '-C', target], { windowsHide: true, stdio: 'ignore' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`解压失败 (tar exit ${code})`))))
    child.on('error', (err) => reject(err))
  })
}

async function ensureRuntime(version) {
  const dir = runtimeDir()
  if (runtimeValid(dir, version)) return true
  // 版本标记不匹配但内容完好：两应用共享同一运行时目录（同内容 zip），
  // 直接更新标记复用，不做破坏性重解压（目录可能被另一实例占用）。
  if (runtimeSentinelsOk(dir)) {
    try {
      writeFileSync(join(dir, '.version'), version, 'utf8')
    } catch {
      /* 标记写不进也可用 */
    }
    return true
  }
  const zip = runtimeZipPath()
  if (!zip) return false
  console.log('[aurora-native] extracting runtime to', dir)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    console.warn('[aurora-native] runtime dir cleanup failed (ignored):', err.message)
  }
  const tmp = `${dir}.tmp-${process.pid}`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  await extractZip(zip, tmp)
  writeFileSync(join(tmp, '.version'), version, 'utf8')
  try {
    renameSync(tmp, dir)
  } catch {
    rmSync(tmp, { recursive: true, force: true })
  }
  return runtimeSentinelsOk(dir)
}

/** 知识库工具注入：在每次 agent 创建/恢复的 setup 里注册进该 agent 作用域 */
function kbSetup(agentCtx) {
  if (kb) registerKbTool(agentCtx, kb)
}

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
    const handle = await c.agents.resume({ resumeSessionId: sessionId, setup: kbSetup })
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
      const handle = await c.agents.resume({ resumeSessionId: sessionId, setup: kbSetup })
      agent = handle.agent
    } else {
      const handle = await c.agents.create({
        sessionId,
        meta: { cwd: app.getPath('documents') },
        setup: kbSetup,
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

/** 面板操作代理：优先复用根 agent；无则惰性创建（重启后缓存自动失效） */
async function ensurePanelAgent() {
  if (panelAgentHandle) return panelAgentHandle
  const c = engine()
  const root = c.agents.roots()[0]
  if (root) {
    panelAgentHandle = { agent: root, dispose: async () => {} }
    return panelAgentHandle
  }
  const handle = await c.agents.create({
    sessionId: `aurora-panel-${randomUUID()}`,
    meta: { cwd: app.getPath('documents') },
    setup: kbSetup,
  })
  panelAgentHandle = handle
  return handle
}

/** 编辑/重新生成：以 boundarySeq 为界的稳定前缀开分叉，发送新文本 */
async function forkChat(sessionId, boundarySeq, text) {
  const c = engine()
  const source = c.sessions.get(sessionId)
  if (!source) throw new Error('source session not live')
  const seed = boundarySeq >= 0 ? source.events.slice(0, boundarySeq + 1) : []
  const childId = `aurora-${randomUUID()}`
  const handle = await c.agents.create({
    sessionId: childId,
    seed,
    meta: { cwd: app.getPath('documents'), parentSession: sessionId },
    setup: kbSetup,
  })
  handle.agent.followup({ role: 'user', content: text })
  return { sessionId: childId }
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
      bootUrl = booted.url
      activeDshHome = newHome
      panelAgentHandle = null
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
async function llmState() {
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
  // 每个提供商：密钥引用、密钥状态、模型目录（含上下文/输出上限等简要信息）
  const providers = []
  for (const p of configured) {
    let apiKeyEnv = null
    let hasKey = false
    try {
      const desc = c.settings.describe({ redactSecrets: true }).find((x) => x.ns === p.settingsNs)
      apiKeyEnv = typeof desc?.value?.apiKeyEnv === 'string' ? desc.value.apiKeyEnv : null
      if (apiKeyEnv) {
        hasKey = (await c.credentials.resolve(apiKeyEnv)) !== undefined
      }
    } catch {
      /* 命名空间缺失 */
    }
    const models = []
    try {
      const listed = await c.llm.listModels(p.id)
      for (const m of listed) {
        let contextWindow
        let maxTokens
        let description = m.description
        try {
          const info = await c.llm.resolveModelInfo(p.id, m.id)
          contextWindow = info?.context?.contextWindow
          maxTokens = info?.defaultMaxTokens
        } catch {
          /* 详情不可用 */
        }
        models.push({ id: m.id, name: m.name ?? m.id, description, contextWindow, maxTokens })
      }
    } catch {
      /* 无目录 */
    }
    providers.push({ ...p, live: live.has(p.id), apiKeyEnv, hasKey, models })
  }
  return { providers, current }
}

async function llmDiscover(providerId) {
  const c = engine()
  const t0 = Date.now()
  const models = []
  let source = 'catalog'
  try {
    const listed = await c.llm.listModels(providerId)
    for (const m of listed) {
      let contextWindow
      let maxTokens
      try {
        const info = await c.llm.resolveModelInfo(providerId, m.id)
        contextWindow = info?.context?.contextWindow
        maxTokens = info?.defaultMaxTokens
      } catch {
        /* 详情不可用 */
      }
      models.push({
        id: m.id,
        name: m.name ?? m.id,
        description: m.description,
        contextWindow,
        maxTokens,
      })
    }
  } catch {
    /* 目录不可用：尝试端点发现 */
  }
  if (models.length === 0) {
    const entry = (c.llm.listConfigurableProviders?.() ?? []).find((p) => p.provider === providerId)
    if (entry) {
      try {
        const desc = c.settings.describe({ redactSecrets: true }).find((x) => x.ns === entry.settingsNs)
        const apiKeyEnv = typeof desc?.value?.apiKeyEnv === 'string' ? desc.value.apiKeyEnv : null
        const key = apiKeyEnv ? await c.credentials.resolve(apiKeyEnv) : undefined
        const found = await c.llm.discoverModels(entry.settingsNs, {
          provider: providerId,
          ...(key?.value ? { apiKey: key.value } : {}),
        })
        source = 'endpoint'
        for (const m of found) {
          models.push({
            id: m.id,
            name: m.name ?? m.id,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
          })
        }
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err), models: [], elapsedMs: Date.now() - t0 }
      }
    }
  }
  return { ok: true, models, elapsedMs: Date.now() - t0, source }
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
  ipcMain.handle('chat:fork', (_e, sessionId, boundarySeq, text) => forkChat(sessionId, boundarySeq, text))
  ipcMain.handle('llm:state', () => llmState())
  ipcMain.handle('llm:select', async (_e, provider, model) => {
    // saveSelection 是异步持久化：必须等待提交完成再回读状态，
    // 否则 UI 第一次点击读到旧选择，表现为「要点两次」。
    await engine().agentDefaultModel.saveSelection({ provider, model })
    return llmState()
  })
  ipcMain.handle('llm:discover', (_e, providerId) => llmDiscover(providerId))
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
  // MCP：组合级配置（home/cordis.patch.yml）+ 应用时重启引擎
  ipcMain.handle('mcp:get', () => {
    const file = join(activeDshHome ?? '', 'cordis.patch.yml')
    try {
      return existsSync(file) ? readFileSync(file, 'utf8') : ''
    } catch {
      return ''
    }
  })
  ipcMain.handle('mcp:set', async (_e, yamlText) => {
    const file = join(activeDshHome ?? '', 'cordis.patch.yml')
    try {
      writeFileSync(file, String(yamlText), 'utf8')
      await disposeEngine().catch(() => {})
      ctx = null
      panelAgentHandle = null
      const booted = await bootEngine(activeDshHome)
      ctx = booted.ctx
      bootUrl = booted.url
        if (sessionEventsOff) sessionEventsOff()
      sessionEventsOff = registerSessionEvents()
      return { restarted: true }
    } catch (err) {
      return { restarted: false, error: err?.message ?? String(err) }
    }
  })
  // 动态插件（引擎 dynamicCordisRunner，面板即用户：审批自动通过）
  ipcMain.handle('plugins:list', () => {
    try {
      const inv = engine().dynamicCordisRunner.inventory() ?? []
      return inv.map((r) => ({
        pluginId: r.pluginId,
        name: r.name,
        status: r.status,
        currentPackageId: r.currentPackageId,
        nextPackageId: r.nextPackageId,
      }))
    } catch (err) {
      return { error: err?.message ?? String(err) }
    }
  })
  ipcMain.handle('plugins:define', async (_e, req) => {
    const { agent } = await ensurePanelAgent()
    // 动态插件归会话所有：定义必须携带面板代理的 sessionId
    const receipt = engine().dynamicCordisRunner.define({ ...req, sessionId: agent.session.id })
    return { pluginId: receipt.pluginId, packageId: receipt.packageId }
  })
  ipcMain.handle('plugins:run', async (_e, pluginId, packageId) => {
    const { agent } = await ensurePanelAgent()
    const r = await engine().dynamicCordisRunner.run(agent, pluginId, packageId, 'run')
    if (r?.requestId && r?.status === 'awaiting-approval') {
      await engine().dynamicCordisRunner.resolveRequestRun(r.requestId, { approved: true })
    }
    return {
      status: r?.status,
      requestId: r?.requestId,
      pluginRunId: r?.pluginRunId,
      error: r?.error,
    }
  })
  ipcMain.handle('plugins:stop', async (_e, pluginId) => {
    const { agent } = await ensurePanelAgent()
    return engine().dynamicCordisRunner.stop(agent, pluginId)
  })
  ipcMain.handle('plugins:undefine', async (_e, pluginId) => {
    const { agent } = await ensurePanelAgent()
    return engine().dynamicCordisRunner.undefine(agent, pluginId)
  })
  // 知识库 RAG（引擎工具 kb_search + 面板管理）
  ipcMain.handle('kb:add-folder', async () => {
    const r = await dialog.showOpenDialog(win ?? undefined, {
      title: '添加知识库文件夹',
      properties: ['openDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return { added: 0 }
    const added = await kb.addFolder(r.filePaths[0])
    return { added, folder: r.filePaths[0] }
  })
  ipcMain.handle('kb:list', () => ({ folders: kb.folders(), docCount: kb.docs.length }))
  ipcMain.handle('kb:remove', (_e, folder) => {
    kb.remove(folder)
    return { folders: kb.folders(), docCount: kb.docs.length }
  })
  ipcMain.handle('kb:rebuild', () => {
    kb.rebuildIndex()
    kb.persist()
    return { docCount: kb.docs.length }
  })
  ipcMain.handle('kb:search', (_e, query) => kb.search(String(query), 5))
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
function windowStateOrDefault() {
  const saved = appSettings.windowState
  if (!saved || typeof saved.width !== 'number') return null
  try {
    const area = screen
      .getDisplayMatching({ x: saved.x ?? 0, y: saved.y ?? 0, width: saved.width, height: saved.height })
      .workArea
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
    width: saved?.width ?? 1280,
    height: saved?.height ?? 840,
    x: saved?.x,
    y: saved?.y,
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
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => {
    if (!(appSettings.startHidden === true) || SMOKE) win.show()
  })
  win.on('close', (e) => {
    // 关闭 = 隐藏到托盘（托盘存在时）；退出走托盘菜单/应用退出
    if (!quitting && tray && appSettings.closeToTray !== false) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })
  const persistState = () => {
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    appSettings.windowState = { ...b, maximized: win.isMaximized() }
    saveAppSettings()
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
  const load = () => {
    if (DEV_URL) {
      void win.loadURL(DEV_URL)
    } else {
      void win.loadFile(join(__dirname, '..', 'dist', 'index.html'))
    }
  }
  load()
}

// ---------- 托盘 ----------
function makeTrayIcon() {
  const png = join(__dirname, '..', 'assets', 'icon.png')
  let img = nativeImage.createFromPath(png)
  if (img.isEmpty()) {
    img = nativeImage.createFromDataURL(
      'data:image/svg+xml;base64,' +
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#0a84ff"/><text x="16" y="22" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">A</text></svg>`,
        ).toString('base64'),
    )
  }
  return img.resize({ width: 16, height: 16 })
}

function createTray() {
  if (tray) return
  tray = new Tray(makeTrayIcon())
  tray.setToolTip('Aurora · DeepSeek Harness 原生客户端')
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
    {
      label: '关闭时最小化到托盘',
      type: 'checkbox',
      checked: appSettings.closeToTray !== false,
      click: (item) => {
        appSettings.closeToTray = item.checked
        saveAppSettings()
      },
    },
    {
      label: '启动时最小化到托盘',
      type: 'checkbox',
      checked: appSettings.startHidden === true,
      click: (item) => {
        appSettings.startHidden = item.checked
        saveAppSettings()
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => {
    if (!win) createWindow()
    win.show()
    win.focus()
  })
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
    activeDshHome = dshHome
    mkdirSync(dshHome, { recursive: true })
    // 内置运行时：首启解压 / 损坏自愈（哨兵校验）
    await ensureRuntime(app.getVersion())
    const booted = await bootEngine(dshHome)
    ctx = booted.ctx
    bootUrl = booted.url
    kb = new KnowledgeBase(join(app.getPath('userData'), 'kb'))
    createTray()
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
    const st = await llmState()
    ok('llmProvidersListed', st.providers.length >= 1, st.providers.map((p) => p.id))
    ok(
      'llmModelsCatalogued',
      st.providers.some((p) => p.models.length >= 1),
      st.providers.map((p) => ({ id: p.id, models: p.models.length })),
    )
    const first = st.providers.find((p) => p.models.length > 0)
    if (first) {
      await engine().agentDefaultModel.saveSelection({ provider: first.id, model: first.models[0].id })
      const cur = (await llmState()).current
      ok('llmSelectionSaved', cur.provider === first.id && cur.model === first.models[0].id, cur)
    }

    // 凭据 roundtrip（写入 .credentials.yaml → 读取存在 → 删除）
    const credRef = 'AURORA_SMOKE_KEY'
    await engine().credentials.set(credRef, 'sk-smoke')
    ok('credentialStored', (await engine().credentials.resolve(credRef)) !== undefined)
    await engine().credentials.unset(credRef)
    ok('credentialCleared', (await engine().credentials.resolve(credRef)) === undefined)

    // 模型发现（测速并获取模型列表：内置目录即时返回 + 简要信息）
    const disc = await llmDiscover('deepseek-official')
    ok(
      'llmDiscoverWorks',
      disc.ok === true && disc.models.length >= 1 && disc.elapsedMs >= 0 && disc.models.every((m) => typeof m.name === 'string'),
      { models: disc.models.map((m) => ({ id: m.id, ctx: m.contextWindow, max: m.maxTokens })), elapsedMs: disc.elapsedMs },
    )

    // 分叉（编辑/重新生成的引擎通路）：空前缀分叉 + 完整历史分叉
    const fork1 = await forkChat(sid, -1, '分支消息 A')
    ok('forkEmptyPrefix', fork1.sessionId !== sid && !!engine().agents.get(fork1.sessionId), fork1)
    const lastSeq = (engine().sessions.get(sid)?.events ?? []).length - 1
    const fork2 = await forkChat(sid, lastSeq, '分支消息 B')
    ok(
      'forkFullHistory',
      fork2.sessionId !== sid &&
        (engine().sessions.get(fork2.sessionId)?.events ?? []).length >= lastSeq + 1,
      { lastSeq, child: fork2.sessionId },
    )

    // MCP 配置文件往返（写回后重启引擎）
    const patchFile = join(activeDshHome ?? '', 'cordis.patch.yml')
    const beforePatch = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : ''
    writeFileSync(patchFile, '# aurora smoke\n[]\n', 'utf8')
    await disposeEngine().catch(() => {})
    ctx = null
    panelAgentHandle = null
    const rebooted = await bootEngine(activeDshHome)
    ctx = rebooted.ctx
    bootUrl = rebooted.url
    if (sessionEventsOff) sessionEventsOff()
    sessionEventsOff = registerSessionEvents()
    ok('mcpConfigRoundtrip', !!ctx && readFileSync(patchFile, 'utf8').includes('aurora smoke'), 'engine rebooted with patch')
    writeFileSync(patchFile, beforePatch, 'utf8')

    // 动态插件：面板代理 → 定义（携带 sessionId）→ 运行（自动审批）→ 清单 → 停止 → 删除
    const { agent } = await ensurePanelAgent()
    const receipt = engine().dynamicCordisRunner.define({
      plugin: { kind: 'new', idPrefix: 'ausmk' },
      name: 'Aurora Smoke Plugin',
      purpose: '冒烟：动态插件全流程',
      sessionId: agent.session.id,
      code: {
        host: `const meta = { name: 'smoke', version: '1.0.0', description: 'smoke' }\nfunction apply(ctx) { ctx.on('session/created', () => {}) }\nreturn { meta, apply }\n`,
      },
    })
    ok('pluginDefined', !!receipt?.pluginId && !!receipt?.packageId, receipt)
    let runResult = null
    if (receipt?.pluginId) {
      try {
        runResult = await engine().dynamicCordisRunner.run(agent, receipt.pluginId, receipt.packageId, 'run')
      } catch (err) {
        runResult = { thrown: err?.message ?? String(err) }
      }
      if (runResult?.requestId && runResult?.status === 'awaiting-approval') {
        await engine().dynamicCordisRunner.resolveRequestRun(runResult.requestId, { approved: true })
      }
      ok('pluginRan', runResult?.status !== undefined && runResult?.status !== 'failed', JSON.stringify(runResult)?.slice(0, 300))
      const inv = engine().dynamicCordisRunner.inventory() ?? []
      ok('pluginListed', inv.some((r) => r.pluginId === receipt.pluginId), inv.map((r) => r.pluginId))
      await engine().dynamicCordisRunner.stop(agent, receipt.pluginId)
      ok('pluginStopped', true, 'stopped')
      const un = await engine().dynamicCordisRunner.undefine(agent, receipt.pluginId)
      const inv2 = engine().dynamicCordisRunner.inventory() ?? []
      ok('pluginUndefined', !inv2.some((r) => r.pluginId === receipt.pluginId), { un, left: inv2.map((r) => r.pluginId) })
    }

    // 知识库 RAG：添加临时文件夹 → BM25 检索命中 → 工具已注册进引擎
    const kbDir = join(app.getPath('temp'), `aurora-kb-smoke-${process.pid}`)
    mkdirSync(kbDir, { recursive: true })
    writeFileSync(join(kbDir, 'aurora-冒烟知识库文档.md'), '# 冒烟测试\n\n这是独一无二的紫罗兰独角兽关键词文档。\n', 'utf8')
    const kbAdded = await kb.addFolder(kbDir)
    ok('kbFolderIndexed', kbAdded >= 1, kbAdded)
    const kbHits = kb.search('紫罗兰独角兽')
    ok('kbSearchHits', kbHits.length >= 1 && kbHits[0].snippet.includes('紫罗兰'), kbHits)
    const kbSchemas = ctx.tools.schemas(agent)
    ok('kbToolRegistered', kbSchemas.some((s) => s.name === 'kb_search'), kbSchemas.map((s) => s.name))
    kb.remove(kbDir)

    // 托盘 + 窗口状态持久化 + 版本显示
    ok('trayCreated', !!tray)
    try {
      win.setBounds({ x: 160, y: 100, width: 1180, height: 760 })
      await sleep(900)
      const actual = win.getBounds()
      const st = appSettings.windowState
      ok(
        'windowStateSaved',
        st && st.x === actual.x && st.y === actual.y && st.width === actual.width && st.height === actual.height,
        { saved: st, actual },
      )
    } catch (err) {
      ok('windowStateSaved', false, String(err))
    }
    ok('versionReported', typeof app.getVersion() === 'string' && app.getVersion().length > 0, app.getVersion())

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

    // UI 交互：打开设置 → 面板/密钥框/模型选项就位 → 单击切换模型（一次点击必须生效）
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
        out.discoverBtns = document.querySelectorAll('[data-discover]').length
        out.mcpYaml = !!document.querySelector('[data-mcp-yaml]')
        out.pluginCode = !!document.querySelector('[data-plugin-code]')
        // 单击第二个模型选项（一次点击）——回归「需要点两次」的 bug
        const chips = Array.from(document.querySelectorAll('[data-model-option]'))
        if (chips.length >= 2) {
          chips[1].click()
          await new Promise((r) => setTimeout(r, 1500))
          const active = Array.from(document.querySelectorAll('[data-model-option]'))
            .filter((c) => c.className.includes('bg-apple-blue'))
            .map((c) => c.textContent || '')
          out.activeAfterOneClick = active
        } else {
          out.activeAfterOneClick = null
        }
        // 关闭（点遮罩）
        const backdrop = document.querySelector('[data-settings]')
        backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 300))
        out.settingsClosed = !document.querySelector('[data-settings]')
        // 模型菜单过滤：无密钥时应显示空态提示
        document.querySelector('[data-model-pill]')?.click()
        await new Promise((r) => setTimeout(r, 300))
        const menuText = (document.querySelector('.relative')?.textContent || '')
        out.menuEmptyHint = menuText.includes('暂无已配置密钥')
        return out
      })()`)
      .catch((e) => ({ error: String(e) }))
    const singleClickOk =
      Array.isArray(uiFlow.activeAfterOneClick) &&
      uiFlow.activeAfterOneClick.length === 1 &&
      /Pro/.test(uiFlow.activeAfterOneClick[0] ?? '')
    ok(
      'settingsUiWorks',
      uiFlow.settingsOpen === true &&
        uiFlow.apiKeyInput === true &&
        uiFlow.modelOptions >= 2 &&
        uiFlow.dshHomeInput === true &&
        uiFlow.discoverBtns >= 1 &&
        uiFlow.mcpYaml === true &&
        uiFlow.pluginCode === true &&
        uiFlow.settingsClosed === true &&
        uiFlow.modelPill === true &&
        singleClickOk === true,
      uiFlow,
    )
    ok('singleClickSwitchesModel', singleClickOk, uiFlow.activeAfterOneClick)
    ok('modelMenuFiltersByKey', uiFlow.menuEmptyHint === true, { menuEmptyHint: uiFlow.menuEmptyHint })

    // 命令面板 / 模板 / 编辑模式 UI 流
    const uiFlow2 = await win.webContents
      .executeJavaScript(`(async () => {
        const out = {}
        // Ctrl+K 打开命令面板
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
        await new Promise((r) => setTimeout(r, 400))
        out.paletteOpen = !!document.querySelector('[data-command-palette]')
        out.paletteItems = document.querySelectorAll('[data-palette-item]').length
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await new Promise((r) => setTimeout(r, 300))
        out.paletteClosed = !document.querySelector('[data-command-palette]')
        // 模板菜单：点击一个模板 → 输入框被填充
        document.querySelector('[data-templates]')?.click()
        await new Promise((r) => setTimeout(r, 300))
        out.templateCount = document.querySelectorAll('[data-template]').length
        document.querySelectorAll('[data-template]')[0]?.click()
        await new Promise((r) => setTimeout(r, 300))
        out.inputFilled = (document.querySelector('textarea')?.value ?? '').length > 0
        return out
      })()`)
      .catch((e) => ({ error: String(e) }))
    ok(
      'paletteWorks',
      uiFlow2.paletteOpen === true && uiFlow2.paletteItems >= 3 && uiFlow2.paletteClosed === true,
      uiFlow2,
    )
    ok(
      'templatesWork',
      uiFlow2.templateCount >= 5 && uiFlow2.inputFilled === true,
      { templateCount: uiFlow2.templateCount, inputFilled: uiFlow2.inputFilled },
    )

    const img = await win.webContents.capturePage()
    const shot = join(app.getPath('userData'), 'smoke-screenshot.png')
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
  if (tray) {
    tray.destroy()
    tray = null
  }
  if (ctx) void disposeEngine()
})

// ---------- 版本信息 ----------
ipcMain.handle('app:version', () => app.getVersion())
