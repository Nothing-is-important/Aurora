import { useCallback, useEffect, useState } from 'react'
import { useChat } from './useChat'
import type { LlmState } from './types'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsModal from './components/SettingsModal'

export default function App() {
  const chat = useChat()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [llm, setLlm] = useState<LlmState | null>(null)

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

  const handleLlmSelect = useCallback(
    async (provider: string, model: string) => {
      try {
        setLlm(await window.aurora.llm.select(provider, model))
      } catch (err) {
        console.error('llm:select failed', err)
      }
    },
    [],
  )

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
          streaming={chat.streaming}
          ready={chat.ready}
          llm={llm}
          onLlmSelect={handleLlmSelect}
          onOpenSettings={() => setSettingsOpen(true)}
          onSend={(t) => void chat.send(t)}
          onStop={chat.stop}
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
    </div>
  )
}
