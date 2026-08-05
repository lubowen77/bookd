import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Annotation, BookMeta, ReaderCommand, ReadingSelection, StoredChapter } from '../shared'
import { api } from './api'

interface Props {
  book: BookMeta
  chapterIndex: number
  annotations: Annotation[]
  command: { id: number; command: ReaderCommand } | null
  onChapterChange: (index: number) => void
  onProgress: (state: { chapter: string; chapterIndex: number; cfi: string; progress: number; visibleTextHead: string }) => void
  onSelection: (selection: ReadingSelection | null) => void
  onError: (message: string) => void
}

const textOffset = (root: Node, target: Node, offset: number) => {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(target, offset)
  return range.toString().length
}

const locateText = (root: HTMLElement, needle: string) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let haystack = ''
  let node: Node | null
  while ((node = walker.nextNode())) {
    nodes.push(node as Text)
    haystack += node.nodeValue ?? ''
  }
  const index = haystack.indexOf(needle)
  if (index < 0) return null
  const end = index + needle.length
  let cursor = 0
  let startNode: Text | undefined
  let endNode: Text | undefined
  let startOffset = 0
  let endOffset = 0
  for (const textNode of nodes) {
    const next = cursor + textNode.length
    if (!startNode && index >= cursor && index <= next) {
      startNode = textNode
      startOffset = index - cursor
    }
    if (end >= cursor && end <= next) {
      endNode = textNode
      endOffset = end - cursor
      break
    }
    cursor = next
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

const locateOffsets = (root: HTMLElement, start: number, end: number) => {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cursor = 0
  let startNode: Text | null = null
  let endNode: Text | null = null
  let startOffset = 0
  let endOffset = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const textNode = node as Text
    const next = cursor + textNode.length
    if (!startNode && start >= cursor && start <= next) {
      startNode = textNode
      startOffset = start - cursor
    }
    if (end >= cursor && end <= next) {
      endNode = textNode
      endOffset = end - cursor
      break
    }
    cursor = next
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

export function MarkdownReader({ book, chapterIndex, annotations, command, onChapterChange, onProgress, onSelection, onError }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  const [chapter, setChapter] = useState<StoredChapter | null>(null)

  useEffect(() => {
    let disposed = false
    setChapter(null)
    api.chapter(book.id, chapterIndex)
      .then(result => {
        if (!disposed) {
          setChapter(result.chapter)
          requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0 }))
        }
      })
      .catch(error => !disposed && onError(error.message))
    return () => { disposed = true }
  }, [book.id, chapterIndex])

  useEffect(() => {
    const element = article.current
    const HighlightConstructor = (window as any).Highlight
    const highlights = (CSS as any).highlights
    if (!element || !HighlightConstructor || !highlights) return
    const ranges = annotations
      .filter(annotation => annotation.cfi.startsWith(`bookd-md:${chapterIndex}:`))
      .map(annotation => {
        const [, , start, end] = annotation.cfi.split(':')
        return locateOffsets(element, Number(start), Number(end)) ?? locateText(element, annotation.text)
      })
      .filter((range): range is Range => Boolean(range))
    highlights.delete('bookd-annotation')
    if (ranges.length) highlights.set('bookd-annotation', new HighlightConstructor(...ranges))
    return () => highlights.delete('bookd-annotation')
  }, [annotations, chapter, chapterIndex])

  useEffect(() => {
    if (!command) return
    const payload = command.command
    if (payload.type !== 'goto' || (payload.bookId && payload.bookId !== book.id)) return
    if (Number.isInteger(payload.chapter)) onChapterChange(payload.chapter!)
    else if (payload.cfi?.startsWith('bookd-md:')) {
      const [, , chapterPart, scrollPart] = payload.cfi.split(':')
      const targetChapter = Number(chapterPart)
      if (targetChapter !== chapterIndex) onChapterChange(targetChapter)
      else requestAnimationFrame(() => scroller.current?.scrollTo({ top: Number(scrollPart) || 0, behavior: 'smooth' }))
    } else if (Number.isFinite(payload.fraction) && scroller.current) {
      const max = scroller.current.scrollHeight - scroller.current.clientHeight
      scroller.current.scrollTo({ top: max * payload.fraction!, behavior: 'smooth' })
    }
  }, [command?.id, book.id, chapterIndex])

  const reportProgress = () => {
    const element = scroller.current
    if (!element || !chapter) return
    const max = Math.max(1, element.scrollHeight - element.clientHeight)
    onSelection(null)
    const visibleText = Array.from(article.current?.querySelectorAll('p, li, blockquote, h1, h2, h3') ?? [])
      .filter(node => {
        const rect = node.getBoundingClientRect()
        const viewport = element.getBoundingClientRect()
        return rect.bottom > viewport.top && rect.top < viewport.bottom
      })
      .map(node => node.textContent?.trim()).filter(Boolean).join(' ')
    onProgress({
      chapter: chapter.title,
      chapterIndex,
      cfi: `bookd-md:${chapterIndex}:${Math.round(element.scrollTop)}`,
      progress: (chapterIndex + element.scrollTop / max) / Math.max(1, book.chapters.length),
      visibleTextHead: visibleText.slice(0, 1000) || chapter.text.slice(0, 1000),
    })
  }

  const select = () => {
    requestAnimationFrame(() => {
      const selection = window.getSelection()
      const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
      if (!selection || selection.isCollapsed || !selection.rangeCount || !text || !article.current) {
        onSelection(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!article.current.contains(range.commonAncestorContainer)) return
      const start = textOffset(article.current, range.startContainer, range.startOffset)
      const end = start + range.toString().length
      onSelection({ text, cfi: `bookd-md:${chapterIndex}:${start}:${end}`, chapter: chapter?.title })
    })
  }

  useEffect(() => {
    if (!chapter) return
    const frame = requestAnimationFrame(reportProgress)
    return () => cancelAnimationFrame(frame)
  }, [chapter?.index])

  return (
    <div className="markdown-scroller" ref={scroller} onScroll={reportProgress} onMouseUp={select} tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          window.getSelection()?.removeAllRanges()
          onSelection(null)
        }
      }}>
      {chapter ? (
        <article className="markdown-article" ref={article}>
          <div className="chapter-kicker">{String(chapterIndex + 1).padStart(2, '0')} · {book.title}</div>
          <ReactMarkdown>{chapter.markdown}</ReactMarkdown>
          <div className="chapter-end">·　·　·</div>
        </article>
      ) : <div className="reader-loading"><span className="orbit-mark" />正在整理章节…</div>}
    </div>
  )
}
