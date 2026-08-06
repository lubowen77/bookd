import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryStore } from './storage.js'
import { makeTestEpub } from './test-helpers.js'

describe('LibraryStore', () => {
  let root: string
  let store: LibraryStore

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookd-storage-test-'))
    store = new LibraryStore(root)
    await store.init()
  })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

  it('导入 EPUB 并生成可搜索章节', async () => {
    const book = await store.importBuffer('test.epub', makeTestEpub())
    expect(book.title).toBe('测试群鸟')
    expect(book.author).toBe('测试作者')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[0].title).toBe('第一章 相遇')
    expect((await fs.readdir(path.join(root, book.id, 'extracted'))).some(file => file.endsWith('.md'))).toBe(true)
    const chapter = await store.getChapter(book.id, 1)
    expect(chapter?.markdown).toContain('复杂的整体秩序')
    expect(chapter?.markdown).not.toContain('script')
    await store.cacheLocations(book.id, [{ href: book.chapters[1].href, cfi: 'epubcfi(/6/4)' }])
    expect(await store.search(book.id, '局部互动')).toMatchObject([{ chapter: 1, cfi: 'epubcfi(/6/4)' }])
    expect((await store.importBuffer('duplicate.epub', makeTestEpub())).id).toBe(book.id)
  })

  it('把带目录前缀的 section 位置匹配到章节 href', async () => {
    const book = await store.importBuffer('test.epub', makeTestEpub())
    const chapter = await store.getChapter(book.id, 0)
    expect(chapter?.href).toBeTruthy()
    const updated = await store.cacheLocations(book.id, [{
      href: `OEBPS/${chapter!.href}`,
      cfi: 'epubcfi(/6/2)',
    }])
    expect(updated.chapters[0].cfi).toBe('epubcfi(/6/2)')
  })

  it('用客户端解析结果补齐 MOBI 元数据', async () => {
    const book = await store.importBuffer('sample.mobi', Buffer.from('mobi-placeholder'))
    const updated = await store.cacheChapters(book.id, [{
      title: '第一章',
      text: '正文',
      markdown: '# 第一章\n\n正文',
      href: 'filepos:100',
      cfi: 'epubcfi(/6/2)',
    }], {
      title: '真正书名【推广语】',
      author: '甲•乙',
    })
    expect(updated).toMatchObject({ title: '真正书名', author: '甲·乙' })
    expect(await fs.readFile(path.join(root, book.id, 'notes.md'), 'utf8')).toContain('# 真正书名 · 阅读笔记')
  })

  it('导入 Markdown 并按一级、二级标题拆章', async () => {
    const markdown = '# 一本测试书\n\n开场。\n\n## 第一节\n\n正文甲。\n\n## 第二节\n\n正文乙。'
    const book = await store.importBuffer('notes.md', Buffer.from(markdown))
    expect(book.title).toBe('一本测试书')
    expect(book.format).toBe('markdown')
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['一本测试书', '第一节', '第二节'])
  })

  it('拒绝纯点书籍 ID 且不会越过书库根目录写文件', async () => {
    const isolatedRoot = path.join(root, 'isolated-library')
    const isolatedStore = new LibraryStore(isolatedRoot)
    await isolatedStore.init()
    await expect(isolatedStore.importBuffer('...md', Buffer.from('没有标题的正文。')))
      .rejects.toThrow('无效的书籍 ID')
    expect(await fs.readdir(root)).toEqual(['isolated-library'])
    expect(await fs.readdir(isolatedRoot)).toEqual([])
  })

  it('保留正常中英文书名作为 ID', async () => {
    expect((await store.importBuffer('opinion.md', Buffer.from('正文。'), { title: '舆论' })).id).toBe('舆论')
    expect((await store.importBuffer('starlings.md', Buffer.from('正文。'), { title: '随椋鸟飞行-复杂系统的奇境' })).id)
      .toBe('随椋鸟飞行-复杂系统的奇境')
  })

  it('把 Markdown 文件夹按文件名顺序导入为一本书', async () => {
    const book = await store.importMarkdownDirectory('群鸟文稿', [
      { name: '02-第二章.md', buffer: Buffer.from('# 第二章\n\n后章。') },
      { name: '01-第一章.md', buffer: Buffer.from('# 第一章\n\n前章。\n\n## 章内小节\n\n仍属第一章。') },
    ])
    expect(book.title).toBe('群鸟文稿')
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['第一章', '第二章'])
    expect((await store.getChapter(book.id, 0))?.text).toContain('章内小节')
  })

  it('批注同时写入 JSON 与 Markdown', async () => {
    const book = await store.importBuffer('notes.md', Buffer.from('# 测试\n\n正文。'))
    const annotation = await store.addAnnotation({
      bookId: book.id,
      cfi: 'bookd-md:0:0:2',
      text: '正文',
      note: '关键句',
      color: '#d6ad55',
      chapter: '测试',
      source: 'reader',
    })
    expect(await store.listAnnotations(book.id)).toContainEqual(annotation)
    const notes = await fs.readFile(path.join(root, book.id, 'notes.md'), 'utf8')
    expect(notes).toContain('> 正文')
    expect(notes).toContain('关键句')
    expect((await store.clearAnnotations(book.id, annotation.id)).removed).toBe(1)
    expect(await fs.readFile(path.join(root, book.id, 'notes.md'), 'utf8')).not.toContain('关键句')
  })

  it('拒绝清除不存在书籍的批注且不创建目录', async () => {
    await expect(store.clearAnnotations('attacker-created-dir')).rejects.toThrow('书籍不存在')
    await expect(fs.access(path.join(root, 'attacker-created-dir'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
