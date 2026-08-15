import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

function extractText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const props = (node as { props: { children?: unknown } }).props
    return extractText(props.children)
  }
  return ''
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const child = Array.isArray(children) ? children[0] : children
  const props = (child as { props?: { className?: string; children?: unknown } })
    ?.props
  const className = props?.className ?? ''
  const langMatch = /language-([\w+-]+)/.exec(className)
  const lang = langMatch?.[1]

  // 数学块：rehype-katex 的 display math，直接透传
  if (lang === 'math') return <pre className="md-math-pre">{children}</pre>

  const code = extractText(props?.children).replace(/\n$/, '')

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="code-block">
      <div className="flex items-center justify-between border-b border-black/[0.07] px-3.5 py-1.5 dark:border-white/[0.09]">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-black/40 dark:text-white/40">
          {lang ?? 'code'}
        </span>
        <button
          aria-label="复制代码"
          onClick={copy}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-black/45 transition-colors hover:bg-black/[0.06] hover:text-black/75 dark:text-white/45 dark:hover:bg-white/[0.08] dark:hover:text-white/80"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <code className={className}>{props?.children}</code>
      </pre>
    </div>
  )
}

// 组件定义在模块级，避免每次流式更新都重建
const components = {
  pre: CodeBlock,
  a: (props: Record<string, unknown>) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
} as never

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
