import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EMPTY_READING_STATE, type ReadingState } from './shared.js'

const atomicWrite = async (file: string, state: ReadingState) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  const bridgeState = {
    book: state.book,
    chapter: state.chapter,
    chapter_index: state.chapterIndex,
    cfi: state.cfi,
    progress: state.progress,
    visible_text_head: state.visibleTextHead,
    selection: state.selection,
    updated_at: state.updatedAt,
  }
  await fs.writeFile(temp, `${JSON.stringify(bridgeState, null, 2)}\n`, 'utf8')
  await fs.rename(temp, file)
}

export class ReadingStateStore extends EventEmitter {
  readonly file: string
  private state: ReadingState = { ...EMPTY_READING_STATE }
  private writeTimer: NodeJS.Timeout | undefined
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(stateDir: string) {
    super()
    this.file = path.join(stateDir, 'state.json')
  }

  async init() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<ReadingState> & Record<string, unknown>
      this.state = this.normalise({
        ...parsed,
        chapterIndex: parsed.chapterIndex ?? parsed.chapter_index,
        visibleTextHead: parsed.visibleTextHead ?? parsed.visible_text_head,
        updatedAt: parsed.updatedAt ?? parsed.updated_at,
      } as Partial<ReadingState>)
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      await atomicWrite(this.file, this.state)
    }
    return this.state
  }

  get() {
    return structuredClone(this.state)
  }

  set(incoming: Partial<ReadingState>, immediate = false) {
    this.state = this.normalise({ ...this.state, ...incoming, updatedAt: new Date().toISOString() })
    this.emit('change', this.get())
    if (immediate) void this.flush()
    else this.scheduleWrite()
    return this.get()
  }

  private normalise(value: Partial<ReadingState>): ReadingState {
    const progress = Number.isFinite(value.progress) ? Number(value.progress) : 0
    return {
      book: typeof value.book === 'string' ? value.book : null,
      chapter: typeof value.chapter === 'string' ? value.chapter : null,
      chapterIndex: Number.isInteger(value.chapterIndex) ? Number(value.chapterIndex) : null,
      cfi: typeof value.cfi === 'string' ? value.cfi : null,
      progress: Math.max(0, Math.min(1, progress)),
      visibleTextHead: typeof value.visibleTextHead === 'string' ? value.visibleTextHead.slice(0, 1200) : '',
      selection: value.selection && typeof value.selection.text === 'string'
        ? {
            text: value.selection.text.slice(0, 4000),
            cfi: typeof value.selection.cfi === 'string' ? value.selection.cfi : undefined,
            chapter: typeof value.selection.chapter === 'string' ? value.selection.chapter : undefined,
          }
        : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    }
  }

  private scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.flush(), 180)
  }

  async flush() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = undefined
    const snapshot = this.get()
    this.pendingWrite = this.pendingWrite.then(() => atomicWrite(this.file, snapshot))
    await this.pendingWrite
  }
}
