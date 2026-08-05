import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReaderCommand, ReadingState, SocketMessage } from '../shared'

interface SocketState {
  connected: boolean
  lastCommand: { id: number; command: ReaderCommand } | null
}

export const useBookdSocket = (
  onState: (state: ReadingState) => void,
  onBooks: () => void,
) => {
  const socket = useRef<WebSocket | null>(null)
  const retry = useRef<number | undefined>(undefined)
  const commandId = useRef(0)
  const [socketState, setSocketState] = useState<SocketState>({ connected: false, lastCommand: null })

  useEffect(() => {
    let disposed = false
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/ws`)
      socket.current = ws
      ws.addEventListener('open', () => setSocketState(current => ({ ...current, connected: true })))
      ws.addEventListener('message', event => {
        const message = JSON.parse(event.data) as SocketMessage
        if (message.type === 'hello') {
          onState(message.state)
          onBooks()
        } else if (message.type === 'state') {
          onState(message.state)
        } else if (message.type === 'books') {
          onBooks()
        } else if (message.type === 'command') {
          commandId.current = Math.max(commandId.current + 1, Date.now())
          setSocketState(current => ({ ...current, lastCommand: { id: commandId.current, command: message.command } }))
        }
      })
      ws.addEventListener('close', () => {
        if (socket.current === ws) socket.current = null
        setSocketState(current => ({ ...current, connected: false }))
        if (!disposed) retry.current = window.setTimeout(connect, 1000)
      })
      ws.addEventListener('error', () => ws.close())
    }
    connect()
    return () => {
      disposed = true
      if (retry.current) window.clearTimeout(retry.current)
      socket.current?.close()
    }
  }, [onBooks, onState])

  const sendState = useCallback((state: Partial<ReadingState>) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'state:update', state }))
    }
  }, [])

  return { ...socketState, sendState }
}
