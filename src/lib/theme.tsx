import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { ThemeSource } from './ipc'

interface ThemeContextValue {
  source: ThemeSource
  isDark: boolean
  cycle: () => void
  setSource: (s: ThemeSource) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const ORDER: ThemeSource[] = ['system', 'light', 'dark']

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<ThemeSource>('system')
  const [systemDark, setSystemDark] = useState<boolean>(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    // 冒烟模式：保持 system，完全跟随主进程控制（matchMedia 会随 nativeTheme 变化）
    if (!window.aurora.smoke) {
      void window.aurora.theme.getSource().then((s) => {
        if (s) setSourceState(s)
      })
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', onMq)
    const off = window.aurora.theme.onSystemChanged(setSystemDark)
    return () => {
      mq.removeEventListener('change', onMq)
      off()
    }
  }, [])

  const isDark = source === 'system' ? systemDark : source === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    // 冒烟模式下由主进程接管主题，渲染层不覆盖
    if (!window.aurora.smoke) window.aurora.theme.setSource(source)
  }, [isDark, source])

  const setSource = useCallback((s: ThemeSource) => setSourceState(s), [])
  const cycle = useCallback(
    () =>
      setSourceState((prev) => ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]),
    [],
  )

  const value = useMemo(
    () => ({ source, isDark, cycle, setSource }),
    [source, isDark, cycle, setSource],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
