// The store's grouped step (US-015) with real documents: deleting a collision class
// changes the project, a tileset and a room; undo and redo take all three back and
// forward, and are refused, saying why, when one has been changed since.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORMAT_VERSION, Tileset, emptyRoom, newProject, renameClass, rleDecode, rleEncode, withoutClass } from '@pecten-studio/core'
import type { Bundle } from '../src/api.ts'

let useStudio: typeof import('../src/store.ts').useStudio
let flushSaves: typeof import('../src/store.ts').flushSaves
const saved: string[] = []

beforeAll(async () => {
  // The store reads the page's address when it is made and saves with fetch.
  vi.stubGlobal('location', { hash: '#project' })
  vi.stubGlobal('history', { replaceState: () => undefined })
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    saved.push(`${init?.method ?? 'GET'} ${url}`)
    return { ok: true, json: async () => ({ ok: true }), text: async () => '' }
  })
  ;({ useStudio, flushSaves } = await import('../src/store.ts'))
})
afterAll(() => vi.unstubAllGlobals())

function bundle(): Bundle {
  const { project, world, audio } = newProject('T')
  const cells = new Array<number>(600).fill(0)
  const painted = new Array<number>(600).fill(0)
  painted[5] = 3 // class 2 (index 2), which the test deletes
  painted[6] = 5 // the class after it
  const room = { ...emptyRoom('Entry', 1, 1, 'ts'), layers: [{ name: 'Ground', data: rleEncode(cells) }], collision: rleEncode(painted) }
  return {
    folder: '/g',
    initialised: true,
    docs: {
      project: { ...project, collisionClasses: [...project.collisionClasses] },
      world,
      audio,
      tilesets: { ts: Tileset.parse({ version: FORMAT_VERSION, name: 'Tiles', image: 'a.png', collision: { 0: 'oneway', 1: 'solid' } }) },
      sprites: {},
      rooms: { entry: room },
    },
    problems: [],
    assets: [],
    art: {},
  } as unknown as Bundle
}

beforeEach(() => {
  saved.length = 0
  useStudio.setState({ bundle: bundle(), history: {}, selection: { kind: 'project' }, notice: null })
})

const docs = () => useStudio.getState().bundle!.docs
/** The change the Delete button makes, for the class with this id. */
function deleteClass(id: string) {
  const d = docs()
  const change = withoutClass({ project: d.project!, tilesets: d.tilesets, rooms: d.rooms }, id)
  if ('problem' in change) throw new Error(change.problem)
  useStudio.getState().commitGroup(`the class “${id}” was deleted`, { kind: 'project' }, change.project, [
    ...Object.entries(change.tilesets).map(([key, doc]) => ({ kind: 'tileset' as const, id: key, label: doc.name, doc })),
    ...Object.entries(change.rooms).map(([key, doc]) => ({ kind: 'room' as const, id: key, label: doc.name, doc })),
  ])
}

describe('deleting a class in the store', () => {
  it('changes the project, the tileset and the room together, and saves all three', async () => {
    deleteClass('oneway')
    await flushSaves()
    expect(saved.filter((s) => s.startsWith('PUT')).sort()).toEqual(['PUT /api/doc/project', 'PUT /api/doc/room/entry', 'PUT /api/doc/tileset/ts'])
    expect(docs().project!.collisionClasses.map((c) => c.id)).not.toContain('oneway')
    expect(docs().tilesets.ts!.collision).toEqual({ 1: 'solid' })
    expect(Array.from(rleDecode(docs().rooms.entry!.collision!).slice(5, 7))).toEqual([0, 4])
    expect(useStudio.getState().history['project:']!.past).toHaveLength(1)
  })

  it('is one undo step: all three come back, and redo does it again', () => {
    const before = bundle().docs
    const first = docs()
    deleteClass('oneway')
    const after = docs()
    useStudio.getState().undo()
    expect(docs().project).toBe(first.project)
    expect(docs().tilesets.ts).toBe(first.tilesets.ts)
    expect(docs().rooms.entry).toBe(first.rooms.entry)
    expect(docs().project!.collisionClasses).toEqual(before.project!.collisionClasses)
    useStudio.getState().redo()
    expect(docs().project).toBe(after.project)
    expect(docs().tilesets.ts).toBe(after.tilesets.ts)
    expect(docs().rooms.entry).toBe(after.rooms.entry)
    expect(useStudio.getState().notice).toBeNull()
  })

  it('is not undone, with the reason, when a room it changed has been changed since', () => {
    deleteClass('oneway')
    const edited = { ...docs().rooms.entry!, name: 'Entry hall' }
    useStudio.getState().commit('room', 'entry', edited)
    useStudio.getState().undo()
    expect(docs().project!.collisionClasses.map((c) => c.id)).not.toContain('oneway')
    expect(docs().rooms.entry).toBe(edited)
    expect(useStudio.getState().notice).toBe('Not undone: Entry was changed after the class “oneway” was deleted. Undo that change first.')
  })

  it('goes ahead once that change is undone, and the notice goes with the next step', () => {
    deleteClass('oneway')
    useStudio.getState().commit('room', 'entry', { ...docs().rooms.entry!, name: 'Entry hall' })
    useStudio.getState().undo()
    // Undo the room edit in the room's own history, then the project's.
    useStudio.getState().select({ kind: 'room', id: 'entry' })
    expect(useStudio.getState().notice).toBeNull()
    useStudio.getState().undo()
    useStudio.getState().select({ kind: 'project' })
    useStudio.getState().undo()
    expect(docs().project!.collisionClasses.map((c) => c.id)).toContain('oneway')
    expect(docs().tilesets.ts!.collision).toEqual({ 0: 'oneway', 1: 'solid' })
    expect(Array.from(rleDecode(docs().rooms.entry!.collision!).slice(5, 7))).toEqual([3, 5])
  })

  it('leaves a document the group did not change out of it', () => {
    // "slope-down" is used by nothing: only the room, which paints classes after it, changes.
    deleteClass('slope-down')
    expect(Object.keys(useStudio.getState().history)).toEqual(['project:'])
    const tileset = docs().tilesets.ts
    useStudio.getState().undo()
    expect(docs().tilesets.ts).toBe(tileset)
  })
})

describe('changing a class id in the store', () => {
  it('changes the project and the tileset that names it as one step, and undo puts both back', () => {
    const first = docs()
    const d = docs()
    const change = renameClass({ project: d.project!, tilesets: d.tilesets, rooms: d.rooms }, 'oneway', 'platform')
    useStudio.getState().commitGroup('the id “oneway” was changed', { kind: 'project' }, change.project, Object.entries(change.tilesets).map(([id, doc]) => ({ kind: 'tileset' as const, id, label: doc.name, doc })))
    expect(docs().tilesets.ts!.collision).toEqual({ 0: 'platform', 1: 'solid' })
    expect(docs().rooms.entry).toBe(first.rooms.entry)
    useStudio.getState().undo()
    expect(docs().project).toBe(first.project)
    expect(docs().tilesets.ts).toBe(first.tilesets.ts)
  })
})
