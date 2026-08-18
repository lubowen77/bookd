import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: { stdio: 'ignore' },
) => ChildProcess

type McpServerDependencies = {
  fetch?: typeof fetch
  spawn?: SpawnProcess
}

const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url))
let autostartPromise: Promise<void> | null = null

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const errorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  return 'cause' in error ? errorCode(error.cause) : undefined
}

const isNetworkError = (error: unknown) => error instanceof TypeError || errorCode(error) === 'ECONNREFUSED'

const isLoopbackUrl = (url: URL) => {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

const startPort = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80')

const spawnBookdStart = (url: URL, spawnProcess: SpawnProcess) => new Promise<void>((resolve, reject) => {
  const port = startPort(url)
  let child: ChildProcess
  try {
    child = spawnProcess(process.execPath, [cliPath, 'start', '--port', port], { stdio: 'ignore' })
  } catch (error) {
    reject(error)
    return
  }
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (code === 0) resolve()
    else reject(new Error(`bookd start 退出：${code == null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`))
  })
})

const ensureBookdStarted = (url: URL, spawnProcess: SpawnProcess) => {
  if (!autostartPromise) {
    const pending = spawnBookdStart(url, spawnProcess)
    const shared = pending.finally(() => {
      if (autostartPromise === shared) autostartPromise = null
    })
    autostartPromise = shared
  }
  return autostartPromise
}

const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const errorResult = (error: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
})

export const createBookdMcpServer = (
  baseUrl = process.env.BOOKD_URL ?? 'http://127.0.0.1:4123',
  dependencies: McpServerDependencies = {},
) => {
  const server = new McpServer({ name: 'bookd', version: '0.1.0' })
  const fetchRequest = dependencies.fetch ?? fetch
  const spawnProcess = dependencies.spawn ?? spawn
  const target = new URL(baseUrl)
  const manualCommand = `node ${cliPath} serve --port ${startPort(target)}`

  const request = async (pathname: string, init?: RequestInit) => {
    const url = new URL(pathname, target)
    const requestOnce = () => fetchRequest(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
    let response: Response
    try {
      response = await requestOnce()
    } catch (connectionError) {
      if (!isNetworkError(connectionError) || !isLoopbackUrl(target)) throw connectionError
      try {
        await ensureBookdStarted(target, spawnProcess)
      } catch (startError) {
        throw new Error(`自动启动 bookd 失败：${errorMessage(startError)}；原始连接错误：${errorMessage(connectionError)}。请手动运行：${manualCommand}`)
      }
      try {
        response = await requestOnce()
      } catch (retryError) {
        throw new Error(`bookd 自动启动后重试失败：${errorMessage(retryError)}；首次连接错误：${errorMessage(connectionError)}。请手动运行：${manualCommand}`)
      }
    }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `bookd 返回 ${response.status}`)
    return body
  }

  server.registerTool('get_reading_state', {
    title: '获取当前阅读状态',
    description: '读取当前打开的书、章节、CFI、总进度、屏幕内文本头部和用户选区。',
    inputSchema: {},
  }, async () => {
    try { return jsonResult(await request('/api/state')) } catch (error) { return errorResult(error) }
  })

  server.registerTool('list_books', {
    title: '列出本地书库',
    description: '列出 bookd 本地书库中的所有书籍及其格式、作者和章节信息。',
    inputSchema: {},
  }, async () => {
    try { return jsonResult(await request('/api/books')) } catch (error) { return errorResult(error) }
  })

  server.registerTool('open_book', {
    title: '打开书籍',
    description: '让已打开的 bookd 阅读器切换到指定书籍。',
    inputSchema: { book_id: z.string().min(1).describe('list_books 返回的书籍 ID') },
  }, async ({ book_id }) => {
    try {
      return jsonResult(await request('/api/open', { method: 'POST', body: JSON.stringify({ bookId: book_id }) }))
    } catch (error) { return errorResult(error) }
  })

  server.registerTool('get_chapter', {
    title: '获取章节正文',
    description: '按从 0 开始的章节序号读取清洗后的 Markdown 与纯文本。',
    inputSchema: {
      book_id: z.string().min(1).describe('书籍 ID'),
      chapter: z.number().int().min(0).describe('从 0 开始的章节序号'),
    },
  }, async ({ book_id, chapter }) => {
    try { return jsonResult(await request(`/api/books/${encodeURIComponent(book_id)}/chapters/${chapter}`)) } catch (error) { return errorResult(error) }
  })

  server.registerTool('search_book', {
    title: '搜索书籍',
    description: '在已提取的全书文本中搜索关键词并返回章节与上下文。',
    inputSchema: {
      book_id: z.string().min(1).describe('书籍 ID'),
      query: z.string().min(1).describe('要搜索的文字'),
    },
  }, async ({ book_id, query }) => {
    try { return jsonResult(await request(`/api/books/${encodeURIComponent(book_id)}/search?q=${encodeURIComponent(query)}`)) } catch (error) { return errorResult(error) }
  })

  server.registerTool('goto', {
    title: '跳转阅读位置',
    description: '让阅读器跳转到 CFI、全书比例或章节；三种目标任选其一。',
    inputSchema: {
      book_id: z.string().optional().describe('可选的书籍 ID'),
      cfi: z.string().optional().describe('精确 EPUB CFI 或 bookd Markdown 位置'),
      fraction: z.number().min(0).max(1).optional().describe('0 到 1 的全书进度'),
      chapter: z.number().int().min(0).optional().describe('从 0 开始的章节序号'),
    },
  }, async ({ book_id, cfi, fraction, chapter }) => {
    if (!cfi && fraction == null && chapter == null) return errorResult(new Error('需要 cfi、fraction 或 chapter'))
    try {
      return jsonResult(await request('/api/commands/goto', {
        method: 'POST', body: JSON.stringify({ bookId: book_id, cfi, fraction, chapter }),
      }))
    } catch (error) { return errorResult(error) }
  })

  server.registerTool('highlight', {
    title: '高亮当前选区',
    description: '高亮指定 CFI/文本；省略时使用阅读器当前选区，同时写入 annotations.json 与 notes.md。',
    inputSchema: {
      book_id: z.string().optional().describe('书籍 ID；默认当前书'),
      cfi: z.string().optional().describe('选区 CFI；默认当前选区'),
      text: z.string().optional().describe('选区文本；默认当前选区'),
      note: z.string().optional().describe('随高亮保存的笔记'),
      color: z.string().optional().describe('CSS 颜色，默认暖金色'),
    },
  }, async ({ book_id, cfi, text, note, color }) => {
    try {
      return jsonResult(await request('/api/commands/highlight', {
        method: 'POST', body: JSON.stringify({ bookId: book_id, cfi, text, note, color, source: 'mcp' }),
      }))
    } catch (error) { return errorResult(error) }
  })

  server.registerTool('clear_highlights', {
    title: '清除高亮',
    description: '删除当前书或指定书籍中的单条/全部高亮。',
    inputSchema: {
      book_id: z.string().optional().describe('书籍 ID；默认当前书'),
      annotation_id: z.string().optional().describe('只删除这一条；省略则清空本书'),
    },
  }, async ({ book_id, annotation_id }) => {
    try {
      let resolvedBookId = book_id
      if (!resolvedBookId) {
        const current = await request('/api/state')
        resolvedBookId = current.state?.book
        if (!resolvedBookId) throw new Error('当前没有打开的书籍')
      }
      return jsonResult(await request('/api/commands/clear-highlights', {
        method: 'POST', body: JSON.stringify({ bookId: resolvedBookId, annotationId: annotation_id }),
      }))
    } catch (error) { return errorResult(error) }
  })

  return server
}
