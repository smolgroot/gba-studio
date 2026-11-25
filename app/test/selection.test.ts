// The Entities page's address and tab (US-019): `#entities:<type id>` comes back on a
// reload or from a link, and every type shows in the one Entities tab.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let store: typeof import('../src/store.ts')
let sidebar: typeof import('../src/sidebar.ts')
const at = { hash: '' }

beforeAll(async () => {
  vi.stubGlobal('location', at)
  vi.stubGlobal('history', { replaceState: () => undefined })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
  store = await import('../src/store.ts')
  sidebar = await import('../src/sidebar.ts')
})
afterAll(() => vi.unstubAllGlobals())

const from = (hash: string) => {
  at.hash = hash
  return store.selectionFromHash()
}

describe('the Entities page address', () => {
  it('names the type it shows', () => {
    expect(from('#entities:sentry-bot')).toEqual({ kind: 'entities', id: 'sentry-bot' })
  })
  it('opens on no type, so the page shows the first', () => {
    expect(from('#entities')).toEqual({ kind: 'entities' })
  })
  it('still opens Project settings at #project', () => {
    expect(from('#project')).toEqual({ kind: 'project' })
  })
  it('is one tab for every type, called Entities', () => {
    expect(store.tabKey({ kind: 'entities', id: 'a' })).toBe(store.tabKey({ kind: 'entities', id: 'b' }))
    expect(store.tabKey({ kind: 'entities' })).toBe(store.tabKey({ kind: 'entities', id: 'b' }))
    expect(store.tabKey({ kind: 'room', id: 'a' })).not.toBe(store.tabKey({ kind: 'room', id: 'b' }))
    expect(store.selectionTitle({ kind: 'entities', id: 'a' }, null)).toBe('Entities')
  })
  it('edits the project file, so undo acts on the project', () => {
    expect(store.editedDoc({ kind: 'entities', id: 'a' })).toEqual({ kind: 'project' })
  })
})

describe('the sidebar', () => {
  it('has Entity types after Sprites', () => {
    expect(sidebar.SECTIONS.indexOf('Entity types')).toBe(sidebar.SECTIONS.indexOf('Sprites') + 1)
  })
})
