import { app, safeStorage } from 'electron'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import * as path from 'path'
import * as fs from 'fs'

export interface ModelConfig {
  /** 条目唯一 id = `${providerId}::${modelId}` */
  id: string
  providerId: string
  providerName: string
  providerKind: string
  name: string
  modelId: string
  temperature: number
  maxTokens: number
  topP: number
  enabled: boolean
}

export interface ProviderRow {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  createdAt: number
}

let db: Database | null = null
let dbFile = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

// ---- API Key 加密（Windows DPAPI via safeStorage）----
function encryptKey(key: string): string {
  if (!key) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(key).toString('base64')
    }
  } catch {
    /* fallthrough */
  }
  return 'plain:' + key
}

function decryptKey(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  if (stored.startsWith('plain:')) return stored.slice(6)
  return stored
}

export async function initDb(opts?: {
  file?: string
  fresh?: boolean
}): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (f: string) =>
      path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm')), f),
  })
  dbFile = path.join(app.getPath('userData'), opts?.file ?? 'aurora.db')
  if (opts?.fresh && fs.existsSync(dbFile)) fs.unlinkSync(dbFile)
  if (fs.existsSync(dbFile)) {
    try {
      db = new SQL.Database(fs.readFileSync(dbFile))
    } catch {
      db = new SQL.Database()
    }
  } else {
    db = new SQL.Database()
  }
  migrate()
  seed()
  persistNow()
}

function migrate(): void {
  if (!db) return
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'custom',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 1,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      top_p REAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_id TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      reasoning TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'done',
      error TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      first_token_ms INTEGER NOT NULL DEFAULT 0,
      tool_steps_json TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '0.0.1',
      description TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'defined',
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  // 旧库补列
  const alt = (sql: string): void => {
    try {
      db!.run(sql)
    } catch {
      /* 已存在则忽略 */
    }
  }
  alt(`ALTER TABLE messages ADD COLUMN error TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE messages ADD COLUMN usage_json TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE messages ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0`)
  alt(`ALTER TABLE messages ADD COLUMN first_token_ms INTEGER NOT NULL DEFAULT 0`)
  alt(`ALTER TABLE messages ADD COLUMN tool_steps_json TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE conversations ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE models ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE models ADD COLUMN base_url TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE models ADD COLUMN api_key TEXT NOT NULL DEFAULT ''`)
  alt(`ALTER TABLE models ADD COLUMN provider TEXT NOT NULL DEFAULT ''`)
  migrateProviders()
}

/** 旧单层模型 → 提供商/模型两层：按 base_url+api_key 分组建提供商并回填 */
function migrateProviders(): void {
  if (!db) return
  const provCount = db.exec('SELECT COUNT(*) FROM providers')
  if (provCount.length && Number(provCount[0].values[0][0]) > 0) return
  // 读取旧模型行（仍有 base_url 数据且未挂 provider 的）
  const res = db.exec(
    `SELECT id,name,provider,base_url,api_key,model_id,temperature,max_tokens,top_p,enabled
     FROM models WHERE provider_id = ''`,
  )
  if (!res.length) return
  const groups = new Map<string, { kind: string; baseUrl: string; apiKey: string; providerId: string; name: string }>()
  const providerIdOf = new Map<string, string>()
  for (const row of res[0].values) {
    const key = `${String(row[3])}|${String(row[4])}`
    let g = groups.get(key)
    if (!g) {
      const kind = String(row[2]) || 'custom'
      const baseUrl = String(row[3])
      g = {
        kind,
        baseUrl,
        apiKey: String(row[4]),
        providerId: 'prov-' + randomId(),
        name: providerDisplayName(kind, baseUrl),
      }
      groups.set(key, g)
    }
    providerIdOf.set(String(row[0]), g.providerId)
  }
  for (const g of groups.values()) {
    db.run(
      `INSERT INTO providers (id,name,kind,base_url,api_key,enabled,created_at)
       VALUES (?,?,?,?,?,1,?)`,
      [g.providerId, g.name, g.kind, g.baseUrl, g.apiKey, Date.now()],
    )
  }
  // 重建模型条目 id（providerId::modelId），回填 provider_id
  for (const row of res[0].values) {
    const oldId = String(row[0])
    const pid = providerIdOf.get(oldId)!
    const modelId = String(row[5])
    const newId = `${pid}::${modelId}`
    db.run(
      `UPDATE models SET id = ?, provider_id = ? WHERE id = ?`,
      [newId, pid, oldId],
    )
  }
}

function providerDisplayName(kind: string, baseUrl: string): string {
  const names: Record<string, string> = {
    deepseek: 'DeepSeek 官方',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    grok: 'Grok (xAI)',
    moonshot: 'Moonshot (Kimi)',
    zhipu: '智谱 GLM',
    qwen: '通义千问',
    ollama: 'Ollama 本地',
    lmstudio: 'LM Studio 本地',
    mock: '本地演示（Mock）',
  }
  if (names[kind]) return names[kind]
  if (baseUrl) {
    try {
      return new URL(baseUrl).hostname
    } catch {
      return baseUrl.slice(0, 24)
    }
  }
  return '自定义提供商'
}

function seed(): void {
  if (!db) return
  const r = db.exec('SELECT COUNT(*) AS c FROM providers')
  const count = r.length ? Number(r[0].values[0][0]) : 0
  if (count > 0) return
  const now = Date.now()
  const mockId = 'prov-mock'
  const dsId = 'prov-deepseek'
  const insP = db.prepare(
    `INSERT INTO providers (id,name,kind,base_url,api_key,enabled,created_at)
     VALUES (?,?,?,?,?,1,?)`,
  )
  insP.run([mockId, '本地演示（Mock）', 'mock', '', '', now])
  insP.run([
    dsId, 'DeepSeek 官方', 'deepseek',
    'https://api.deepseek.com/v1', '', now,
  ])
  insP.free()
  const insM = db.prepare(
    `INSERT INTO models (id,provider_id,name,model_id,temperature,max_tokens,top_p,enabled,sort)
     VALUES (?,?,?,?,?,?,?,1,?)`,
  )
  insM.run([
    `${mockId}::aurora-mock-1`, mockId, '本地演示（Mock）', 'aurora-mock-1',
    1, 4096, 1, 0,
  ])
  insM.run([
    `${dsId}::deepseek-chat`, dsId, 'DeepSeek Chat', 'deepseek-chat',
    1.3, 4096, 1, 1,
  ])
  insM.run([
    `${dsId}::deepseek-reasoner`, dsId, 'DeepSeek Reasoner', 'deepseek-reasoner',
    1, 32768, 1, 2,
  ])
  insM.free()
}

// ---- 提供商 CRUD ----
type ProvRow = (string | number | Uint8Array | null)[]

function rowToProvider(row: ProvRow): ProviderRow {
  return {
    id: String(row[0]),
    name: String(row[1]),
    kind: String(row[2]),
    baseUrl: String(row[3]),
    apiKey: decryptKey(String(row[4])),
    enabled: !!row[5],
    createdAt: Number(row[6]),
  }
}

export function listProviders(): ProviderRow[] {
  if (!db) return []
  const res = db.exec(
    `SELECT id,name,kind,base_url,api_key,enabled,created_at
     FROM providers ORDER BY created_at`,
  )
  if (!res.length) return []
  return res[0].values.map(rowToProvider)
}

export function getProvider(id: string): ProviderRow | null {
  return listProviders().find((p) => p.id === id) ?? null
}

export function saveProvider(p: {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  enabled: boolean
}): void {
  if (!db) return
  db.run(
    `INSERT INTO providers (id,name,kind,base_url,api_key,enabled,created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
       api_key=excluded.api_key, enabled=excluded.enabled`,
    [
      p.id, p.name, p.kind, p.baseUrl, encryptKey(p.apiKey),
      p.enabled ? 1 : 0, Date.now(),
    ],
  )
  persist()
}

export function deleteProvider(id: string): void {
  if (!db) return
  db.run('DELETE FROM models WHERE provider_id = ?', [id])
  db.run('DELETE FROM providers WHERE id = ?', [id])
  persist()
}

// ---- 模型 CRUD（挂靠提供商）----
type ModelRow = (string | number | Uint8Array | null)[]

function rowToModel(row: ModelRow): ModelConfig {
  return {
    id: String(row[0]),
    providerId: String(row[1]),
    name: String(row[2]),
    modelId: String(row[3]),
    temperature: Number(row[4]),
    maxTokens: Number(row[5]),
    topP: Number(row[6]),
    enabled: !!row[7],
    providerName: String(row[8]),
    providerKind: String(row[9]),
  }
}

export function listModels(): ModelConfig[] {
  if (!db) return []
  const res = db.exec(
    `SELECT m.id,m.provider_id,m.name,m.model_id,m.temperature,m.max_tokens,m.top_p,m.enabled,
            p.name, p.kind
     FROM models m LEFT JOIN providers p ON p.id = m.provider_id
     ORDER BY m.sort, m.name`,
  )
  if (!res.length) return []
  return res[0].values.map(rowToModel)
}

export function listModelsOfProvider(providerId: string): ModelConfig[] {
  return listModels().filter((m) => m.providerId === providerId)
}

export function getModel(id: string): ModelConfig | null {
  return listModels().find((m) => m.id === id) ?? null
}

export function saveModel(m: ModelConfig & { providerId: string }): void {
  if (!db) return
  db.run(
    `INSERT INTO models (id,provider_id,name,model_id,temperature,max_tokens,top_p,enabled)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, model_id=excluded.model_id,
       temperature=excluded.temperature, max_tokens=excluded.max_tokens,
       top_p=excluded.top_p, enabled=excluded.enabled`,
    [
      m.id, m.providerId, m.name, m.modelId,
      m.temperature, m.maxTokens, m.topP, m.enabled ? 1 : 0,
    ],
  )
  persist()
}

export function deleteModel(id: string): void {
  if (!db) return
  db.run('DELETE FROM models WHERE id = ?', [id])
  persist()
}

// ---- 设置 KV ----
export function getSetting(key: string): string | null {
  if (!db) return null
  const res = db.exec('SELECT value FROM settings WHERE key = ?', [key])
  if (!res.length || !res[0].values.length) return null
  return String(res[0].values[0][0])
}

export function setSetting(key: string, value: string): void {
  if (!db) return
  db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
  persist()
}

// ---- 持久化（防抖）----
export function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistNow, 400)
}

// ---- 会话 ----
export interface ConversationRow {
  id: string
  title: string
  modelId: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

type ConvRow = (string | number | Uint8Array | null)[]

function rowToConv(row: ConvRow): ConversationRow {
  return {
    id: String(row[0]),
    title: String(row[1]),
    modelId: String(row[2]),
    pinned: !!row[3],
    createdAt: Number(row[4]),
    updatedAt: Number(row[5]),
  }
}

export function listConversations(): ConversationRow[] {
  if (!db) return []
  const res = db.exec(
    `SELECT id,title,model_id,pinned,created_at,updated_at
     FROM conversations ORDER BY pinned DESC, updated_at DESC`,
  )
  if (!res.length) return []
  return res[0].values.map(rowToConv)
}

export function createConversation(title: string): ConversationRow {
  const now = Date.now()
  const id = randomId()
  db?.run(
    `INSERT INTO conversations (id,title,model_id,pinned,created_at,updated_at)
     VALUES (?,?,?,0,?,?)`,
    [id, title, '', now, now],
  )
  persist()
  return { id, title, modelId: '', pinned: false, createdAt: now, updatedAt: now }
}

export function renameConversation(id: string, title: string): void {
  db?.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [
    title,
    Date.now(),
    id,
  ])
  persist()
}

export function deleteConversation(id: string): void {
  db?.run('DELETE FROM messages WHERE conversation_id = ?', [id])
  db?.run('DELETE FROM conversations WHERE id = ?', [id])
  persist()
}

export function setConversationPinned(id: string, pinned: boolean): void {
  db?.run('UPDATE conversations SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])
  persist()
}

export function touchConversation(id: string): void {
  db?.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), id])
  persist()
}

export function getConversationSystemPrompt(id: string): string {
  if (!db) return ''
  const res = db.exec(
    'SELECT system_prompt FROM conversations WHERE id = ?',
    [id],
  )
  if (!res.length || !res[0].values.length) return ''
  return String(res[0].values[0][0] ?? '')
}

export function setConversationSystemPrompt(id: string, text: string): void {
  db?.run('UPDATE conversations SET system_prompt = ? WHERE id = ?', [text, id])
  persist()
}

// ---- 消息 ----
export interface MessageRow {
  id: string
  conversationId: string
  role: string
  content: string
  reasoning: string
  status: string
  error: string
  usageJson: string
  durationMs: number
  firstTokenMs: number
  toolStepsJson: string
  createdAt: number
}

type MsgRow = (string | number | Uint8Array | null)[]

function rowToMsg(row: MsgRow): MessageRow {
  return {
    id: String(row[0]),
    conversationId: String(row[1]),
    role: String(row[2]),
    content: String(row[3]),
    reasoning: String(row[4]),
    status: String(row[5]),
    error: String(row[6]),
    usageJson: String(row[7]),
    durationMs: Number(row[8]),
    firstTokenMs: Number(row[9]),
    toolStepsJson: String(row[10]),
    createdAt: Number(row[11]),
  }
}

export function listMessages(conversationId: string): MessageRow[] {
  if (!db) return []
  const res = db.exec(
    `SELECT id,conversation_id,role,content,reasoning,status,error,
            usage_json,duration_ms,first_token_ms,tool_steps_json,created_at
     FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid`,
    [conversationId],
  )
  if (!res.length) return []
  return res[0].values.map(rowToMsg)
}

export function upsertMessage(m: {
  id: string
  conversationId: string
  role: string
  content: string
  reasoning: string
  status: string
  error?: string
  usage?: unknown
  durationMs?: number
  firstTokenMs?: number
  toolSteps?: unknown
  createdAt: number
}): void {
  if (!db) return
  db.run(
    `INSERT INTO messages
       (id,conversation_id,role,content,reasoning,status,error,
        usage_json,duration_ms,first_token_ms,tool_steps_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       content=excluded.content, reasoning=excluded.reasoning,
       status=excluded.status, error=excluded.error,
       usage_json=excluded.usage_json, duration_ms=excluded.duration_ms,
       first_token_ms=excluded.first_token_ms,
       tool_steps_json=excluded.tool_steps_json`,
    [
      m.id, m.conversationId, m.role, m.content, m.reasoning, m.status,
      m.error ?? '',
      m.usage ? JSON.stringify(m.usage) : '',
      m.durationMs ?? 0,
      m.firstTokenMs ?? 0,
      m.toolSteps ? JSON.stringify(m.toolSteps) : '',
      m.createdAt,
    ],
  )
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [
    Date.now(),
    m.conversationId,
  ])
  persist()
}

/** 删除某条消息及其之后的所有消息（编辑/重新生成分支用） */
export function deleteMessagesFrom(
  conversationId: string,
  fromId: string,
): void {
  if (!db) return
  db.run(
    `DELETE FROM messages WHERE conversation_id = ?
     AND (id = ? OR created_at > (SELECT created_at FROM messages WHERE id = ?))`,
    [conversationId, fromId, fromId],
  )
  persist()
}

function randomId(): string {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 16; i++) {
    s += c[Math.floor(Math.random() * c.length)]
  }
  return s + Date.now().toString(36)
}

// ---- 动态插件（DPS）----
export interface PluginRow {
  id: string
  name: string
  version: string
  description: string
  code: string
  status: 'defined' | 'running' | 'stopped' | 'error'
  error: string
  createdAt: number
  updatedAt: number
}

export function listPlugins(): PluginRow[] {
  if (!db) return []
  const res = db.exec(
    `SELECT id,name,version,description,code,status,error,created_at,updated_at
     FROM plugins ORDER BY created_at`,
  )
  if (!res.length) return []
  return res[0].values.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    version: String(r[2]),
    description: String(r[3]),
    code: String(r[4]),
    status: String(r[5]) as PluginRow['status'],
    error: String(r[6]),
    createdAt: Number(r[7]),
    updatedAt: Number(r[8]),
  }))
}

export function getPlugin(id: string): PluginRow | null {
  return listPlugins().find((p) => p.id === id) ?? null
}

export function upsertPlugin(p: {
  id: string
  name: string
  version: string
  description: string
  code: string
  status: string
  error?: string
}): void {
  if (!db) return
  db.run(
    `INSERT INTO plugins (id,name,version,description,code,status,error,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, version=excluded.version, description=excluded.description,
       code=excluded.code, status=excluded.status, error=excluded.error,
       updated_at=excluded.updated_at`,
    [
      p.id, p.name, p.version, p.description, p.code, p.status, p.error ?? '',
      Date.now(), Date.now(),
    ],
  )
  persist()
}

export function setPluginStatus(
  id: string,
  status: string,
  error = '',
): void {
  db?.run('UPDATE plugins SET status = ?, error = ?, updated_at = ? WHERE id = ?', [
    status, error, Date.now(), id,
  ])
  persist()
}

export function deletePlugin(id: string): void {
  db?.run('DELETE FROM plugins WHERE id = ?', [id])
  persist()
}

function persistNow(): void {
  if (!db) return
  try {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true })
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } catch (err) {
    console.error('[db] persist failed:', err)
  }
}

export function closeDb(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (db) {
    persistNow()
    db.close()
    db = null
  }
}
