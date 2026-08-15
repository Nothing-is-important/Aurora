import { useChat } from './useChat'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'

export default function App() {
  const chat = useChat()
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
          onSend={(t) => void chat.send(t)}
          onStop={chat.stop}
        />
      </div>
    </div>
  )
}
