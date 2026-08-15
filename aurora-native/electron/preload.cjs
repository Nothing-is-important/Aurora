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
    onEvent: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
  },
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
  },
})
