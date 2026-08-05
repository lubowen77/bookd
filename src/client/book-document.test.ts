import { describe, expect, it } from 'vitest'
import { hardenBookDocument } from './book-document.js'

describe('hardenBookDocument', () => {
  it('removes executable book markup and replaces a weak CSP', () => {
    const source = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body onload="window.bad=1"><script>window.bad=2</script><script src="https://bad.example/x.js"/><a href="javascript:alert(1)">x</a><img src=x onerror=alert(2) /></body></html>`
    const result = hardenBookDocument(source)

    expect(result).not.toMatch(/<script/i)
    expect(result).not.toMatch(/\son(?:load|error)\s*=/i)
    expect(result).not.toMatch(/javascript:/i)
    expect(result).not.toContain('default-src *')
    expect(result).toContain("default-src 'none'")
    expect(result).toContain("connect-src 'none'")
    expect(result).toContain("form-action 'none'")
  })
})
