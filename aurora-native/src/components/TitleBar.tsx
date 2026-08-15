import { Minus, Square, X } from 'lucide-react'

export default function TitleBar({ title }: { title: string }) {
  return (
    <div className="titlebar flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
      <div className="flex items-center gap-2.5 text-[12px] font-medium text-black/60 dark:text-white/60">
        <span className="inline-block h-2 w-2 rounded-full bg-gradient-to-br from-apple-blue to-apple-purple" />
        {title}
      </div>
      <div className="flex items-center gap-1">
        <button
          aria-label="最小化"
          className="win-btn"
          onClick={() => window.aurora.window.minimize()}
        >
          <Minus size={14} strokeWidth={2} />
        </button>
        <button
          aria-label="最大化"
          className="win-btn"
          onClick={() => window.aurora.window.toggleMaximize()}
        >
          <Square size={11} strokeWidth={2} />
        </button>
        <button
          aria-label="关闭"
          className="win-btn hover:!bg-apple-red hover:!text-white"
          onClick={() => window.aurora.window.close()}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
