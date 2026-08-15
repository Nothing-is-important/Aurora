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
  toolsEnabled?: boolean
  allowedTools?: string[]
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

export interface SearchRef {
  title: string
  url: string
  snippet?: string
}

export interface ToolStep {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  resultSummary: string
  refs?: SearchRef[]
}

export interface MessageRow {
  id: string
  conversationId: string
  role: string
  content: string
  reasoning: string
  status: string
  error: string
  usageJson: string
  durationMs: number
  firstTokenMs: number
  toolStepsJson: string
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
  modelIds?: string[]
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  enabled: boolean
}

export interface KbRow {
  id: string
  name: string
  path: string
  fileCount: number
  createdAt: number
}

export interface PluginRow {
  id: string
  name: string
  version: string
  description: string
  code: string
  status: 'defined' | 'running' | 'stopped' | 'error'
  error: string
  createdAt: number
  updatedAt: number
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
    getSystemPrompt: (id: string) => Promise<string>
    setSystemPrompt: (id: string, text: string) => Promise<boolean>
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
        usage?: unknown
        durationMs?: number
        firstTokenMs?: number
        toolSteps?: unknown
        createdAt: number
      }) => Promise<boolean>
      deleteFrom: (conversationId: string, fromId: string) => Promise<boolean>
    }
    export: (
      convId: string,
      format: 'md' | 'json',
    ) => Promise<{ path: string; content: string }>
  }
  clipboard: {
    writeText: (text: string) => Promise<boolean>
  }
  openExternal: (url: string) => Promise<boolean>
  app: {
    getVersion: () => Promise<string>
    openDataDir: () => Promise<boolean>
    quit: () => void
  }
  mcp: {
    configure: (
      servers: McpServerConfig[],
    ) => Promise<{ connected: string[]; errors: string[] }>
  }
  kb: {
    list: () => Promise<KbRow[]>
    addFolder: () => Promise<KbRow | null>
    remove: (id: string) => Promise<boolean>
    rebuild: (id: string) => Promise<KbRow | null>
  }
  plugins: {
    list: () => Promise<PluginRow[]>
    define: (id: string, code: string) => Promise<PluginRow>
    run: (id: string) => Promise<{ ok: boolean; error?: string }>
    stop: (id: string) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
  }
  chat: {
    start: (req: ChatStartRequest) => void
    stop: (requestId: string) => void
    onDelta: (cb: (p: { requestId: string; content?: string; reasoning?: string }) => void) => () => void
    onDone: (cb: (p: {
      requestId: string
      aborted: boolean
      durationMs: number
      firstTokenMs: number
    }) => void) => () => void
    onError: (cb: (p: { requestId: string; message: string; aborted: boolean }) => void) => () => void
    onUsage: (cb: (p: { requestId: string; usage: ChatUsage }) => void) => () => void
    onTool: (cb: (p: { requestId: string; step: ToolStep }) => void) => () => void
  }
  smokeNotifyChatDone: () => void
  smokeNotifyToolsVerified: (p: { done: boolean; steps: number }) => void
  smokeNotifyShellVerified: (p: { done: boolean; shellOk: boolean }) => void
  smokeNotifyNetVerified: (p: { done: boolean; refsOk: boolean }) => void
  smokeNotifyMcpVerified: (p: { done: boolean; mcpOk: boolean }) => void
  smokeNotifyKbVerified: (p: { done: boolean; refsOk: boolean }) => void
  smokeNotifyErrorVerified: (p: {
    done: boolean
    errorShown: boolean
    lastStatus?: string
    lastError?: string
  }) => void
  smokeNotifyPluginVerified: (p: { done: boolean; pluginOk: boolean }) => void
  smokeNotifyStopVerified: (p: { stoppedEarly: boolean; errored: boolean }) => void
  smokeNotifyConvVerified: (p: {
    listCount: number
    firstTitle: string
    emptyOk: boolean
    restoredCount: number
  }) => void
  smokeNotifyExportVerified: (p: {
    mdOk: boolean
    jsonOk: boolean
    pathOk: boolean
  }) => void
  smokeNotifyPromptVerified: (p: { sent: boolean; sysOk: boolean }) => void
}

declare global {
  interface Window {
    aurora: AuroraApi
  }
}
