import { describe, expect, it } from 'vitest'
import type { Annotation } from '../shared'
import { upsertAnnotation } from './annotations.js'

const makeAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'annotation-1',
  bookId: 'book-1',
  cfi: 'epubcfi(/6/2)',
  text: '原始划线',
  note: '',
  color: '#d6ad55',
  source: 'reader',
  createdAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
})

describe('upsertAnnotation', () => {
  it('appends a new annotation', () => {
    const item = makeAnnotation()
    expect(upsertAnnotation([], item)).toEqual([item])
  })

  it('does not add another item for an existing id', () => {
    const item = makeAnnotation()
    expect(upsertAnnotation([item], item)).toHaveLength(1)
  })

  it('replaces the content for an existing id', () => {
    const original = makeAnnotation()
    const updated = makeAnnotation({ text: '更新后的划线', note: '新笔记' })
    expect(upsertAnnotation([original], updated)).toEqual([updated])
  })
})
