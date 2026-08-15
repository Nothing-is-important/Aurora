// 知识库 RAG：文件夹扫描 → BM25 索引（中文 unigram+bigram / 拉丁词）→ 检索
// 数据落在 userData/kb（docs.json + index.json），引擎工具 kb_search 调用本模块。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative, basename } from 'node:path'

const TEXT_EXTS = new Set(['.md', '.txt', '.markdown', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.yml', '.yaml', '.css', '.html', '.csv'])

function tokenize(text) {
  const tokens = []
  const latin = text.toLowerCase().match(/[a-z0-9_$]{2,}/g) ?? []
  tokens.push(...latin)
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    const chars = [...run]
    for (const c of chars) tokens.push(c)
    for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1])
  }
  return tokens
}

function snippetOf(content, queryTokens, maxLen = 220) {
  const lower = content.toLowerCase()
  let best = -1
  for (const t of queryTokens) {
    const i = lower.indexOf(t)
    if (i >= 0 && (best < 0 || i < best)) best = i
  }
  if (best < 0) return content.slice(0, maxLen)
  const start = Math.max(0, best - 60)
  return (start > 0 ? '…' : '') + content.slice(start, start + maxLen) + '…'
}

export class KnowledgeBase {
  constructor(dir) {
    this.dir = dir
    this.docs = []
    this.index = null // { postings: Map<term, number[]>, df: Map<term, number>, lengths: number[], avgLen }
    this.load()
  }

  file(kind) {
    return join(this.dir, kind + '.json')
  }

  load() {
    try {
      if (existsSync(this.file('docs'))) {
        this.docs = JSON.parse(readFileSync(this.file('docs'), 'utf8'))
      }
      if (existsSync(this.file('index'))) {
        const raw = JSON.parse(readFileSync(this.file('index'), 'utf8'))
        this.index = {
          postings: new Map(Object.entries(raw.postings)),
          df: new Map(Object.entries(raw.df)),
          lengths: raw.lengths,
          avgLen: raw.avgLen,
        }
      }
    } catch {
      this.docs = []
      this.index = null
    }
  }

  persist() {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file('docs'), JSON.stringify(this.docs, null, 2), 'utf8')
    if (this.index) {
      writeFileSync(
        this.file('index'),
        JSON.stringify({
          postings: Object.fromEntries(this.index.postings),
          df: Object.fromEntries(this.index.df),
          lengths: this.index.lengths,
          avgLen: this.index.avgLen,
        }),
        'utf8',
      )
    }
  }

  folders() {
    const set = new Set(this.docs.map((d) => d.folder))
    return [...set].sort()
  }

  async addFolder(folder) {
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) walk(p)
        else if (TEXT_EXTS.has(extname(name).toLowerCase()) && st.size < 2 * 1024 * 1024) files.push(p)
      }
    }
    walk(folder)
    // 去重：同文件夹重扫 = 重建
    this.docs = this.docs.filter((d) => d.folder !== folder)
    const base = folder
    for (const f of files) {
      try {
        const content = readFileSync(f, 'utf8')
        this.docs.push({ id: f, folder: base, rel: relative(base, f), content })
      } catch {
        /* 跳过不可读文件 */
      }
    }
    this.rebuildIndex()
    this.persist()
    return this.docs.filter((d) => d.folder === folder).length
  }

  rebuildIndex() {
    const postings = new Map()
    const df = new Map()
    const lengths = []
    this.docs.forEach((doc, docIdx) => {
      const tokens = tokenize(doc.content)
      lengths.push(tokens.length)
      const tf = new Map()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const [term, count] of tf) {
        if (!postings.has(term)) postings.set(term, [])
        postings.get(term).push([docIdx, count])
        df.set(term, (df.get(term) ?? 0) + 1)
      }
    })
    const avgLen = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
    this.index = { postings, df, lengths, avgLen }
  }

  remove(folder) {
    const before = this.docs.length
    this.docs = this.docs.filter((d) => d.folder !== folder)
    if (this.docs.length !== before) {
      this.rebuildIndex()
      this.persist()
    }
  }

  /** BM25 检索：返回 [{ path, rel, snippet, score }] */
  search(query, topK = 5) {
    if (!this.index || this.docs.length === 0) return []
    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []
    const N = this.docs.length
    const k1 = 1.5
    const b = 0.75
    const scores = new Map()
    for (const term of new Set(queryTokens)) {
      const postings = this.index.postings.get(term)
      if (!postings) continue
      const dft = this.index.df.get(term) ?? 0
      const idf = Math.log(1 + (N - dft + 0.5) / (dft + 0.5))
      for (const [docIdx, tf] of postings) {
        const len = this.index.lengths[docIdx] || 1
        const score = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / this.index.avgLen)))
        scores.set(docIdx, (scores.get(docIdx) ?? 0) + score)
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([docIdx, score]) => {
        const doc = this.docs[docIdx]
        return {
          path: doc.rel,
          snippet: snippetOf(doc.content, queryTokens),
          score: Math.round(score * 1000) / 1000,
        }
      })
  }
}

/** 把知识库注册为引擎工具（模型在 Agent 循环中可直接调用 kb_search） */
export function registerKbTool(ctx, kb) {
  return ctx.tools.register({
    name: 'kb_search',
    description:
      '在用户知识库中检索相关文档片段（BM25 全文检索）。当需要引用用户自己整理的资料、笔记或项目文档时调用；查询用自然语言或关键词。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询（关键词或问题）' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                snippet: { type: 'string' },
                score: { type: 'number' },
              },
              required: ['path', 'snippet'],
            },
          },
        },
        required: ['results'],
      },
      render: (_args, value) => {
        if (!value.results || value.results.length === 0) return '（知识库为空或无匹配）'
        return value.results.map((r) => `《${r.path}》\n${r.snippet}`).join('\n\n')
      },
    },
    execute: async (args) => {
      const results = kb.search(String(args.query ?? ''))
      return { results: results.map((r) => ({ path: r.path, snippet: r.snippet, score: r.score })) }
    },
  })
}
