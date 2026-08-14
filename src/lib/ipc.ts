export type ThemeSource = 'system' | 'light' | 'dark'

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

export interface ChatStartRequest {
  requestId: string
  modelId: string
  messages: { role: string; content: string }[]
}

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ConversationRow {
  id: string
  title: string
  modelId: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface MessageRow {
  id: string
  conversationId: string
  role: string
  content: string
  reasoning: string
  status: string
  error: string
  createdAt: number
}

export interface PickedFile {
  name: string
  path: string
  size: number
  mime: string
  isImage: boolean
  isText: boolean
  dataUrl?: string
  content?: string
}

export interface ConnectionTestResult {
  ok: boolean
  message?: string
  models?: number | null
}

export interface AuroraApi {
  smoke: boolean
  window: {
    minimize: () => void
    maximizeToggle: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximized: (cb: (max: boolean) => void) => () => void
  }
  theme: {
    getSource: () => Promise<ThemeSource>
    setSource: (s: ThemeSource) => void
    onSystemChanged: (cb: (dark: boolean) => void) => () => void
  }
  models: {
    list: () => Promise<ModelConfig[]>
    save: (m: ModelConfig) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
    test: (m: ModelConfig) => Promise<ConnectionTestResult>
  }
  dialog: {
    pickFiles: () => Promise<PickedFile[]>
  }
  settings: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<boolean>
  }
  conversations: {
    list: () => Promise<ConversationRow[]>
    create: (title: string) => Promise<ConversationRow>
    rename: (id: string, title: string) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
    setPinned: (id: string, pinned: boolean) => Promise<boolean>
    messages: {
      list: (conversationId: string) => Promise<MessageRow[]>
      upsert: (m: {
        id: string
        conversationId: string
        role: string
        content: string
        reasoning: string
        status: string
        error?: string
        createdAt: number
      }) => Promise<boolean>
    }
  }
  chat: {
    start: (req: ChatStartRequest) => void
    stop: (requestId: string) => void
    onDelta: (cb: (p: { requestId: string; content?: string; reasoning?: string }) => void) => () => void
    onDone: (cb: (p: { requestId: string; aborted: boolean }) => void) => () => void
    onError: (cb: (p: { requestId: string; message: string; aborted: boolean }) => void) => () => void
    onUsage: (cb: (p: { requestId: string; usage: ChatUsage }) => void) => () => void
  }
  smokeNotifyChatDone: () => void
  smokeNotifyStopVerified: (p: { stoppedEarly: boolean; errored: boolean }) => void
  smokeNotifyConvVerified: (p: {
    listCount: number
    firstTitle: string
    emptyOk: boolean
    restoredCount: number
  }) => void
}

declare global {
  interface Window {
    aurora: AuroraApi
  }
}
