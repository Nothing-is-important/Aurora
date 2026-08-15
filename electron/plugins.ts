import vm from 'node:vm'
import {
  deletePlugin,
  getPlugin,
  listPlugins,
  setPluginStatus,
  upsertPlugin,
} from './db'
import type { PluginRow } from './db'
import type { ToolExecResult } from './tools'

export interface PluginToolDef {
  name: string
  description: string
  parameters: unknown
  handler: (args: Record<string, unknown>) => string | Promise<string>
}

interface RunningPlugin {
  id: string
  meta: { name: string; version: string; description: string }
  tools: Map<string, PluginToolDef>
}

const TOOL_TIMEOUT_MS = 30_000

/** 内置示例插件（演示 DPS 全链路，首次启动 seed 并自动运行） */
const DEMO_PLUGIN_ID = 'demo-time'
const DEMO_PLUGIN_CODE = `
// Aurora 动态插件示例：时间查询
// 约定：返回 { meta, setup(api) }，setup 中用 api.registerTool 注册工具
const meta = {
  name: '时间查询',
  version: '1.0.0',
  description: '获取当前日期时间（内置示例插件）',
}
function setup(api) {
  api.registerTool({
    name: 'get_current_time',
    description: '返回当前日期与时间（北京时间）',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: () => {
      const d = new Date()
      return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    },
  })
}
return { meta, setup }
`

class PluginManager {
  private running = new Map<string, RunningPlugin>()

  async init(): Promise<void> {
    // seed 内置示例插件
    if (!getPlugin(DEMO_PLUGIN_ID)) {
      upsertPlugin({
        id: DEMO_PLUGIN_ID,
        name: '时间查询',
        version: '1.0.0',
        description: '获取当前日期时间（内置示例插件）',
        code: DEMO_PLUGIN_CODE,
        status: 'stopped',
      })
    }
    // 恢复上次运行的插件
    for (const p of listPlugins().filter((x) => x.status === 'running')) {
      const r = this.runCode(p.id, p.code)
      if (!r.ok) setPluginStatus(p.id, 'error', r.error ?? '')
    }
  }

  /** 定义/更新插件（仅保存代码，不执行） */
  define(id: string, code: string): PluginRow {
    const existing = getPlugin(id)
    upsertPlugin({
      id,
      name: existing?.name ?? '未命名插件',
      version: existing?.version ?? '0.0.1',
      description: existing?.description ?? '',
      code,
      status: 'defined',
      error: '',
    })
    // 定义即停止旧运行实例
    this.stop(id)
    return getPlugin(id)!
  }

  /** 运行插件：vm 沙箱执行代码并注册工具 */
  run(id: string): { ok: boolean; error?: string } {
    const p = getPlugin(id)
    if (!p) return { ok: false, error: '插件不存在' }
    this.stop(id)
    const r = this.runCode(id, p.code)
    if (r.ok) {
      const rp = this.running.get(id)
      if (rp) {
        upsertPlugin({
          id,
          name: rp.meta.name,
          version: rp.meta.version,
          description: rp.meta.description,
          code: p.code,
          status: 'running',
        })
      }
    } else {
      setPluginStatus(id, 'error', r.error ?? '')
    }
    return r
  }

  stop(id: string): void {
    const rp = this.running.get(id)
    if (rp) {
      rp.tools.clear()
      this.running.delete(id)
      const p = getPlugin(id)
      if (p && p.status === 'running') setPluginStatus(id, 'stopped')
    } else {
      const p = getPlugin(id)
      if (p && p.status === 'running') setPluginStatus(id, 'stopped')
    }
  }

  remove(id: string): void {
    this.stop(id)
    deletePlugin(id)
  }

  /** 收集所有运行中插件的工具定义（并入 Agent tools 数组） */
  getToolDefs(): unknown[] {
    const defs: unknown[] = []
    for (const rp of this.running.values()) {
      for (const [name, tool] of rp.tools) {
        defs.push({
          type: 'function',
          function: {
            name: `plugin__${rp.id}__${name}`,
            description: `[插件] ${tool.description}`,
            parameters: tool.parameters,
          },
        })
      }
    }
    return defs
  }

  /** 执行插件工具（plugin__<pluginId>__<toolName>） */
  async execute(fullName: string, args: Record<string, unknown>): Promise<ToolExecResult> {
    if (!fullName.startsWith('plugin__')) {
      return { ok: false, error: `未知插件工具: ${fullName}` }
    }
    const rest = fullName.slice(8)
    const idx = rest.lastIndexOf('__')
    if (idx <= 0) return { ok: false, error: `未知插件工具: ${fullName}` }
    const pluginId = rest.slice(0, idx)
    const toolName = rest.slice(idx + 2)
    const rp = this.running.get(pluginId)
    if (!rp) return { ok: false, error: `插件未运行: ${pluginId}` }
    const tool = rp.tools.get(toolName)
    if (!tool) return { ok: false, error: `插件工具不存在: ${toolName}` }
    try {
      const result = await Promise.race([
        Promise.resolve(tool.handler(args ?? {})),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('工具执行超时')), TOOL_TIMEOUT_MS),
        ),
      ])
      return { ok: true, result: String(result).slice(0, 20000) || '(无输出)' }
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 300) }
    }
  }

  // ---- vm 沙箱 ----
  private runCode(
    id: string,
    code: string,
  ): { ok: boolean; error?: string } {
    try {
      const tools = new Map<string, PluginToolDef>()
      const sandbox = {
        console: { log: () => {}, error: () => {}, warn: () => {} },
        setTimeout: () => 0,
        setInterval: () => 0,
        fetch: undefined,
        require: undefined,
        process: undefined,
        Buffer: undefined,
        registerTool: (def: {
          name: string
          description?: string
          parameters?: unknown
          handler: (args: Record<string, unknown>) => string | Promise<string>
        }) => {
          if (!def?.name || typeof def.handler !== 'function') {
            throw new Error('registerTool 需要 name 与 handler')
          }
          tools.set(def.name, {
            name: def.name,
            description: def.description ?? '',
            parameters: def.parameters ?? { type: 'object', properties: {} },
            handler: def.handler,
          })
        },
      }
      const context = vm.createContext(sandbox)
      const script = new vm.Script(`(function () { ${code}\n})()`, {
        filename: `plugin-${id}.js`,
      })
      const result = script.runInContext(context, { timeout: 5000 }) as {
        meta?: { name?: string; version?: string; description?: string }
        setup?: (api: unknown) => void
      }
      const meta = result?.meta ?? {}
      if (typeof result?.setup === 'function') {
        result.setup(sandbox)
      }
      if (tools.size === 0) {
        return { ok: false, error: '插件未注册任何工具（请在 setup 中调用 registerTool）' }
      }
      this.running.set(id, {
        id,
        meta: {
          name: meta.name ?? '未命名插件',
          version: meta.version ?? '0.0.1',
          description: meta.description ?? '',
        },
        tools,
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 500) }
    }
  }
}

export const pluginManager = new PluginManager()
