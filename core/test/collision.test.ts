// Editing collision classes (US-015): what a class is made of and what stands on it.
import { describe, expect, it } from 'vitest'
import {
  CollisionClass, FORMAT_VERSION, MAX_COLLISION_CLASSES, Tileset, classDeleteBlocker, classIdProblem, classUsage, codeName, emptyRoom, newClass, newProject, renameClass,
  rleDecode, rleEncode, roomCellClasses, withKind, withoutClass, writeSection,
} from '../src/index.ts'
import type { ClassDocs, CollisionClass as Class, Manifest, Room } from '../src/index.ts'
import { readCollision, readSection } from '../src/datasection.ts'

const classes: Class[] = [
  { id: 'empty', name: 'Empty', colour: '#000000', kind: 'empty' },
  { id: 'solid', name: 'Solid', colour: '#e5484d', kind: 'solid' },
  { id: 'ledge', name: 'Ledge', colour: '#f5d90a', kind: 'oneway' },
  { id: 'spikes', name: 'Spikes', colour: '#d6409f', kind: 'hazard' },
  { id: 'door', name: 'Door', colour: '#4c9ffe', kind: 'custom' },
]

/** A one-screen room (30 by 20 cells): a floor of tile 0, spikes (tile 2) at the right of the top row, and cells painted over. */
function room(name: string, paint: Record<number, number> = {}): Room {
  const cells = new Array<number>(600).fill(0)
  for (let col = 0; col < 30; col++) cells[19 * 30 + col] = 1 // tile 0: solid
  for (let col = 25; col < 30; col++) cells[col] = 3 // tile 2: spikes
  const collision = new Array<number>(600).fill(0)
  for (const [cell, cls] of Object.entries(paint)) collision[Number(cell)] = cls + 1
  return { ...emptyRoom(name, 1, 1, 'ts'), layers: [{ name: 'Ground', data: rleEncode(cells) }], collision: Object.keys(paint).length ? rleEncode(collision) : undefined }
}

const tileset = Tileset.parse({ version: FORMAT_VERSION, name: 'Placeholder tiles', image: 'assets/ts.png', collision: { 0: 'solid', 1: 'ledge', 2: 'spikes' } })
const docs = (): ClassDocs => {
  const { project } = newProject('T')
  return {
    project: { ...project, collisionClasses: classes },
    tilesets: { ts: tileset },
    // "entry" paints a ledge in the air (class 2), a door (class 4) and spikes (class 3); "shaft" paints nothing.
    rooms: { entry: room('Entry', { 100: 2, 101: 4, 102: 3 }), shaft: room('Shaft') },
  }
}

describe('a class id', () => {
  it('is accepted when it is valid and free', () => {
    expect(classIdProblem(classes, 1, 'wall')).toBeNull()
    expect(classIdProblem(classes, 1, 'solid')).toBeNull() // its own, unchanged
  })

  it('is refused when it is not a valid id, saying what is', () => {
    expect(classIdProblem(classes, 1, 'Wall')).toContain('lowercase letters, digits')
    expect(classIdProblem(classes, 1, '')).toContain('lowercase letters, digits')
    expect(classIdProblem(classes, 1, 'a'.repeat(49))).toContain('max 48')
  })

  it('is refused when another class has it, or has the same name in code', () => {
    expect(classIdProblem(classes, 1, 'ledge')).toBe('There is already a class "ledge".')
    expect(classIdProblem([...classes, { ...classes[1]!, id: 'wall-top' }], 1, 'wall_top')).toBe('"wall_top" and "wall-top" would both be WALL_TOP in the game\'s code.')
  })

  it('has the name in code that codegen gives it', () => {
    expect(codeName('solid')).toBe('SOLID')
    expect(codeName('slope-up')).toBe('SLOPE_UP')
    expect(codeName('1st')).toBe('_1ST')
  })
})

describe('a class\'s own fields', () => {
  const slope = { ...classes[1]!, kind: 'slope' as const, slope: { left: 2, right: 6 } }

  it('gives a new slope a 45 degree rise, and keeps heights it already has', () => {
    expect(withKind(classes[1]!, 'slope').slope).toEqual({ left: 0, right: 8 })
    expect(withKind(slope, 'slope').slope).toEqual({ left: 2, right: 6 })
  })

  it('drops the heights when the kind is not slope, as the schema needs', () => {
    expect(withKind(slope, 'hazard')).not.toHaveProperty('slope')
    expect(CollisionClass.safeParse(withKind(slope, 'hazard')).success).toBe(true)
    expect(CollisionClass.safeParse(withKind(classes[1]!, 'slope')).success).toBe(true)
  })

  it('adds a new class with a free id, name in code and a valid shape', () => {
    const first = newClass(classes)
    expect(first).toMatchObject({ id: 'class', kind: 'solid' })
    expect(CollisionClass.safeParse(first).success).toBe(true)
    expect(newClass([...classes, first]).id).toBe('class-2')
    // `class_2` is taken in code by `class-2`, so a new one skips it.
    expect(newClass([...classes, { ...first, id: 'class' }, { ...first, id: 'class_2' }]).id).toBe('class-3')
  })

  it('has a limit of 255, as codegen does', () => {
    expect(MAX_COLLISION_CLASSES).toBe(255)
  })
})

describe('what uses a class', () => {
  it('lists the tilesets that give it tiles, and the rooms with cells of it, painted or from a tile', () => {
    expect(classUsage(docs(), 'solid')).toEqual({
      tilesets: [{ id: 'ts', name: 'Placeholder tiles', tiles: 1 }],
      // The 30 floor cells of each room.
      rooms: [{ id: 'entry', name: 'Entry', cells: 30, painted: 0 }, { id: 'shaft', name: 'Shaft', cells: 30, painted: 0 }],
    })
    // Five cells of tile 2 in each room, and one painted in "entry".
    expect(classUsage(docs(), 'spikes').rooms).toEqual([{ id: 'entry', name: 'Entry', cells: 6, painted: 1 }, { id: 'shaft', name: 'Shaft', cells: 5, painted: 0 }])
  })

  it('counts a class that is only painted, and has no tilesets', () => {
    expect(classUsage(docs(), 'door')).toEqual({ tilesets: [], rooms: [{ id: 'entry', name: 'Entry', cells: 1, painted: 1 }] })
  })

  it('has no uses for a class nothing mentions, or one that is not there', () => {
    const none = { ...docs(), rooms: { shaft: room('Shaft') }, tilesets: { ts: { ...tileset, collision: {} } } }
    expect(classUsage(none, 'door')).toEqual({ tilesets: [], rooms: [] })
    expect(classUsage(docs(), 'ghost')).toEqual({ tilesets: [], rooms: [] })
  })

  it('counts cells as the data section gives them: a tile of an empty class shows the one behind it', () => {
    const behind: Room = { ...room('Behind'), layers: [{ name: 'Back', data: rleEncode(new Array<number>(600).fill(1)) }, { name: 'Front', data: rleEncode(new Array<number>(600).fill(0).map((_, i) => (i === 0 ? 4 : 0))) }] }
    // Tile 3 has no class of its own, so it has the first (empty), and the tile behind it shows.
    expect(roomCellClasses(behind, tileset, classes).classes[0]).toBe(1)
  })
})

describe('deleting a class', () => {
  it('is refused for the first class, and for one that is not there', () => {
    expect(classDeleteBlocker(classes, 'empty')).toContain('the first class')
    expect(classDeleteBlocker(classes, 'ghost')).toBe('There is no class "ghost".')
    expect(withoutClass(docs(), 'empty')).toHaveProperty('problem')
    expect(classDeleteBlocker(classes, 'door')).toBeNull()
  })

  it('takes the class out of the project, and its tiles out of the tilesets', () => {
    const change = withoutClass(docs(), 'ledge')
    if ('problem' in change) throw new Error(change.problem)
    expect(change.project.collisionClasses.map((c) => c.id)).toEqual(['empty', 'solid', 'spikes', 'door'])
    expect(change.tilesets.ts!.collision).toEqual({ 0: 'solid', 2: 'spikes' })
    // Nothing else changed in the tileset: a tileset that did not name the class is not in the answer.
    expect(change.tilesets.ts!.name).toBe('Placeholder tiles')
    const other = withoutClass({ ...docs(), tilesets: { ts: { ...tileset, collision: { 0: 'solid' } } } }, 'ledge')
    if ('problem' in other) throw new Error(other.problem)
    expect(other.tilesets).toEqual({})
  })

  it('sends cells painted with it back to their tile, and counts the later classes down by one', () => {
    const change = withoutClass(docs(), 'ledge')
    if ('problem' in change) throw new Error(change.problem)
    const painted = rleDecode(change.rooms.entry!.collision!)
    // Cell 100 was the ledge (class 2): back to its tile. Cell 101 was the door (4): now 3, painted as 3 + 1. Cell 102 was spikes (3): now 2.
    expect([painted[100], painted[101], painted[102]]).toEqual([0, 4, 3])
    expect(change.rooms.shaft).toBeUndefined()
  })

  it('leaves the cells painted with earlier classes as they were', () => {
    const change = withoutClass(docs(), 'door')
    if ('problem' in change) throw new Error(change.problem)
    const painted = rleDecode(change.rooms.entry!.collision!)
    expect([painted[100], painted[101], painted[102]]).toEqual([3, 0, 4])
  })

  it('reads a painted class past the last one as the last, as the game does, and does not keep it', () => {
    const odd = { ...docs(), rooms: { entry: { ...room('Entry'), collision: rleEncode(new Array<number>(600).fill(0).map((_, i) => (i === 0 ? 99 : 0))) } } }
    const change = withoutClass(odd, 'door')
    if ('problem' in change) throw new Error(change.problem)
    expect(rleDecode(change.rooms.entry!.collision!)[0]).toBe(0)
  })

  // The project as the game is built from it: each cell's class id, from the data section.
  const cellIds = (project: ClassDocs['project'], tilesets: ClassDocs['tilesets'], rooms: ClassDocs['rooms']) => {
    const manifest: Manifest = { entityTypes: [], tilesets: [{ id: 'ts', tiles: 4, palettes: 1 }], pictures: [], tracks: [] }
    const { world, audio } = newProject('T')
    const written = writeSection({ project, world, audio, tilesets, sprites: {}, rooms }, manifest, 1 << 16)
    if ('problems' in written) throw new Error(written.problems.join('; '))
    const rom = new Uint8Array(written.bytes)
    const read = readCollision(rom, readSection(rom)!)
    return read.rooms.map((r) => Array.from(r.cells, (cls) => read.classes[cls]!.id))
  }

  it('leaves every cell the class it was, in the data the game is built from, except those that had the deleted one', () => {
    const before = docs()
    const change = withoutClass(before, 'ledge')
    if ('problem' in change) throw new Error(change.problem)
    const after = cellIds(change.project, { ...before.tilesets, ...change.tilesets }, { ...before.rooms, ...change.rooms })
    const was = cellIds(before.project, before.tilesets, before.rooms)
    expect(after).toHaveLength(was.length)
    was.forEach((cells, r) => {
      cells.forEach((id, i) => {
        if (id !== 'ledge') expect(after[r]![i], `room ${r} cell ${i}`).toBe(id)
        else expect(after[r]![i], `room ${r} cell ${i}`).not.toBe('ledge')
      })
    })
    // The painted ledge followed its tile (nothing: empty), and the ledge's tile in the tileset is gone.
    expect(after[0]![100]).toBe('empty')
  })

  it('does the same for a class in the middle with a painted class after it, and for the last class', () => {
    for (const id of ['spikes', 'door']) {
      const before = docs()
      const change = withoutClass(before, id)
      if ('problem' in change) throw new Error(change.problem)
      const after = cellIds(change.project, { ...before.tilesets, ...change.tilesets }, { ...before.rooms, ...change.rooms })
      const was = cellIds(before.project, before.tilesets, before.rooms)
      was.forEach((cells, r) => cells.forEach((cell, i) => cell !== id && expect(after[r]![i], `${id} room ${r} cell ${i}`).toBe(cell)))
    }
  })
})

describe('renaming a class', () => {
  it('changes the project and the tilesets that name it, and nothing else', () => {
    const change = renameClass(docs(), 'ledge', 'platform')
    expect(change.project.collisionClasses.map((c) => c.id)).toEqual(['empty', 'solid', 'platform', 'spikes', 'door'])
    expect(change.project.collisionClasses[2]).toMatchObject({ name: 'Ledge', kind: 'oneway' })
    expect(change.tilesets.ts!.collision).toEqual({ 0: 'solid', 1: 'platform', 2: 'spikes' })
    expect(change.rooms).toEqual({})
  })

  it('leaves out a tileset that does not name it', () => {
    expect(renameClass(docs(), 'door', 'exit').tilesets).toEqual({})
  })

  it('keeps every cell its class in the data section: only the id changed', () => {
    const before = docs()
    const change = renameClass(before, 'ledge', 'platform')
    const ids = (d: ClassDocs) => {
      const manifest: Manifest = { entityTypes: [], tilesets: [{ id: 'ts', tiles: 4, palettes: 1 }], pictures: [], tracks: [] }
      const { world, audio } = newProject('T')
      const written = writeSection({ ...d, world, audio, sprites: {} }, manifest, 1 << 16)
      if ('problems' in written) throw new Error(written.problems.join('; '))
      const rom = new Uint8Array(written.bytes)
      return readCollision(rom, readSection(rom)!).rooms.map((r) => Array.from(r.cells))
    }
    expect(ids({ project: change.project, tilesets: { ...before.tilesets, ...change.tilesets }, rooms: before.rooms })).toEqual(ids(before))
  })
})
