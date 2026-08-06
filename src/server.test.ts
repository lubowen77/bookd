import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBookdServer, type BookdServer } from './server.js'
import { makeTestEpub } from './test-helpers.js'

const nextMessage = (socket: WebSocket) => new Promise<any>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('WebSocket 消息超时')), 3000)
  socket.once('message', raw => {
    clearTimeout(timeout)
    resolve(JSON.parse(raw.toString()))
  })
})

const openSocket = (socket: WebSocket) => new Promise<void>((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})

describe('bookd HTTP + WebSocket', () => {
  let root: string
  let server: BookdServer
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookd-server-test-'))
    server = await createBookdServer({
      host: '127.0.0.1', port: 0,
      libraryDir: path.join(root, 'library'), stateDir: path.join(root, 'state'), clientDir: path.join(root, 'client'),
    })
  })
  afterEach(async () => {
    await server.close()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('拒绝非白名单 Host，同时允许 vite dev 保留的回环 Host 与端口', async () => {
    await request(server.app).get('/api/health').set('Host', 'bookd.evil.example').expect(403)
    await request(server.app).get('/api/health').set('Host', '127.0.0.1:5173').expect(200)
    await request(server.app).get('/api/health').set('Host', 'localhost:5173').expect(200)
    await request(server.app).get('/api/health').set('Host', '[::1]:5173').expect(200)
  })

  it('导入书籍并在 2 秒内提供状态与章节 API', async () => {
    const started = performance.now()
    const imported = await request(server.app).post('/api/books/import').attach('book', makeTestEpub(), 'test.epub').expect(201)
    const id = imported.body.book.id
    await request(server.app).get(`/api/books/${encodeURIComponent(id)}/chapters/0`).expect(200)
    await request(server.app).put('/api/state').send({ book: id, chapter: '第一章 相遇', cfi: 'epubcfi(/6/2)', progress: .25, visibleTextHead: '一群椋鸟' }).expect(200)
    const state = await request(server.app).get('/api/state').expect(200)
    expect(state.body.state).toMatchObject({ book: id, chapter: '第一章 相遇', visibleTextHead: '一群椋鸟' })
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('拒绝跨源 WebSocket，同时允许无 Origin 与 vite dev Origin', async () => {
    const address = await server.start()
    const url = `ws://${address.host}:${address.port}/ws`
    const attacker = new WebSocket(url, { origin: 'https://evil.example.com' })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('跨源 WebSocket 未被及时拒绝')), 3000)
      attacker.once('open', () => reject(new Error('跨源 WebSocket 不应连接成功')))
      attacker.once('message', () => reject(new Error('跨源 WebSocket 不应收到 hello')))
      attacker.once('error', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    const noOrigin = new WebSocket(url)
    const noOriginHello = nextMessage(noOrigin)
    await openSocket(noOrigin)
    expect((await noOriginHello).type).toBe('hello')
    noOrigin.close()

    const viteDev = new WebSocket(url, { origin: 'http://127.0.0.1:5173' })
    const viteHello = nextMessage(viteDev)
    await openSocket(viteDev)
    expect((await viteHello).type).toBe('hello')
    viteDev.close()
  })

  it('拒绝跨源变更请求与 multipart 导入', async () => {
    await request(server.app)
      .post('/api/commands/clear-highlights')
      .set('Origin', 'https://evil.example.com')
      .send({ bookId: '任意书籍' })
      .expect(403)
    await request(server.app)
      .post('/api/books/import')
      .set('Origin', 'https://evil.example.com')
      .attach('book', makeTestEpub(), 'attack.epub')
      .expect(403)
    expect(await server.library.listBooks()).toHaveLength(0)
  })

  it('clear-highlights 缺少 bookId 时返回 400 且保留批注', async () => {
    const book = await server.library.importBuffer('notes.md', Buffer.from('# 测试\n\n正文。'))
    await server.library.addAnnotation({
      bookId: book.id, cfi: 'bookd-md:0:0:2', text: '正文', note: '不可删除',
      color: '#d6ad55', chapter: '测试', source: 'reader',
    })
    server.state.set({ book: book.id }, true)
    await request(server.app)
      .post('/api/commands/clear-highlights')
      .set('Content-Type', 'text/plain')
      .send('')
      .expect(400)
    expect(await server.library.listAnnotations(book.id)).toHaveLength(1)
    expect(await fs.readFile(path.join(root, 'library', book.id, 'notes.md'), 'utf8')).toContain('不可删除')
  })

  it('允许无 Origin 的 POST 与 vite dev Origin', async () => {
    await request(server.app).post('/api/commands/goto').send({ chapter: 0 }).expect(200)
    await request(server.app)
      .post('/api/commands/goto')
      .set('Origin', 'http://127.0.0.1:5173')
      .send({ chapter: 1 })
      .expect(200)
  })

  it('双向传递状态与 goto 命令', async () => {
    const address = await server.start()
    const socket = new WebSocket(`ws://${address.host}:${address.port}/ws`)
    const helloPromise = nextMessage(socket)
    await openSocket(socket)
    expect((await helloPromise).type).toBe('hello')

    const statePromise = nextMessage(socket)
    socket.send(JSON.stringify({ type: 'state:update', state: { book: 'test', progress: .4, visibleTextHead: '当前可见文字' } }))
    expect(await statePromise).toMatchObject({ type: 'state', state: { book: 'test', progress: .4 } })

    const commandPromise = nextMessage(socket)
    await request(server.app).post('/api/commands/goto').send({ chapter: 2 }).expect(200)
    expect(await commandPromise).toMatchObject({ type: 'command', command: { type: 'goto', chapter: 2 } })
    socket.close()
  })
})
