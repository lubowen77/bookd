import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { WebSocket, WebSocketServer } from 'ws'
import type { BookdConfig } from './config.js'
import { getConfig } from './config.js'
import { LibraryStore } from './storage.js'
import { ReadingStateStore } from './state.js'
import type { ReaderCommand, SocketMessage } from './shared.js'

const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next)

const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

const normalizeHostname = (hostname: string) => hostname
  .trim()
  .toLowerCase()
  .replace(/^\[|\]$/g, '')

const hostHeaderHostname = (host: string): string | null => {
  try {
    return normalizeHostname(new URL(`http://${host}`).hostname)
  } catch {
    return null
  }
}

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && LOOPBACK_HOSTS.has(normalizeHostname(url.hostname))
  } catch {
    return false
  }
}

export interface BookdServer {
  app: express.Express
  httpServer: http.Server
  library: LibraryStore
  state: ReadingStateStore
  config: BookdConfig
  start(): Promise<{ host: string; port: number }>
  close(): Promise<void>
}

export const createBookdServer = async (overrides: Partial<BookdConfig> = {}): Promise<BookdServer> => {
  const config = getConfig(overrides)
  const library = new LibraryStore(config.libraryDir)
  const state = new ReadingStateStore(config.stateDir)
  await library.init()
  await state.init()

  const app = express()
  const httpServer = http.createServer(app)
  const sockets = new WebSocketServer({ noServer: true })
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024, files: 200 },
  })

  const broadcast = (message: SocketMessage) => {
    const encoded = JSON.stringify(message)
    for (const client of sockets.clients) if (client.readyState === WebSocket.OPEN) client.send(encoded)
  }

  const issueCommand = (command: ReaderCommand) => {
    broadcast({ type: 'command', command })
    return command
  }

  state.on('change', current => broadcast({ type: 'state', state: current }))
  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const origin = request.headers.origin
    if (origin && !isLoopbackOrigin(origin)) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request))
  })
  sockets.on('connection', async socket => {
    socket.send(JSON.stringify({ type: 'hello', state: state.get(), books: await library.listBooks() } satisfies SocketMessage))
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString())
        if (message?.type === 'state:update' && message.state) state.set(message.state)
        if (message?.type === 'pong') return
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: '无效的 WebSocket 消息' }))
      }
    })
  })

  app.disable('x-powered-by')
  const allowedHosts = new Set(LOOPBACK_HOSTS)
  allowedHosts.add(normalizeHostname(config.host))
  app.use((request, response, next) => {
    const hostname = request.headers.host ? hostHeaderHostname(request.headers.host) : null
    if (!hostname || !allowedHosts.has(hostname)) {
      response.status(403).json({ error: '请求来源不受信任' })
      return
    }
    next()
  })
  const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  app.use((request, response, next) => {
    const origin = request.headers.origin
    if (mutationMethods.has(request.method) && origin && !isLoopbackOrigin(origin)) {
      response.status(403).json({ error: '请求来源不受信任' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '40mb' }))
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.get('/api/health', (_request, response) => response.json({
    ok: true,
    service: 'bookd',
    version: '0.1.0',
    libraryDir: config.libraryDir,
    stateFile: state.file,
    pdf: { enabled: false, reason: '未配置本地 MinerU CLI' },
  }))

  app.get('/api/books', asyncRoute(async (_request, response) => {
    response.json({ books: await library.listBooks() })
  }))

  app.post('/api/books/import', upload.single('book'), asyncRoute(async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: '请选择电子书文件' })
      return
    }
    const book = await library.importBuffer(request.file.originalname, request.file.buffer)
    broadcast({ type: 'books', books: await library.listBooks() })
    issueCommand({ type: 'open', bookId: book.id })
    response.status(201).json({ book })
  }))

  app.post('/api/books/import-markdown', upload.array('books', 200), asyncRoute(async (request, response) => {
    const files = request.files as Express.Multer.File[] | undefined
    if (!files?.length) return response.status(400).json({ error: '请选择 Markdown 文件夹' })
    const title = String(request.body?.title || 'Markdown 书稿')
    const book = await library.importMarkdownDirectory(title, files.map(file => ({ name: file.originalname, buffer: file.buffer })))
    broadcast({ type: 'books', books: await library.listBooks() })
    issueCommand({ type: 'open', bookId: book.id })
    response.status(201).json({ book })
  }))

  app.get('/api/books/:id', asyncRoute(async (request, response) => {
    const book = await library.getBook(param(request.params.id))
    if (!book) return response.status(404).json({ error: '书籍不存在' })
    response.json({ book, annotations: await library.listAnnotations(book.id) })
  }))

  app.get('/api/books/:id/source', asyncRoute(async (request, response) => {
    const book = await library.getBook(param(request.params.id))
    if (!book) return response.status(404).json({ error: '书籍不存在' })
    response.setHeader('Content-Disposition', `inline; filename="${book.sourceFile}"`)
    response.sendFile(library.sourcePath(book))
  }))

  app.get('/api/books/:id/chapters/:index', asyncRoute(async (request, response) => {
    const chapter = await library.getChapter(param(request.params.id), Number(param(request.params.index)))
    if (!chapter) return response.status(404).json({ error: '章节不存在或尚未提取' })
    response.json({ chapter })
  }))

  app.get('/api/books/:id/search', asyncRoute(async (request, response) => {
    const query = String(request.query.q ?? '')
    response.json({ query, results: await library.search(param(request.params.id), query) })
  }))

  app.post('/api/books/:id/cache', asyncRoute(async (request, response) => {
    if (!Array.isArray(request.body?.chapters)) return response.status(400).json({ error: 'chapters 必须是数组' })
    const book = await library.cacheChapters(param(request.params.id), request.body.chapters, request.body.metadata)
    broadcast({ type: 'books', books: await library.listBooks() })
    response.json({ book })
  }))

  app.post('/api/books/:id/locations', asyncRoute(async (request, response) => {
    if (!Array.isArray(request.body?.locations)) return response.status(400).json({ error: 'locations 必须是数组' })
    const book = await library.cacheLocations(param(request.params.id), request.body.locations)
    response.json({ book })
  }))

  app.get('/api/books/:id/annotations', asyncRoute(async (request, response) => {
    response.json({ annotations: await library.listAnnotations(param(request.params.id)) })
  }))

  app.get('/api/state', (_request, response) => response.json({ state: state.get() }))
  app.put('/api/state', (request, response) => response.json({ state: state.set(request.body ?? {}, true) }))

  app.post('/api/open', asyncRoute(async (request, response) => {
    const bookId = String(request.body?.bookId ?? '')
    const book = await library.getBook(bookId)
    if (!book) return response.status(404).json({ error: '书籍不存在' })
    issueCommand({ type: 'open', bookId })
    response.json({ ok: true, book })
  }))

  app.post('/api/commands/goto', asyncRoute(async (request, response) => {
    const { bookId, cfi, fraction, chapter } = request.body ?? {}
    if (!cfi && !Number.isFinite(fraction) && !Number.isInteger(chapter)) {
      return response.status(400).json({ error: '需要 cfi、fraction 或 chapter' })
    }
    const command = issueCommand({ type: 'goto', bookId, cfi, fraction, chapter })
    response.json({ ok: true, command })
  }))

  app.post('/api/commands/highlight', asyncRoute(async (request, response) => {
    const current = state.get()
    const bookId = String(request.body?.bookId ?? current.book ?? '')
    const cfi = String(request.body?.cfi ?? current.selection?.cfi ?? '')
    const text = String(request.body?.text ?? current.selection?.text ?? '')
    if (!bookId || !cfi || !text) return response.status(400).json({ error: '当前没有可高亮的选区' })
    if (!await library.getBook(bookId)) return response.status(404).json({ error: '书籍不存在' })
    const annotation = await library.addAnnotation({
      bookId,
      cfi,
      text,
      note: String(request.body?.note ?? ''),
      color: String(request.body?.color ?? '#d6ad55'),
      chapter: String(request.body?.chapter ?? current.selection?.chapter ?? current.chapter ?? ''),
      source: request.body?.source === 'reader' ? 'reader' : 'mcp',
    })
    issueCommand({ type: 'highlight', annotation })
    response.status(201).json({ annotation })
  }))

  app.post('/api/commands/clear-highlights', asyncRoute(async (request, response) => {
    const bookId = String(request.body?.bookId ?? '')
    if (!bookId) return response.status(400).json({ error: '缺少 bookId' })
    const result = await library.clearAnnotations(bookId, request.body?.annotationId)
    issueCommand({ type: 'clear-highlights', bookId, annotationId: request.body?.annotationId })
    response.json({ ok: true, ...result })
  }))

  const clientIndex = path.join(config.clientDir, 'index.html')
  try {
    await fs.access(clientIndex)
    app.use(express.static(config.clientDir, { index: 'index.html' }))
    app.get('/read/:id', (_request, response) => response.sendFile(clientIndex))
  } catch {
    app.get('/', (_request, response) => response.status(503).type('text').send('bookd 前端尚未构建，请运行 npm run dev 或 npm run build。'))
  }

  app.use((error: any, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof multer.MulterError ? 400 : 500
    response.status(status).json({ error: error?.message || '服务器错误' })
  })

  const start = () => new Promise<{ host: string; port: number }>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject)
      const address = httpServer.address()
      resolve({ host: config.host, port: typeof address === 'object' && address ? address.port : config.port })
    })
  })

  const close = async () => {
    await state.flush()
    for (const client of sockets.clients) client.close()
    sockets.close()
    if (!httpServer.listening) return
    await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()))
  }

  return { app, httpServer, library, state, config, start, close }
}
