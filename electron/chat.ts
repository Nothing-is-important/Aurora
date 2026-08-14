import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { ModelConfig } from './db'
import { executeTool, TOOL_DEFS } from './tools'

export interface ApiChatMessage {
  role: string
  content: string | unknown[] | null
  tool_calls?: unknown[]
  tool_call_id?: string
}

export interface ChatStartRequest {
  requestId: string
  modelId: string
  messages: { role: string; content: unknown }[]
}

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

interface ToolCall {
  id: string
  name: string
  argsStr: string
}

interface StreamOutcome {
  finish: string
  toolCalls: ToolCall[]
}

const active = new Map<string, AbortController>()

/** 冒烟模式记录最近的请求（用于系统提示词注入断言） */
const smokeRequests: ChatStartRequest[] = []

export function getSmokeChatRequests(): ChatStartRequest[] {
  return smokeRequests
}

export function registerChatIpc(getModels: () => ModelConfig[]): void {
  ipcMain.on('chat:start', (e, req: ChatStartRequest) => {
    if (process.env.SMOKE === '1') smokeRequests.push(req)
    const model = getModels().find((m) => m.id === req.modelId)
    void runChat(e.sender, req, model ?? null)
  })
  ipcMain.on('chat:stop', (_e, requestId: string) => {
    active.get(requestId)?.abort()
  })
}

function emit(wc: WebContents, channel: string, payload: unknown): void {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

function errMessage(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err)
  return s.slice(0, 500)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

const MAX_ROUNDS = 6

async function runChat(
  wc: WebContents,
  req: ChatStartRequest,
  model: ModelConfig | null,
): Promise<void> {
  if (!model) {
    emit(wc, 'chat:error', {
      requestId: req.requestId,
      message: '未找到所选模型',
      aborted: false,
    })
    emit(wc, 'chat:done', {
      requestId: req.requestId,
      aborted: false,
      durationMs: 0,
      firstTokenMs: 0,
    })
    return
  }
  const ac = new AbortController()
  active.set(req.requestId, ac)
  const startAt = Date.now()
  let firstTokenAt = 0
  const onFirstToken = (): void => {
    if (!firstTokenAt) firstTokenAt = Date.now()
  }
  try {
    if (model.provider !== 'mock' && !model.apiKey) {
      emit(wc, 'chat:error', {
        requestId: req.requestId,
        message: `「${model.name}」尚未配置 API Key，请到设置中填写`,
        aborted: false,
      })
    } else {
      // Agent 循环：工具调用 → 执行 → 结果回传，直到 stop 或达上限
      const messages: ApiChatMessage[] = req.messages.map((m) => ({
        role: m.role,
        content: m.content as string | unknown[] | null,
      }))
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const outcome =
          model.provider === 'mock'
            ? await mockCallOnce(wc, req.requestId, ac.signal, messages, onFirstToken)
            : await sseCallOnce(wc, req.requestId, model, ac.signal, messages, onFirstToken)
        if (outcome.toolCalls.length === 0 || outcome.finish !== 'tool_calls') {
          break
        }
        // 执行工具
        const assistantToolCalls = outcome.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.argsStr },
        }))
        const toolMessages: ApiChatMessage[] = []
        for (const tc of outcome.toolCalls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.argsStr || '{}')
          } catch {
            args = { _raw: tc.argsStr }
          }
          emit(wc, 'chat:tool', {
            requestId: req.requestId,
            step: {
              id: tc.id,
              name: tc.name,
              args,
              status: 'running',
              resultSummary: '',
            },
          })
          const r = executeTool(tc.name, args)
          const summary = (r.ok ? r.result : r.error) ?? ''
          emit(wc, 'chat:tool', {
            requestId: req.requestId,
            step: {
              id: tc.id,
              name: tc.name,
              args,
              status: r.ok ? 'done' : 'error',
              resultSummary: summary.slice(0, 800),
            },
          })
          toolMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: r.ok ? r.result ?? '' : `ERROR: ${r.error}`,
          })
        }
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: assistantToolCalls,
        })
        messages.push(...toolMessages)
      }
    }
    emit(wc, 'chat:done', {
      requestId: req.requestId,
      aborted: false,
      durationMs: Date.now() - startAt,
      firstTokenMs: firstTokenAt ? firstTokenAt - startAt : 0,
    })
  } catch (err) {
    const aborted = ac.signal.aborted
    emit(wc, 'chat:error', {
      requestId: req.requestId,
      message: aborted ? '已停止生成' : errMessage(err),
      aborted,
    })
    emit(wc, 'chat:done', {
      requestId: req.requestId,
      aborted,
      durationMs: Date.now() - startAt,
      firstTokenMs: firstTokenAt ? firstTokenAt - startAt : 0,
    })
  } finally {
    active.delete(req.requestId)
  }
}

// ---- OpenAI 兼容 SSE 单轮调用（累积 tool_calls）----
async function sseCallOnce(
  wc: WebContents,
  requestId: string,
  model: ModelConfig,
  signal: AbortSignal,
  messages: ApiChatMessage[],
  onFirstToken?: () => void,
): Promise<StreamOutcome> {
  const url = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.modelId,
      messages,
      tools: TOOL_DEFS,
      stream: true,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      top_p: model.topP,
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? ': ' + detail.slice(0, 300) : ''}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finish = ''
  const toolCalls = new Map<number, { id: string; name: string; argsStr: string }>()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const choice = j.choices?.[0]
        const delta = choice?.delta ?? {}
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          emit(wc, 'chat:delta', { requestId, reasoning: delta.reasoning_content })
        }
        if (typeof delta.content === 'string' && delta.content) {
          onFirstToken?.()
          emit(wc, 'chat:delta', { requestId, content: delta.content })
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const cur = toolCalls.get(idx) ?? { id: '', name: '', argsStr: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name = tc.function.name
            if (tc.function?.arguments) cur.argsStr += tc.function.arguments
            toolCalls.set(idx, cur)
          }
        }
        if (choice?.finish_reason) finish = choice.finish_reason
        if (j.usage) {
          emit(wc, 'chat:usage', { requestId, usage: j.usage })
        }
      } catch {
        /* 忽略不完整行 */
      }
    }
  }
  return {
    finish,
    toolCalls: [...toolCalls.values()].filter((tc) => tc.name),
  }
}

// ---- Mock 单轮调用（含工具调用演示）----
function chunks(text: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out
}

async function mockCallOnce(
  wc: WebContents,
  requestId: string,
  signal: AbortSignal,
  messages: ApiChatMessage[],
  onFirstToken?: () => void,
): Promise<StreamOutcome> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const userText =
    typeof lastUser?.content === 'string' ? lastUser.content : ''
  const hasToolResult = messages.some((m) => m.role === 'tool')
  const wantsFileDemo = userText.includes('hello.py') || userText.includes('工作目录')

  if (wantsFileDemo && !hasToolResult) {
    // 第一轮：演示工具调用（写文件）
    const reasoning =
      '用户想要在工作目录操作文件。我将使用 write_file 工具写入 hello.py，然后读取它确认内容。'
    for (const ch of chunks(reasoning, 6)) {
      emit(wc, 'chat:delta', { requestId, reasoning: ch })
      await sleep(22, signal)
    }
    await sleep(120, signal)
    return {
      finish: 'tool_calls',
      toolCalls: [
        {
          id: 'call_mock_hello',
          name: 'write_file',
          argsStr: JSON.stringify({
            path: 'hello.py',
            content: 'print("hello from aurora")\n',
          }),
        },
      ],
    }
  }

  // 正常流（第二轮会提及读取结果）
  if (!hasToolResult) {
    const reasoning =
      '用户希望看到一个综合示例。我可以准备一段包含二级标题、Python 代码块、LaTeX 公式与列表的 Markdown 回复，用来验证流式渲染、语法高亮、复制按钮与 KaTeX 是否正常工作。'
    for (const ch of chunks(reasoning, 6)) {
      emit(wc, 'chat:delta', { requestId, reasoning: ch })
      await sleep(22, signal)
    }
    await sleep(120, signal)
  }
  const intro = hasToolResult
    ? '已通过工具完成文件操作：'
    : '好的，下面是一个综合示例。'
  const content = [
    intro,
    '',
    hasToolResult
      ? '我在工作目录写入了 hello.py 并读取确认，内容如下：'
      : '## 快速示例',
    '',
    '```python',
    'print("hello from aurora")',
    '```',
    '',
    hasToolResult
      ? '文件已就绪，可以继续让我修改或解释它。'
      : '再验证一个公式，欧拉恒等式：',
    '',
    hasToolResult ? '' : '$$',
    hasToolResult ? '' : 'e^{i\\pi} + 1 = 0',
    hasToolResult ? '' : '$$',
    '',
    '要点：',
    '',
    '- **流式渲染**逐字出现',
    hasToolResult ? '- **工具调用**已执行并回传结果' : '- 代码块带语法高亮与复制按钮',
    hasToolResult ? '' : '- 公式由 KaTeX 渲染',
    '',
    hasToolResult ? '' : '以上全部来自本地 Mock 提供方，无需 API Key。',
  ]
    .filter((l) => l !== '')
    .join('\n')

  for (const ch of chunks(content, 8)) {
    onFirstToken?.()
    emit(wc, 'chat:delta', { requestId, content: ch })
    await sleep(14, signal)
  }
  if (!hasToolResult) {
    emit(wc, 'chat:usage', {
      requestId,
      usage: { prompt_tokens: 24, completion_tokens: 218, total_tokens: 242 },
    })
  }
  return { finish: 'stop', toolCalls: [] }
}
