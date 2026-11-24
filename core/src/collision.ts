// Editing a project's collision classes (US-015): what a class is made of and what
// stands on it. Tilesets name a class by its id; a room's painted collision names it by
// its position in the project's list, plus one; and codegen makes a constant of its id.
// So a class can be added at the end, but deleting or renaming one reaches into the
// tilesets and rooms. See design/US-015.md.
import { rleDecode, rleEncode } from './rle.ts'
import { roomSize } from './room.ts'
import { Id, TILE } from './schema.ts'
import type { CollisionClass, Project, Room, Tileset } from './schema.ts'
import type { Documents } from './validate.ts'

/** The most classes a game can have: a cell's class is one byte, as codegen checks. */
export const MAX_COLLISION_CLASSES = 255

/** The documents collision classes are used by. */
export type ClassDocs = Pick<Documents, 'tilesets' | 'rooms'> & { project: Project }

/** The constant codegen makes of a class's id (`data::class::SOLID`): the same function, in the same words. */
export function codeName(id: string): string {
  const name = [...id].map((c) => (/[A-Za-z0-9]/.test(c) ? c.toUpperCase() : '_')).join('')
  return /^[0-9]/.test(name) ? `_${name}` : name
}

/**
 * Why `next` cannot be the id of the class at `index`, in the author's terms; null if it can.
 * An id is how tilesets name the class and what its constant in the game is called, so it
 * must be valid, unique, and different in code from every other class's.
 */
export function classIdProblem(classes: readonly CollisionClass[], index: number, next: string): string | null {
  const valid = Id.safeParse(next)
  if (!valid.success) return `An id is ${valid.error.issues[0]?.message ?? 'lowercase letters, digits, - and _'}.`
  const others = classes.filter((_, i) => i !== index)
  if (others.some((c) => c.id === next)) return `There is already a class "${next}".`
  const same = others.find((c) => codeName(c.id) === codeName(next))
  if (same) return `"${next}" and "${same.id}" would both be ${codeName(next)} in the game's code.`
  return null
}

/** A class with its kind changed: a slope gets a 45 degree rise to start with, anything else has no heights. */
export function withKind(cls: CollisionClass, kind: CollisionClass['kind']): CollisionClass {
  const { slope: _, ...rest } = cls
  return kind === 'slope' ? { ...rest, kind, slope: cls.slope ?? { left: 0, right: TILE } } : { ...rest, kind }
}

/** A new class for the end of the list, with a free id and a name. */
export function newClass(classes: readonly CollisionClass[]): CollisionClass {
  const taken = new Set(classes.map((c) => c.id))
  const names = new Set(classes.map((c) => codeName(c.id)))
  let id = 'class'
  for (let n = 2; taken.has(id) || names.has(codeName(id)); n++) id = `class-${n}`
  return { id, name: 'New class', colour: '#8e4ec6', kind: 'solid' }
}

/** Which tiles of a tileset name a class, by tile number. */
const tilesNamed = (tileset: Tileset, id: string): number[] => Object.entries(tileset.collision).flatMap(([tile, cls]) => (cls === id ? [Number(tile)] : []))

/**
 * The class each cell of a room has, by its position in `classes`: what was painted over
 * it, else the class of its frontmost tile that has one that is not empty, else the first.
 * As the data section writer makes it, so what is counted here is what the game has.
 */
export function roomCellClasses(room: Room, tileset: Tileset | undefined, classes: readonly CollisionClass[]): { classes: Uint8Array; painted: Uint8Array } {
  const { cols, rows } = roomSize(room)
  const cells = cols * rows
  const out = new Uint8Array(cells)
  const painted = new Uint8Array(cells)
  const layers = room.layers.map((l) => l.data).map((data) => {
    try {
      return rleDecode(data)
    } catch {
      return new Uint16Array(cells)
    }
  })
  let overrides: Uint16Array = new Uint16Array(cells)
  if (room.collision) {
    try {
      overrides = rleDecode(room.collision)
    } catch {
      // Malformed: validation says so, and the cells are counted as unpainted.
    }
  }
  const classOf = (tile: number): number => {
    const id = tileset?.collision[String(tile - 1)]
    const at = id === undefined ? 0 : classes.findIndex((c) => c.id === id)
    return at < 0 ? 0 : at
  }
  for (let i = 0; i < cells; i++) {
    if (overrides[i]! > 0) {
      out[i] = Math.min(overrides[i]! - 1, classes.length - 1)
      painted[i] = 1
      continue
    }
    for (let l = layers.length - 1; l >= 0; l--) {
      const tile = layers[l]![i] ?? 0
      if (tile === 0) continue
      const cls = classOf(tile)
      if (classes[cls] && classes[cls].kind !== 'empty') {
        out[i] = cls
        break
      }
    }
  }
  return { classes: out, painted }
}

/** What uses a class: the tilesets that give tiles to it, and the rooms with cells of it. */
export interface ClassUsage {
  tilesets: { id: string; name: string; tiles: number }[]
  /** `cells` is every cell of the class, `painted` those painted over their tile. */
  rooms: { id: string; name: string; cells: number; painted: number }[]
}

export function classUsage(docs: ClassDocs, id: string): ClassUsage {
  const classes = docs.project.collisionClasses
  const at = classes.findIndex((c) => c.id === id)
  const tilesets = Object.entries(docs.tilesets).flatMap(([key, t]) => {
    const tiles = tilesNamed(t, id).length
    return tiles > 0 ? [{ id: key, name: t.name, tiles }] : []
  })
  const rooms = at < 0 ? [] : Object.entries(docs.rooms).flatMap(([key, room]) => {
    const { classes: cells, painted } = roomCellClasses(room, docs.tilesets[room.tileset], classes)
    let [count, paint] = [0, 0]
    cells.forEach((cls, i) => {
      if (cls !== at) return
      count++
      paint += painted[i]!
    })
    return count > 0 ? [{ id: key, name: room.name, cells: count, painted: paint }] : []
  })
  return { tilesets, rooms }
}

/** The documents a change to the classes made, and only those. */
export interface ClassChange {
  project: Project
  tilesets: Record<string, Tileset>
  rooms: Record<string, Room>
}

/**
 * Why the class cannot be deleted, if it cannot: the first class is what a tile with no
 * class of its own has, so another one would take its place; and a project needs one.
 */
export function classDeleteBlocker(classes: readonly CollisionClass[], id: string): string | null {
  if (!classes.some((c) => c.id === id)) return `There is no class "${id}".`
  if (classes[0]!.id === id) return `"${id}" is the first class, which a tile with no class of its own has. Change its kind or colour instead.`
  return null
}

/**
 * The project without a class, and what used it repointed: a tile that named it has no
 * class of its own again (so it has the first), a cell painted with it follows its tile
 * again, and a cell painted with a class after it counts one less, as the list does.
 */
export function withoutClass(docs: ClassDocs, id: string): ClassChange | { problem: string } {
  const classes = docs.project.collisionClasses
  const blocked = classDeleteBlocker(classes, id)
  if (blocked) return { problem: blocked }
  const at = classes.findIndex((c) => c.id === id)
  const change: ClassChange = { project: { ...docs.project, collisionClasses: classes.filter((_, i) => i !== at) }, tilesets: {}, rooms: {} }
  for (const [key, tileset] of Object.entries(docs.tilesets)) {
    if (tilesNamed(tileset, id).length === 0) continue
    change.tilesets[key] = { ...tileset, collision: Object.fromEntries(Object.entries(tileset.collision).filter(([, cls]) => cls !== id)) }
  }
  for (const [key, room] of Object.entries(docs.rooms)) {
    if (!room.collision) continue
    let cells: Uint16Array
    try {
      cells = rleDecode(room.collision)
    } catch {
      continue
    }
    // A value past the last class is the last class, as the data section reads it.
    const moved = cells.map((v) => {
      if (v === 0) return 0
      const cls = Math.min(v - 1, classes.length - 1)
      return cls === at ? 0 : cls > at ? cls : cls + 1
    })
    if (moved.every((v, i) => v === cells[i])) continue
    change.rooms[key] = { ...room, collision: rleEncode(moved) }
  }
  return change
}

/** The project with one class's id changed, and the tilesets that name it changed with it. */
export function renameClass(docs: ClassDocs, from: string, to: string): ClassChange {
  const change: ClassChange = {
    project: { ...docs.project, collisionClasses: docs.project.collisionClasses.map((c) => (c.id === from ? { ...c, id: to } : c)) },
    tilesets: {},
    rooms: {},
  }
  for (const [key, tileset] of Object.entries(docs.tilesets)) {
    if (tilesNamed(tileset, from).length === 0) continue
    change.tilesets[key] = { ...tileset, collision: Object.fromEntries(Object.entries(tileset.collision).map(([tile, cls]) => [tile, cls === from ? to : cls])) }
  }
  return change
}
