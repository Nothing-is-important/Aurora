import { useEffect, useState } from 'react'
import { Search, Sparkles } from 'lucide-react'

function LightGlyph({ kind }: { kind: 'close' | 'min' | 'max' }) {
  if (kind === 'close') {
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
        <path
          d="M1.2 1.2 L6.8 6.8 M6.8 1.2 L1.2 6.8"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (kind === 'min') {
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
        <path
          d="M1.2 4 H6.8"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
      <path
        d="M2.6 2.2 L5.8 2.2 L5.8 5.4 M2.2 5.8 L2.2 2.2 L5.8 2.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function TitleBar({ title }: { title: string }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.aurora.window.isMaximized().then(setMaximized)
    const off = window.aurora.window.onMaximized(setMaximized)
    return off
  }, [])

  return (
    <div className="drag relative z-20 flex h-11 shrink-0 items-center px-3">
      {/* 交通灯 */}
      <div className="traffic-group flex items-center gap-2 pl-1">
        <button
          aria-label="关闭"
          onClick={() => window.aurora.window.close()}
          className="traffic-light bg-[#FF5F57] border border-black/10"
        >
          <LightGlyph kind="close" />
        </button>
        <button
          aria-label="最小化"
          onClick={() => window.aurora.window.minimize()}
          className="traffic-light bg-[#FEBC2E] border border-black/10"
        >
          <LightGlyph kind="min" />
        </button>
        <button
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => window.aurora.window.maximizeToggle()}
          className="traffic-light bg-[#28C840] border border-black/10"
        >
          <LightGlyph kind="max" />
        </button>
      </div>

      {/* 居中标题 */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <span
          data-titlebar-title
          className="max-w-[46%] truncate text-[13px] font-medium text-black/55 dark:text-white/60"
        >
          {title}
        </span>
      </div>

      {/* 右侧工具 */}
      <div className="no-drag ml-auto flex items-center gap-1">
        <button className="flex h-7 w-7 items-center justify-center rounded-lg text-black/50 transition-colors hover:bg-black/[0.06] hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white/90">
          <Search size={15} strokeWidth={2} />
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-lg text-black/50 transition-colors hover:bg-black/[0.06] hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white/90">
          <Sparkles size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
