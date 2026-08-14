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
          const r = await executeTool(tc.name, args)
          const summary = (r.ok ? r.result : r.error) ?? ''
          emit(wc, 'chat:tool', {
            requestId: req.requestId,
            step: {
              id: tc.id,
              name: tc.name,
              args,
              status: r.ok ? 'done' : 'error',
              resultSummary: summary.slice(0, 800),
              refs: r.refs ?? [],
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
  const wantsShellDemo =
    userText.includes('系统命令') || userText.includes('echo aurora')
  const wantsPythonDemo =
    userText.includes('6*7') || userText.includes('run_python')
  const wantsSearchDemo = userText.includes('搜索')
  const wantsFetchDemo = userText.includes('抓取')
  const wantsToolDemo =
    wantsFileDemo || wantsShellDemo || wantsPythonDemo || wantsSearchDemo || wantsFetchDemo

  if (wantsToolDemo && !hasToolResult) {
    // 第一轮：演示工具调用
    let toolCall: ToolCall
    let reasoning: string
    if (wantsShellDemo) {
      toolCall = {
        id: 'call_mock_shell',
        name: 'run_shell',
        argsStr: JSON.stringify({ command: 'echo aurora-shell-ok' }),
      }
      reasoning =
        '用户想演示系统命令执行。我将通过 run_shell 工具执行 echo 命令，验证确认流程与结果回传。'
    } else if (wantsPythonDemo) {
      toolCall = {
        id: 'call_mock_py',
        name: 'run_python',
        argsStr: JSON.stringify({ code: 'print(6*7)' }),
      }
      reasoning =
        '用户想验证 Python 代码执行。我将用 run_python 工具计算 6*7，并检查输出是否为 42。'
    } else if (wantsSearchDemo) {
      toolCall = {
        id: 'call_mock_search',
        name: 'web_search',
        argsStr: JSON.stringify({ query: 'deepseek-harness 开源方案' }),
      }
      reasoning =
        '用户想了解 deepseek-harness 的开源方案。我将使用 web_search 工具搜索并整理引用来源。'
    } else if (wantsFetchDemo) {
      toolCall = {
        id: 'call_mock_fetch',
        name: 'fetch_url',
        argsStr: JSON.stringify({ url: 'https://example.com/article' }),
      }
      reasoning =
        '用户想抓取网页内容。我将使用 fetch_url 工具抓取并提取正文。'
    } else {
      toolCall = {
        id: 'call_mock_hello',
        name: 'write_file',
        argsStr: JSON.stringify({
          path: 'hello.py',
          content: 'print("hello from aurora")\n',
        }),
      }
      reasoning =
        '用户想要在工作目录操作文件。我将使用 write_file 工具写入 hello.py，然后读取它确认内容。'
    }
    for (const ch of chunks(reasoning, 6)) {
      emit(wc, 'chat:delta', { requestId, reasoning: ch })
      await sleep(22, signal)
    }
    await sleep(120, signal)
    return { finish: 'tool_calls', toolCalls: [toolCall] }
  }

  // 正常流（工具第二轮会提及执行结果）
  if (!hasToolResult) {
    const reasoning =
      '用户希望看到一个综合示例。我可以准备一段包含二级标题、Python 代码块、LaTeX 公式与列表的 Markdown 回复，用来验证流式渲染、语法高亮、复制按钮与 KaTeX 是否正常工作。'
    for (const ch of chunks(reasoning, 6)) {
      emit(wc, 'chat:delta', { requestId, reasoning: ch })
      await sleep(22, signal)
    }
    await sleep(120, signal)
  }
  const content = hasToolResult
    ? [
        '已通过工具完成操作：',
        '',
        '工具已执行并返回结果，执行摘要：',
        '',
        '```',
        'ok',
        '```',
        '',
        '**工具调用**链路（模型发起 → 本地执行 → 结果回传）验证完成。',
      ].join('\n')
    : [
        '好的，下面是一个综合示例。',
        '',
        '## 快速示例',
        '',
        '先看一个 Python 函数：',
        '',
        '```python',
        'def fib(n):',
        '    """返回前 n 个斐波那契数"""',
        '    a, b = 0, 1',
        '    out = []',
        '    for _ in range(n):',
        '        out.append(a)',
        '        a, b = b, a + b',
        '    return out',
        '',
        'print(fib(10))',
        '```',
        '',
        '再验证一个公式，欧拉恒等式：',
        '',
        '$$',
        'e^{i\\pi} + 1 = 0',
        '$$',
        '',
        '要点：',
        '',
        '- **流式渲染**逐字出现',
        '- 代码块带语法高亮与复制按钮',
        '- 公式由 KaTeX 渲染',
        '',
        '以上全部来自本地 Mock 提供方，无需 API Key。',
      ].join('\n')

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
