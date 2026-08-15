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
        onEvent: (cb: (p: { sessionId: string; event: SessionEventPayload }) => void) => () => void
      }
      window: {
        minimize: () => void
        toggleMaximize: () => void
        close: () => void
      }
    }
  }
}
