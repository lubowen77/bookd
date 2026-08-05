export const SUPPORTED_EXTENSIONS = ['epub', 'mobi', 'azw3', 'md', 'markdown'] as const

export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'markdown' | 'pdf'

export interface ChapterSummary {
  index: number
  title: string
  href?: string
  cfi?: string
  characters: number
}

export interface BookMeta {
  id: string
  title: string
  author?: string
  format: BookFormat
  sourceFile: string
  sourceHash: string
  createdAt: string
  updatedAt: string
  chapters: ChapterSummary[]
}

export interface StoredChapter extends ChapterSummary {
  markdown: string
  text: string
}

export interface ReadingSelection {
  text: string
  cfi?: string
  chapter?: string
}

export interface ReadingState {
  book: string | null
  chapter: string | null
  chapterIndex: number | null
  cfi: string | null
  progress: number
  visibleTextHead: string
  selection: ReadingSelection | null
  updatedAt: string
}

export interface Annotation {
  id: string
  bookId: string
  cfi: string
  text: string
  note: string
  color: string
  chapter?: string
  source: 'reader' | 'mcp'
  createdAt: string
}

export type ReaderCommand =
  | { type: 'open'; bookId: string }
  | { type: 'goto'; bookId?: string; cfi?: string; fraction?: number; chapter?: number }
  | { type: 'page'; direction: 'previous' | 'next' }
  | { type: 'highlight'; annotation: Annotation }
  | { type: 'clear-highlights'; bookId?: string; annotationId?: string }

export type SocketMessage =
  | { type: 'hello'; state: ReadingState; books: BookMeta[] }
  | { type: 'state'; state: ReadingState }
  | { type: 'books'; books: BookMeta[] }
  | { type: 'command'; command: ReaderCommand }
  | { type: 'ping' }

export const EMPTY_READING_STATE: ReadingState = {
  book: null,
  chapter: null,
  chapterIndex: null,
  cfi: null,
  progress: 0,
  visibleTextHead: '',
  selection: null,
  updatedAt: new Date(0).toISOString(),
}
