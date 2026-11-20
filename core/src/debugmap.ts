// Where a running game keeps its state, read from its ROM: see
// docs/reference/debug-map.md. The game copies its state each frame to one block in
// RAM (pecten_studio_rt::debug), and a record in the ROM, starting `PECTDBUG`, holds
// the block's address. Release builds have no record.
import { readSection } from './datasection.ts'

const RECORD_MAGIC = [...'PECTDBUG'].map((c) => c.charCodeAt(0))
/** Version 1 records are 20 bytes; version 2 adds the inbox's address and size. */
const RECORD_SIZE = 20
/** Where the GBA maps the cartridge: ROM offset 0 is this address. */
export const ROM_ADDRESS = 0x0800_0000
/** The two work RAMs the block can be in. */
export const RAM_REGIONS = { ewram: { start: 0x0200_0000, size: 0x4_0000 }, iwram: { start: 0x0300_0000, size: 0x8000 } } as const

export type DebugFieldType = 'u32' | 'i32' | 'bool' | 'address' | 'body'
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
}

/**
 * The layouts for each record version, as `pecten_studio_rt::debug` lays them out.
 * `codegen/fixture/debug-layout.json` holds the newest, and a runtime test checks
 * the Rust side against it. Version 2 added the inbox.
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
} as const satisfies Record<number, Layout>

/** The bits of the inbox's `changed` word, as `pecten_studio_rt::debug::Changes` reads them. */
export const LIVE_CHANGES = { tiles: 1, physics: 2, entities: 4, rooms: 8 } as const

/** What `<rom>.debug.json` holds. */
export interface DebugMap {
  /** The ROM record's version. */
  version: 1 | 2
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

  const section = readSection(rom)
  return {
    map: {
      version: version as 1 | 2,
      state: { address, size, stamp: layout.stamp, fields: layout.fields.map((f) => ({ ...f })) },
      body: { size: layout.bodySize, fields: layout.body.map((f) => ({ ...f })) },
      collected: { bitsPerWord: 32 },
      dataSection: section ? { address: ROM_ADDRESS + section.start } : null,
      inbox,
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
      if (f.type === 'body') out[f.name] = read(map.body.fields, at) as Record<string, number | boolean>
      else if (f.type === 'i32') out[f.name] = view.getInt32(at, true)
      else if (f.type === 'bool') out[f.name] = view.getUint8(at) !== 0
      else out[f.name] = view.getUint32(at, true)
    }
    return out
  }
  return read(map.state.fields, 0)
}
