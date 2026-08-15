import { useCallback, useEffect, useState } from 'react'
import { useChat } from './useChat'
import type { LlmState } from './types'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'

const THEME_KEY = 'aurora-theme'

export default function App() {
  const chat = useChat()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [llm, setLlm] = useState<LlmState | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const cycleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const refreshLlm = useCallback(async () => {
    try {
      setLlm(await window.aurora.llm.state())
    } catch (err) {
      console.error('llm:state failed', err)
    }
  }, [])

  useEffect(() => {
    void refreshLlm()
  }, [refreshLlm])

  const handleLlmSelect = useCallback(async (provider: string, model: string) => {
    try {
      setLlm(await window.aurora.llm.select(provider, model))
    } catch (err) {
      console.error('llm:select failed', err)
    }
  }, [])

  // 快捷键：Ctrl+K 命令面板 / Ctrl+N 新对话 / Ctrl+, 设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (k === 'n') {
        e.preventDefault()
        chat.newChat()
      } else if (k === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chat])

  return (
    <div className="relative z-10 flex h-full flex-col">
      <div className="bg-orbs" aria-hidden />
      <TitleBar title="Aurora" />
      <div className="relative z-10 flex min-h-0 flex-1">
        <Sidebar
          sessions={chat.sessions}
          activeId={chat.sessionId}
          onOpen={(id) => void chat.openSession(id)}
          onNew={chat.newChat}
        />
        <ChatArea
          messages={chat.messages}
          rawEvents={chat.rawEvents}
          streaming={chat.streaming}
          ready={chat.ready}
          llm={llm}
          onLlmSelect={handleLlmSelect}
          onOpenSettings={() => setSettingsOpen(true)}
          onSend={(t) => void chat.send(t)}
          onStop={chat.stop}
          onFork={chat.fork}
        />
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          void refreshLlm()
        }}
        onEngineRestarted={() => {
          void refreshLlm()
          void chat.refreshSessions()
        }}
      />
      <CommandPalette
        open={paletteOpen}
        sessions={chat.sessions}
        llm={llm}
        onClose={() => setPaletteOpen(false)}
        onNewChat={() => chat.newChat()}
        onOpenSettings={() => setSettingsOpen(true)}
        onCycleTheme={cycleTheme}
        onSelectConversation={(id) => void chat.openSession(id)}
        onSelectModel={(provider, model) => void handleLlmSelect(provider, model)}
      />
    </div>
  )
}
