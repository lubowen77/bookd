import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BookFormat, BookMeta, StoredChapter, Annotation } from './shared.js'
import { extractEpub } from './epub.js'
import { splitMarkdown } from './markdown.js'

const safeName = (value: string) => value
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}._-]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'untitled'

const cleanBookTitle = (value: string) => value
  .replace(/【[^】]*】/g, '')
  .replace(/\[[^\]]*\]/g, '')
  .replace(/\s*[:：]\s*/g, '：')
  .replace(/\s{2,}/g, ' ')
  .trim()

const atomicJson = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temp, file)
}

const writeExtracted = async (dir: string, chapters: StoredChapter[]) => {
  const extractedDir = path.join(dir, 'extracted')
  await fs.mkdir(extractedDir, { recursive: true })
  await Promise.all((await fs.readdir(extractedDir)).filter(file => file.endsWith('.md')).map(file =>
    fs.unlink(path.join(extractedDir, file))))
  await Promise.all(chapters.map(chapter => {
    const fileName = `${String(chapter.index + 1).padStart(3, '0')}-${safeName(chapter.title)}.md`
    return fs.writeFile(path.join(extractedDir, fileName), `${chapter.markdown.trim()}\n`, 'utf8')
  }))
}

const annotationMarkdown = (annotation: Annotation) => [
  `## ${annotation.chapter || '未命名章节'}`,
  '',
  `> ${annotation.text.replace(/\n/g, '\n> ')}`,
  '',
  annotation.note || '_仅高亮，未添加笔记。_',
  '',
  `- CFI: \`${annotation.cfi}\``,
  `- 时间: ${annotation.createdAt}`,
  '',
].join('\n')

const formatFromName = (fileName: string): BookFormat => {
  const ext = path.extname(fileName).toLowerCase().slice(1)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'epub' || ext === 'mobi' || ext === 'azw3' || ext === 'pdf') return ext
  throw new Error(`不支持的文件格式：.${ext || '(无扩展名)'}`)
}

export class LibraryStore {
  constructor(readonly root: string) {}

  async init() {
    await fs.mkdir(this.root, { recursive: true })
  }

  private bookDir(bookId: string) {
    if (!/^[\p{L}\p{N}._-]+$/u.test(bookId)) throw new Error('无效的书籍 ID')
    return path.join(this.root, bookId)
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T
    } catch (error: any) {
      if (error?.code === 'ENOENT') return fallback
      throw error
    }
  }

  async importBuffer(fileName: string, buffer: Buffer, options: { title?: string } = {}): Promise<BookMeta> {
    const format = formatFromName(fileName)
    if (format === 'pdf') throw new Error('当前未检测到本地 MinerU CLI，PDF 导入尚未启用')
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    const baseTitle = path.basename(fileName, path.extname(fileName))
    let title = options.title || baseTitle
    let author: string | undefined
    let chapters: StoredChapter[] = []

    if (format === 'epub') {
      const extracted = extractEpub(buffer)
      title = cleanBookTitle(extracted.title || title)
      author = extracted.author?.replace(/[•·]+/g, '·')
      chapters = extracted.chapters
    } else if (format === 'markdown') {
      const markdown = buffer.toString('utf8')
      chapters = splitMarkdown(markdown)
      const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]
      if (firstHeading && !options.title) title = firstHeading.trim()
    }

    const baseId = safeName(title)
    let id = baseId
    let dir = this.bookDir(id)
    const existing = await this.readJson<BookMeta | null>(path.join(dir, 'meta.json'), null)
    if (existing && existing.sourceHash !== hash) {
      id = `${baseId}-${hash.slice(0, 8)}`
      dir = this.bookDir(id)
    } else if (existing?.sourceHash === hash) {
      return existing
    }

    await fs.mkdir(dir, { recursive: true })
    const extension = format === 'markdown' ? 'md' : format
    const sourceFile = `source.${extension}`
    await fs.writeFile(path.join(dir, sourceFile), buffer)
    if (chapters.length) {
      await atomicJson(path.join(dir, 'chapters.json'), chapters)
      await writeExtracted(dir, chapters)
    }
    const now = new Date().toISOString()
    const meta: BookMeta = {
      id,
      title,
      author,
      format,
      sourceFile,
      sourceHash: hash,
      createdAt: now,
      updatedAt: now,
      chapters: chapters.map(({ markdown: _markdown, text: _text, ...chapter }) => chapter),
    }
    await atomicJson(path.join(dir, 'meta.json'), meta)
    await atomicJson(path.join(dir, 'annotations.json'), [])
    await fs.writeFile(path.join(dir, 'notes.md'), `# ${title} · 阅读笔记\n\n`, { flag: 'wx' }).catch((error: any) => {
      if (error?.code !== 'EEXIST') throw error
    })
    return meta
  }

  async importMarkdownDirectory(directoryName: string, files: Array<{ name: string; buffer: Buffer }>) {
    const markdownFiles = files
      .filter(file => /\.md(?:own)?$/i.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    if (!markdownFiles.length) throw new Error('文件夹中没有 Markdown 文件')
    const sources = markdownFiles.map(file => ({ ...file, markdown: file.buffer.toString('utf8').trim() })).filter(file => file.markdown)
    const combined = sources.map(file => file.markdown).join('\n\n')
    const book = await this.importBuffer(`${safeName(directoryName)}.md`, Buffer.from(combined), { title: directoryName })
    const chapters = sources.map((file, index) => {
      const parts = splitMarkdown(file.markdown)
      const text = parts.map(part => part.text).join('\n\n').trim()
      const title = parts[0]?.title
        || path.basename(file.name, path.extname(file.name)).replace(/^\d+[\s._-]*/, '').trim()
        || `第 ${index + 1} 节`
      return { index, title, characters: text.length, markdown: file.markdown, text }
    })
    return this.cacheChapters(book.id, chapters)
  }

  async listBooks(): Promise<BookMeta[]> {
    await this.init()
    const entries = await fs.readdir(this.root, { withFileTypes: true })
    const books = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
      return this.readJson<BookMeta | null>(path.join(this.root, entry.name, 'meta.json'), null)
    }))
    return books.filter((book): book is BookMeta => Boolean(book))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getBook(bookId: string): Promise<BookMeta | null> {
    return this.readJson<BookMeta | null>(path.join(this.bookDir(bookId), 'meta.json'), null)
  }

  sourcePath(book: BookMeta) {
    return path.join(this.bookDir(book.id), book.sourceFile)
  }

  async getChapters(bookId: string): Promise<StoredChapter[]> {
    return this.readJson<StoredChapter[]>(path.join(this.bookDir(bookId), 'chapters.json'), [])
  }

  async cacheChapters(
    bookId: string,
    incoming: Array<Pick<StoredChapter, 'title' | 'markdown' | 'text' | 'href' | 'cfi'>>,
    metadata: { title?: string; author?: string } = {},
  ) {
    const meta = await this.getBook(bookId)
    if (!meta) throw new Error('书籍不存在')
    const chapters: StoredChapter[] = incoming.map((chapter, index) => ({
      index,
      title: chapter.title || `第 ${index + 1} 节`,
      href: chapter.href,
      cfi: chapter.cfi,
      markdown: chapter.markdown || chapter.text,
      text: chapter.text,
      characters: chapter.text.length,
    }))
    await atomicJson(path.join(this.bookDir(bookId), 'chapters.json'), chapters)
    await writeExtracted(this.bookDir(bookId), chapters)
    const updated: BookMeta = {
      ...meta,
      title: metadata.title ? cleanBookTitle(String(metadata.title).slice(0, 500)) : meta.title,
      author: metadata.author ? String(metadata.author).replace(/[•·]+/g, '·').trim().slice(0, 300) : meta.author,
      chapters: chapters.map(({ markdown: _markdown, text: _text, ...chapter }) => chapter),
      updatedAt: new Date().toISOString(),
    }
    await atomicJson(path.join(this.bookDir(bookId), 'meta.json'), updated)
    if (updated.title !== meta.title) {
      const notesFile = path.join(this.bookDir(bookId), 'notes.md')
      const notes = await fs.readFile(notesFile, 'utf8')
      await fs.writeFile(notesFile, notes.replace(/^# .*$/m, `# ${updated.title} · 阅读笔记`), 'utf8')
    }
    return updated
  }

  async getChapter(bookId: string, index: number) {
    return (await this.getChapters(bookId))[index] ?? null
  }

  async cacheLocations(bookId: string, locations: Array<{ href?: string; cfi: string }>) {
    const meta = await this.getBook(bookId)
    if (!meta) throw new Error('书籍不存在')
    const normalizeHref = (href: string) => decodeURI(href).split('#')[0].replace(/^\.\//, '').replace(/^\//, '')
    const candidates = locations.filter((item): item is { href: string; cfi: string } => Boolean(item.href && item.cfi))
    const locationFor = (href: string) => {
      const normalized = normalizeHref(href)
      return candidates.find(item => {
        const candidate = normalizeHref(item.href)
        return candidate === normalized || candidate.endsWith(`/${normalized}`) || normalized.endsWith(`/${candidate}`)
      })?.cfi
    }
    const chapters = (await this.getChapters(bookId)).map(chapter => ({
      ...chapter,
      cfi: chapter.href ? locationFor(chapter.href) ?? chapter.cfi : chapter.cfi,
    }))
    const updated: BookMeta = {
      ...meta,
      chapters: chapters.map(({ markdown: _markdown, text: _text, ...chapter }) => chapter),
      updatedAt: new Date().toISOString(),
    }
    await atomicJson(path.join(this.bookDir(bookId), 'chapters.json'), chapters)
    await atomicJson(path.join(this.bookDir(bookId), 'meta.json'), updated)
    return updated
  }

  async search(bookId: string, query: string, limit = 20) {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    const results: Array<{ chapter: number; title: string; excerpt: string; cfi?: string; href?: string }> = []
    for (const chapter of await this.getChapters(bookId)) {
      const haystack = chapter.text.toLocaleLowerCase()
      let offset = 0
      while (results.length < limit) {
        const index = haystack.indexOf(needle, offset)
        if (index < 0) break
        const start = Math.max(0, index - 50)
        const end = Math.min(chapter.text.length, index + query.length + 80)
        results.push({ chapter: chapter.index, title: chapter.title, excerpt: chapter.text.slice(start, end), cfi: chapter.cfi, href: chapter.href })
        offset = index + needle.length
      }
      if (results.length >= limit) break
    }
    return results
  }

  async listAnnotations(bookId: string) {
    return this.readJson<Annotation[]>(path.join(this.bookDir(bookId), 'annotations.json'), [])
  }

  async addAnnotation(input: Omit<Annotation, 'id' | 'createdAt'>): Promise<Annotation> {
    const annotations = await this.listAnnotations(input.bookId)
    const annotation: Annotation = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    annotations.push(annotation)
    await atomicJson(path.join(this.bookDir(input.bookId), 'annotations.json'), annotations)
    await fs.appendFile(path.join(this.bookDir(input.bookId), 'notes.md'), `${annotationMarkdown(annotation)}\n`, 'utf8')
    return annotation
  }

  async clearAnnotations(bookId: string, annotationId?: string) {
    const annotations = await this.listAnnotations(bookId)
    const remaining = annotationId ? annotations.filter(item => item.id !== annotationId) : []
    await atomicJson(path.join(this.bookDir(bookId), 'annotations.json'), remaining)
    const book = await this.getBook(bookId)
    const notes = [`# ${book?.title ?? bookId} · 阅读笔记`, '', ...remaining.map(annotationMarkdown)].join('\n')
    await fs.writeFile(path.join(this.bookDir(bookId), 'notes.md'), `${notes.trim()}\n`, 'utf8')
    return { removed: annotations.length - remaining.length, remaining }
  }
}
