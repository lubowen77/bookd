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

  it('双向传递状态与 goto 命令', async () => {
    const address = await server.start()
    const socket = new WebSocket(`ws://${address.host}:${address.port}/ws`)
    const helloPromise = nextMessage(socket)
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
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
