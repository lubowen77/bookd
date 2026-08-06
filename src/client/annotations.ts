import type { Annotation } from '../shared'

export const upsertAnnotation = (list: Annotation[], item: Annotation): Annotation[] =>
  list.some(existing => existing.id === item.id)
    ? list.map(existing => existing.id === item.id ? item : existing)
    : [...list, item]
