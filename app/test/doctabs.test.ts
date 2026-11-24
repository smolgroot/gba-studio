import { describe, expect, it } from 'vitest'
import { documentToClose } from '../src/doctabs.ts'

const open = ['project', 'properties', 'doc:room/a', 'doc:sprite/b', 'problems']

describe('the document tab Ctrl+W closes', () => {
  it('is the active panel when that is a document', () => {
    expect(documentToClose({ active: 'doc:sprite/b', selected: 'doc:room/a', open })).toBe('doc:sprite/b')
  })
  it("is the selection's tab when another panel has focus", () => {
    expect(documentToClose({ active: 'properties', selected: 'doc:room/a', open })).toBe('doc:room/a')
    expect(documentToClose({ active: null, selected: 'doc:room/a', open })).toBe('doc:room/a')
  })
  it('is none when no document tab is open', () => {
    const panels = ['project', 'properties', 'problems']
    expect(documentToClose({ active: 'project', selected: 'doc:room/a', open: panels })).toBeNull()
    expect(documentToClose({ active: null, selected: 'doc:room/a', open: [] })).toBeNull()
  })
})
