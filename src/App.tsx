import { useCallback, useEffect, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InspectorPanel from './components/InspectorPanel'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import { ThemeProvider, useTheme } from './lib/theme'
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
  const { cycle: cycleTheme } = useTheme()
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
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
  const [convDone, setConvDone] = useState(false)

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
      setConvDone(true)
    })()
  }, [phase2Done])

  // ---- 冒烟第五阶段：导出验证 ----
  const phase5 = useRef(false)
  const [exportDone, setExportDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !convDone || phase5.current) return
    phase5.current = true
    void (async () => {
      const conv = (await window.aurora.conversations.list()).find((c) =>
        c.title.startsWith('冒烟'),
      )
      if (!conv) {
        window.aurora.smokeNotifyExportVerified({
          mdOk: false,
          jsonOk: false,
          pathOk: false,
        })
        setExportDone(true)
        return
      }
      const md = await window.aurora.conversations.export(conv.id, 'md')
      const j = await window.aurora.conversations.export(conv.id, 'json')
      let jsonOk = false
      try {
        jsonOk = JSON.parse(j.content).messages.length === 4
      } catch {
        jsonOk = false
      }
      window.aurora.smokeNotifyExportVerified({
        mdOk: md.content.includes('快速示例') && md.content.includes('## 用户'),
        jsonOk,
        pathOk: !!md.path && !!j.path,
      })
      setExportDone(true)
    })()
  }, [convDone])

  // ---- 冒烟第六阶段：系统提示词注入 ----
  const phase6 = useRef(false)
  const streamingAppRef = useRef(chat.streamingId)
  streamingAppRef.current = chat.streamingId
  const [promptDone, setPromptDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !exportDone || phase6.current) return
    phase6.current = true
    void (async () => {
      await window.aurora.settings.set('systemPrompt', '你是全局冒烟系统提示词')
      const conv = (await window.aurora.conversations.list()).find((c) =>
        c.title.startsWith('冒烟'),
      )
      if (!conv) {
        window.aurora.smokeNotifyPromptVerified({ sent: false, sysOk: false })
        return
      }
      await window.aurora.conversations.setSystemPrompt(
        conv.id,
        '会话级冒烟覆盖提示词',
      )
      chat.send('冒烟系统提示词注入测试')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 6,
        25000,
      )
      window.aurora.smokeNotifyPromptVerified({ sent: ok, sysOk: ok })
      setPromptDone(true)
    })()
  }, [exportDone, chat])

  // ---- 冒烟第七阶段：工具调用端到端 ----
  const phase7 = useRef(false)
  const [toolsDone, setToolsDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !promptDone || phase7.current) return
    phase7.current = true
    void (async () => {
      chat.send('请帮我在工作目录写一个 hello.py 文件，然后读取它的内容确认')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 8,
        30000,
      )
      const steps = messagesRef.current.flatMap((m) => m.toolSteps ?? []).length
      window.aurora.smokeNotifyToolsVerified({ done: ok, steps })
      setToolsDone(true)
    })()
  }, [promptDone, chat])

  // ---- 冒烟第八阶段：系统命令端到端 ----
  const phase8 = useRef(false)
  const [shellDone, setShellDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !toolsDone || phase8.current) return
    phase8.current = true
    void (async () => {
      chat.send('请演示系统命令执行：用 echo 输出 aurora-shell-ok')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 10,
        30000,
      )
      const shellSteps = messagesRef.current.flatMap((m) =>
        (m.toolSteps ?? []).filter((s) => s.name === 'run_shell'),
      )
      const shellOk =
        shellSteps.length > 0 &&
        shellSteps.some((s) => s.resultSummary.includes('aurora-shell-ok'))
      window.aurora.smokeNotifyShellVerified({ done: ok, shellOk })
      setShellDone(true)
    })()
  }, [toolsDone, chat])

  // ---- 冒烟第九阶段：联网搜索端到端 ----
  const phase9 = useRef(false)
  const [netDone, setNetDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !shellDone || phase9.current) return
    phase9.current = true
    void (async () => {
      chat.send('请联网搜索 deepseek-harness 的开源方案')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 12,
        30000,
      )
      const refs = messagesRef.current
        .flatMap((m) => m.toolSteps ?? [])
        .flatMap((s) => s.refs ?? [])
      window.aurora.smokeNotifyNetVerified({ done: ok, refsOk: refs.length >= 3 })
      setNetDone(true)
    })()
  }, [shellDone, chat])

  // ---- 冒烟第十阶段：MCP Agent 端到端 ----
  const phase10 = useRef(false)
  const [mcpDone, setMcpDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !netDone || phase10.current) return
    phase10.current = true
    void (async () => {
      chat.send('请调用 MCP 工具 echo 输出 aurora-mcp-ok')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 14,
        30000,
      )
      const mcpSteps = messagesRef.current.flatMap((m) =>
        (m.toolSteps ?? []).filter((s) => s.name.startsWith('mcp__')),
      )
      const mcpOk =
        mcpSteps.length > 0 &&
        mcpSteps.some((s) => s.resultSummary.includes('aurora-mcp-ok'))
      window.aurora.smokeNotifyMcpVerified({ done: ok, mcpOk })
      setMcpDone(true)
    })()
  }, [netDone, chat])

  // ---- 冒烟第十一阶段：知识库检索端到端 ----
  const phase11 = useRef(false)
  const [kbDone, setKbDone] = useState(false)
  useEffect(() => {
    if (!window.aurora.smoke || !mcpDone || phase11.current) return
    phase11.current = true
    void (async () => {
      chat.send('请检索知识库中关于引用溯源的内容')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 16,
        30000,
      )
      const kbSteps = messagesRef.current.flatMap((m) =>
        (m.toolSteps ?? []).filter((s) => s.name === 'search_knowledge'),
      )
      const refs = kbSteps.flatMap((s) => s.refs ?? [])
      window.aurora.smokeNotifyKbVerified({ done: ok, refsOk: refs.length >= 1 })
      setKbDone(true)
    })()
  }, [mcpDone, chat])

  // ---- 冒烟第十二阶段：错误与重试 ----
  const phase12 = useRef(false)
  useEffect(() => {
    if (!window.aurora.smoke || !kbDone || phase12.current) return
    phase12.current = true
    void (async () => {
      chat.send('请触发模拟错误场景')
      const ok = await waitFor(
        () =>
          streamingAppRef.current === null &&
          messagesRef.current.length === 18,
        30000,
      )
      const lastAsst = [...messagesRef.current]
        .reverse()
        .find((m) => m.role === 'assistant')
      window.aurora.smokeNotifyErrorVerified({
        done: ok,
        errorShown: lastAsst?.status === 'error',
        lastStatus: (lastAsst?.status ?? 'none') as string,
        lastError: (lastAsst?.error ?? '') as string,
      })
    })()
  }, [kbDone, chat])

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

  // ---- 快捷键 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (key === 'n') {
        e.preventDefault()
        setActiveId(null)
      } else if (key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      } else if (/^[1-9]$/.test(key)) {
        e.preventDefault()
        const idx = Number(key) - 1
        const conv = conversations[idx]
        if (conv) setActiveId(conv.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [conversations])

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
        <InspectorPanel
          conversation={activeConv}
          messageCount={chat.messages.length}
          messages={chat.messages}
          activeModel={chat.models.find((m) => m.id === chat.modelId)}
        />
      </div>

      <SettingsModal
        open={settingsOpen}
        models={chat.models}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => void chat.reloadModels()}
        onModesChanged={() => void chat.reloadModes()}
      />

      <CommandPalette
        open={paletteOpen}
        conversations={conversations}
        models={chat.models}
        modelId={chat.modelId}
        onClose={() => setPaletteOpen(false)}
        onNewChat={() => setActiveId(null)}
        onOpenSettings={() => setSettingsOpen(true)}
        onCycleTheme={cycleTheme}
        onSelectConversation={(id) => setActiveId(id)}
        onSelectModel={(id) => chat.setModelId(id)}
      />
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
