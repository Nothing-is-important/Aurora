// 沙箱化 preload 只能跑 CommonJS（sandbox:true 不支持 ESM import）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('auroraShell', {
  // 窗口控制
  windowMinimize: () => ipcRenderer.send('shell:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  windowClose: () => ipcRenderer.send('shell:close'),
  // dsh 服务
  retryDsh: () => ipcRenderer.send('shell:retry-dsh'),
  openInstallGuide: () => ipcRenderer.send('shell:open-install-guide'),
  getState: () => ipcRenderer.invoke('shell:get-state'),
  onState: (cb) => {
    const listener = (_e, state) => cb(state)
    ipcRenderer.on('shell:state', listener)
    return () => ipcRenderer.removeListener('shell:state', listener)
  },
})
