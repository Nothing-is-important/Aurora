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
  },
  smokeNotifyChatDone: (): void => ipcRenderer.send('smoke:chat-done'),
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
}

contextBridge.exposeInMainWorld('aurora', api)
