import { contextBridge, ipcRenderer } from 'electron'

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

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  smoke: process.argv.includes('--smoke'),
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximizeToggle: (): void => ipcRenderer.send('window:maximize-toggle'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximized: (cb: (max: boolean) => void): (() => void) => {
      const listener = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    },
  },
  theme: {
    getSource: (): Promise<ThemeSource> => ipcRenderer.invoke('theme:get'),
    setSource: (s: ThemeSource): void => ipcRenderer.send('theme:set', s),
    onSystemChanged: (cb: (dark: boolean) => void): (() => void) => {
      const listener = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('theme:system-changed', listener)
      return () => ipcRenderer.removeListener('theme:system-changed', listener)
    },
  },
  models: {
    list: (): Promise<ModelConfig[]> => ipcRenderer.invoke('models:list'),
    save: (m: ModelConfig): Promise<boolean> => ipcRenderer.invoke('models:save', m),
    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('models:delete', id),
    test: (m: ModelConfig): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('models:test', m),
  },
  dialog: {
    pickFiles: (): Promise<PickedFile[]> => ipcRenderer.invoke('dialog:pickFiles'),
  },
  settings: {
    get: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string): Promise<boolean> =>
      ipcRenderer.invoke('settings:set', key, value),
  },
  conversations: {
    list: (): Promise<ConversationRow[]> =>
      ipcRenderer.invoke('conversations:list'),
    create: (title: string): Promise<ConversationRow> =>
      ipcRenderer.invoke('conversations:create', title),
    rename: (id: string, title: string): Promise<boolean> =>
      ipcRenderer.invoke('conversations:rename', id, title),
    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('conversations:delete', id),
    setPinned: (id: string, pinned: boolean): Promise<boolean> =>
      ipcRenderer.invoke('conversations:setPinned', id, pinned),
    getSystemPrompt: (id: string): Promise<string> =>
      ipcRenderer.invoke('conversations:getSystemPrompt', id),
    setSystemPrompt: (id: string, text: string): Promise<boolean> =>
      ipcRenderer.invoke('conversations:setSystemPrompt', id, text),
    messages: {
      list: (conversationId: string): Promise<MessageRow[]> =>
        ipcRenderer.invoke('messages:list', conversationId),
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
      }): Promise<boolean> => ipcRenderer.invoke('messages:upsert', m),
      deleteFrom: (conversationId: string, fromId: string): Promise<boolean> =>
        ipcRenderer.invoke('messages:deleteFrom', conversationId, fromId),
    },
    export: (
      convId: string,
      format: 'md' | 'json',
    ): Promise<{ path: string; content: string }> =>
      ipcRenderer.invoke('conversation:export', convId, format),
  },
  clipboard: {
    writeText: (text: string): Promise<boolean> =>
      ipcRenderer.invoke('clipboard:writeText', text),
  },
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('app:openExternal', url),
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    openDataDir: (): Promise<boolean> => ipcRenderer.invoke('app:openDataDir'),
  },
  mcp: {
    configure: (
      servers: McpServerConfig[],
    ): Promise<{ connected: string[]; errors: string[] }> =>
      ipcRenderer.invoke('mcp:configure', servers),
  },
  kb: {
    list: (): Promise<KbRow[]> => ipcRenderer.invoke('kb:list'),
    addFolder: (): Promise<KbRow | null> => ipcRenderer.invoke('kb:addFolder'),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('kb:remove', id),
    rebuild: (id: string): Promise<KbRow | null> =>
      ipcRenderer.invoke('kb:rebuild', id),
  },
  chat: {
    start: (req: ChatStartRequest): void => ipcRenderer.send('chat:start', req),
    stop: (requestId: string): void =>
      ipcRenderer.send('chat:stop', requestId),
    onDelta: (cb: (p: { requestId: string; content?: string; reasoning?: string }) => void) =>
      on('chat:delta', cb),
    onDone: (cb: (p: {
      requestId: string
      aborted: boolean
      durationMs: number
      firstTokenMs: number
    }) => void) => on('chat:done', cb),
    onError: (cb: (p: { requestId: string; message: string; aborted: boolean }) => void) =>
      on('chat:error', cb),
    onUsage: (cb: (p: { requestId: string; usage: ChatUsage }) => void) =>
      on('chat:usage', cb),
    onTool: (cb: (p: { requestId: string; step: ToolStep }) => void) =>
      on('chat:tool', cb),
  },
  smokeNotifyChatDone: (): void => ipcRenderer.send('smoke:chat-done'),
  smokeNotifyToolsVerified: (p: { done: boolean; steps: number }): void =>
    ipcRenderer.send('smoke:tools-verified', p),
  smokeNotifyShellVerified: (p: { done: boolean; shellOk: boolean }): void =>
    ipcRenderer.send('smoke:shell-verified', p),
  smokeNotifyNetVerified: (p: { done: boolean; refsOk: boolean }): void =>
    ipcRenderer.send('smoke:net-verified', p),
  smokeNotifyMcpVerified: (p: { done: boolean; mcpOk: boolean }): void =>
    ipcRenderer.send('smoke:mcp-verified', p),
  smokeNotifyKbVerified: (p: { done: boolean; refsOk: boolean }): void =>
    ipcRenderer.send('smoke:kb-verified', p),
  smokeNotifyErrorVerified: (p: {
    done: boolean
    errorShown: boolean
    lastStatus?: string
    lastError?: string
  }): void => ipcRenderer.send('smoke:error-verified', p),
  smokeNotifyStopVerified: (p: { stoppedEarly: boolean; errored: boolean }): void =>
    ipcRenderer.send('smoke:stop-verified', p),
  smokeNotifyConvVerified: (p: {
    listCount: number
    firstTitle: string
    emptyOk: boolean
    restoredCount: number
  }): void => ipcRenderer.send('smoke:conv-verified', p),
  smokeNotifyExportVerified: (p: {
    mdOk: boolean
    jsonOk: boolean
    pathOk: boolean
  }): void => ipcRenderer.send('smoke:export-verified', p),
  smokeNotifyPromptVerified: (p: { sent: boolean; sysOk: boolean }): void =>
    ipcRenderer.send('smoke:prompt-verified', p),
}

contextBridge.exposeInMainWorld('aurora', api)
