// 渲染层 ↔ 主进程桥的类型定义
export interface SessionMeta {
  id: string
  title: string
  createdAt?: number
  live: boolean
}

export interface ToolStepInfo {
  id: string
  name: string
  status: 'running' | 'done' | 'error'
  args?: unknown
  result?: string
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  toolSteps: ToolStepInfo[]
  turn: number
  step: number
  /** user 消息的日志序号（编辑/重新生成分叉时用） */
  seq?: number
}

export interface SessionEventPayload {
  type: string
  seq: number
  time: number
  data: Record<string, unknown> & {
    content?: unknown
    turn?: number
    step?: number
    chunk?: { content?: string; reasoning?: string }
    message?: unknown
    name?: string
    arguments?: string
    callId?: string
    usage?: unknown
    reason?: { kind?: string; error?: { message?: string } }
    error?: { name?: string; code?: string }
    meta?: unknown
  }
}

declare global {
  interface Window {
    aurora: {
      sessions: {
        list: () => Promise<SessionMeta[]>
        open: (sessionId: string) => Promise<{ events: SessionEventPayload[]; live: boolean }>
      }
      chat: {
        send: (sessionId: string, text: string) => Promise<{ sessionId: string }>
        stop: (sessionId: string) => void
        fork: (
          sessionId: string,
          boundarySeq: number,
          text: string,
        ) => Promise<{ sessionId: string }>
        onEvent: (cb: (p: { sessionId: string; event: SessionEventPayload }) => void) => () => void
      }
      llm: {
        state: () => Promise<LlmState>
        select: (provider: string, model: string) => Promise<LlmState>
        discover: (providerId: string) => Promise<LlmDiscoverResult>
      }
      credentials: {
        has: (ref: string) => Promise<boolean>
        set: (ref: string, value: string) => Promise<boolean>
        unset: (ref: string) => Promise<boolean>
      }
      appSettings: {
        get: () => Promise<{ dshHome: string }>
        set: (patch: { dshHome?: string }) => Promise<{ restarted: boolean; error?: string }>
      }
      mcp: {
        get: () => Promise<string>
        set: (yamlText: string) => Promise<{ restarted: boolean; error?: string }>
      }
      plugins: {
        list: () => Promise<PluginRow[]>
        define: (req: PluginDefineRequest) => Promise<{ pluginId: string; packageId: string }>
        run: (pluginId: string, packageId: string) => Promise<PluginRunResult>
        stop: (pluginId: string) => Promise<unknown>
        undefine: (pluginId: string) => Promise<unknown>
      }
      window: {
        minimize: () => void
        toggleMaximize: () => void
        close: () => void
      }
    }
  }
}

export interface LlmModelInfo {
  id: string
  name: string
  description?: string
  contextWindow?: number
  maxTokens?: number
}

export interface LlmProviderInfo {
  id: string
  name: string
  settingsNs: string
  live: boolean
  apiKeyEnv: string | null
  hasKey: boolean
  models: LlmModelInfo[]
}

export interface LlmState {
  providers: LlmProviderInfo[]
  current: { provider: string; model: string }
}

export interface LlmDiscoverResult {
  ok: boolean
  error?: string
  models: LlmModelInfo[]
  elapsedMs: number
  source?: 'catalog' | 'endpoint'
}

export interface PluginRow {
  pluginId: string
  name: string
  status?: string
  currentPackageId?: string
  nextPackageId?: string
}

export interface PluginDefineRequest {
  plugin: { kind: 'new'; idPrefix: string } | { kind: 'existing'; pluginId: string }
  name: string
  purpose: string
  code: { host?: string; client?: string }
}

export interface PluginRunResult {
  status?: string
  requestId?: string
  pluginRunId?: string
  error?: unknown
}
