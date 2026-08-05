#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createBookdMcpServer } from './mcp-server.js'

const server = createBookdMcpServer()
await server.connect(new StdioServerTransport())
