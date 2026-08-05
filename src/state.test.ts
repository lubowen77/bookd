import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadingStateStore } from './state.js'

describe('ReadingStateStore', () => {
  let root: string
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookd-state-test-')) })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

  it('规范化并原子持久化阅读状态', async () => {
    const store = new ReadingStateStore(root)
    await store.init()
    store.set({ book: '群鸟', progress: 2, visibleTextHead: '段落', selection: { text: '选区' } })
    await store.flush()
    expect(store.get()).toMatchObject({ book: '群鸟', progress: 1, selection: { text: '选区' } })
    const restored = new ReadingStateStore(root)
    await restored.init()
    expect(restored.get().book).toBe('群鸟')
    const bridge = JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8'))
    expect(bridge).toMatchObject({ visible_text_head: '段落', chapter_index: null })
    expect(bridge.visibleTextHead).toBeUndefined()
  })
})
