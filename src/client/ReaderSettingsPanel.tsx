import { useEffect, useRef } from 'react'
import type { BookFormat } from '../shared'
import { FONT_SIZES, type ReaderFont, type ReaderPaper, type ReaderSettings, type ReaderView } from './settings'

interface Props {
  format: BookFormat
  open: boolean
  settings: ReaderSettings
  onChange: (settings: ReaderSettings) => void
  onOpenChange: (open: boolean) => void
}

const VIEW_OPTIONS: Array<{ value: ReaderView; label: string }> = [
  { value: 'single', label: '单页' },
  { value: 'spread', label: '双页' },
  { value: 'scroll', label: '滚动' },
]

const FONT_OPTIONS: Array<{ value: ReaderFont; label: string }> = [
  { value: 'song', label: '宋体' },
  { value: 'hei', label: '黑体' },
  { value: 'kai', label: '楷体' },
]

const PAPER_OPTIONS: Array<{ value: ReaderPaper; label: string }> = [
  { value: 'white', label: '白纸' },
  { value: 'cream', label: '米黄' },
  { value: 'green', label: '豆沙绿' },
  { value: 'dark', label: '墨色' },
]

export function ReaderSettingsPanel({ format, open, settings, onChange, onOpenChange }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const sizeIndex = FONT_SIZES.indexOf(settings.fontSize as typeof FONT_SIZES[number])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open, onOpenChange])

  const update = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const adjustFontSize = (offset: number) => {
    const next = Math.min(FONT_SIZES.length - 1, Math.max(0, sizeIndex + offset))
    update('fontSize', FONT_SIZES[next])
  }

  return (
    <div className={`reader-settings ${open ? 'open' : ''}`} ref={root}>
      <button
        type="button"
        className="reader-settings-trigger"
        aria-label={open ? '收起阅读设置' : '展开阅读设置'}
        aria-expanded={open}
        aria-controls="reader-settings-panel"
        onClick={() => onOpenChange(!open)}
      >
        <span />
      </button>

      {open && <section id="reader-settings-panel" className="reader-settings-panel" role="dialog" aria-label="阅读设置">
        {format !== 'markdown' && <div className="settings-group">
          <span className="settings-label">视图</span>
          <div className="settings-segments" role="group" aria-label="阅读视图">
            {VIEW_OPTIONS.map(option => <button
              type="button"
              key={option.value}
              className={settings.view === option.value ? 'active' : ''}
              aria-pressed={settings.view === option.value}
              onClick={() => update('view', option.value)}
            >{option.label}</button>)}
          </div>
        </div>}

        <div className="settings-group settings-text-group">
          <span className="settings-label">文字</span>
          <div className="font-size-control" role="group" aria-label="字号">
            <button type="button" onClick={() => adjustFontSize(-1)} disabled={sizeIndex <= 0} aria-label="减小字号">A−</button>
            <output aria-label="当前字号档位">{sizeIndex + 1} / {FONT_SIZES.length}</output>
            <button type="button" onClick={() => adjustFontSize(1)} disabled={sizeIndex >= FONT_SIZES.length - 1} aria-label="增大字号">A＋</button>
          </div>
          <div className="settings-segments font-segments" role="group" aria-label="字体">
            {FONT_OPTIONS.map(option => <button
              type="button"
              key={option.value}
              className={settings.fontFamily === option.value ? 'active' : ''}
              aria-pressed={settings.fontFamily === option.value}
              onClick={() => update('fontFamily', option.value)}
            >{option.label}</button>)}
          </div>
        </div>

        <div className="settings-group">
          <span className="settings-label">纸面</span>
          <div className="paper-options" role="group" aria-label="纸面颜色">
            {PAPER_OPTIONS.map(option => <button
              type="button"
              key={option.value}
              className={settings.paper === option.value ? 'active' : ''}
              data-paper-option={option.value}
              aria-label={option.label}
              aria-pressed={settings.paper === option.value}
              title={option.label}
              onClick={() => update('paper', option.value)}
            ><span /></button>)}
          </div>
        </div>
      </section>}
    </div>
  )
}
