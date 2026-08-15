import { app, safeStorage } from 'electron'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import * as path from 'path'
import * as fs from 'fs'

export interface ModelConfig {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  modelId: string
  temperature: number
  maxTokens: number
  topP: number
  enabled: boolean
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
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
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
}

function seed(): void {
  if (!db) return
  const r = db.exec('SELECT COUNT(*) AS c FROM models')
  const count = r.length ? Number(r[0].values[0][0]) : 0
  if (count > 0) return
  const insert = db.prepare(
    `INSERT INTO models
     (id,name,provider,base_url,api_key,model_id,temperature,max_tokens,top_p,enabled,sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  insert.run([
    'mock', '本地演示（Mock）', 'mock', '', '', 'aurora-mock-1',
    1, 4096, 1, 1, 0,
  ])
  insert.run([
    'deepseek-chat', 'DeepSeek Chat', 'deepseek',
    'https://api.deepseek.com/v1', '', 'deepseek-chat', 1.3, 8192, 1, 1, 1,
  ])
  insert.run([
    'deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek',
    'https://api.deepseek.com/v1', '', 'deepseek-reasoner', 1.3, 8192, 1, 1, 2,
  ])
  insert.free()
}

// ---- 模型 CRUD ----
type ModelRow = (string | number | Uint8Array | null)[]

function rowToModel(row: ModelRow): ModelConfig {
  return {
    id: String(row[0]),
    name: String(row[1]),
    provider: String(row[2]) as ModelConfig['provider'],
    baseUrl: String(row[3]),
    apiKey: decryptKey(String(row[4])),
    modelId: String(row[5]),
    temperature: Number(row[6]),
    maxTokens: Number(row[7]),
    topP: Number(row[8]),
    enabled: !!row[9],
  }
}

export function listModels(): ModelConfig[] {
  if (!db) return []
  const res = db.exec(
    `SELECT id,name,provider,base_url,api_key,model_id,temperature,max_tokens,top_p,enabled
     FROM models ORDER BY sort, name`,
  )
  if (!res.length) return []
  return res[0].values.map(rowToModel)
}

export function getModel(id: string): ModelConfig | null {
  return listModels().find((m) => m.id === id) ?? null
}

export function saveModel(m: ModelConfig): void {
  if (!db) return
  db.run(
    `INSERT INTO models (id,name,provider,base_url,api_key,model_id,temperature,max_tokens,top_p,enabled)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, provider=excluded.provider, base_url=excluded.base_url,
       api_key=excluded.api_key, model_id=excluded.model_id,
       temperature=excluded.temperature, max_tokens=excluded.max_tokens,
       top_p=excluded.top_p, enabled=excluded.enabled`,
    [
      m.id, m.name, m.provider, m.baseUrl, encryptKey(m.apiKey), m.modelId,
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
