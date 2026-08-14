import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { app, dialog } from 'electron'
import { getSetting, setSetting } from './db'
import { kbManager } from './kb'

let workspaceDir = ''

export function getWorkspaceDir(): string {
  if (!workspaceDir) {
    workspaceDir = path.join(app.getPath('userData'), 'workspace')
  }
  return workspaceDir
}

export function ensureWorkspaceDir(): void {
  fs.mkdirSync(getWorkspaceDir(), { recursive: true })
}

export function resolveInWorkspace(
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  const base = path.resolve(getWorkspaceDir())
  const abs = path.resolve(base, rel || '.')
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    return { ok: false, error: `路径越界：仅允许访问工作目录 ${base}` }
  }
  return { ok: true, abs }
}

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作目录内的文本文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作目录的文件路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在工作目录内写入（或覆盖）一个文本文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作目录的文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出工作目录内的文件和子目录',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径，留空为根目录' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_python',
      description: '在工作目录中执行一段 Python 代码并返回输出（需本机安装 Python）',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 Python 代码' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: '执行一条系统命令（会请求用户确认，可加入白名单）',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索并返回结果列表（标题、链接、摘要）',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '抓取网页内容并提取正文文本',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的网页 URL' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '检索本地知识库，返回相关文档片段与来源',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          top_k: { type: 'number', description: '返回片段数，默认 5' },
        },
        required: ['query'],
      },
    },
  },
]

export interface ToolExecResult {
  ok: boolean
  result?: string
  error?: string
  refs?: SearchRef[]
}

export interface SearchRef {
  title: string
  url: string
  snippet?: string
}

// ---- 联网能力 ----
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export async function webSearch(
  query: string,
): Promise<ToolExecResult & { refs?: SearchRef[] }> {
  if (process.env.SMOKE === '1') {
    return {
      ok: true,
      result: '（冒烟模拟）搜索到 3 条相关结果。',
      refs: [
        {
          title: 'DeepSeek Harness（社区版）',
          url: 'https://github.com/HenryZ838978/deepseek-harness',
          snippet: 'MCP server + CLI + SKILL.md',
        },
        {
          title: 'tylerbuilds/deepseek-harness',
          url: 'https://github.com/tylerbuilds/deepseek-harness',
          snippet: 'Releases 与源码',
        },
        {
          title: 'DeepSeek Harness 实测报告',
          url: 'https://example.com/review',
          snippet: 'Agent 运行时评测',
        },
      ],
    }
  }
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15000)
    const q = encodeURIComponent(query)
    const res = await fetch(`https://cn.bing.com/search?q=${q}&setlang=zh-hans`, {
      signal: ac.signal,
      headers: { 'User-Agent': UA },
    })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const html = await res.text()
    const refs: SearchRef[] = []
    const blocks = html.split('<li class="b_algo"')
    for (let i = 1; i < Math.min(blocks.length, 9); i++) {
      const b = blocks[i]
      const titleM = /<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b)
      const snipM = /<p[^>]*>([\s\S]*?)<\/p>/.exec(b)
      if (titleM) {
        refs.push({
          title: htmlToText(titleM[2]).slice(0, 120),
          url: titleM[1],
          snippet: snipM ? htmlToText(snipM[1]).slice(0, 200) : '',
        })
      }
    }
    if (!refs.length) {
      return { ok: false, error: '未解析到搜索结果，请稍后重试或检查网络' }
    }
    return {
      ok: true,
      result: refs
        .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
        .join('\n\n'),
      refs,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('abort')) {
      return { ok: false, error: '搜索超时（15 秒）' }
    }
    return { ok: false, error: msg.slice(0, 200) }
  }
}

export async function fetchUrl(
  url: string,
): Promise<ToolExecResult & { refs?: SearchRef[] }> {
  if (process.env.SMOKE === '1') {
    return {
      ok: true,
      result: '（冒烟模拟）这是示例网页的正文内容，用于验证网页抓取工具链路。',
      refs: [{ title: '示例网页', url }],
    }
  }
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15000)
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const ct = res.headers.get('content-type') ?? ''
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 2 * 1024 * 1024) {
      return { ok: false, error: '页面过大（>2MB），已拒绝抓取' }
    }
    const text = new TextDecoder().decode(buf)
    const body = ct.includes('html') ? htmlToText(text) : text
    return {
      ok: true,
      result: body.slice(0, 30000),
      refs: [{ title: url, url }],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('abort')) {
      return { ok: false, error: '抓取超时（15 秒）' }
    }
    return { ok: false, error: msg.slice(0, 200) }
  }
}

function execAsync(
  command: string,
  opts: { cwd: string; timeoutMs: number },
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const out = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).slice(
          0,
          20000,
        )
        if (err) {
          const killed = (err as { killed?: boolean }).killed
          const msg = killed
            ? `执行超时（>${Math.round(opts.timeoutMs / 1000)}s）或已终止`
            : `${err.message.slice(0, 300)}\n${out}`
          resolve({ ok: false, output: msg })
        } else {
          resolve({ ok: true, output: out })
        }
      },
    )
  })
}

export async function runPython(code: string): Promise<ToolExecResult> {
  try {
    const workspace = getWorkspaceDir()
    const r = await execAsync(`python -c ${JSON.stringify(code)}`, {
      cwd: workspace,
      timeoutMs: 30000,
    })
    if (r.ok) {
      return { ok: true, result: r.output.trim() || '(无输出)' }
    }
    if (r.output.includes('不是内部或外部命令') || r.output.includes('ENOENT')) {
      return { ok: false, error: '未检测到本机 Python，请先安装或配置 PATH' }
    }
    return { ok: false, error: r.output.slice(0, 800) }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) }
  }
}

export async function runShell(command: string): Promise<ToolExecResult> {
  try {
    const workspace = getWorkspaceDir()
    const r = await execAsync(command, { cwd: workspace, timeoutMs: 30000 })
    return r.ok
      ? { ok: true, result: r.output.trim() || '(无输出)' }
      : { ok: false, error: r.output.slice(0, 800) }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) }
  }
}

// ---- 命令白名单与确认 ----
export function getShellWhitelist(): string[] {
  const raw = getSetting('shellWhitelist')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

export function addToShellWhitelist(command: string): void {
  const list = getShellWhitelist()
  if (isShellAllowed(command, list)) return
  list.push(command)
  setSetting('shellWhitelist', JSON.stringify(list))
}

export function isShellAllowed(command: string, whitelist: string[]): boolean {
  const cmd = command.trim()
  if (!cmd) return false
  return whitelist.some((w) => {
    const prefix = w.trim()
    if (!prefix) return false
    if (prefix.endsWith('*')) return cmd.startsWith(prefix.slice(0, -1))
    return cmd === prefix || cmd.startsWith(prefix + ' ')
  })
}

/** 系统命令确认：白名单内直接放行；冒烟模式自动放行；否则弹确认框 */
export async function confirmShell(command: string): Promise<boolean> {
  if (isShellAllowed(command, getShellWhitelist())) return true
  if (process.env.SMOKE === '1') return true
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['允许一次', '始终允许', '拒绝'],
    defaultId: 0,
    cancelId: 2,
    title: '系统命令确认',
    message: 'Agent 请求执行系统命令：',
    detail: `${command}\n\n该命令将在你的电脑上真实执行。选择"始终允许"会把命令加入白名单，之后不再询问。`,
  })
  if (response === 2) return false
  if (response === 1) addToShellWhitelist(command)
  return true
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecResult> {
  try {
    if (name === 'list_dir') {
      const rel = typeof args.path === 'string' && args.path ? args.path : '.'
      const r = resolveInWorkspace(rel)
      if (!r.ok) return { ok: false, error: r.error }
      if (!fs.existsSync(r.abs)) return { ok: false, error: `目录不存在: ${rel}` }
      const entries = fs.readdirSync(r.abs, { withFileTypes: true })
      const list = entries
        .slice(0, 200)
        .map((e) => (e.isDirectory() ? e.name + '/' : e.name))
      return {
        ok: true,
        result: list.length ? list.join('\n') : '(空目录)',
      }
    }
    if (name === 'read_file') {
      const rel = String(args.path ?? '')
      const r = resolveInWorkspace(rel)
      if (!r.ok) return { ok: false, error: r.error }
      if (!fs.existsSync(r.abs)) return { ok: false, error: `文件不存在: ${rel}` }
      const stat = fs.statSync(r.abs)
      if (stat.isDirectory()) return { ok: false, error: `${rel} 是目录` }
      if (stat.size > 200 * 1024) {
        return { ok: false, error: '文件过大（>200KB），请用 list_dir 或拆分为小文件' }
      }
      const content = fs.readFileSync(r.abs, 'utf-8').slice(0, 50000)
      return { ok: true, result: content }
    }
    if (name === 'write_file') {
      const rel = String(args.path ?? '')
      const content = String(args.content ?? '')
      if (!rel || rel.includes('\0')) return { ok: false, error: '非法路径' }
      const r = resolveInWorkspace(rel)
      if (!r.ok) return { ok: false, error: r.error }
      fs.mkdirSync(path.dirname(r.abs), { recursive: true })
      fs.writeFileSync(r.abs, content, 'utf-8')
      return { ok: true, result: `已写入 ${rel}（${content.length} 字符）` }
    }
    if (name === 'run_python') {
      return await runPython(String(args.code ?? ''))
    }
    if (name === 'run_shell') {
      const command = String(args.command ?? '').trim()
      if (!command) return { ok: false, error: '命令为空' }
      const allowed = await confirmShell(command)
      if (!allowed) return { ok: false, error: '用户拒绝了该命令的执行' }
      return await runShell(command)
    }
    if (name === 'web_search') {
      const query = String(args.query ?? '').trim()
      if (!query) return { ok: false, error: '搜索关键词为空' }
      return await webSearch(query)
    }
    if (name === 'fetch_url') {
      const url = String(args.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'URL 需以 http(s):// 开头' }
      return await fetchUrl(url)
    }
    if (name === 'search_knowledge') {
      const query = String(args.query ?? '').trim()
      if (!query) return { ok: false, error: '检索关键词为空' }
      const topK = Math.min(20, Math.max(1, Number(args.top_k) || 5))
      const r = kbManager.search(query, topK)
      return { ok: true, result: r.text, refs: r.refs }
    }
    return { ok: false, error: `未知工具: ${name}` }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) }
  }
}
