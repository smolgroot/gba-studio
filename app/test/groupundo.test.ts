import { describe, expect, it } from 'vitest'
import { GroupLinks } from '../src/groupundo.ts'

// The documents a group changed: a project (the owner) and two others, as plain objects.
const project0 = { v: 0 }
const project1 = { v: 1 }
const tileset0 = { v: 'a' }
const tileset1 = { v: 'b' }
const entry0 = { v: 'x' }
const entry1 = { v: 'y' }

/** The others as the studio holds them: by what they are, changing as writes are made. */
function held(initial: Record<string, unknown>) {
  const docs = { ...initial }
  const key = (kind: string, id?: string) => `${kind}:${id ?? ''}`
  return { docs, read: (kind: string, id?: string) => docs[key(kind, id)], write: (w: { kind: string; id?: string; doc: unknown }) => void (docs[key(w.kind, w.id)] = w.doc), key }
}

const companions = [
  { kind: 'tileset', id: 'ts', label: 'Placeholder tiles', before: tileset0, after: tileset1 },
  { kind: 'room', id: 'entry', label: 'Entry', before: entry0, after: entry1 },
]

function setup() {
  const links = new GroupLinks()
  links.record(project0, project1, 'the class was deleted', companions)
  const others = held({ 'tileset:ts': tileset1, 'room:entry': entry1 })
  return { links, others }
}

describe('a group of changes', () => {
  it('is nothing to the others when the owner moves between versions that were not a group', () => {
    const { links, others } = setup()
    expect(links.step({ v: 5 }, { v: 4 }, others.read)).toEqual({ ok: true, writes: [] })
    expect(links.step(project0, { v: 9 }, others.read)).toEqual({ ok: true, writes: [] })
    expect(links.step(null, undefined, others.read)).toEqual({ ok: true, writes: [] })
  })

  it('puts the others back with the owner on undo, and forward again on redo', () => {
    const { links, others } = setup()
    const undone = links.step(project1, project0, others.read)
    expect(undone).toEqual({ ok: true, writes: [{ kind: 'tileset', id: 'ts', doc: tileset0 }, { kind: 'room', id: 'entry', doc: entry0 }] })
    if (!undone.ok) throw new Error('refused')
    undone.writes.forEach(others.write)
    const redone = links.step(project0, project1, others.read)
    expect(redone).toEqual({ ok: true, writes: [{ kind: 'tileset', id: 'ts', doc: tileset1 }, { kind: 'room', id: 'entry', doc: entry1 }] })
    if (!redone.ok) throw new Error('refused')
    redone.writes.forEach(others.write)
    // And back again: a group can be undone and redone as often as the author likes.
    expect(links.step(project1, project0, others.read)).toMatchObject({ ok: true })
  })

  it('is refused, saying which, when another has been changed since', () => {
    const { links, others } = setup()
    others.write({ kind: 'room', id: 'entry', doc: { v: 'z' } })
    expect(links.step(project1, project0, others.read)).toEqual({ ok: false, reason: 'Entry was changed after the class was deleted. Undo that change first.' })
    others.write({ kind: 'tileset', id: 'ts', doc: { v: 'c' } })
    expect(links.step(project1, project0, others.read)).toEqual({ ok: false, reason: 'Placeholder tiles and Entry were changed after the class was deleted. Undo that change first.' })
  })

  it('is refused the same way on redo, if one was changed after the undo', () => {
    const { links, others } = setup()
    const undone = links.step(project1, project0, others.read)
    if (!undone.ok) throw new Error('refused')
    undone.writes.forEach(others.write)
    others.write({ kind: 'tileset', id: 'ts', doc: { v: 'edited' } })
    expect(links.step(project0, project1, others.read)).toMatchObject({ ok: false })
  })

  it('keeps two groups apart when one version of the owner is the end of one and the start of the next', () => {
    const links = new GroupLinks()
    const project2 = { v: 2 }
    const tileset2 = { v: 'c' }
    links.record(project0, project1, 'the class was deleted', [{ kind: 'tileset', id: 'ts', label: 'Tiles', before: tileset0, after: tileset1 }])
    links.record(project1, project2, 'an id was renamed', [{ kind: 'tileset', id: 'ts', label: 'Tiles', before: tileset1, after: tileset2 }])
    const others = held({ 'tileset:ts': tileset2 })
    // Undo the rename, then the delete, redo the delete, undo the rename again: each uses its own group.
    for (const [from, to, expected] of [[project2, project1, tileset1], [project1, project0, tileset0], [project0, project1, tileset1], [project1, project2, tileset2], [project2, project1, tileset1]] as const) {
      const step = links.step(from, to, others.read)
      if (!step.ok) throw new Error(step.reason)
      expect(step.writes).toEqual([{ kind: 'tileset', id: 'ts', doc: expected }])
      step.writes.forEach(others.write)
    }
  })
})
