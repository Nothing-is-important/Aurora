import { useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InspectorPanel from './components/InspectorPanel'
import { ThemeProvider } from './lib/theme'
import type { ConversationItem } from './components/Sidebar'

const SMOKE_CONVERSATIONS: ConversationItem[] = [
  { id: '1', title: 'Python 频谱分析脚本', time: '10:24', active: true },
  { id: '2', title: 'SQLite 查询优化讨论', time: '昨天', pinned: true },
  { id: '3', title: '周末旅行计划：京都', time: '昨天' },
  { id: '4', title: '产品周报草稿', time: '周一' },
]

function AppInner() {
  const [conversations, setConversations] = useState<ConversationItem[]>(
    window.aurora.smoke ? SMOKE_CONVERSATIONS : [],
  )

  return (
    <div className="relative flex h-full flex-col">
      <div className="bg-orbs">
        <div className="orb-orange" />
      </div>
      <TitleBar title={conversations.find((c) => c.active)?.title ?? '新对话'} />
      <div className="relative z-10 flex min-h-0 flex-1">
        <Sidebar
          conversations={conversations}
          onNewChat={() => setConversations([])}
        />
        <ChatArea smoke={window.aurora.smoke} />
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
