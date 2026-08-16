// 沙箱化 preload：暴露 Aurora 渲染层所需的引擎桥
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aurora', {
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    open: (sessionId) => ipcRenderer.invoke('sessions:open', sessionId),
  },
  chat: {
    send: (sessionId, text) => ipcRenderer.invoke('chat:send', sessionId, text),
    stop: (sessionId) => ipcRenderer.send('chat:stop', sessionId),
    fork: (sessionId, boundarySeq, text) => ipcRenderer.invoke('chat:fork', sessionId, boundarySeq, text),
    onEvent: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
  },
  llm: {
    state: () => ipcRenderer.invoke('llm:state'),
    select: (provider, model) => ipcRenderer.invoke('llm:select', provider, model),
    discover: (providerId) => ipcRenderer.invoke('llm:discover', providerId),
    removeModel: (providerId, modelId) => ipcRenderer.invoke('llm:removeModel', providerId, modelId),
    restoreModels: (providerId) => ipcRenderer.invoke('llm:restoreModels', providerId),
  },
  credentials: {
    has: (ref) => ipcRenderer.invoke('credentials:has', ref),
    set: (ref, value) => ipcRenderer.invoke('credentials:set', ref, value),
    unset: (ref) => ipcRenderer.invoke('credentials:unset', ref),
  },
  appSettings: {
    get: () => ipcRenderer.invoke('app:settings:get'),
    set: (patch) => ipcRenderer.invoke('app:settings:set', patch),
  },
  mcp: {
    get: () => ipcRenderer.invoke('mcp:get'),
    set: (yamlText) => ipcRenderer.invoke('mcp:set', yamlText),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    define: (req) => ipcRenderer.invoke('plugins:define', req),
    run: (pluginId, packageId) => ipcRenderer.invoke('plugins:run', pluginId, packageId),
    stop: (pluginId) => ipcRenderer.invoke('plugins:stop', pluginId),
    undefine: (pluginId) => ipcRenderer.invoke('plugins:undefine', pluginId),
  },
  kb: {
    addFolder: () => ipcRenderer.invoke('kb:add-folder'),
    list: () => ipcRenderer.invoke('kb:list'),
    remove: (folder) => ipcRenderer.invoke('kb:remove', folder),
    rebuild: () => ipcRenderer.invoke('kb:rebuild'),
    search: (query) => ipcRenderer.invoke('kb:search', query),
  },
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
})
