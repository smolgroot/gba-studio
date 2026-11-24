import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEBUG_LAYOUTS, ROM_ADDRESS, readDebugMap, readGameState } from '@pecten-studio/core'

const FIXTURE = fileURLToPath(new URL('../../codegen/fixture/', import.meta.url))

/** A ROM of zeros with a debug record at `at`, and optionally a data section at `section`. */
function rom({ at = 0x100, version = 4, address = 0x0200_0000, size = 64, inbox = 0x0200_0040, inboxSize = 12, entities = 0x0200_0050, entitiesSize = 12, section }: { at?: number; version?: number; address?: number; size?: number; inbox?: number; inboxSize?: number; entities?: number; entitiesSize?: number; section?: number } = {}): Uint8Array {
  const bytes = new Uint8Array(0x8000)
  const view = new DataView(bytes.buffer)
  bytes.set([...'PECTDBUG'].map((c) => c.charCodeAt(0)), at)
  view.setUint32(at + 8, version, true)
  view.setUint32(at + 12, address, true)
  view.setUint32(at + 16, size, true)
  if (version >= 2) {
    view.setUint32(at + 20, inbox, true)
    view.setUint32(at + 24, inboxSize, true)
  }
  if (version >= 4) {
    view.setUint32(at + 44, entities, true)
    view.setUint32(at + 48, entitiesSize, true)
  }
  if (section !== undefined) bytes.set(readFileSync(`${FIXTURE}expected/studio_data.bin`), section)
  return bytes
}

describe('debug map', () => {
  it('has the layout the runtime writes, as the shared fixture holds it', () => {
    expect(DEBUG_LAYOUTS[4]).toEqual(JSON.parse(readFileSync(`${FIXTURE}debug-layout.json`, 'utf8')))
  })

  it('reads the block address and layouts from the ROM record', () => {
    const result = readDebugMap(rom({ address: 0x0200_0080 }))
    expect(result).not.toBeNull()
    if (!result || 'problem' in result) throw new Error('expected a map')
    expect(result.map.version).toBe(4)
    expect(result.map.state).toMatchObject({ address: 0x0200_0080, size: 64, stamp: 'PSGS' })
    expect(result.map.inbox).toEqual({ address: 0x0200_0040, size: 12, fields: [{ name: 'generation', offset: 0, type: 'u32' }, { name: 'changed', offset: 4, type: 'u32' }, { name: 'seen', offset: 8, type: 'u32' }] })
    expect(result.map.state.fields.find((f) => f.name === 'player')).toEqual({ name: 'player', offset: 20, type: 'body' })
    expect(result.map.body.fields.map((f) => f.name)).toEqual(['x', 'y', 'w', 'h', 'vx', 'vy', 'onGround', 'hitWall', 'hitCeiling'])
    expect(result.map.dataSection).toBeNull()
  })

  it('says where the start override is, from version 3', () => {
    const result = readDebugMap(rom({ at: 0x100 }))
    if (!result || 'problem' in result) throw new Error('expected a map')
    expect(result.map.startOverride).toEqual({ address: ROM_ADDRESS + 0x100 + 28, size: 16, fields: [{ name: 'set', offset: 0, type: 'u32' }, { name: 'room', offset: 4, type: 'u32' }, { name: 'x', offset: 8, type: 'i32' }, { name: 'y', offset: 12, type: 'i32' }] })
    const older = readDebugMap(rom({ version: 2 }))
    if (!older || 'problem' in older) throw new Error('expected a map')
    expect(older.map.startOverride).toBeNull()
  })

  it('says where the table of live entities is told, from version 4', () => {
    const result = readDebugMap(rom({ entities: 0x0200_0100 }))
    if (!result || 'problem' in result) throw new Error('expected a map')
    expect(result.map.entities).toEqual({
      address: 0x0200_0100,
      size: 12,
      fields: [{ name: 'address', offset: 0, type: 'address' }, { name: 'slots', offset: 4, type: 'u32' }, { name: 'slotSize', offset: 8, type: 'u32' }],
      slot: { size: 108, fields: expect.arrayContaining([{ name: 'x', offset: 0, type: 'i32' }, { name: 'kind', offset: 36, type: 'u16' }, { name: 'built', offset: 42, type: 'bool' }]) },
    })
    const older = readDebugMap(rom({ version: 3 }))
    if (!older || 'problem' in older) throw new Error('expected a map')
    expect(older.map.version).toBe(3)
    expect(older.map.entities).toBeNull()
  })

  it('says what is wrong with an entity table it cannot use', () => {
    expect(readDebugMap(rom({ entitiesSize: 8 }))).toEqual({ problem: expect.stringContaining('entity table is 8 bytes') })
    expect(readDebugMap(rom({ entities: 0x0600_0000 }))).toEqual({ problem: expect.stringContaining('puts the entity table at 0x06000000') })
  })

  it('gives the data section address when the ROM has one', () => {
    const result = readDebugMap(rom({ section: 0x1000 }))
    if (!result || 'problem' in result) throw new Error('expected a map')
    expect(result.map.dataSection).toEqual({ address: ROM_ADDRESS + 0x1000 })
  })

  it('still reads a version 1 record, which has no inbox', () => {
    const result = readDebugMap(rom({ version: 1 }))
    if (!result || 'problem' in result) throw new Error('expected a map')
    expect(result.map.version).toBe(1)
    expect(result.map.inbox).toBeNull()
  })

  it('finds nothing in a ROM without a record, as release builds are', () => {
    expect(readDebugMap(new Uint8Array(0x4000))).toBeNull()
  })

  it('says what is wrong with a record it cannot use', () => {
    expect(readDebugMap(rom({ version: 9 }))).toEqual({ problem: expect.stringContaining('version 9') })
    expect(readDebugMap(rom({ size: 60 }))).toEqual({ problem: expect.stringContaining('60 bytes') })
    expect(readDebugMap(rom({ address: 0x0600_0000 }))).toEqual({ problem: expect.stringContaining('0x06000000, which is not in EWRAM or IWRAM') })
    expect(readDebugMap(rom({ inboxSize: 8 }))).toEqual({ problem: expect.stringContaining('inbox is 8 bytes') })
    expect(readDebugMap(rom({ inbox: 0x0800_0000 }))).toEqual({ problem: expect.stringContaining('puts the inbox at 0x08000000') })
    // A block that runs past the end of IWRAM.
    expect(readDebugMap(rom({ address: 0x0300_7fe0 }))).toEqual({ problem: expect.stringContaining('not in EWRAM or IWRAM') })
  })

  it('reads a block by its layout', () => {
    const result = readDebugMap(rom())
    if (!result || 'problem' in result) throw new Error('expected a map')
    const block = new Uint8Array(64)
    const view = new DataView(block.buffer)
    block.set([...'PSGS'].map((c) => c.charCodeAt(0)), 0)
    view.setUint32(4, 120, true)
    view.setUint32(8, 2, true)
    view.setInt32(12, -8, true)
    view.setInt32(20, 740, true)
    view.setInt32(40, -256, true) // player.vy
    block[52] = 1 // player.onGround
    view.setUint32(56, 0x0300_7bc8, true)
    expect(readGameState(result.map, block)).toMatchObject({
      stamp: 0x53475350,
      frame: 120,
      room: 2,
      cameraX: -8,
      player: { x: 740, vy: -256, onGround: true, hitWall: false },
      collected: 0x0300_7bc8,
    })
  })
})
