import { useEffect, useRef, useState } from 'react'
import { Overlayer } from 'foliate-js/overlayer.js'
import 'foliate-js/view.js'
import type { Annotation, BookMeta, ReaderCommand, ReadingSelection } from '../shared'
import { api } from './api'
import { hardenBookDocument } from './book-document'
import { makeEbookStyles, type ReaderSettings } from './settings'

interface Props {
  book: BookMeta
  restoreCfi?: string | null
  annotations: Annotation[]
  command: { id: number; command: ReaderCommand } | null
  settings: ReaderSettings
  onProgress: (state: { chapter: string; chapterIndex: number; cfi: string; progress: number; visibleTextHead: string }) => void
  onEdgeHover: (edge: 'left' | 'right' | null) => void
  onWheelPage: (event: WheelEvent) => void
  onSelection: (selection: ReadingSelection | null) => void
  onCached: (book: BookMeta) => void
  onError: (message: string) => void
}

const chapterTitle = (doc: Document, index: number) =>
  doc.querySelector('h1, h2, h3, title')?.textContent?.trim() || `第 ${index + 1} 节`

const applySettings = (element: FoliateViewElement, settings: ReaderSettings) => {
  const renderer = element.renderer
  if (!renderer) return
  if (settings.view === 'scroll') {
    renderer.setAttribute('flow', 'scrolled')
  } else {
    renderer.setAttribute('flow', 'paginated')
    renderer.setAttribute('max-column-count', settings.view === 'spread' ? '2' : '1')
    renderer.setAttribute('max-inline-size', settings.view === 'spread' ? '560px' : '720px')
    renderer.setAttribute('gap', '7%')
  }
  renderer.setStyles?.(makeEbookStyles(settings))
}

export function FoliateReader({ book, restoreCfi, annotations, command, settings, onProgress, onEdgeHover, onWheelPage, onSelection, onCached, onError }: Props) {
  const canvas = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<FoliateViewElement | null>(null)
  const annotationMap = useRef(new Map<string, Annotation>())
  const logicalChapter = useRef(0)
  const settingsRef = useRef(settings)
  const onWheelPageRef = useRef(onWheelPage)
  const [loading, setLoading] = useState(true)
  settingsRef.current = settings
  onWheelPageRef.current = onWheelPage

  useEffect(() => {
    let disposed = false
    let openedElement: FoliateViewElement | null = null
    const cleanups: Array<() => void> = []
    setLoading(true)
    onSelection(null)

    const open = async () => {
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/source`)
        if (!response.ok) throw new Error('无法读取电子书源文件')
        const file = new File([await response.blob()], book.sourceFile)
        const element = document.createElement('foliate-view') as FoliateViewElement
        openedElement = element
        element.className = 'foliate-surface'
        if (disposed || !host.current) return
        host.current.replaceChildren(element)
        view.current = element

        const clearSelection = () => onSelection(null)
        const onLoad = (event: Event) => {
          const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail
          let hoverFrame = 0
          let pendingEdge: 'left' | 'right' | null = null
          let reportedEdge: 'left' | 'right' | null = null
          const reportEdge = () => {
            hoverFrame = 0
            if (pendingEdge === reportedEdge) return
            reportedEdge = pendingEdge
            onEdgeHover(reportedEdge)
          }
          const scheduleEdge = (edge: 'left' | 'right' | null) => {
            pendingEdge = edge
            if (!hoverFrame) hoverFrame = requestAnimationFrame(reportEdge)
          }
          const onMouseMove = (mouseEvent: MouseEvent) => {
            const width = doc.defaultView?.innerWidth ?? doc.documentElement.clientWidth
            scheduleEdge(mouseEvent.clientX <= 120 ? 'left' : mouseEvent.clientX >= width - 120 ? 'right' : null)
          }
          const onMouseLeave = () => scheduleEdge(null)
          const onWheel = (wheelEvent: WheelEvent) => onWheelPageRef.current(wheelEvent)
          const onMouseUp = () => {
            requestAnimationFrame(() => {
              const selection = doc.defaultView?.getSelection()
              const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
              if (!selection || selection.isCollapsed || !text || !selection.rangeCount) {
                onSelection(null)
                return
              }
              const range = selection.getRangeAt(0)
              const tocLabel = element.getProgressOf(index, range)?.tocItem?.label
              onSelection({ text, cfi: element.getCFI(index, range), chapter: tocLabel || chapterTitle(doc, index) })
            })
          }
          const onKeyDown = (keyboardEvent: KeyboardEvent) => {
            if (keyboardEvent.key === 'ArrowLeft') void element.goLeft()
            if (keyboardEvent.key === 'ArrowRight') void element.goRight()
            if (keyboardEvent.key === 'Escape') {
              doc.defaultView?.getSelection()?.removeAllRanges()
              clearSelection()
            }
          }
          doc.addEventListener('mousemove', onMouseMove, { passive: true })
          doc.addEventListener('mouseleave', onMouseLeave)
          doc.addEventListener('wheel', onWheel, { passive: false })
          doc.addEventListener('mouseup', onMouseUp)
          doc.addEventListener('keydown', onKeyDown)
          doc.defaultView?.addEventListener('scroll', clearSelection, { passive: true })
          cleanups.push(() => {
            doc.removeEventListener('mousemove', onMouseMove)
            doc.removeEventListener('mouseleave', onMouseLeave)
            doc.removeEventListener('wheel', onWheel)
            doc.removeEventListener('mouseup', onMouseUp)
            doc.removeEventListener('keydown', onKeyDown)
            doc.defaultView?.removeEventListener('scroll', clearSelection)
            if (hoverFrame) cancelAnimationFrame(hoverFrame)
            if (reportedEdge) onEdgeHover(null)
          })
        }
        const onRelocate = (event: Event) => {
          const detail = (event as CustomEvent<any>).detail
          const matchedChapter = book.chapters.findIndex(chapter => chapter.title === detail.tocItem?.label)
          if (matchedChapter >= 0) logicalChapter.current = matchedChapter
          onProgress({
            chapter: detail.tocItem?.label || `第 ${(detail.index ?? 0) + 1} 节`,
            chapterIndex: logicalChapter.current,
            cfi: detail.cfi,
            progress: Number.isFinite(detail.fraction) ? detail.fraction : 0,
            visibleTextHead: detail.range?.toString?.().replace(/\s+/g, ' ').trim().slice(0, 1000) ?? '',
          })
        }
        const onDrawAnnotation = (event: Event) => {
          const { draw, annotation } = (event as CustomEvent<any>).detail
          draw(Overlayer.highlight, { color: annotation.color || '#d6ad55' })
        }
        const onCreateOverlay = (event: Event) => {
          void (event as CustomEvent<any>).detail.index
          for (const annotation of annotationMap.current.values()) {
            void element.addAnnotation({ value: annotation.cfi, color: annotation.color, note: annotation.note })
          }
        }
        element.addEventListener('load', onLoad)
        element.addEventListener('relocate', onRelocate)
        element.addEventListener('draw-annotation', onDrawAnnotation)
        element.addEventListener('create-overlay', onCreateOverlay)
        cleanups.push(() => {
          element.removeEventListener('load', onLoad)
          element.removeEventListener('relocate', onRelocate)
          element.removeEventListener('draw-annotation', onDrawAnnotation)
          element.removeEventListener('create-overlay', onCreateOverlay)
        })

        await element.open(file)
        const transformTarget = element.book.transformTarget as EventTarget | undefined
        const harden = (event: Event) => {
          const detail = (event as CustomEvent<{ data: string | Promise<string>; type: string | Promise<string> }>).detail
          detail.data = Promise.all([Promise.resolve(detail.data), Promise.resolve(detail.type)]).then(([data, type]) =>
            /(?:xhtml|html|svg)/i.test(type) ? hardenBookDocument(String(data)) : data)
        }
        transformTarget?.addEventListener('data', harden)
        cleanups.push(() => transformTarget?.removeEventListener('data', harden))
        applySettings(element, settingsRef.current)
        await element.init({ lastLocation: restoreCfi || undefined, showTextStart: !restoreCfi })
        const locations = element.book.sections.map((section: any, index: number) => ({
          href: section.href ?? (section.id == null ? undefined : String(section.id)),
          cfi: element.getCFI(index),
        }))
        if (locations.length) void api.cacheLocations(book.id, locations).then(result => onCached(result.book))
        for (const annotation of annotationMap.current.values()) {
          await element.addAnnotation({ value: annotation.cfi, color: annotation.color, note: annotation.note })
        }
        setLoading(false)

        if (!book.chapters.length) {
          const tocStarts = new Map<number, { label: string; href?: string }>()
          const flattenToc = (items: any[] = []): any[] => items.flatMap(item => [item, ...flattenToc(item.subitems)])
          for (const item of flattenToc(element.book.toc)) {
            if (!item?.href) continue
            const resolved = await Promise.resolve(element.book.resolveHref?.(item.href))
            if (Number.isInteger(resolved?.index) && !tocStarts.has(resolved.index)) {
              tocStarts.set(resolved.index, { label: String(item.label || '').trim(), href: item.href })
            }
          }

          const groups: Array<{ title: string; href?: string; cfi: string; parts: string[] }> = []
          for (const [index, section] of element.book.sections.entries()) {
            if (!section.createDocument) continue
            const doc = await section.createDocument()
            const text = (doc.body?.innerText || doc.body?.textContent || '').replace(/\s+/g, ' ').trim()
            if (!text) continue
            const tocStart = tocStarts.get(index)
            let group = groups.at(-1)
            if (!group || tocStart) {
              group = {
                title: tocStart?.label || chapterTitle(doc, index),
                href: tocStart?.href || section.href,
                cfi: element.getCFI(index),
                parts: [],
              }
              groups.push(group)
            }
            group.parts.push(text)
          }
          const extracted = groups.map(group => {
            const text = group.parts.join('\n\n')
            return { title: group.title, href: group.href, cfi: group.cfi, text, markdown: `# ${group.title}\n\n${text}` }
          })
          const rawAuthor = element.book.metadata?.author
          const metadata = {
            title: typeof element.book.metadata?.title === 'string' ? element.book.metadata.title : undefined,
            author: (Array.isArray(rawAuthor) ? rawAuthor : [rawAuthor])
              .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
              .join('、') || undefined,
          }
          if (extracted.length && !disposed) onCached((await api.cacheChapters(book.id, extracted, metadata)).book)
        }
      } catch (error) {
        if (!disposed) {
          setLoading(false)
          onError(error instanceof Error ? error.message : '打开电子书失败')
        }
      }
    }
    void open()
    return () => {
      disposed = true
      cleanups.forEach(cleanup => cleanup())
      openedElement?.close()
      openedElement?.remove()
      if (view.current === openedElement) view.current = null
    }
  }, [book.id])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const onWheel = (event: WheelEvent) => onWheelPageRef.current(event)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const element = view.current
    if (element) applySettings(element, settings)
  }, [settings])

  useEffect(() => {
    annotationMap.current = new Map(annotations.map(annotation => [annotation.id, annotation]))
    const element = view.current
    if (!element) return
    for (const annotation of annotations) {
      void element.addAnnotation({ value: annotation.cfi, color: annotation.color, note: annotation.note })
    }
  }, [annotations])

  useEffect(() => {
    const element = view.current
    if (!element || !command) return
    const payload = command.command
    if (payload.type === 'goto' && (!payload.bookId || payload.bookId === book.id)) {
      if (payload.cfi) void element.goTo(payload.cfi)
      else if (Number.isFinite(payload.fraction)) void element.goToFraction(payload.fraction!)
      else if (Number.isInteger(payload.chapter)) {
        logicalChapter.current = payload.chapter!
        void element.goTo(book.chapters[payload.chapter!]?.href ?? payload.chapter!)
      }
    } else if (payload.type === 'page') {
      if (payload.direction === 'previous') void element.goLeft()
      else void element.goRight()
    } else if (payload.type === 'highlight' && payload.annotation.bookId === book.id) {
      annotationMap.current.set(payload.annotation.id, payload.annotation)
      void element.addAnnotation({ value: payload.annotation.cfi, color: payload.annotation.color, note: payload.annotation.note })
    } else if (payload.type === 'clear-highlights' && (!payload.bookId || payload.bookId === book.id)) {
      for (const annotation of annotationMap.current.values()) {
        if (!payload.annotationId || payload.annotationId === annotation.id) {
          void element.deleteAnnotation({ value: annotation.cfi })
          annotationMap.current.delete(annotation.id)
        }
      }
    }
  }, [command?.id, book.id])

  return (
    <div className="reader-canvas" ref={canvas}>
      <div className="foliate-host" ref={host} />
      {loading && <div className="reader-loading"><span className="orbit-mark" />正在展开《{book.title}》…</div>}
    </div>
  )
}
