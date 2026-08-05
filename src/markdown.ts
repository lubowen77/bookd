import type { StoredChapter } from './shared.js'

const stripMarkdown = (value: string) => value
  .replace(/```[\s\S]*?```/g, match => match.replace(/```[^\n]*\n?|```/g, ''))
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/[*_~>`]/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

export const splitMarkdown = (markdown: string): StoredChapter[] => {
  const heading = /^#{1,2}\s+(.+)$/gm
  const matches = [...markdown.matchAll(heading)]
  if (!matches.length) {
    const text = stripMarkdown(markdown)
    return [{ index: 0, title: '正文', characters: text.length, markdown: markdown.trim(), text }]
  }

  const chapters: StoredChapter[] = []
  const preface = markdown.slice(0, matches[0].index).trim()
  if (preface) {
    const text = stripMarkdown(preface)
    chapters.push({ index: 0, title: '前言', characters: text.length, markdown: preface, text })
  }
  matches.forEach((match, matchIndex) => {
    const start = match.index ?? 0
    const end = matches[matchIndex + 1]?.index ?? markdown.length
    const body = markdown.slice(start, end).trim()
    const text = stripMarkdown(body)
    chapters.push({ index: chapters.length, title: match[1].trim(), characters: text.length, markdown: body, text })
  })
  return chapters
}
