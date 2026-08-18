import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  BookOpen, Bookmark, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, FileUp,
  FolderOpen, Highlighter, Library, Menu, Moon, NotebookPen, PanelLeftClose, PanelRightClose,
  Search, Sun, Trash2, Wifi, WifiOff, X,
} from 'lucide-react'
import type { Annotation, BookMeta, ReaderCommand, ReadingSelection, ReadingState } from '../shared'
import { EMPTY_READING_STATE } from '../shared'
import { upsertAnnotation } from './annotations'
import { api } from './api'
import { FoliateReader } from './FoliateReader'
import { MarkdownReader } from './MarkdownReader'
import { ReaderSettingsPanel } from './ReaderSettingsPanel'
import { FONT_FAMILIES, loadSettings, saveSettings } from './settings'
import { useBookdSocket } from './useBookdSocket'

const formatPercent = (value: number) => `${Math.round(value * 100)}%`
const formatCount = (value: number) => new Intl.NumberFormat('zh-CN').format(value)

export default function App() {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => {
    const match = location.pathname.match(/^\/read\/([^/]+)$/)
    return match ? decodeURIComponent(match[1]) : null
  })
  const [activeBook, setActiveBook] = useState<BookMeta | null>(null)
  const [readingState, setReadingState] = useState<ReadingState>(EMPTY_READING_STATE)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selection, setSelection] = useState<ReadingSelection | null>(null)
  const [note, setNote] = useState('')
  const [chapterIndex, setChapterIndex] = useState(0)
  const [leftOpen, setLeftOpen] = useState(() => !matchMedia('(max-width: 820px)').matches)
  const [rightOpen, setRightOpen] = useState(() => !matchMedia('(max-width: 820px)').matches)
  const [dark, setDark] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ chapter: number; title: string; excerpt: string; cfi?: string; href?: string }>>([])
  const [settings, setSettings] = useState(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [pageArrowEdge, setPageArrowEdge] = useState<'left' | 'right' | null>(null)
  const [localCommand, setLocalCommand] = useState<{ id: number; command: ReaderCommand } | null>(null)
  const localCommandId = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const directoryInput = useRef<HTMLInputElement>(null)
  const leftEdgeZone = useRef<HTMLDivElement>(null)
  const rightEdgeZone = useRef<HTMLDivElement>(null)

  const refreshBooks = useCallback(async () => {
    const result = await api.books()
    setBooks(result.books)
    return result.books
  }, [])
  const receiveState = useCallback((state: ReadingState) => {
    setReadingState(state)
    if (state.book) setActiveId(current => current ?? state.book)
  }, [])
  const { connected, lastCommand, sendState } = useBookdSocket(receiveState, refreshBooks)

  useEffect(() => { void refreshBooks().catch(error => setError(error.message)) }, [refreshBooks])
  useEffect(() => {
    directoryInput.current?.setAttribute('webkitdirectory', '')
    directoryInput.current?.setAttribute('directory', '')
  }, [])
  useEffect(() => {
    if (!lastCommand) return
    const command = lastCommand.command
    if (command.type === 'open') {
      setActiveId(command.bookId)
      history.replaceState(null, '', `/read/${encodeURIComponent(command.bookId)}`)
      if (matchMedia('(max-width: 820px)').matches) {
        setLeftOpen(false)
        setRightOpen(false)
      }
    } else if (command.type === 'highlight') {
      setAnnotations(current => upsertAnnotation(current, command.annotation))
    } else if (command.type === 'clear-highlights') {
      setAnnotations(current => current.filter(item =>
        command.bookId && item.bookId !== command.bookId
          ? true
          : Boolean(command.annotationId && item.id !== command.annotationId)))
    }
  }, [lastCommand])

  useEffect(() => {
    if (!activeId) {
      setActiveBook(null)
      setAnnotations([])
      return
    }
    let disposed = false
    api.book(activeId).then(result => {
      if (disposed) return
      setActiveBook(result.book)
      setAnnotations(result.annotations)
      setChapterIndex(readingState.book === activeId ? readingState.chapterIndex ?? 0 : 0)
    }).catch(error => !disposed && setError(error.message))
    return () => { disposed = true }
  }, [activeId])

  useEffect(() => {
    if (!selection) return
    const timeout = window.setTimeout(() => setSelection(null), 10_000)
    return () => window.clearTimeout(timeout)
  }, [selection])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (!activeId || !searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timeout = window.setTimeout(() => {
      api.search(activeId, searchQuery).then(result => setSearchResults(result.results)).catch(error => setError(error.message))
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [activeId, searchQuery])

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => setSettingsOpen(false), [activeId])

  const readerCommand = useMemo(() => {
    if (lastCommand && localCommand) return lastCommand.id > localCommand.id ? lastCommand : localCommand
    return lastCommand ?? localCommand
  }, [lastCommand, localCommand])

  const dispatchLocal = useCallback((command: ReaderCommand) => {
    localCommandId.current = Math.max(localCommandId.current + 1, Date.now())
    setLocalCommand({ id: localCommandId.current, command })
  }, [])

  const selectBook = (bookId: string) => {
    setActiveId(bookId)
    history.replaceState(null, '', `/read/${encodeURIComponent(bookId)}`)
    setSelection(null)
    if (matchMedia('(max-width: 820px)').matches) {
      setLeftOpen(false)
      setRightOpen(false)
    }
    void api.open(bookId).catch(error => setError(error.message))
  }

  const importFiles = async (files: FileList | File[]) => {
    const file = Array.from(files)[0]
    if (!file) return
    setImporting(true)
    setError('')
    try {
      const { book } = await api.importBook(file)
      setBooks(await refreshBooks())
      setActiveId(book.id)
      history.replaceState(null, '', `/read/${encodeURIComponent(book.id)}`)
      if (matchMedia('(max-width: 820px)').matches) {
        setLeftOpen(false)
        setRightOpen(false)
      }
      setToast(`已导入《${book.title}》`)
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const importMarkdownDirectory = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(file => /\.md(?:own)?$/i.test(file.name))
    if (!list.length) return setError('所选文件夹中没有 Markdown 文件')
    const title = list[0].webkitRelativePath.split('/')[0] || 'Markdown 书稿'
    setImporting(true)
    try {
      const { book } = await api.importMarkdownDirectory(title, list)
      await refreshBooks()
      setActiveId(book.id)
      history.replaceState(null, '', `/read/${encodeURIComponent(book.id)}`)
      setToast(`已导入 Markdown 书稿《${book.title}》`)
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImporting(false)
      if (directoryInput.current) directoryInput.current.value = ''
    }
  }

  const progress = useCallback((value: { chapter: string; chapterIndex: number; cfi: string; progress: number; visibleTextHead: string }) => {
    if (!activeBook) return
    setChapterIndex(value.chapterIndex)
    const update = { book: activeBook.id, ...value, selection }
    setReadingState(current => ({ ...current, ...update, updatedAt: new Date().toISOString() }))
    sendState(update)
  }, [activeBook?.id, selection, sendState])

  const updateSelection = useCallback((value: ReadingSelection | null) => {
    setSelection(value)
    if (activeBook) sendState({ book: activeBook.id, selection: value })
  }, [activeBook?.id, sendState])

  const addHighlight = async () => {
    if (!activeBook || !selection?.cfi || !selection.text) return
    try {
      const result = await api.highlight({
        bookId: activeBook.id,
        cfi: selection.cfi,
        text: selection.text,
        chapter: selection.chapter,
        note,
        source: 'reader',
      })
      setAnnotations(current => upsertAnnotation(current, result.annotation))
      setSelection(null)
      setNote('')
      window.getSelection()?.removeAllRanges()
      setToast(note ? '划线与笔记已保存' : '已添加划线')
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
    }
  }

  const removeAnnotation = async (annotationId: string) => {
    if (!activeBook) return
    await api.clearHighlights({ bookId: activeBook.id, annotationId })
    setAnnotations(current => current.filter(item => item.id !== annotationId))
    setToast('已删除划线')
  }

  const copySelection = async () => {
    if (!selection || !activeBook) return
    await navigator.clipboard.writeText(`《${activeBook.title}》${selection.chapter ? ` · ${selection.chapter}` : ''}\n「${selection.text}」`)
    setToast('已复制带出处引用')
    setSelection(null)
  }

  const gotoChapter = useCallback((index: number) => {
    setChapterIndex(index)
    dispatchLocal({ type: 'goto', bookId: activeBook?.id, chapter: index })
  }, [activeBook?.id, dispatchLocal])

  const pageBackward = useCallback(() => {
    if (!activeBook) return
    if (activeBook.format === 'markdown') gotoChapter(Math.max(0, chapterIndex - 1))
    else dispatchLocal({ type: 'page', direction: 'previous' })
  }, [activeBook, chapterIndex, dispatchLocal, gotoChapter])

  const pageForward = useCallback(() => {
    if (!activeBook) return
    if (activeBook.format === 'markdown') gotoChapter(Math.min(activeBook.chapters.length - 1, chapterIndex + 1))
    else dispatchLocal({ type: 'page', direction: 'next' })
  }, [activeBook, chapterIndex, dispatchLocal, gotoChapter])

  const pageWheelContext = useRef({
    format: activeBook?.format,
    view: settings.view,
    backward: pageBackward,
    forward: pageForward,
  })
  const wheelLockedUntil = useRef(0)
  pageWheelContext.current = {
    format: activeBook?.format,
    view: settings.view,
    backward: pageBackward,
    forward: pageForward,
  }
  const handlePageWheel = useCallback((event: WheelEvent) => {
    const context = pageWheelContext.current
    if (!context.format || context.format === 'markdown' || context.view === 'scroll' || event.deltaY === 0) return
    event.preventDefault()
    const now = performance.now()
    if (now < wheelLockedUntil.current) return
    wheelLockedUntil.current = now + 300
    if (event.deltaY > 0) context.forward()
    else context.backward()
  }, [])

  useEffect(() => {
    wheelLockedUntil.current = 0
    const zones = [leftEdgeZone.current, rightEdgeZone.current].filter((zone): zone is HTMLDivElement => Boolean(zone))
    for (const zone of zones) zone.addEventListener('wheel', handlePageWheel, { passive: false })
    return () => {
      for (const zone of zones) zone.removeEventListener('wheel', handlePageWheel)
    }
  }, [activeBook?.id, handlePageWheel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const isTextEntry = Boolean(target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable))
      if (event.key === 'Escape') {
        setSelection(null)
        setSearchOpen(false)
        setSettingsOpen(false)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === '/' && !isTextEntry) {
        event.preventDefault()
        setSearchOpen(true)
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && activeBook && !searchOpen && !isTextEntry) {
        event.preventDefault()
        if (event.key === 'ArrowLeft') pageBackward()
        else pageForward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeBook, pageBackward, pageForward, searchOpen])

  const currentCommand = readerCommand
  const currentProgress = readingState.book === activeBook?.id ? readingState.progress : 0
  const readerStyle = {
    '--reader-font-family': FONT_FAMILIES[settings.fontFamily],
    '--reader-font-size': `${settings.fontSize}rem`,
  } as CSSProperties

  return (
    <div className={`app-shell ${dark ? 'theme-dark' : 'theme-light'} ${activeBook ? 'has-book' : ''} ${!leftOpen ? 'left-closed' : ''} ${!rightOpen ? 'right-closed' : ''} ${pageArrowEdge ? `edge-${pageArrowEdge}` : ''}`}
      data-paper={settings.paper}
      data-font={settings.fontFamily}
      style={readerStyle}
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); void importFiles(event.dataTransfer.files) }}>
      <header className="topbar">
        <div className="brand"><span className="brand-word">BookD</span></div>
        <div className="book-status">
          <span className="current-title">{activeBook?.title ?? '本地书库'}</span>
          <span className="progress-number">{formatPercent(currentProgress)}</span>
          <div className="top-progress"><span style={{ width: `${currentProgress * 100}%` }} /></div>
        </div>
        <div className="top-actions">
          <button className={`connection ${connected ? 'online' : ''}`} title={connected ? '阅读器与本地桥已连接' : '正在重连本地桥'}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}{connected ? '本地桥已连接' : '连接中'}
          </button>
          <button className="icon-button" onClick={() => setSearchOpen(true)} aria-label="搜索"><Search size={18} /></button>
          <button className="icon-button" onClick={() => setDark(value => !value)} aria-label="切换主题">{dark ? <Moon size={18} /> : <Sun size={18} />}</button>
          <button className="icon-button mobile-only" onClick={() => setLeftOpen(value => !value)} aria-label="打开书库"><Menu size={19} /></button>
        </div>
      </header>

      <aside className="left-rail">
        <div className="rail-tabs">
          <span className="rail-tab active"><Library size={16} />书库</span>
          <button className="rail-collapse" onClick={() => setLeftOpen(false)} aria-label="收起书库"><PanelLeftClose size={17} /></button>
        </div>
        <div className="rail-section-label"><span>我的书库</span><div className="import-actions"><button onClick={() => directoryInput.current?.click()} aria-label="导入 Markdown 文件夹"><FolderOpen size={15} /></button><button onClick={() => fileInput.current?.click()} aria-label="导入电子书">＋</button></div></div>
        <input ref={fileInput} type="file" accept=".epub,.mobi,.azw3,.md,.markdown,.pdf" hidden onChange={event => void importFiles(event.target.files ?? [])} />
        <input ref={directoryInput} type="file" accept=".md,.markdown" multiple hidden onChange={event => void importMarkdownDirectory(event.target.files ?? [])} />
        <div className="book-list">
          {books.map((book, index) => (
            <button className={`book-row ${book.id === activeId ? 'active' : ''}`} key={book.id} onClick={() => selectBook(book.id)}>
              <span className={`cover-mini cover-tone-${index % 5}`}><BookOpen size={16} /></span>
              <span className="book-row-copy"><strong>{book.title}</strong><small>{book.format.toUpperCase()}{book.author ? ` · ${book.author}` : ''}</small></span>
              {readingState.book === book.id && <span className="book-percent">{formatPercent(readingState.progress)}</span>}
            </button>
          ))}
          {!books.length && <button className="empty-import" onClick={() => fileInput.current?.click()}><FileUp size={19} />拖入或选择电子书</button>}
        </div>
        {activeBook && <>
          <div className="rail-section-label chapter-heading"><span>目录</span><small>{activeBook.chapters.length} 节</small></div>
          <ol className="chapter-list">
            {activeBook.chapters.map(chapter => (
              <li key={chapter.index}>
                <button className={chapter.index === chapterIndex ? 'active' : ''} onClick={() => gotoChapter(chapter.index)}>
                  <span>{String(chapter.index + 1).padStart(2, '0')}</span>
                  <strong>{chapter.title}</strong>
                  <small>{formatCount(chapter.characters)}</small>
                </button>
              </li>
            ))}
          </ol>
        </>}
      </aside>
      <button type="button" className="side-reopen" onClick={() => setLeftOpen(true)} aria-label="展开书库" title="展开书库"><ChevronRight size={17} /></button>

      <main
        className="reader-stage"
        data-reader-view={settings.view}
        onMouseLeave={() => setPageArrowEdge(null)}
      >
        {activeBook && <ReaderSettingsPanel
          format={activeBook.format}
          open={settingsOpen}
          settings={settings}
          onChange={setSettings}
          onOpenChange={setSettingsOpen}
        />}

        {activeBook && <>
          <div
            ref={leftEdgeZone}
            className="reader-edge-zone reader-edge-zone-left"
            aria-hidden="true"
            onMouseEnter={() => setPageArrowEdge('left')}
            onMouseLeave={() => setPageArrowEdge(null)}
          />
          <div
            ref={rightEdgeZone}
            className="reader-edge-zone reader-edge-zone-right"
            aria-hidden="true"
            onMouseEnter={() => setPageArrowEdge('right')}
            onMouseLeave={() => setPageArrowEdge(null)}
          />
          <button
            type="button"
            className="page-arrow page-arrow-left"
            onClick={pageBackward}
            aria-label={activeBook.format === 'markdown' ? '上一章' : '上一页'}
            title={activeBook.format === 'markdown' ? '上一章' : '上一页'}
            disabled={activeBook.format === 'markdown' && chapterIndex <= 0}
          ><ChevronLeft size={22} /></button>
          <button
            type="button"
            className="page-arrow page-arrow-right"
            onClick={pageForward}
            aria-label={activeBook.format === 'markdown' ? '下一章' : '下一页'}
            title={activeBook.format === 'markdown' ? '下一章' : '下一页'}
            disabled={activeBook.format === 'markdown' && chapterIndex >= activeBook.chapters.length - 1}
          ><ChevronRight size={22} /></button>
        </>}

        {!activeBook ? (
          <section className="welcome">
            <div className="welcome-orbits"><span /><span /><span /></div>
            <p className="welcome-eyebrow">LOCAL-FIRST READING COMPANION</p>
            <h1>让阅读位置，成为<br />对话的一部分。</h1>
            <p>导入 EPUB、MOBI、AZW3 或 Markdown。bookd 会持续保存章节、位置与选区，供 AI 在需要时准确读取。</p>
            <button onClick={() => fileInput.current?.click()} disabled={importing}><FileUp size={17} />{importing ? '正在导入…' : '导入第一本书'}</button>
            <button className="welcome-folder" onClick={() => directoryInput.current?.click()} disabled={importing}><FolderOpen size={15} />导入 Markdown 文件夹</button>
            <small>文件只保存在本机的 ~/Books/bookd</small>
          </section>
        ) : activeBook.format === 'markdown' ? (
          <MarkdownReader
            book={activeBook}
            chapterIndex={chapterIndex}
            annotations={annotations}
            command={currentCommand}
            onChapterChange={gotoChapter}
            onProgress={progress}
            onSelection={updateSelection}
            onError={setError}
          />
        ) : (
          <FoliateReader
            book={activeBook}
            restoreCfi={readingState.book === activeBook.id ? readingState.cfi : null}
            annotations={annotations}
            command={currentCommand}
            settings={settings}
            onProgress={progress}
            onEdgeHover={setPageArrowEdge}
            onWheelPage={handlePageWheel}
            onSelection={updateSelection}
            onCached={book => { setActiveBook(book); void refreshBooks() }}
            onError={setError}
          />
        )}

        {activeBook && <nav className="page-controls" aria-label={activeBook.format === 'markdown' ? '章节跳转' : '翻页'}>
          <button type="button" onClick={pageBackward} aria-label={activeBook.format === 'markdown' ? '上一章' : '上一页'}><ChevronLeft size={18} /></button>
          <span>{readingState.chapter || activeBook.chapters[chapterIndex]?.title || '阅读中'}</span>
          <button type="button" onClick={pageForward} aria-label={activeBook.format === 'markdown' ? '下一章' : '下一页'}><ChevronRight size={18} /></button>
        </nav>}

        {selection && <div className="selection-toolbar" role="toolbar" aria-label="选区操作">
          <button onClick={() => void addHighlight()}><Highlighter size={15} />划线</button>
          <button onClick={() => { setRightOpen(true); document.querySelector<HTMLTextAreaElement>('#selection-note')?.focus() }}><NotebookPen size={15} />笔记</button>
          <button onClick={() => void copySelection()}><Copy size={15} />引用</button>
          <button className="toolbar-close" onClick={() => setSelection(null)} aria-label="关闭"><X size={15} /></button>
        </div>}
      </main>

      <aside className="right-rail">
        <div className="rail-tabs right-tabs">
          <span className="rail-tab active">AI 伴读</span>
          <span className="rail-tab">笔记 {annotations.length}</span>
          <button className="rail-collapse" onClick={() => setRightOpen(false)} aria-label="收起伴读栏"><PanelRightClose size={17} /></button>
        </div>
        <section className="companion-section">
          <div className="section-title">当前选中</div>
          {selection ? <div className="selection-card">
            <blockquote>{selection.text}</blockquote>
            <small>{selection.chapter || readingState.chapter || '当前章节'}</small>
            <textarea id="selection-note" value={note} onChange={event => setNote(event.target.value)} placeholder="写下你的想法…" />
            <button onClick={() => void addHighlight()}><Bookmark size={14} />保存划线{note ? '与笔记' : ''}</button>
          </div> : <div className="companion-empty">选中正文后，这里会出现原文、出处与笔记入口。</div>}
        </section>
        <section className="companion-section bridge-card">
          <button
            type="button"
            className="section-title bridge-toggle"
            aria-expanded={contextOpen}
            aria-controls="reading-context-details"
            onClick={() => setContextOpen(value => !value)}
          >
            <span>阅读上下文</span>
            <ChevronDown size={15} />
          </button>
          <div className="bridge-status"><span className={connected ? 'status-dot' : 'status-dot offline'} />{connected ? '同步通道已连接' : '等待本地桥重连'}</div>
          {contextOpen && <div id="reading-context-details" className="bridge-details">
            <p>{readingState.visibleTextHead || '开始阅读后，AI 可通过 MCP 获取当前章节、CFI 和屏幕内文本。'}</p>
            {readingState.cfi && <code>{readingState.cfi}</code>}
          </div>}
        </section>
        <section className="companion-section annotations-section">
          <div className="section-title">我的批注</div>
          <div className="annotation-list">
            {annotations.slice().reverse().map(annotation => <article key={annotation.id} className="annotation-card">
              <blockquote>{annotation.text}</blockquote>
              {annotation.note && <p>{annotation.note}</p>}
              <footer><span>{annotation.chapter || '未命名章节'}</span><button onClick={() => void removeAnnotation(annotation.id)} aria-label="删除划线"><Trash2 size={13} /></button></footer>
            </article>)}
            {!annotations.length && <div className="companion-empty compact">还没有划线。选中文字后按“划线”即可保存。</div>}
          </div>
        </section>
      </aside>
      <button type="button" className="right-reopen" onClick={() => setRightOpen(true)} aria-label="展开伴读栏" title="展开伴读栏"><ChevronLeft size={17} /></button>

      {searchOpen && <div className="command-backdrop" onMouseDown={event => event.target === event.currentTarget && setSearchOpen(false)}>
        <div className="command-panel" role="dialog" aria-label="搜索书中内容">
          <div className="command-input"><Search size={18} /><input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder={activeBook ? `搜索《${activeBook.title}》` : '请先打开一本书'} disabled={!activeBook} /><kbd>Esc</kbd></div>
          <div className="command-results">
            {searchResults.map((result, index) => <button key={`${result.chapter}-${index}`} onClick={() => { gotoChapter(result.chapter); setSearchOpen(false) }}>
              <span>{String(result.chapter + 1).padStart(2, '0')}</span><div><strong>{result.title}</strong><p>{result.excerpt}</p></div>
            </button>)}
            {searchQuery && !searchResults.length && <div className="command-empty">没有找到匹配内容</div>}
            {!searchQuery && <div className="command-hints"><span><kbd>⌘ K</kbd> 打开搜索</span><span><kbd>Esc</kbd> 关闭浮层</span></div>}
          </div>
        </div>
      </div>}

      {error && <div className="error-toast"><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={14} /></button></div>}
      <div className={`app-toast ${toast ? 'show' : ''}`} aria-live="polite">{toast}</div>
    </div>
  )
}
