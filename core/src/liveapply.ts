// Live apply (US-003): puts a patched data section into a game that is running, so
// the player stays where they are. The studio compares the running ROM with the
// patched one, writes the changed bytes into the emulator's cartridge, moves the
// collected bits to the entities' new numbers, and tells the game through its inbox
// (pecten_studio_rt::debug::Live). See design/US-003.md.
import { readSection } from './datasection.ts'
import { LIVE_CHANGES, RAM_REGIONS, readDebugMap } from './debugmap.ts'
import type { DebugMap } from './debugmap.ts'

/** What live apply needs of an emulator: the Pecten core's debugger calls. */
export interface LiveTarget {
  read_ram(addr: number, len: number): Uint8Array
  write_ram(addr: number, data: Uint8Array): void
  patch_rom(offset: number, data: Uint8Array): void
}

export type LivePlan =
  /** The ROMs are the same: nothing to do. */
  | { kind: 'same' }
  /** Only a restart brings the new ROM in, for this reason. */
  | { kind: 'restart'; reason: string }
  | {
      kind: 'apply'
      map: DebugMap
      /** Bits of LIVE_CHANGES. Zero when only something the game does not draw changed, such as a room's name. */
      changes: number
      /** The bytes to write into the cartridge, from `offset`. */
      offset: number
      bytes: Uint8Array
      /** For each entity number in the running ROM, its number in the new one; null when it changed or is gone. */
      renumber: (number | null)[]
    }

const HEADER = 20
const [S_STRINGS, S_CLASSES, S_ROOMS, S_ENTITIES, S_PROPS, S_CELLS, S_GLOBALS] = [0, 1, 2, 3, 4, 5, 6] as const
const ROOM = 64
const ENTITY = 12
const PROP = 20

interface RoomData {
  id: string
  /** Everything about the room but its tiles and entities, as text to compare. */
  shape: string
  tiles: string
  entities: string[]
  firstEntity: number
}

/** The rooms, classes, start and physics of a section, decoded so two can be compared whatever their offsets. */
function decode(rom: Uint8Array, start: number) {
  const view = new DataView(rom.buffer, rom.byteOffset + start)
  const u8 = (at: number) => view.getUint8(at)
  const u16 = (at: number) => view.getUint16(at, true)
  const i16 = (at: number) => view.getInt16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  const part = (n: number) => ({ at: u32(HEADER + n * 8), length: u32(HEADER + n * 8 + 4) })
  const strings = part(S_STRINGS).at
  const str = (at: number) => {
    const from = strings + u32(at)
    return String.fromCharCode(...rom.subarray(start + from, start + from + u32(at + 4)))
  }
  const hex = (at: number, length: number) => Array.from(rom.subarray(start + at, start + at + length), (b) => b.toString(16).padStart(2, '0')).join('')
  const cells = part(S_CELLS).at
  const props = part(S_PROPS).at
  const entities = part(S_ENTITIES).at

  const entity = (n: number) => {
    const at = entities + n * ENTITY
    const values: string[] = []
    for (let p = 0; p < u16(at + 6); p++) {
      const prop = props + (u32(at + 8) + p) * PROP
      const type = u8(prop + 8)
      values.push(`${str(prop)}:${type}:${type === 2 ? str(prop + 12) : view.getInt32(prop + 12, true)}`)
    }
    return `${u16(at)} ${i16(at + 2)} ${i16(at + 4)} ${values.join(',')}`
  }

  const rooms: RoomData[] = []
  const roomPart = part(S_ROOMS)
  for (let at = roomPart.at; at < roomPart.at + roomPart.length; at += ROOM) {
    const [cols, rows, layers] = [u16(at + 16), u16(at + 18), u8(at + 30)]
    const backgrounds = [48, 56].map((b) => hex(at + b, 8)).join(' ')
    const shape = [cols, rows, i16(at + 20), i16(at + 22), u16(at + 24), u16(at + 26), u16(at + 28), layers, u8(at + 31), backgrounds].join(' ')
    const first = u32(at + 40)
    rooms.push({
      id: str(at),
      shape,
      tiles: hex(cells + u32(at + 32), cols * rows) + hex(cells + u32(at + 36), cols * rows * 2 * layers),
      entities: Array.from({ length: u32(at + 44) }, (_, i) => entity(first + i)),
      firstEntity: first,
    })
  }
  const classes = part(S_CLASSES)
  const classList = Array.from({ length: classes.length / 12 }, (_, i) => `${str(classes.at + i * 12)} ${hex(classes.at + i * 12 + 8, 4)}`)
  const globals = part(S_GLOBALS).at
  return { rooms, classes: classList.join(','), start: u16(globals), physics: hex(globals + 8, 84), entityCount: u32(globals + 4) }
}

/** Whether `next` can go into a game running `running` without a restart, and what it would change. */
export function planLiveApply(running: Uint8Array, next: Uint8Array): LivePlan {
  if (running.length !== next.length) return { kind: 'restart', reason: 'the ROM changed size' }
  const debug = readDebugMap(next)
  if (!debug) return { kind: 'restart', reason: 'the ROM has no debug record (a release build)' }
  if ('problem' in debug) return { kind: 'restart', reason: debug.problem }
  if (!debug.map.inbox) return { kind: 'restart', reason: 'the game was built with a runtime older than live apply; build it again' }
  const [before, after] = [readSection(running), readSection(next)]
  if (!before || !after) return { kind: 'restart', reason: 'the ROM has no level data section' }
  if (before.start !== after.start || before.capacity !== after.capacity) return { kind: 'restart', reason: 'the level data section moved' }
  const end = after.start + after.capacity
  let first = -1
  let last = -1
  for (let i = 0; i < next.length; i++) {
    if (running[i] === next[i]) continue
    if (i < after.start || i >= end) return { kind: 'restart', reason: 'something other than level data changed' }
    if (first < 0) first = i
    last = i
  }
  if (first < 0) return { kind: 'same' }

  const [old, now] = [decode(running, before.start), decode(next, after.start)]
  let changes = 0
  if (old.physics !== now.physics) changes |= LIVE_CHANGES.physics
  const sameRooms = old.rooms.length === now.rooms.length && old.rooms.every((room, i) => room.id === now.rooms[i]!.id && room.shape === now.rooms[i]!.shape)
  if (!sameRooms || old.classes !== now.classes || old.start !== now.start) changes |= LIVE_CHANGES.rooms
  const oldById = new Map(old.rooms.map((room) => [room.id, room]))
  for (const room of now.rooms) {
    const was = oldById.get(room.id)
    if (was && was.tiles !== room.tiles) changes |= LIVE_CHANGES.tiles
    if (!was || was.entities.join('\n') !== room.entities.join('\n')) changes |= LIVE_CHANGES.entities
  }
  if (old.rooms.some((room) => !now.rooms.find((r) => r.id === room.id) && room.entities.length)) changes |= LIVE_CHANGES.entities

  // An entity keeps its number's collected bit when the same entity, in the same
  // room, is in the new ROM; the first unused match wins, so repeats pair in order.
  const renumber: (number | null)[] = Array.from({ length: old.entityCount }, () => null)
  for (const room of now.rooms) {
    const was = oldById.get(room.id)
    if (!was) continue
    const used = new Set<number>()
    room.entities.forEach((key, i) => {
      const match = was.entities.findIndex((other, k) => other === key && !used.has(k))
      if (match < 0) return
      used.add(match)
      renumber[was.firstEntity + match] = room.firstEntity + i
    })
  }
  return { kind: 'apply', map: debug.map, changes, offset: first, bytes: next.slice(first, last + 1), renumber }
}

const word = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true)
const inRam = (address: number, size: number) => Object.values(RAM_REGIONS).some((r) => address >= r.start && address + size <= r.start + r.size)

/**
 * Puts a planned change into the running game. Call it between frames. Returns the
 * inbox generation the game will copy to `seen` once it has taken the change.
 */
export function applyLive(emulator: LiveTarget, plan: Extract<LivePlan, { kind: 'apply' }>): number {
  const { map } = plan
  emulator.patch_rom(plan.offset, plan.bytes)

  // The collected bits, renumbered. A game that has not published yet has none to move.
  const block = emulator.read_ram(map.state.address, map.state.size)
  const field = (name: string) => map.state.fields.find((f) => f.name === name)!.offset
  const [address, words] = [word(block, field('collected')), word(block, field('collectedWords'))]
  if (address && words && inRam(address, words * 4)) {
    const bits = emulator.read_ram(address, words * 4)
    const moved = new Uint8Array(words * 4)
    plan.renumber.forEach((to, from) => {
      if (to === null || from >= words * 32 || to >= words * 32) return
      if (bits[from >> 3]! & (1 << (from & 7))) moved[to >> 3]! |= 1 << (to & 7)
    })
    emulator.write_ram(address, moved)
  }

  const inbox = map.inbox!
  const box = emulator.read_ram(inbox.address, inbox.size)
  const generation = (word(box, 0) + 1) >>> 0
  const out = new Uint8Array(8)
  const view = new DataView(out.buffer)
  view.setUint32(0, generation, true)
  view.setUint32(4, (word(box, 4) | plan.changes) >>> 0, true)
  emulator.write_ram(inbox.address, out)
  return generation
}

/** Whether the game has taken the change `applyLive` returned. */
export function liveTaken(emulator: LiveTarget, map: DebugMap, generation: number): boolean {
  const inbox = map.inbox
  return !!inbox && word(emulator.read_ram(inbox.address, inbox.size), 8) === generation
}
