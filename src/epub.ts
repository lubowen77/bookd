import path from 'node:path'
import AdmZip from 'adm-zip'
import * as cheerio from 'cheerio'
import { XMLParser } from 'fast-xml-parser'
import TurndownService from 'turndown'
import type { StoredChapter } from './shared.js'

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
turndown.remove(['script', 'style'])

const array = <T>(value: T | T[] | undefined): T[] => value == null
  ? []
  : Array.isArray(value) ? value : [value]

const textValue = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && '#text' in value) return textValue((value as Record<string, unknown>)['#text'])
  return ''
}

const namespaced = (object: Record<string, unknown> | undefined, name: string) => {
  if (!object) return ''
  const key = Object.keys(object).find(candidate => candidate === name || candidate.endsWith(`:${name}`))
  return key ? textValue(object[key]) : ''
}

const readZipText = (zip: AdmZip, name: string) => {
  const candidates = [name, decodeURIComponent(name)]
  const entry = candidates.map(candidate => zip.getEntry(candidate)).find(Boolean)
  if (!entry) throw new Error(`EPUB 内缺少文件：${name}`)
  return entry.getData().toString('utf8')
}

const cleanText = (value: string) => value
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

export interface EpubExtraction {
  title?: string
  author?: string
  chapters: StoredChapter[]
}

export const extractEpub = (buffer: Buffer): EpubExtraction => {
  const zip = new AdmZip(buffer)
  const container = xml.parse(readZipText(zip, 'META-INF/container.xml')) as any
  const rootfiles = array(container?.container?.rootfiles?.rootfile)
  const opfPath = rootfiles[0]?.['@_full-path'] as string | undefined
  if (!opfPath) throw new Error('无法定位 EPUB package 文档')

  const packageDoc = xml.parse(readZipText(zip, opfPath)) as any
  const pkg = packageDoc?.package
  const opfDir = path.posix.dirname(opfPath)
  const metadata = pkg?.metadata as Record<string, unknown> | undefined
  const manifestItems = array<any>(pkg?.manifest?.item)
  const manifest = new Map(manifestItems.map(item => [item['@_id'], item]))
  const spine = array<any>(pkg?.spine?.itemref)

  const tocTitles = new Map<string, string>()
  const nav = manifestItems.find(item => String(item['@_properties'] ?? '').split(/\s+/).includes('nav'))
  if (nav?.['@_href']) {
    const navPath = path.posix.join(opfDir, nav['@_href'])
    const $nav = cheerio.load(readZipText(zip, navPath), { xmlMode: true })
    $nav('nav a, a').each((_, element) => {
      const href = $nav(element).attr('href')?.split('#')[0]
      if (!href) return
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(navPath), href))
      tocTitles.set(resolved, cleanText($nav(element).text()))
    })
  }

  const ncx = manifest.get(pkg?.spine?.['@_toc'])
    ?? manifestItems.find(item => item['@_media-type'] === 'application/x-dtbncx+xml')
  if (ncx?.['@_href']) {
    const ncxPath = path.posix.join(opfDir, ncx['@_href'])
    const ncxDoc = xml.parse(readZipText(zip, ncxPath)) as any
    const collectNavPoints = (points: any[]) => {
      for (const point of points) {
        const source = String(point?.content?.['@_src'] ?? '').split('#')[0]
        const label = cleanText(textValue(point?.navLabel?.text))
        if (source && label) {
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(ncxPath), source))
          tocTitles.set(resolved, label)
        }
        collectNavPoints(array(point?.navPoint))
      }
    }
    collectNavPoints(array(ncxDoc?.ncx?.navMap?.navPoint))
  }

  const sections = spine.flatMap<StoredChapter & { tocTitle?: string }>((itemref, index) => {
    const item = manifest.get(itemref['@_idref'])
    if (!item?.['@_href']) return []
    const chapterPath = path.posix.normalize(path.posix.join(opfDir, item['@_href']))
    let html: string
    try {
      html = readZipText(zip, chapterPath)
    } catch {
      return []
    }
    const $ = cheerio.load(html, { xmlMode: true })
    $('script, style, nav[epub\\:type="landmarks"], nav[epub\\:type="toc"]').remove()
    const body = $('body').html() ?? html
    const markdown = cleanText(turndown.turndown(body))
    const plainText = cleanText($('body').text() || $.root().text())
    if (!plainText) return []
    const heading = cleanText($('h1, h2, h3, title').first().text())
    const tocTitle = tocTitles.get(chapterPath)
    const title = tocTitle || heading || `第 ${index + 1} 节`
    return [{ index, title, href: item['@_href'], characters: plainText.length, markdown, text: plainText, tocTitle }]
  })

  const chapters: StoredChapter[] = []
  for (const section of sections) {
    const shouldStart = Boolean(section.tocTitle)
      || chapters.length === 0
      || (tocTitles.size === 0 && section.title && !/^未知$/.test(section.title))
    if (shouldStart) {
      chapters.push({
        index: chapters.length,
        title: section.tocTitle || section.title,
        href: section.href,
        characters: section.characters,
        markdown: section.markdown,
        text: section.text,
      })
    } else {
      const current = chapters.at(-1)!
      current.markdown = `${current.markdown}\n\n${section.markdown}`.trim()
      current.text = `${current.text}\n\n${section.text}`.trim()
      current.characters = current.text.length
    }
  }

  return {
    title: namespaced(metadata, 'title') || undefined,
    author: namespaced(metadata, 'creator') || undefined,
    chapters,
  }
}
