import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { app, dialog } from 'electron'
import { getSetting, setSetting } from './db'

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
]

export interface ToolExecResult {
  ok: boolean
  result?: string
  error?: string
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
    return { ok: false, error: `未知工具: ${name}` }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) }
  }
}
