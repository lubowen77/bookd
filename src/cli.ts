#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getConfig } from './config.js'
import { createBookdServer } from './server.js'
import { LibraryStore } from './storage.js'

const args = process.argv.slice(2)
const command = args[0] ?? 'serve'

const valueAfter = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const usage = () => {
  console.log(`bookd — 本地 AI 伴读阅读器

用法：
  bookd serve [--host 127.0.0.1] [--port 4123]
  bookd start [--port 4123]        后台启动（已运行则复用）
  bookd import <电子书路径>
  bookd mcp
  bookd help

环境变量：
  BOOKD_LIBRARY_DIR  书库目录（默认 ~/Books/bookd）
  BOOKD_STATE_DIR    阅读状态目录（默认 .reading）`)
}

if (command === 'mcp') {
  await import('./mcp.js')
} else if (command === 'start') {
  const port = valueAfter('--port') ? Number(valueAfter('--port')) : Number(process.env.BOOKD_PORT ?? 4123)
  const url = `http://127.0.0.1:${port}/api/health`
  const isHealthy = async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) })
      const body = await response.json()
      return response.ok && body.service === 'bookd'
    } catch { return false }
  }
  if (await isHealthy()) {
    console.log(`bookd 已在运行：http://127.0.0.1:${port}`)
  } else {
    const entry = fileURLToPath(import.meta.url)
    const child = spawn(process.execPath, [entry, 'serve', '--port', String(port)], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
      env: process.env,
    })
    child.unref()
    let ready = false
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      ready = await isHealthy()
    }
    if (!ready) throw new Error('bookd 后台启动失败；请用 bookd serve 查看错误日志')
    console.log(`bookd 已在后台启动：http://127.0.0.1:${port}`)
  }
} else if (command === 'serve') {
  const server = await createBookdServer({
    host: valueAfter('--host'),
    port: valueAfter('--port') ? Number(valueAfter('--port')) : undefined,
  })
  const address = await server.start()
  console.log(`bookd 已启动：http://${address.host}:${address.port}`)
  console.log(`书库：${server.config.libraryDir}`)
  console.log(`状态：${server.state.file}`)
  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
} else if (command === 'import') {
  const file = args[1]
  if (!file) {
    usage()
    process.exitCode = 1
  } else {
    const absolute = path.resolve(file)
    const store = new LibraryStore(getConfig().libraryDir)
    await store.init()
    const stat = await fs.stat(absolute)
    const book = stat.isDirectory()
      ? await store.importMarkdownDirectory(path.basename(absolute), await Promise.all(
          (await fs.readdir(absolute)).filter(name => /\.md(?:own)?$/i.test(name)).map(async name => ({
            name,
            buffer: await fs.readFile(path.join(absolute, name)),
          })),
        ))
      : await store.importBuffer(path.basename(absolute), await fs.readFile(absolute))
    console.log(`已导入《${book.title}》→ ${book.id}`)
  }
} else if (command === 'help' || command === '--help' || command === '-h') {
  usage()
} else {
  console.error(`未知命令：${command}`)
  usage()
  process.exitCode = 1
}
