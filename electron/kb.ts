import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import type { SearchRef } from './tools'

let db: Database | null = null
let dbFile = ''

export async function initKbDb(opts?: {
  file?: string
  fresh?: boolean
  smoke?: boolean
}): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (f: string) =>
      path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm')), f),
  })
  dbFile = path.join(
    app.getPath('userData'),
    opts?.file ?? (opts?.smoke ? 'kb-smoke.sqlite' : 'kb.sqlite'),
  )
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
  db.run(`
    CREATE TABLE IF NOT EXISTS kb (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, rel_path TEXT NOT NULL,
      title TEXT NOT NULL, chunk_idx INTEGER NOT NULL,
      content TEXT NOT NULL, mtime INTEGER NOT NULL
    );
  `)
  // 正式模式清理历史冒烟污染（kb-smoke 目录为冒烟专用）
  if (!opts?.smoke) {
    const smokeDir = path.join(app.getPath('userData'), 'kb-smoke')
    const res = db.exec('SELECT id FROM kb WHERE path = ?', [smokeDir])
    for (const row of res.length ? res[0].values : []) {
      const id = String(row[0])
      db.run('DELETE FROM kb_documents WHERE kb_id = ?', [id])
      db.run('DELETE FROM kb WHERE id = ?', [id])
    }
    if (res.length) saveDb()
  }
}

function saveDb(): void {
  if (!db) return
  try {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true })
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } catch (err) {
    console.error('[kb] save failed:', err)
  }
}

// ==================== 分词与 BM25 ====================
export function tokenize(text: string): string[] {
  const t = text.toLowerCase()
  const tokens: string[] = []
  const cjkRuns = t.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjkRuns) {
    const chars = [...run]
    for (let i = 0; i < chars.length; i++) {
      tokens.push(chars[i])
      if (i < chars.length - 1) tokens.push(chars[i] + chars[i + 1])
    }
  }
  const words = t.replace(/[\u4e00-\u9fff]+/g, ' ').match(/[a-z0-9_]+/g) ?? []
  tokens.push(...words)
  return tokens
}

interface IndexedDoc {
  id: string
  tokens: Map<string, number>
  length: number
}

const K1 = 1.5
const B = 0.75

class Bm25Index {
  docs: IndexedDoc[] = []
  df = new Map<string, number>()
  avgdl = 0

  clear(): void {
    this.docs = []
    this.df.clear()
    this.avgdl = 0
  }

  add(id: string, text: string): void {
    const tokens = tokenize(text)
    const counts = new Map<string, number>()
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
    this.docs.push({ id, tokens: counts, length: tokens.length })
    for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
  }

  finalize(): void {
    const n = this.docs.length
    this.avgdl = n ? this.docs.reduce((s, d) => s + d.length, 0) / n : 0
  }

  search(query: string, k: number): string[] {
    const qTokens = tokenize(query)
    const n = this.docs.length
    if (!n || qTokens.length === 0) return []
    const scores = new Map<string, number>()
    for (const qt of new Set(qTokens)) {
      const df = this.df.get(qt) ?? 0
      if (!df) continue
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      for (const d of this.docs) {
        const tf = d.tokens.get(qt) ?? 0
        if (!tf) continue
        const denom = tf + K1 * (1 - B + (B * d.length) / this.avgdl)
        scores.set(d.id, (scores.get(d.id) ?? 0) + idf * ((tf * (K1 + 1)) / denom))
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id]) => id)
  }
}

// ==================== 知识库管理器 ====================
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.csv', '.py', '.js', '.ts', '.tsx',
  '.jsx', '.css', '.scss', '.html', '.xml', '.yml', '.yaml', '.log', '.sh',
  '.c', '.h', '.cpp', '.java', '.go', '.rs', '.sql', '.ini', '.toml',
])

interface KbDoc {
  id: string
  kbId: string
  relPath: string
  title: string
  chunkIdx: number
  content: string
  mtime: number
}

interface KbRow {
  id: string
  name: string
  path: string
  fileCount: number
  createdAt: number
}

class KbManager {
  private index = new Bm25Index()
  private docs = new Map<string, KbDoc>()

  async init(opts?: { file?: string; fresh?: boolean; smoke?: boolean }): Promise<void> {
    await initKbDb(opts)
    this.reloadIndex()
  }

  private reloadIndex(): void {
    this.index.clear()
    this.docs.clear()
    if (!db) return
    const res = db.exec(
      'SELECT id,kb_id,rel_path,title,chunk_idx,content,mtime FROM kb_documents',
    )
    if (!res.length) return
    for (const row of res[0].values) {
      const doc: KbDoc = {
        id: String(row[0]),
        kbId: String(row[1]),
        relPath: String(row[2]),
        title: String(row[3]),
        chunkIdx: Number(row[4]),
        content: String(row[5]),
        mtime: Number(row[6]),
      }
      this.docs.set(doc.id, doc)
      this.index.add(doc.id, doc.content)
    }
    this.index.finalize()
  }

  list(): KbRow[] {
    if (!db) return []
    const res = db.exec(
      'SELECT id,name,path,file_count,created_at FROM kb ORDER BY created_at DESC',
    )
    if (!res.length) return []
    return res[0].values.map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      path: String(r[2]),
      fileCount: Number(r[3]),
      createdAt: Number(r[4]),
    }))
  }

  private chunkText(text: string): string[] {
    const paras = text.split(/\n\s*\n/)
    const chunks: string[] = []
    let cur = ''
    for (const p of paras) {
      if ((cur + '\n\n' + p).length > 1200 && cur) {
        chunks.push(cur)
        cur = p
      } else {
        cur = cur ? cur + '\n\n' + p : p
      }
    }
    if (cur.trim()) chunks.push(cur)
    return chunks.length ? chunks : [text]
  }

  private scanFiles(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        const full = path.join(d, e.name)
        if (e.isDirectory()) {
          if (entries.length < 500) walk(full)
        } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
          try {
            const stat = fs.statSync(full)
            if (stat.size < 500 * 1024) out.push(full)
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(dir)
    return out
  }

  async addFolder(folderPath: string): Promise<KbRow> {
    if (!db) throw new Error('KB 未初始化')
    const abs = path.resolve(folderPath)
    // 去重：同一路径已存在则重建该条目（避免重复添加产生多条记录）
    const existing = this.list().find((k) => path.resolve(k.path) === abs)
    if (existing) {
      const rebuilt = await this.rebuild(existing.id)
      if (rebuilt) return rebuilt
    }
    const name = path.basename(abs) || abs
    const id = 'kb-' + Date.now().toString(36)
    db.run(
      'INSERT INTO kb (id,name,path,file_count,created_at) VALUES (?,?,?,0,?)',
      [id, name, abs, Date.now()],
    )
    const files = this.scanFiles(abs)
    const stmt = db.prepare(
      'INSERT INTO kb_documents (id,kb_id,rel_path,title,chunk_idx,content,mtime) VALUES (?,?,?,?,?,?,?)',
    )
    for (const f of files) {
      try {
        const content = fs.readFileSync(f, 'utf-8')
        const rel = path.relative(abs, f)
        const chunks = this.chunkText(content)
        chunks.forEach((c, i) => {
          const docId = `${id}:${rel}:${i}`
          stmt.run([
            docId, id, rel, path.basename(f), i, c,
            fs.statSync(f).mtimeMs,
          ])
        })
      } catch {
        /* 跳过不可读文件 */
      }
    }
    stmt.free()
    db.run('UPDATE kb SET file_count = ? WHERE id = ?', [files.length, id])
    saveDb()
    this.reloadIndex()
    return { id, name, path: abs, fileCount: files.length, createdAt: Date.now() }
  }

  async remove(id: string): Promise<void> {
    db?.run('DELETE FROM kb_documents WHERE kb_id = ?', [id])
    db?.run('DELETE FROM kb WHERE id = ?', [id])
    saveDb()
    this.reloadIndex()
  }

  async rebuild(id: string): Promise<KbRow | null> {
    const row = this.list().find((r) => r.id === id)
    if (!row) return null
    db?.run('DELETE FROM kb_documents WHERE kb_id = ?', [id])
    const files = this.scanFiles(row.path)
    const stmt = db?.prepare(
      'INSERT INTO kb_documents (id,kb_id,rel_path,title,chunk_idx,content,mtime) VALUES (?,?,?,?,?,?,?)',
    )
    if (stmt && db) {
      for (const f of files) {
        try {
          const content = fs.readFileSync(f, 'utf-8')
          const rel = path.relative(row.path, f)
          this.chunkText(content).forEach((c, i) => {
            stmt.run([
              `${id}:${rel}:${i}`, id, rel, path.basename(f), i, c,
              fs.statSync(f).mtimeMs,
            ])
          })
        } catch {
          /* ignore */
        }
      }
      stmt.free()
      db.run('UPDATE kb SET file_count = ? WHERE id = ?', [files.length, id])
    }
    saveDb()
    this.reloadIndex()
    return { ...row, fileCount: files.length }
  }

  search(query: string, k = 5): { text: string; refs: SearchRef[] } {
    const ids = this.index.search(query, k)
    const refs: SearchRef[] = []
    const parts: string[] = []
    for (const id of ids) {
      const doc = this.docs.get(id)
      if (!doc) continue
      refs.push({
        title: `${doc.title}（片段 ${doc.chunkIdx + 1}）`,
        url: 'file:///' + encodeURI(path.join(this.kbPathOf(doc.kbId), doc.relPath)),
        snippet: doc.content.slice(0, 160),
      })
      parts.push(
        `【${doc.title} 片段 ${doc.chunkIdx + 1}】\n${doc.content.slice(0, 1200)}`,
      )
    }
    return {
      text: parts.length
        ? parts.join('\n\n---\n\n')
        : '知识库为空或未找到相关内容。',
      refs,
    }
  }

  private kbPathOf(kbId: string): string {
    if (!db) return ''
    const res = db.exec('SELECT path FROM kb WHERE id = ?', [kbId])
    return res.length && res[0].values.length
      ? String(res[0].values[0][0])
      : ''
  }
}

export const kbManager = new KbManager()
