import type { Annotation, BookMeta, ReadingState, StoredChapter } from '../shared'

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`)
  return body as T
}

export const api = {
  books: () => request<{ books: BookMeta[] }>('/api/books'),
  book: (id: string) => request<{ book: BookMeta; annotations: Annotation[] }>(`/api/books/${encodeURIComponent(id)}`),
  chapter: (id: string, index: number) => request<{ chapter: StoredChapter }>(`/api/books/${encodeURIComponent(id)}/chapters/${index}`),
  search: (id: string, query: string) => request<{ results: Array<{ chapter: number; title: string; excerpt: string; cfi?: string; href?: string }> }>(`/api/books/${encodeURIComponent(id)}/search?q=${encodeURIComponent(query)}`),
  state: () => request<{ state: ReadingState }>('/api/state'),
  updateState: (state: Partial<ReadingState>) => request<{ state: ReadingState }>('/api/state', { method: 'PUT', body: JSON.stringify(state) }),
  open: (bookId: string) => request('/api/open', { method: 'POST', body: JSON.stringify({ bookId }) }),
  importBook: async (file: File) => {
    const form = new FormData()
    form.set('book', file)
    return request<{ book: BookMeta }>('/api/books/import', { method: 'POST', body: form })
  },
  importMarkdownDirectory: async (title: string, files: File[]) => {
    const form = new FormData()
    form.set('title', title)
    files.forEach(file => form.append('books', file, file.webkitRelativePath || file.name))
    return request<{ book: BookMeta }>('/api/books/import-markdown', { method: 'POST', body: form })
  },
  cacheChapters: (
    bookId: string,
    chapters: Array<Pick<StoredChapter, 'title' | 'text' | 'markdown' | 'href' | 'cfi'>>,
    metadata?: { title?: string; author?: string },
  ) => request<{ book: BookMeta }>(`/api/books/${encodeURIComponent(bookId)}/cache`, {
    method: 'POST',
    body: JSON.stringify({ chapters, metadata }),
  }),
  cacheLocations: (bookId: string, locations: Array<{ href?: string; cfi: string }>) =>
    request<{ book: BookMeta }>(`/api/books/${encodeURIComponent(bookId)}/locations`, { method: 'POST', body: JSON.stringify({ locations }) }),
  annotations: (bookId: string) => request<{ annotations: Annotation[] }>(`/api/books/${encodeURIComponent(bookId)}/annotations`),
  highlight: (payload: { bookId: string; cfi: string; text: string; note?: string; chapter?: string; source?: 'reader' | 'mcp' }) =>
    request<{ annotation: Annotation }>('/api/commands/highlight', { method: 'POST', body: JSON.stringify(payload) }),
  clearHighlights: (payload: { bookId: string; annotationId?: string }) =>
    request('/api/commands/clear-highlights', { method: 'POST', body: JSON.stringify(payload) }),
}
