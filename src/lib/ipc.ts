export type ThemeSource = 'system' | 'light' | 'dark'

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
}

declare global {
  interface Window {
    aurora: AuroraApi
  }
}
