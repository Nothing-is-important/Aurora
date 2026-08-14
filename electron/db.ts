import { app, safeStorage } from 'electron'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import * as path from 'path'
import * as fs from 'fs'

export interface ModelConfig {
  id: string
  name: string
  provider: 'deepseek' | 'openai' | 'mock'
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
      created_at INTEGER NOT NULL
    );
  `)
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
