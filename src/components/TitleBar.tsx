import { useEffect, useState } from 'react'

function WinGlyph({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }) {
  if (kind === 'close') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M1 1 L9 9 M9 1 L1 9"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (kind === 'min') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M0.5 5 H9.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (kind === 'max') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <rect
          x="0.5"
          y="0.5"
          width="9"
          height="9"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      </svg>
    )
  }
  // restore：两个叠放矩形
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect
        x="0.5"
        y="2.5"
        width="7"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M2.5 2.5 V1.5 A1 1 0 0 1 3.5 0.5 H8.5 A1 1 0 0 1 9.5 1.5 V6.5 A1 1 0 0 1 8.5 7.5 H7.5"
        stroke="currentColor"
        strokeWidth="1.1"
        fill="none"
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
    <div className="drag relative z-20 flex h-8 shrink-0 items-stretch border-b border-black/[0.05] dark:border-white/[0.07]">
      {/* Windows 风格：标题居左 */}
      <div className="flex min-w-0 items-center pl-3">
        <span
          data-titlebar-title
          className="truncate text-[12px] text-black/60 dark:text-white/65"
        >
          {title}
        </span>
      </div>

      {/* 右上角窗口控制按钮（Win11 风格） */}
      <div className="no-drag ml-auto flex h-full items-stretch">
        <button
          aria-label="最小化"
          title="最小化"
          onClick={() => window.aurora.window.minimize()}
          className="flex w-[46px] items-center justify-center text-black/65 transition-colors hover:bg-black/[0.06] dark:text-white/75 dark:hover:bg-white/[0.08]"
        >
          <WinGlyph kind="min" />
        </button>
        <button
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
          onClick={() => window.aurora.window.maximizeToggle()}
          className="flex w-[46px] items-center justify-center text-black/65 transition-colors hover:bg-black/[0.06] dark:text-white/75 dark:hover:bg-white/[0.08]"
        >
          <WinGlyph kind={maximized ? 'restore' : 'max'} />
        </button>
        <button
          aria-label="关闭"
          title="关闭"
          onClick={() => window.aurora.window.close()}
          className="flex w-[46px] items-center justify-center text-black/65 transition-colors hover:bg-[#E81123] hover:text-white dark:text-white/75"
        >
          <WinGlyph kind="close" />
        </button>
      </div>
    </div>
  )
}
