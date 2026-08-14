import { useCallback, useEffect, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InspectorPanel from './components/InspectorPanel'
import { ThemeProvider } from './lib/theme'
import { useChat } from './lib/chat'
import type { ConversationRow } from './lib/ipc'

function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv)
        resolve(true)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv)
        resolve(false)
      }
    }, 50)
  })
}

function AppInner() {
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const messagesRef = useRef<unknown[]>([])
  /** 刚创建的会话跳过 load（send 会自行追加状态，避免读到半成品落库） */
  const skipLoadRef = useRef(false)

  const reloadConversations = useCallback(async () => {
    const list = await window.aurora.conversations.list()
    setConversations(list)
  }, [])

  useEffect(() => {
    void reloadConversations()
  }, [reloadConversations])

  const ensureConversation = useCallback(
    async (title: string) => {
      skipLoadRef.current = true
      const conv = await window.aurora.conversations.create(title)
      setActiveId(conv.id)
      void reloadConversations()
      return conv.id
    },
    [reloadConversations],
  )

  const chat = useChat({
    conversationId: activeId,
    onEnsureConversation: ensureConversation,
    onActivity: () => {
      void reloadConversations()
    },
  })

  // 切换会话 → 重载消息（刚创建的会话跳过，由 send 自行填充）
  useEffect(() => {
    if (activeId) {
      if (skipLoadRef.current) {
        skipLoadRef.current = false
        return
      }
      void chat.loadConversation(activeId)
    } else {
      chat.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  messagesRef.current = chat.messages

  // ---- 冒烟第三阶段：会话切换与持久化 ----
  const phase3 = useRef(false)
  const [phase2Done, setPhase2Done] = useState(false)

  useEffect(() => {
    if (!window.aurora.smoke || !phase2Done || phase3.current) return
    phase3.current = true
    void (async () => {
      await new Promise((r) => setTimeout(r, 400))
      const list1 = await window.aurora.conversations.list()
      const convB = await window.aurora.conversations.create('工作区会话 B')
      void reloadConversations()
      setActiveId(convB.id)
      const emptyOk = await waitFor(() => messagesRef.current.length === 0)
      const first = list1[0]
      if (first) setActiveId(first.id)
      const restored = await waitFor(() => messagesRef.current.length === 4)
      window.aurora.smokeNotifyConvVerified({
        listCount: list1.length + 1,
        firstTitle: first?.title ?? '',
        emptyOk,
        restoredCount: messagesRef.current.length,
      })
    })()
  }, [phase2Done])

  const handleSelect = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const handleNewChat = useCallback(() => {
    setActiveId(null)
  }, [])

  const handleRename = useCallback(
    async (id: string, title: string) => {
      await window.aurora.conversations.rename(id, title)
      void reloadConversations()
    },
    [reloadConversations],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await window.aurora.conversations.remove(id)
      if (activeId === id) setActiveId(null)
      void reloadConversations()
    },
    [activeId, reloadConversations],
  )

  const handleTogglePin = useCallback(
    async (id: string, pinned: boolean) => {
      await window.aurora.conversations.setPinned(id, pinned)
      void reloadConversations()
    },
    [reloadConversations],
  )

  const activeConv = conversations.find((c) => c.id === activeId) ?? null

  return (
    <div className="relative flex h-full flex-col">
      <div className="bg-orbs">
        <div className="orb-orange" />
      </div>
      <TitleBar title={activeConv?.title ?? '新对话'} />
      <div className="relative z-10 flex min-h-0 flex-1">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onNewChat={handleNewChat}
          onSelect={handleSelect}
          onRename={handleRename}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          onOpenSettings={() => setSettingsOpen((v) => !v)}
        />
        <ChatArea
          chat={chat}
          settingsOpen={settingsOpen}
          onSmokePhase2Done={() => setPhase2Done(true)}
        />
        <InspectorPanel />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}
