// Where a running game keeps its state, read from its ROM: see
// docs/reference/debug-map.md. The game copies its state each frame to one block in
// RAM (pecten_studio_rt::debug), and a record in the ROM, starting `PECTDBUG`, holds
// the block's address. Release builds have no record.
import { readSection } from './datasection.ts'

const RECORD_MAGIC = [...'PECTDBUG'].map((c) => c.charCodeAt(0))
/** Version 1 records are 20 bytes; version 2 adds the inbox's address and size (28), version 3 the start override (44), version 4 the entity table's cell (52). */
const RECORD_SIZE = 20
const START_AT = 28
const ENTITIES_AT = 44
/** Where the GBA maps the cartridge: ROM offset 0 is this address. */
export const ROM_ADDRESS = 0x0800_0000
/** The two work RAMs the block can be in. */
export const RAM_REGIONS = { ewram: { start: 0x0200_0000, size: 0x4_0000 }, iwram: { start: 0x0300_0000, size: 0x8000 } } as const

export type DebugFieldType = 'u32' | 'i32' | 'u16' | 'i16' | 'bool' | 'address' | 'body'
export interface DebugField {
  name: string
  /** Bytes from the start of the record it is in. */
  offset: number
  type: DebugFieldType
}

const BLOCK_FIELDS = [
  { name: 'stamp', offset: 0, type: 'u32' },
  { name: 'frame', offset: 4, type: 'u32' },
  { name: 'room', offset: 8, type: 'u32' },
  { name: 'cameraX', offset: 12, type: 'i32' },
  { name: 'cameraY', offset: 16, type: 'i32' },
  { name: 'player', offset: 20, type: 'body' },
  { name: 'collected', offset: 56, type: 'address' },
  { name: 'collectedWords', offset: 60, type: 'u32' },
] as const
const BODY_FIELDS = [
  { name: 'x', offset: 0, type: 'i32' },
  { name: 'y', offset: 4, type: 'i32' },
  { name: 'w', offset: 8, type: 'i32' },
  { name: 'h', offset: 12, type: 'i32' },
  { name: 'vx', offset: 16, type: 'i32' },
  { name: 'vy', offset: 20, type: 'i32' },
  { name: 'onGround', offset: 32, type: 'bool' },
  { name: 'hitWall', offset: 33, type: 'bool' },
  { name: 'hitCeiling', offset: 34, type: 'bool' },
] as const

interface Layout {
  version: number
  stamp: string
  size: number
  fields: readonly DebugField[]
  bodySize: number
  body: readonly DebugField[]
  inboxSize?: number
  inbox?: readonly DebugField[]
  startSize?: number
  start?: readonly DebugField[]
  tableSize?: number
  table?: readonly DebugField[]
  slotSize?: number
  slot?: readonly DebugField[]
}

const INBOX_FIELDS = [
  { name: 'generation', offset: 0, type: 'u32' },
  { name: 'changed', offset: 4, type: 'u32' },
  { name: 'seen', offset: 8, type: 'u32' },
] as const
const START_FIELDS = [
  { name: 'set', offset: 0, type: 'u32' },
  { name: 'room', offset: 4, type: 'u32' },
  { name: 'x', offset: 8, type: 'i32' },
  { name: 'y', offset: 12, type: 'i32' },
] as const

/**
 * The layouts for each record version, as `pecten_studio_rt::debug` lays them out.
 * `codegen/fixture/debug-layout.json` holds the newest, and a runtime test checks
 * the Rust side against it. Version 2 added the inbox, version 3 the start override,
 * version 4 the table of live entities.
 */
export const DEBUG_LAYOUTS = {
  1: { version: 1, stamp: 'PSGS', size: 64, fields: BLOCK_FIELDS, bodySize: 36, body: BODY_FIELDS },
  2: {
    version: 2,
    stamp: 'PSGS',
    size: 64,
    fields: BLOCK_FIELDS,
    bodySize: 36,
    body: BODY_FIELDS,
    inboxSize: 12,
    inbox: [
      { name: 'generation', offset: 0, type: 'u32' },
      { name: 'changed', offset: 4, type: 'u32' },
      { name: 'seen', offset: 8, type: 'u32' },
    ],
  },
  3: {
    version: 3,
    stamp: 'PSGS',
    size: 64,
    fields: BLOCK_FIELDS,
    bodySize: 36,
    body: BODY_FIELDS,
    inboxSize: 12,
    inbox: [
      { name: 'generation', offset: 0, type: 'u32' },
      { name: 'changed', offset: 4, type: 'u32' },
      { name: 'seen', offset: 8, type: 'u32' },
    ],
    startSize: 16,
    start: START_FIELDS,
  },
  4: {
    version: 4,
    stamp: 'PSGS',
    size: 64,
    fields: BLOCK_FIELDS,
    bodySize: 36,
    body: BODY_FIELDS,
    inboxSize: 12,
    inbox: INBOX_FIELDS,
    startSize: 16,
    start: START_FIELDS,
    tableSize: 12,
    table: [
      { name: 'address', offset: 0, type: 'address' },
      { name: 'slots', offset: 4, type: 'u32' },
      { name: 'slotSize', offset: 8, type: 'u32' },
    ],
    // A slot of the table (`LiveEntity`): the actor's position (its feet), speed in
    // whole pixels a frame, facing, whether it is alive and its hitbox (offset from
    // the feet), then its type, room and number in the world, and whether the slot
    // holds an entity. The behaviours after these are not described.
    slotSize: 108,
    slot: [
      { name: 'x', offset: 0, type: 'i32' },
      { name: 'y', offset: 4, type: 'i32' },
      { name: 'vx', offset: 16, type: 'i32' },
      { name: 'vy', offset: 20, type: 'i32' },
      { name: 'facesLeft', offset: 24, type: 'bool' },
      { name: 'alive', offset: 25, type: 'bool' },
      { name: 'hitboxX', offset: 26, type: 'i16' },
      { name: 'hitboxY', offset: 28, type: 'i16' },
      { name: 'hitboxW', offset: 30, type: 'u16' },
      { name: 'hitboxH', offset: 32, type: 'u16' },
      { name: 'kind', offset: 36, type: 'u16' },
      { name: 'room', offset: 38, type: 'u16' },
      { name: 'index', offset: 40, type: 'u16' },
      { name: 'built', offset: 42, type: 'bool' },
    ],
  },
} as const satisfies Record<number, Layout>

/** The bits of the inbox's `changed` word, as `pecten_studio_rt::debug::Changes` reads them. */
export const LIVE_CHANGES = { tiles: 1, physics: 2, entities: 4, rooms: 8 } as const

/** What `<rom>.debug.json` holds. */
export interface DebugMap {
  /** The ROM record's version. */
  version: 1 | 2 | 3 | 4
  /** The game's state block in RAM: read `size` bytes at `address`. */
  state: {
    address: number
    size: number
    /** The block's first word, as four characters, once the game has published it. */
    stamp: string
    fields: DebugField[]
  }
  /** The layout of a `body` field. Positions are in world pixels, speeds in 1/256 pixel per frame. */
  body: { size: number; fields: DebugField[] }
  /**
   * The collected bits: one per entity, numbered as the data section numbers them.
   * Where they are is the block's `collected` field, read while the game runs.
   */
  collected: { bitsPerWord: 32 }
  /**
   * Where the level data section starts in ROM (docs/reference/data-section.md); null
   * if the game has none. Its header has the sizes, which a patch changes.
   */
  dataSection: { address: number } | null
  /**
   * Where the studio tells the game its level data changed (live apply), from record
   * version 2; null before. Fields: `generation`, `changed` (bits of LIVE_CHANGES), `seen`.
   */
  inbox: { address: number; size: number; fields: DebugField[] } | null
  /**
   * Where a dev build reads its start from, in the ROM (record version 3; null before):
   * `set` (1 to use it), `room` (index in the data section's room table), and `x`, `y` in
   * room pixels. Zero as built. The studio writes it into the emulator's copy only.
   */
  startOverride: { address: number; size: number; fields: DebugField[] } | null
  /**
   * Where the game says its table of live entities is (record version 4; null before):
   * a cell in RAM of `address`, `slots` and `slotSize`, zero until the game has taken
   * its table. `slot` is the layout of each slot.
   */
  entities: { address: number; size: number; fields: DebugField[]; slot: { size: number; fields: DebugField[] } } | null
}

export type DebugMapResult = { map: DebugMap } | { problem: string } | null

const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`

/**
 * Reads the debug record of a ROM. Null when it has none (a release build, or a game
 * that does not use the runtime's debug module); a problem when the record is there
 * but cannot be used.
 */
export function readDebugMap(rom: Uint8Array): DebugMapResult {
  let at = -1
  for (let i = 0; i + RECORD_SIZE <= rom.length; i += 4) {
    if (RECORD_MAGIC.every((byte, k) => rom[i + k] === byte)) {
      at = i
      break
    }
  }
  if (at < 0) return null
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength)
  const version = view.getUint32(at + 8, true)
  const address = view.getUint32(at + 12, true)
  const size = view.getUint32(at + 16, true)
  const layout: Layout | undefined = DEBUG_LAYOUTS[version as keyof typeof DEBUG_LAYOUTS]
  if (!layout) return { problem: `the ROM's debug record is version ${version}, and this studio reads version ${Object.keys(DEBUG_LAYOUTS).join(', ')}; update the studio or the game's runtime so they match` }
  if (size !== layout.size) return { problem: `the ROM's debug record says the state block is ${size} bytes, but version ${version} blocks are ${layout.size}; rebuild the game with the studio's runtime` }
  const inRam = (address: number, size: number) => Object.values(RAM_REGIONS).some((r) => address >= r.start && address + size <= r.start + r.size)
  if (!inRam(address, size)) return { problem: `the ROM's debug record points at ${hex(address)}, which is not in EWRAM or IWRAM; rebuild the game` }
  let inbox: DebugMap['inbox'] = null
  if (layout.inbox) {
    if (at + 28 > rom.length) return { problem: 'the ROM ends inside its debug record; rebuild the game' }
    const inboxAddress = view.getUint32(at + 20, true)
    const inboxSize = view.getUint32(at + 24, true)
    if (inboxSize !== layout.inboxSize) return { problem: `the ROM's debug record says the inbox is ${inboxSize} bytes, but version ${version} inboxes are ${layout.inboxSize}; rebuild the game with the studio's runtime` }
    if (!inRam(inboxAddress, inboxSize)) return { problem: `the ROM's debug record puts the inbox at ${hex(inboxAddress)}, which is not in EWRAM or IWRAM; rebuild the game` }
    inbox = { address: inboxAddress, size: inboxSize, fields: layout.inbox.map((f) => ({ ...f })) }
  }

  let startOverride: DebugMap['startOverride'] = null
  if (layout.start) {
    if (at + START_AT + layout.startSize! > rom.length) return { problem: 'the ROM ends inside its debug record; rebuild the game' }
    startOverride = { address: ROM_ADDRESS + at + START_AT, size: layout.startSize!, fields: layout.start.map((f) => ({ ...f })) }
  }

  let entities: DebugMap['entities'] = null
  if (layout.table) {
    if (at + ENTITIES_AT + 8 > rom.length) return { problem: 'the ROM ends inside its debug record; rebuild the game' }
    const cell = view.getUint32(at + ENTITIES_AT, true)
    const cellSize = view.getUint32(at + ENTITIES_AT + 4, true)
    if (cellSize !== layout.tableSize) return { problem: `the ROM's debug record says the entity table is ${cellSize} bytes, but version ${version} tables are ${layout.tableSize}; rebuild the game with the studio's runtime` }
    if (!inRam(cell, cellSize)) return { problem: `the ROM's debug record puts the entity table at ${hex(cell)}, which is not in EWRAM or IWRAM; rebuild the game` }
    entities = { address: cell, size: cellSize, fields: layout.table.map((f) => ({ ...f })), slot: { size: layout.slotSize!, fields: layout.slot!.map((f) => ({ ...f })) } }
  }

  const section = readSection(rom)
  return {
    map: {
      version: version as DebugMap['version'],
      state: { address, size, stamp: layout.stamp, fields: layout.fields.map((f) => ({ ...f })) },
      body: { size: layout.bodySize, fields: layout.body.map((f) => ({ ...f })) },
      collected: { bitsPerWord: 32 },
      dataSection: section ? { address: ROM_ADDRESS + section.start } : null,
      inbox,
      startOverride,
      entities,
    },
  }
}

/** Reads the state block out of a copy of RAM, by the map's layout. */
export function readGameState(map: DebugMap, block: Uint8Array): Record<string, number | boolean | Record<string, number | boolean>> {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength)
  const read = (fields: DebugField[], base: number) => {
    const out: Record<string, number | boolean | Record<string, number | boolean>> = {}
    for (const f of fields) {
      const at = base + f.offset
      out[f.name] = f.type === 'body' ? (read(map.body.fields, at) as Record<string, number | boolean>) : readField(view, at, f.type)
    }
    return out
  }
  return read(map.state.fields, 0)
}

/** One field that is not a body, little-endian, by its type. */
export function readField(view: DataView, at: number, type: Exclude<DebugFieldType, 'body'>): number | boolean {
  switch (type) {
    case 'i32':
      return view.getInt32(at, true)
    case 'i16':
      return view.getInt16(at, true)
    case 'u16':
      return view.getUint16(at, true)
    case 'bool':
      return view.getUint8(at) !== 0
    default:
      return view.getUint32(at, true)
  }
}
