import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { getSetting, setSetting } from './db'
import type { ToolExecResult } from './tools'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  enabled: boolean
}

interface McpTool {
  serverId: string
  name: string
  description: string
  schema: unknown
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class McpClient {
  cfg: McpServerConfig
  proc: ChildProcess | null = null
  tools: McpTool[] = []
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private stopped = false

  constructor(cfg: McpServerConfig) {
    this.cfg = cfg
  }

  async start(): Promise<void> {
    this.stopped = false
    this.proc = spawn(this.cfg.command, this.cfg.args, {
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d))
    this.proc.stderr?.on('data', () => {
      /* 忽略 stderr 噪音 */
    })
    this.proc.on('exit', () => {
      this.rejectAll(new Error('MCP 进程已退出'))
    })
    await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'aurora', version: '0.1.0' },
      },
      15000,
    )
    this.notify('notifications/initialized', {})
    const res = (await this.request('tools/list', {}, 15000)) as {
      tools?: { name: string; description?: string; inputSchema?: unknown }[]
    }
    this.tools = (res.tools ?? []).map((t) => ({
      serverId: this.cfg.id,
      name: t.name,
      description: t.description ?? '',
      schema: t.inputSchema ?? { type: 'object', properties: {} },
    }))
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = (await this.request(
      'tools/call',
      { name, arguments: args },
      60000,
    )) as { content?: { type?: string; text?: string }[] }
    const content = res.content ?? []
    return content
      .map((c) =>
        c && c.type === 'text' ? c.text : c ? JSON.stringify(c) : '',
      )
      .join('\n')
      .slice(0, 20000)
  }

  stop(): void {
    this.stopped = true
    this.rejectAll(new Error('MCP 客户端已停止'))
    try {
      this.proc?.kill()
    } catch {
      /* ignore */
    }
    this.proc = null
  }

  private onData(d: Buffer): void {
    this.buffer += d.toString('utf-8')
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      try {
        const msg = JSON.parse(t)
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          clearTimeout(p.timer)
          if (msg.error) {
            p.reject(new Error(String(msg.error.message ?? 'MCP 错误')))
          } else {
            p.resolve(msg.result)
          }
        }
        // 服务器发起的请求（server->client）本轮不支持，忽略
      } catch {
        /* 忽略不完整行 */
      }
    }
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.proc || this.stopped) {
      return Promise.reject(new Error('MCP 未连接'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时（${Math.round(timeoutMs / 1000)}s）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc!.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      )
    })
  }

  private notify(method: string, params: unknown): void {
    if (!this.proc || this.stopped) return
    this.proc.stdin?.write(
      JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n',
    )
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

// ---- 管理器 ----
class McpManager {
  private clients = new Map<string, McpClient>()
  private toolsCache: McpTool[] = []

  async configure(
    servers: McpServerConfig[],
  ): Promise<{ connected: string[]; errors: string[] }> {
    for (const [, c] of this.clients) c.stop()
    this.clients.clear()
    this.toolsCache = []
    setSetting('mcpServers', JSON.stringify(servers))
    const connected: string[] = []
    const errors: string[] = []
    for (const cfg of servers.filter((s) => s.enabled)) {
      const client = new McpClient(cfg)
      try {
        await client.start()
        this.clients.set(cfg.id, client)
        this.toolsCache.push(...client.tools)
        connected.push(cfg.id)
      } catch (err) {
        client.stop()
        errors.push(`${cfg.name}: ${String(err).slice(0, 200)}`)
      }
    }
    return { connected, errors }
  }

  getToolDefs(): unknown[] {
    return this.toolsCache.map((t) => ({
      type: 'function',
      function: {
        name: `mcp__${t.serverId}__${t.name}`,
        description: `[MCP] ${t.description}`,
        parameters: t.schema,
      },
    }))
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<ToolExecResult> {
    if (!fullName.startsWith('mcp__')) {
      return { ok: false, error: `未知 MCP 工具: ${fullName}` }
    }
    const rest = fullName.slice(5)
    const idx = rest.lastIndexOf('__')
    if (idx <= 0) return { ok: false, error: `未知 MCP 工具: ${fullName}` }
    const serverId = rest.slice(0, idx)
    const toolName = rest.slice(idx + 2)
    const client = this.clients.get(serverId)
    if (!client) return { ok: false, error: `MCP 服务器未连接: ${serverId}` }
    try {
      const text = await client.callTool(toolName, args)
      return { ok: true, result: text || '(无输出)' }
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 300) }
    }
  }

  /** 启动时从设置恢复配置 */
  async restoreFromSettings(): Promise<void> {
    const raw = getSetting('mcpServers')
    if (!raw) return
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) await this.configure(arr)
    } catch {
      /* ignore */
    }
  }
}

export const mcpManager = new McpManager()
