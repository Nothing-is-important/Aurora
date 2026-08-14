import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

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
]

export interface ToolExecResult {
  ok: boolean
  result?: string
  error?: string
}

export function executeTool(
  name: string,
  args: Record<string, unknown>,
): ToolExecResult {
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
    return { ok: false, error: `未知工具: ${name}` }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) }
  }
}
