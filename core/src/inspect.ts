// The live entity list (US-021a): what a running game holds, read from the emulator's
// memory through the debug map, and named from the running ROM's data section. See
// design/US-021.md and docs/reference/debug-map.md.
import { readPlacements, readSection } from './datasection.ts'
import type { PlacedProperty, PlacedRoom } from './datasection.ts'
import { RAM_REGIONS, readField, readGameState } from './debugmap.ts'
import type { DebugField, DebugMap } from './debugmap.ts'
import type { LiveTarget } from './liveapply.ts'

/** A room and where it is on the world map, in world pixels. */
export type RoomPlace = PlacedRoom

/** What the running ROM says about its rooms and entities, read once per ROM. */
export interface SectionIndex {
  rooms: RoomPlace[]
  /** Entity type ids, by the number the game gives each type. */
  types: string[]
  /** Each entity's properties as placed, by its number in the world. */
  entities: { properties: PlacedProperty[] }[]
}

/** Reads what the list needs from a ROM's data section; null when it has none. Call it again after a live apply. */
export function indexSection(rom: Uint8Array): SectionIndex | null {
  const section = readSection(rom)
  if (!section) return null
  const { rooms, entities } = readPlacements(rom, section)
  return { rooms, types: section.manifest.entityTypes.map((t) => t.id), entities }
}

/** The most rooms active at once, as `pecten_studio_rt::behaviour::live::MAX_ACTIVE_ROOMS`. */
const MAX_ACTIVE_ROOMS = 16

/** Whether two rectangles overlap or share an edge or a corner, as the runtime's `touch`. */
const touch = (a: RoomPlace, b: RoomPlace) => a.left <= b.left + b.width && b.left <= a.left + a.width && a.top <= b.top + b.height && b.top <= a.top + a.height

/**
 * The rooms whose entities the game runs with the player in room `here`: that room,
 * then the rooms touching it on the map by number, at most 16, as
 * `LiveEntities::enter` makes them. `codegen/fixture/active-rooms.txt` holds both to it.
 */
export function activeRooms(rooms: readonly RoomPlace[], here: number): number[] {
  const room = rooms[here]
  if (!room) return []
  const active = [here]
  if (!room.onMap) return active
  rooms.forEach((other, i) => {
    if (i !== here && other.onMap && touch(room, other) && active.length < MAX_ACTIVE_ROOMS) active.push(i)
  })
  return active
}

/** The player: its body's top-left corner and size in world pixels, speeds in 1/256 pixel a frame. */
export interface LivePlayer {
  kind: 'player'
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
  onGround: boolean
  hitWall: boolean
  hitCeiling: boolean
}

/** A live entity: its feet in world pixels, speeds in whole pixels a frame, its hitbox from its feet. */
export interface LiveEntityRow {
  kind: 'entity'
  /** Its number in the world, as the data section numbers entities. */
  index: number
  type: string
  room: string
  x: number
  y: number
  vx: number
  vy: number
  facesLeft: boolean
  hitbox: { x: number; y: number; w: number; h: number }
  /** As placed, from the running ROM: not a behaviour's own copy, which may change as it runs. */
  properties: PlacedProperty[]
}

export type LiveRow = LivePlayer | LiveEntityRow

export type LiveView =
  /** The game has not published its state yet. */
  | { state: 'waiting'; message: string }
  /** The debug map points somewhere that cannot be what it says. */
  | { state: 'problem'; message: string }
  | {
      state: 'running'
      frame: number
      room: string
      camera: { x: number; y: number }
      /** The player first, then the entities, by number. */
      rows: LiveRow[]
      /** Why no entities are listed, when they cannot be. */
      note: string | null
    }

const inRam = (address: number, size: number) => Object.values(RAM_REGIONS).some((r) => address >= r.start && address + size <= r.start + r.size)
const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`

function readRecord(bytes: Uint8Array, base: number, fields: readonly DebugField[]): Record<string, number | boolean> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: Record<string, number | boolean> = {}
  for (const f of fields) if (f.type !== 'body') out[f.name] = readField(view, base + f.offset, f.type)
  return out
}

/**
 * The player and the live entities of a running game, for one frame. Call it between
 * frames. `section` is the running ROM's, from `indexSection`, so the names are
 * those the game was given even after a live apply.
 */
export function readLive(emulator: Pick<LiveTarget, 'read_ram'>, map: DebugMap, section: SectionIndex | null): LiveView {
  const state = readGameState(map, emulator.read_ram(map.state.address, map.state.size))
  const stamp = [...map.state.stamp].reduce((word, c, i) => word | (c.charCodeAt(0) << (i * 8)), 0) >>> 0
  if (state.stamp !== stamp) return { state: 'waiting', message: 'The game has not started yet: its state is read once it has run a frame.' }
  const body = state.player as Record<string, number | boolean>
  const player: LivePlayer = {
    kind: 'player',
    x: body.x as number,
    y: body.y as number,
    w: body.w as number,
    h: body.h as number,
    vx: body.vx as number,
    vy: body.vy as number,
    onGround: body.onGround as boolean,
    hitWall: body.hitWall as boolean,
    hitCeiling: body.hitCeiling as boolean,
  }
  const roomIndex = state.room as number
  const running = (rows: LiveRow[], note: string | null): LiveView => ({
    state: 'running',
    frame: state.frame as number,
    room: section?.rooms[roomIndex]?.id ?? `room ${roomIndex}`,
    camera: { x: state.cameraX as number, y: state.cameraY as number },
    rows,
    note,
  })

  const table = map.entities
  if (!table) return running([player], 'Build again to see entities: this ROM was built by an older studio, whose debug map has no entity table.')
  const cell = readRecord(emulator.read_ram(table.address, table.size), 0, table.fields)
  const [address, slots, slotSize] = [cell.address as number, cell.slots as number, cell.slotSize as number]
  if (!address) return running([player], 'The game does not use the generated entity table (data::entities()), so there are no entities to list.')
  if (slotSize !== table.slot.size) return { state: 'problem', message: `The game says its entity slots are ${slotSize} bytes, but this studio reads slots of ${table.slot.size}; rebuild the game with the studio's runtime.` }
  if (!inRam(address, slots * slotSize)) return { state: 'problem', message: `The game says its entity table is ${slots} slots at ${hex(address)}, which is not in EWRAM or IWRAM; rebuild the game.` }
  if (!section) return running([player], 'The ROM has no level data section, so its entities cannot be named.')

  const active = new Set(activeRooms(section.rooms, roomIndex))
  const bytes = emulator.read_ram(address, slots * slotSize)
  const rows: LiveRow[] = [player]
  for (let n = 0; n < slots; n++) {
    const slot = readRecord(bytes, n * slotSize, table.slot.fields)
    if (!slot.built || !slot.alive || !active.has(slot.room as number)) continue
    const index = slot.index as number
    rows.push({
      kind: 'entity',
      index,
      type: section.types[slot.kind as number] ?? `type ${slot.kind}`,
      room: section.rooms[slot.room as number]?.id ?? `room ${slot.room}`,
      x: slot.x as number,
      y: slot.y as number,
      vx: slot.vx as number,
      vy: slot.vy as number,
      facesLeft: slot.facesLeft as boolean,
      hitbox: { x: slot.hitboxX as number, y: slot.hitboxY as number, w: slot.hitboxW as number, h: slot.hitboxH as number },
      properties: section.entities[index]?.properties ?? [],
    })
  }
  return running(rows, null)
}

/** How a row is known from frame to frame: the player, or an entity's number in the world. */
export function rowKey(row: LiveRow): 'player' | number {
  return row.kind === 'player' ? 'player' : row.index
}

/** An entity with no hitbox (its type has no sprite) is picked by a box this big standing on its feet. */
const PICK_SIZE = 8

/** A row's box in world pixels: left, top, width, height. */
export function rowBox(row: LiveRow): [number, number, number, number] {
  if (row.kind === 'player') return [row.x, row.y, row.w, row.h]
  const { hitbox: h } = row
  if (h.w === 0 || h.h === 0) return [row.x - PICK_SIZE / 2, row.y - PICK_SIZE, PICK_SIZE, PICK_SIZE]
  return [row.x + h.x, row.y + h.y, h.w, h.h]
}

/**
 * What is under a point of the game screen (0 to 239 across, 0 to 159 down): the
 * player or an entity, the one with the smallest box where several hold it, or null.
 */
export function pickAt(view: LiveView, screenX: number, screenY: number): LiveRow | null {
  if (view.state !== 'running') return null
  const [x, y] = [view.camera.x + screenX, view.camera.y + screenY]
  let best: LiveRow | null = null
  let bestArea = Infinity
  for (const row of view.rows) {
    const [left, top, w, h] = rowBox(row)
    if (x >= left && x < left + w && y >= top && y < top + h && w * h < bestArea) {
      best = row
      bestArea = w * h
    }
  }
  return best
}
