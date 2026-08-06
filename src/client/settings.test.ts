import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings } from './settings.js'

const useStoredValue = (value: string | null) => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  } satisfies Storage)
}

afterEach(() => vi.unstubAllGlobals())

describe('loadSettings', () => {
  it('falls back to defaults for malformed JSON', () => {
    useStoredValue('{not-json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back field by field for invalid persisted values', () => {
    useStoredValue(JSON.stringify({ view: 'pages', fontSize: 99, fontFamily: 'mono', paper: 'blue' }))
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields while replacing invalid ones', () => {
    useStoredValue(JSON.stringify({ view: 'scroll', fontSize: 1.26, fontFamily: 'hei', paper: 'unknown' }))
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, view: 'scroll', fontSize: 1.26, fontFamily: 'hei' })
  })
})
