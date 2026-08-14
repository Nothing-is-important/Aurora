import { contextBridge, ipcRenderer } from 'electron'

export type ThemeSource = 'system' | 'light' | 'dark'

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
}

contextBridge.exposeInMainWorld('aurora', api)
