const bookDocumentPolicy = [
  "default-src 'none'",
  "img-src blob: data:",
  "media-src blob: data:",
  "font-src blob: data:",
  "style-src 'unsafe-inline' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export const hardenBookDocument = (source: string) => {
  let safe = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(?:["']\s*)?content-security-policy\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src|xlink:href)\s*=\s*(?:(["'])\s*javascript:[\s\S]*?\1|javascript:[^\s>]+)/gi, ' href="#"')

  const meta = `<meta http-equiv="Content-Security-Policy" content="${bookDocumentPolicy}" />`
  if (/<head\b[^>]*>/i.test(safe)) {
    safe = safe.replace(/<head\b[^>]*>/i, match => `${match}${meta}`)
  } else if (/<html\b[^>]*>/i.test(safe)) {
    safe = safe.replace(/<html\b[^>]*>/i, match => `${match}<head>${meta}</head>`)
  } else {
    safe = `${meta}${safe}`
  }
  return safe
}
