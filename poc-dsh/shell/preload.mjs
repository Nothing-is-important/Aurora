import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('auroraShell', {
  windowMinimize: () => ipcRenderer.send('shell:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  windowClose: () => ipcRenderer.send('shell:close'),
})
