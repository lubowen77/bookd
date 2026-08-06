import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBookdMcpServer } from './mcp-server.js'
import { createBookdServer, type BookdServer } from './server.js'
import { makeTestEpub } from './test-helpers.js'

describe('bookd MCP', () => {
  let root: string
  let service: BookdServer
  let client: Client
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookd-mcp-test-'))
    service = await createBookdServer({ host: '127.0.0.1', port: 0, libraryDir: path.join(root, 'library'), stateDir: path.join(root, 'state'), clientDir: path.join(root, 'client') })
    const address = await service.start()
    await service.library.importBuffer('test.epub', makeTestEpub())
    service.state.set({ book: '测试群鸟', chapter: '第一章 相遇', cfi: 'epubcfi(/6/2)', visibleTextHead: '一群椋鸟在黄昏相遇。', progress: .2 }, true)
    const mcp = createBookdMcpServer(`http://${address.host}:${address.port}`)
    client = new Client({ name: 'bookd-test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverTransport)
    await client.connect(clientTransport)
  })
  afterEach(async () => {
    await client.close()
    await service.close()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('暴露并执行方案规定的 8 个工具', async () => {
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name).sort()).toEqual([
      'clear_highlights', 'get_chapter', 'get_reading_state', 'goto',
      'highlight', 'list_books', 'open_book', 'search_book',
    ])
    const state = await client.callTool({ name: 'get_reading_state', arguments: {} })
    expect(JSON.stringify(state.content)).toContain('一群椋鸟在黄昏相遇')
    const books = await client.callTool({ name: 'list_books', arguments: {} })
    expect(JSON.stringify(books.content)).toContain('测试群鸟')
    const goto = await client.callTool({ name: 'goto', arguments: { chapter: 1 } })
    expect(goto.isError).not.toBe(true)
  })

  it('clear_highlights 省略 book_id 时仍清除当前书', async () => {
    await service.library.addAnnotation({
      bookId: '测试群鸟', cfi: 'epubcfi(/6/2)', text: '一群椋鸟', note: '待清除',
      color: '#d6ad55', chapter: '第一章 相遇', source: 'mcp',
    })
    const result = await client.callTool({ name: 'clear_highlights', arguments: {} })
    expect(result.isError).not.toBe(true)
    expect(await service.library.listAnnotations('测试群鸟')).toHaveLength(0)
  })

  it('可由真实 stdio 子进程连接', async () => {
    const address = service.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('服务未监听')
    const stdioClient = new Client({ name: 'bookd-stdio-test', version: '1.0.0' })
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const transport = new StdioClientTransport({
      command: path.resolve('node_modules/.bin/tsx'),
      args: ['src/mcp.ts'],
      env: { ...env, BOOKD_URL: `http://127.0.0.1:${address.port}` },
    })
    await stdioClient.connect(transport)
    expect((await stdioClient.listTools()).tools).toHaveLength(8)
    const result = await stdioClient.callTool({ name: 'get_reading_state', arguments: {} })
    expect(JSON.stringify(result.content)).toContain('第一章 相遇')
    await stdioClient.close()
  })
})
