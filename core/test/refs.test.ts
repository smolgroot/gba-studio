// References between placed entities (US-017): ids, the targets the panel offers,
// pointing at one, the lines the map draws, and the problems validation reports.
import { describe, expect, it } from 'vitest'
import {
  Entity, PropertyDef, emptyRoom, entitiesById, entityNumbers, freeEntityId, pointAt, pointersTo, propertyAllows, propertyMisfit, refLinks, refProblems, refTargets, validateProject, withTypes,
} from '../src/index.ts'
import type { Documents, EntityType, Project, Room, World } from '../src/index.ts'

const opens: PropertyDef = { name: 'opens', type: 'ref', default: '', types: ['door'] }
const types: EntityType[] = [
  { id: 'switch', name: 'Switch', colour: '#ffffff', props: [opens, { name: 'anything', type: 'ref', default: '' }], behaviours: [] },
  { id: 'door', name: 'Door', colour: '#000000', props: [], behaviours: [] },
  { id: 'sign', name: 'Sign', colour: '#888888', props: [], behaviours: [] },
]

/** Hall (one screen) has a switch, a door and a sign; cave, to its right on the map, has another door. */
const rooms = (): Record<string, Room> => ({
  hall: { ...emptyRoom('Hall', 1, 1, 'ts'), entities: [
    { type: 'switch', x: 20, y: 100, props: { opens: 'door-1' } },
    { type: 'door', id: 'door-1', x: 200, y: 100, props: {} },
    { type: 'sign', x: 120, y: 100, props: {} },
  ] },
  cave: { ...emptyRoom('Cave', 1, 1, 'ts'), entities: [{ type: 'door', x: 40, y: 100, props: {} }] },
})
const world: World = { version: 1, rooms: [{ room: 'hall', x: 0, y: 0 }, { room: 'cave', x: 1, y: 0 }] }

describe('a ref property', () => {
  it('has the default "" and may be limited to some entity types', () => {
    expect(PropertyDef.safeParse(opens).success).toBe(true)
    expect(PropertyDef.safeParse({ name: 'to', type: 'ref', default: '' }).success).toBe(true)
    expect(PropertyDef.safeParse({ name: 'to', type: 'ref', default: 'door-1' }).success).toBe(false)
    expect(PropertyDef.safeParse({ name: 'to', type: 'ref', default: '', types: [] }).success).toBe(false)
    expect(PropertyDef.safeParse({ name: 'to', type: 'string', default: '', types: ['door'] }).success).toBe(false)
  })

  it('is limited by a list of types, and an empty list lifts the limit', () => {
    expect(withTypes(opens, ['door', 'sign', 'door'])).toEqual({ ...opens, types: ['door', 'sign'] })
    expect(withTypes(opens, [])).toEqual({ name: 'opens', type: 'ref', default: '' })
  })

  it('holds "" or an id, and says so when it does not', () => {
    expect(propertyMisfit(opens, '')).toBeNull()
    expect(propertyMisfit(opens, 'door-1')).toBeNull()
    expect(propertyMisfit(opens, 7)).toBe('opens is 7; it is the id of an entity of type "door", or "" for none')
    expect(propertyMisfit(opens, 'Not An Id')).toBe('opens is "Not An Id"; it is the id of an entity of type "door", or "" for none')
    expect(propertyAllows({ name: 'to', type: 'ref', default: '' })).toBe('the id of an entity, or "" for none')
  })

  it('lets a placed entity store an id', () => {
    expect(Entity.safeParse({ type: 'door', id: 'door-1', x: 0, y: 0 }).success).toBe(true)
    expect(Entity.safeParse({ type: 'door', id: 'Door 1', x: 0, y: 0 }).success).toBe(false)
  })
})

describe('entity ids', () => {
  it('are found by id, and numbered as the game numbers entities: rooms by id, then list order', () => {
    const r = rooms()
    r.cave!.entities[0]!.id = 'door-2'
    expect(entitiesById(r).get('door-1')).toMatchObject({ room: 'hall', index: 1 })
    // cave comes before hall: its door is 0, and hall's entities are 1, 2, 3.
    expect([...entityNumbers(r)]).toEqual([['door-2', 0], ['door-1', 2]])
  })

  it('are given free, from the type, within 48 characters', () => {
    expect(freeEntityId(rooms(), 'door')).toBe('door-2')
    expect(freeEntityId(rooms(), 'sign')).toBe('sign-1')
    const long = 'a'.repeat(48)
    expect(freeEntityId(rooms(), long)).toBe(`${'a'.repeat(46)}-1`)
  })
})

describe('the targets a reference may point at', () => {
  it('are of the allowed types, this room first, never the entity itself', () => {
    const targets = refTargets(rooms(), types, 'hall', 0, opens)
    expect(targets.map((t) => [t.room, t.index, t.here])).toEqual([['hall', 1, true], ['cave', 0, false]])
    expect(targets.map((t) => t.label)).toEqual(['door-1 · Door at 200, 100', 'Door at 40, 100 (entity 0)'])
    expect(refTargets(rooms(), types, 'hall', 0, types[0]!.props[1]!).map((t) => t.index)).toEqual([1, 2, 0])
  })
})

describe('pointing at an entity', () => {
  it('stores its id and changes only that room when the target has one', () => {
    const r = rooms()
    r.hall!.entities[0]!.props = {}
    const changed = pointAt(r, types, 'hall', 0, 'opens', { room: 'hall', index: 1 })
    expect(Object.keys(changed)).toEqual(['hall'])
    expect(changed.hall!.entities[0]!.props).toEqual({ opens: 'door-1' })
  })

  it('gives a target in another room an id, in the same change', () => {
    const changed = pointAt(rooms(), types, 'hall', 0, 'opens', { room: 'cave', index: 0 })
    expect(Object.keys(changed).sort()).toEqual(['cave', 'hall'])
    expect(changed.cave!.entities[0]!.id).toBe('door-2')
    expect(changed.hall!.entities[0]!.props).toEqual({ opens: 'door-2' })
  })

  it('gives a target in the same room an id in the one room it changes', () => {
    const changed = pointAt(rooms(), types, 'hall', 0, 'anything', { room: 'hall', index: 2 })
    expect(Object.keys(changed)).toEqual(['hall'])
    expect(changed.hall!.entities[2]!.id).toBe('sign-1')
    expect(changed.hall!.entities[0]!.props).toEqual({ opens: 'door-1', anything: 'sign-1' })
  })

  it('at nothing drops the stored value, so it has the type\'s ""', () => {
    expect(pointAt(rooms(), types, 'hall', 0, 'opens', null).hall!.entities[0]!.props).toEqual({})
  })

  it('is listed for the target', () => {
    expect(pointersTo(rooms(), types, 'door-1')).toEqual([{ room: 'hall', roomName: 'Hall', index: 0, prop: 'opens' }])
    expect(pointersTo(rooms(), types, 'sign-1')).toEqual([])
  })
})

describe('the lines the map draws', () => {
  it('go from an entity to its target in the same room, and follow a dragged one', () => {
    expect(refLinks(rooms(), types, world, 'hall')).toEqual([{ entity: 0, prop: 'opens', kind: 'here', from: { x: 20, y: 100 }, to: { x: 200, y: 100 }, target: 1 }])
    const dragged = refLinks(rooms(), types, world, 'hall', { index: 1, x: 160, y: 40 })
    expect(dragged[0]).toMatchObject({ to: { x: 160, y: 40 } })
  })

  it('go to the room\'s edge towards a target in another room, with its name', () => {
    const r = pointAt(rooms(), types, 'hall', 0, 'opens', { room: 'cave', index: 0 })
    const links = refLinks({ ...rooms(), ...r }, types, world, 'hall')
    // Cave is to the right on the map, its door at the same height: the line ends on hall's right edge.
    expect(links).toEqual([{ entity: 0, prop: 'opens', kind: 'away', from: { x: 20, y: 100 }, to: { x: 240, y: 100 }, room: 'cave', roomName: 'Cave' }])
  })

  it('are a stub with the name when a room is not on the map', () => {
    const r = { ...rooms(), ...pointAt(rooms(), types, 'hall', 0, 'opens', { room: 'cave', index: 0 }) }
    const links = refLinks(r, types, { version: 1, rooms: [{ room: 'hall', x: 0, y: 0 }] }, 'hall')
    expect(links[0]).toMatchObject({ kind: 'away', to: { x: 44, y: 76 }, roomName: 'Cave' })
  })

  it('are none for a reference to nothing that exists: it is marked missing', () => {
    const r = rooms()
    r.hall!.entities.splice(1, 1)
    expect(refLinks(r, types, world, 'hall')).toEqual([{ entity: 0, prop: 'opens', kind: 'missing', from: { x: 20, y: 100 }, value: 'door-1' }])
  })
})

describe('reference problems', () => {
  const project = (): Project => ({ version: 1, name: 'T', build: { dev: 'x', release: 'x', devRom: 'a.gba', releaseRom: 'b.gba' }, collisionClasses: [{ id: 'empty', name: 'Empty', colour: '#000000', kind: 'empty' }], entityTypes: types, physics: { mode: 'platformer', platformer: {} as never, topDown: {} as never } })
  const docs = (r: Record<string, Room>): Documents => ({ project: project(), tilesets: {}, sprites: {}, rooms: r })

  it('are none for good references and for none', () => {
    expect(refProblems(docs(rooms()))).toEqual([])
  })

  it('report a reference to a deleted entity in the room that points', () => {
    const r = rooms()
    r.hall!.entities.splice(1, 1)
    expect(refProblems(docs(r))).toEqual([{ file: 'studio/rooms/hall.json', message: 'entity 0 (switch): opens points at "door-1", which no entity has. It was deleted, or its id changed: pick another target or set it to None' }])
  })

  it('are errors in validation, which Problems shows', () => {
    const r = rooms()
    r.hall!.entities.splice(1, 1)
    const found = validateProject(docs(r), () => true).filter((p) => p.message.includes('points at'))
    expect(found).toEqual([{ severity: 'error', file: 'studio/rooms/hall.json', message: 'entity 0 (switch): opens points at "door-1", which no entity has. It was deleted, or its id changed: pick another target or set it to None' }])
  })

  it('report a target of a type the reference may not point at, an id used twice, and a limit naming no type', () => {
    const r = rooms()
    r.hall!.entities[2]!.id = 'sign-1'
    r.hall!.entities[0]!.props.opens = 'sign-1'
    r.cave!.entities[0]!.id = 'door-1'
    const d = docs(r)
    d.project!.entityTypes = [{ ...types[0]!, props: [{ ...opens, types: ['door', 'gate'] }] }, types[1]!, types[2]!]
    expect(refProblems(d).map((p) => `${p.file}: ${p.message}`)).toEqual([
      'studio/project.json: entity type "switch": property "opens" may point at type "gate", which the project does not have',
      'studio/rooms/hall.json: entity 0 (switch): opens points at "sign-1", of type "sign"; it may point at type "door" or "gate"',
      'studio/rooms/hall.json: entity 1 (door) has id "door-1", which entity 0 of cave has too; an id names one entity, so change or remove one of them',
    ])
  })
})
