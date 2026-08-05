declare module 'foliate-js/view.js'
declare module 'foliate-js/overlayer.js' {
  export const Overlayer: {
    highlight: (...args: unknown[]) => unknown
    outline: (...args: unknown[]) => unknown
  }
}

interface FoliateViewElement extends HTMLElement {
  book: any
  renderer: any
  lastLocation: any
  open(file: File | string): Promise<void>
  close(): void
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number | { fraction: number }): Promise<any>
  goToFraction(fraction: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  getCFI(index: number, range?: Range): string
  getProgressOf(index: number, range?: Range): { tocItem?: { label?: string } }
  addAnnotation(annotation: { value: string; color?: string; note?: string }): Promise<unknown>
  deleteAnnotation(annotation: { value: string }): Promise<unknown>
}
