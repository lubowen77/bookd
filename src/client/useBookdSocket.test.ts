// @vitest-environment jsdom

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createElement, useEffect } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import { createBookdServer, type BookdServer } from '../server'
import type { ReadingState } from '../shared'
import { useBookdSocket } from './useBookdSocket'

type Listener = (event: Event) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close')
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open')
  }

  receive(message: unknown) {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  private emit(type: string, event: Event = new Event(type)) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

interface HarnessProps {
  onReady: (sendState: (state: Partial<ReadingState>) => void) => void
  onState: (state: ReadingState) => void
  onBooks: () => void
}

const Harness = ({ onReady, onState, onBooks }: HarnessProps) => {
  const { sendState } = useBookdSocket(onState, onBooks)
  useEffect(() => onReady(sendState), [onReady, sendState])
  return null
}

const waitFor = async (predicate: () => boolean, timeout = 5000) => {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待条件超时')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('useBookdSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('等收到 hello 后才补发断线期间合并的最新状态', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onState = vi.fn()
    const onBooks = vi.fn()
    let sendState: ((state: Partial<ReadingState>) => void) | undefined

    await act(async () => {
      root.render(createElement(Harness, {
        onReady: callback => { sendState = callback },
        onState,
        onBooks,
      }))
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()
    sendState?.({ book: 'test', progress: 0.4 })
    sendState?.({ progress: 0.8, cfi: 'epubcfi(/6/4)' })

    await act(async () => socket.open())
    expect(socket.sent).toEqual([])

    const oldState = { book: 'test', progress: 0.2 }
    await act(async () => socket.receive({ type: 'hello', state: oldState, books: [] }))

    expect(onState).toHaveBeenCalledWith(oldState)
    expect(onBooks).toHaveBeenCalledOnce()
    expect(socket.sent.map(message => JSON.parse(message))).toEqual([{
      type: 'state:update',
      state: { book: 'test', progress: 0.8, cfi: 'epubcfi(/6/4)' },
    }])

    await act(async () => socket.receive({ type: 'hello', state: oldState, books: [] }))
    expect(socket.sent).toHaveLength(1)

    await act(async () => root.unmount())
  })

  it('服务重启后把断线期间的最新状态补发给真实 WebSocket 服务', async () => {
    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bookd-socket-hook-test-'))
    const config = {
      host: '127.0.0.1',
      port: 0,
      libraryDir: path.join(testRoot, 'library'),
      stateDir: path.join(testRoot, 'state'),
      clientDir: path.join(testRoot, 'client'),
    }
    let socketTarget = ''
    class RoutedWebSocket extends NodeWebSocket {
      constructor(_url: string | URL) {
        super(socketTarget)
      }
    }

    vi.stubGlobal('WebSocket', RoutedWebSocket)
    let firstServer: BookdServer | null = await createBookdServer(config)
    let secondServer: BookdServer | null = null
    const firstAddress = await firstServer.start()
    socketTarget = `ws://${firstAddress.host}:${firstAddress.port}/ws`

    const container = document.createElement('div')
    const root = createRoot(container)
    const onState = vi.fn()
    const onBooks = vi.fn()
    let sendState: ((state: Partial<ReadingState>) => void) | undefined

    try {
      await act(async () => {
        root.render(createElement(Harness, {
          onReady: callback => { sendState = callback },
          onState,
          onBooks,
        }))
      })
      await act(async () => waitFor(() => onBooks.mock.calls.length === 1))

      await act(async () => {
        await firstServer?.close()
        firstServer = null
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      sendState?.({ book: 'offline-book', progress: 0.73, cfi: 'epubcfi(/6/8)' })

      secondServer = await createBookdServer(config)
      const secondAddress = await secondServer.start()
      socketTarget = `ws://${secondAddress.host}:${secondAddress.port}/ws`

      await act(async () => {
        await waitFor(() => secondServer?.state.get().progress === 0.73
          && onState.mock.calls.some(([state]) => state.progress === 0.73))
      })
      expect(secondServer.state.get()).toMatchObject({
        book: 'offline-book',
        progress: 0.73,
        cfi: 'epubcfi(/6/8)',
      })
    } finally {
      await act(async () => root.unmount())
      if (firstServer) await firstServer.close()
      if (secondServer) await secondServer.close()
      await fs.rm(testRoot, { recursive: true, force: true })
    }
  })
})
