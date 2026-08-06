export type ReaderView = 'single' | 'spread' | 'scroll'
export type ReaderFont = 'song' | 'hei' | 'kai'
export type ReaderPaper = 'white' | 'cream' | 'green' | 'dark'

export interface ReaderSettings {
  view: ReaderView
  fontSize: number
  fontFamily: ReaderFont
  paper: ReaderPaper
}

export const FONT_SIZES = [0.92, 1, 1.08, 1.16, 1.26, 1.38] as const

export const FONT_FAMILIES: Record<ReaderFont, string> = {
  song: '"Songti SC", "STSong", "Noto Serif CJK SC", serif',
  hei: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif',
  kai: '"Kaiti SC", "STKaiti", serif',
}

const PAPER_STYLES: Record<ReaderPaper, {
  background: string
  ink: string
  link: string
  selection: string
  colorScheme: 'light' | 'dark'
}> = {
  white: {
    background: '#ffffff',
    ink: '#2a2926',
    link: '#7a5b2b',
    selection: 'rgba(197, 153, 68, .28)',
    colorScheme: 'light',
  },
  cream: {
    background: '#f5f0e7',
    ink: '#242321',
    link: '#7a5b2b',
    selection: 'rgba(197, 153, 68, .32)',
    colorScheme: 'light',
  },
  green: {
    background: '#c9e0c9',
    ink: '#24312a',
    link: '#5b7a4b',
    selection: 'rgba(173, 135, 57, .3)',
    colorScheme: 'light',
  },
  dark: {
    background: '#17181a',
    ink: '#c9c7c1',
    link: '#b8935a',
    selection: 'rgba(197, 153, 68, .35)',
    colorScheme: 'dark',
  },
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  view: 'single',
  fontSize: 1.08,
  fontFamily: 'song',
  paper: 'cream',
}

const STORAGE_KEY = 'bookd:reader-settings'
const VIEWS: ReaderView[] = ['single', 'spread', 'scroll']
const FONTS: ReaderFont[] = ['song', 'hei', 'kai']
const PAPERS: ReaderPaper[] = ['white', 'cream', 'green', 'dark']

const includes = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T)

export const loadSettings = (): ReaderSettings => {
  const defaults = { ...DEFAULT_SETTINGS }
  if (typeof localStorage === 'undefined') return defaults

  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
    const candidate = value as Partial<ReaderSettings>
    return {
      view: includes(VIEWS, candidate.view) ? candidate.view : defaults.view,
      fontSize: typeof candidate.fontSize === 'number' && FONT_SIZES.includes(candidate.fontSize as typeof FONT_SIZES[number])
        ? candidate.fontSize
        : defaults.fontSize,
      fontFamily: includes(FONTS, candidate.fontFamily) ? candidate.fontFamily : defaults.fontFamily,
      paper: includes(PAPERS, candidate.paper) ? candidate.paper : defaults.paper,
    }
  } catch {
    return defaults
  }
}

export const saveSettings = (settings: ReaderSettings): void => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Reading must keep working when storage is unavailable or full.
  }
}

export const makeEbookStyles = (settings: ReaderSettings): string => {
  const paper = PAPER_STYLES[settings.paper]
  const font = FONT_FAMILIES[settings.fontFamily]
  return `
    :root { color-scheme: ${paper.colorScheme}; --theme-bg-color: ${paper.background}; }
    html, body { background: ${paper.background} !important; color: ${paper.ink} !important; }
    body {
      max-width: none; margin: 0 !important; padding: 0 !important;
      font-family: ${font} !important;
      font-size: ${settings.fontSize}rem !important; line-height: 1.95 !important; letter-spacing: .025em !important;
    }
    p, li, blockquote, dd { line-height: 1.95 !important; text-align: justify; }
    h1, h2, h3 { font-family: ${font}; font-weight: 500; line-height: 1.45; }
    h1, h2 { margin: 2.2em 0 1.25em; }
    h3 { margin: 1.8em 0 .8em; }
    img { max-width: 100%; height: auto; }
    a { color: ${paper.link}; text-underline-offset: .22em; }
    ::selection { background: ${paper.selection}; }
  `
}
