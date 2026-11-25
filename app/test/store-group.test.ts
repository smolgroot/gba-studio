// The store's grouped step (US-015) with real documents: deleting a collision class
// changes the project, a tileset and a room; undo and redo take all three back and
// forward, and are refused, saying why, when one has been changed since.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORMAT_VERSION, Tileset, editProperty, emptyRoom, newProject, renameClass, renameProperty, rleDecode, rleEncode, withPropertyType, withoutClass } from '@pecten-studio/core'
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

describe('changing a property of an entity type in the store (US-016)', () => {
  const sentry = { id: 'sentry', name: 'Sentry', colour: '#e5484d', props: [{ name: 'shield', type: 'int' as const, default: 3 }, { name: 'mood', type: 'string' as const, default: 'calm' }], behaviours: [] }
  beforeEach(() => {
    const b = bundle()
    const room = { ...docs().rooms.entry!, entities: [{ type: 'sentry', x: 4, y: 4, props: { shield: 7, mood: 'angry' } }, { type: 'sentry', x: 8, y: 4, props: {} }] }
    useStudio.setState({ bundle: { ...b, docs: { ...b.docs, project: { ...b.docs.project!, entityTypes: [sentry] }, rooms: { entry: room } } }, history: {}, notice: null })
  })
  const rooms = () => docs().rooms
  const types = () => docs().project!.entityTypes

  /** What the properties table does for a change of type, with the values it drops. */
  function retype(index: number, to: 'int' | 'bool' | 'string' | 'enum') {
    const plan = editProperty(docs().project!, rooms(), 'sentry', index, withPropertyType(types()[0]!.props[index]!, to))!
    useStudio.getState().commitGroup('the property was changed', { kind: 'project' }, plan.project, Object.entries(plan.rooms).map(([id, doc]) => ({ kind: 'room' as const, id, label: doc.name, doc })))
    return plan.broken
  }

  it('drops the values that no longer fit with the change, as one undo step', () => {
    const first = docs()
    const broken = retype(0, 'bool')
    expect(broken.map((m) => [m.entity, m.name, m.value])).toEqual([[0, 'shield', 7]])
    expect(types()[0]!.props[0]).toEqual({ name: 'shield', type: 'bool', default: false })
    expect(rooms().entry!.entities[0]!.props).toEqual({ mood: 'angry' })
    useStudio.getState().undo()
    expect(docs().project).toBe(first.project)
    expect(docs().rooms.entry).toBe(first.rooms.entry)
    useStudio.getState().redo()
    expect(rooms().entry!.entities[0]!.props).toEqual({ mood: 'angry' })
  })

  it('leaves the rooms alone when the change breaks nothing', () => {
    const first = docs().rooms.entry
    retype(1, 'string') // the same kind
    expect(docs().rooms.entry).toBe(first)
    // Only the project has a step; the room was not part of it.
    expect(Object.keys(useStudio.getState().history)).toEqual(['project:'])
  })

  it('renames the stored values with the property, one undo step across the project and the room', () => {
    const first = docs()
    const change = renameProperty(docs().project!, rooms(), 'sentry', 'shield', 'armour')
    useStudio.getState().commitGroup('the property was renamed', { kind: 'project' }, change.project, Object.entries(change.rooms).map(([id, doc]) => ({ kind: 'room' as const, id, label: doc.name, doc })))
    expect(types()[0]!.props[0]!.name).toBe('armour')
    expect(rooms().entry!.entities[0]!.props).toEqual({ armour: 7, mood: 'angry' })
    useStudio.getState().undo()
    expect(docs().project).toBe(first.project)
    expect(docs().rooms.entry).toBe(first.rooms.entry)
  })

  it('is not undone, with the reason, when a room it changed has been edited since', () => {
    retype(0, 'bool')
    useStudio.getState().commit('room', 'entry', { ...rooms().entry!, name: 'Entry hall' })
    useStudio.getState().undo()
    expect(types()[0]!.props[0]!.type).toBe('bool')
    expect(useStudio.getState().notice).toBe('Not undone: Entry was changed after the property was changed. Undo that change first.')
  })
})

describe('the Entities page in the store (US-019)', () => {
  const sentry = { id: 'sentry', name: 'Sentry', colour: '#e5484d', props: [{ name: 'shield', type: 'int' as const, default: 3 }], behaviours: [] }
  const coin = { id: 'coin', name: 'Coin', colour: '#f5a524', props: [], behaviours: [] }
  beforeEach(() => {
    const b = bundle()
    const room = { ...docs().rooms.entry!, entities: [{ type: 'sentry', x: 4, y: 4, props: { shield: 7 } }] }
    useStudio.setState({ bundle: { ...b, docs: { ...b.docs, project: { ...b.docs.project!, entityTypes: [sentry, coin] }, rooms: { entry: room } } }, history: {}, notice: null, selection: { kind: 'entities', id: 'sentry' } })
  })

  it('undoes and redoes a change to a type made on the page, as one step on the project', () => {
    const first = docs().project
    useStudio.getState().commit('project', undefined, { ...first!, entityTypes: [{ ...sentry, name: 'Sentry bot' }, coin] })
    useStudio.getState().select({ kind: 'entities', id: 'coin' })
    useStudio.getState().undo()
    expect(docs().project).toBe(first)
    useStudio.getState().redo()
    expect(docs().project!.entityTypes[0]!.name).toBe('Sentry bot')
  })

  it('says why a grouped property change was not undone', () => {
    const change = renameProperty(docs().project!, docs().rooms, 'sentry', 'shield', 'armour')
    useStudio.getState().commitGroup('the property was renamed', { kind: 'project' }, change.project, Object.entries(change.rooms).map(([id, doc]) => ({ kind: 'room' as const, id, label: doc.name, doc })))
    useStudio.getState().commit('room', 'entry', { ...docs().rooms.entry!, name: 'Entry hall' })
    useStudio.getState().undo()
    expect(docs().project!.entityTypes[0]!.props[0]!.name).toBe('armour')
    expect(useStudio.getState().notice).toBe('Not undone: Entry was changed after the property was renamed. Undo that change first.')
  })
})
