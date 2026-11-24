import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activeRooms, indexSection, readDebugMap, readLive } from '@pecten-studio/core'
import type { DebugMap, LiveEntityRow, RoomPlace } from '@pecten-studio/core'

const FIXTURE = fileURLToPath(new URL('../../codegen/fixture/', import.meta.url))
const EWRAM = 0x0200_0000
const BLOCK = EWRAM
const CELL = EWRAM + 0x50
const TABLE = EWRAM + 0x1000
const SLOT = 108

/**
 * A ROM with a version 4 debug record and the codegen fixture's data section: rooms
 * `entry` (screens 0 to 1 across, 1 down) and `shaft` (2 across, 0 to 1 down), which
 * touch; in `entry` a player start and two signs.
 */
function rom(version = 4): Uint8Array {
  const bytes = new Uint8Array(0x8000)
  const view = new DataView(bytes.buffer)
  bytes.set([...'PECTDBUG'].map((c) => c.charCodeAt(0)), 0x100)
  view.setUint32(0x108, version, true)
  view.setUint32(0x10c, BLOCK, true)
  view.setUint32(0x110, 64, true)
  view.setUint32(0x114, EWRAM + 0x40, true)
  view.setUint32(0x118, 12, true)
  if (version >= 4) {
    view.setUint32(0x100 + 44, CELL, true)
    view.setUint32(0x100 + 48, 12, true)
  }
  bytes.set(readFileSync(`${FIXTURE}expected/studio_data.bin`), 0x1000)
  return bytes
}

function mapOf(bytes: Uint8Array): DebugMap {
  const result = readDebugMap(bytes)
  if (!result || 'problem' in result) throw new Error('expected a map')
  return result.map
}

/** EWRAM, as the emulator's `read_ram` gives it. */
function machine() {
  const ram = new Uint8Array(0x4_0000)
  const view = new DataView(ram.buffer)
  const at = (address: number) => address - EWRAM
  return {
    ram,
    view,
    at,
    read_ram: (address: number, length: number) => ram.slice(at(address), at(address) + length),
    /** The game's frame: the block published, the cell filled. */
    publish({ frame = 120, room = 0, camera = [16, 160], cell = true } = {}) {
      ram.set([...'PSGS'].map((c) => c.charCodeAt(0)), at(BLOCK))
      view.setUint32(at(BLOCK) + 4, frame, true)
      view.setUint32(at(BLOCK) + 8, room, true)
      view.setInt32(at(BLOCK) + 12, camera[0]!, true)
      view.setInt32(at(BLOCK) + 16, camera[1]!, true)
      // The player's body: top-left (30, 290), 10x14, moving right and up.
      view.setInt32(at(BLOCK) + 20, 30, true)
      view.setInt32(at(BLOCK) + 24, 290, true)
      view.setInt32(at(BLOCK) + 28, 10, true)
      view.setInt32(at(BLOCK) + 32, 14, true)
      view.setInt32(at(BLOCK) + 36, 256, true)
      view.setInt32(at(BLOCK) + 40, -512, true)
      if (cell) {
        view.setUint32(at(CELL), TABLE, true)
        view.setUint32(at(CELL) + 4, 32, true)
        view.setUint32(at(CELL) + 8, SLOT, true)
      }
    },
    slot(n: number, { x, y, vx = 0, kind, room, alive = true, built = true, facesLeft = false }: { x: number; y: number; vx?: number; kind: number; room: number; alive?: boolean; built?: boolean; facesLeft?: boolean }) {
      const base = at(TABLE) + n * SLOT
      view.setInt32(base, x, true)
      view.setInt32(base + 4, y, true)
      view.setInt32(base + 16, vx, true)
      ram[base + 24] = facesLeft ? 1 : 0
      ram[base + 25] = alive ? 1 : 0
      view.setInt16(base + 26, -4, true)
      view.setInt16(base + 28, -16, true)
      view.setUint16(base + 30, 8, true)
      view.setUint16(base + 32, 16, true)
      view.setUint16(base + 36, kind, true)
      view.setUint16(base + 38, room, true)
      view.setUint16(base + 40, n, true)
      ram[base + 42] = built ? 1 : 0
    },
  }
}

describe('the live entity list', () => {
  const bytes = rom()
  const section = indexSection(bytes)

  it('reads the rooms, types and properties of the running ROM', () => {
    expect(section?.rooms.map((r) => r.id)).toEqual(['entry', 'shaft'])
    expect(section?.rooms[0]).toMatchObject({ onMap: true, left: 0, top: 160, width: 480, height: 160 })
    expect(section?.types).toEqual(['player-start', 'sign'])
    expect(section?.entities).toHaveLength(3)
    expect(section?.entities[1]!.properties).toEqual(expect.arrayContaining([{ name: 'text', value: 'Café ahead' }, { name: 'lit', value: true }, { name: 'weight', value: -3 }]))
    expect(section?.entities[2]!.properties).toEqual(expect.arrayContaining([{ name: 'weight', value: 70000 }]))
  })

  it('lists the player first, then the built, living entities of the active rooms', () => {
    const emulator = machine()
    emulator.publish()
    // The player start leaves the table on the first frame, as the sample does.
    emulator.slot(0, { x: 24, y: 296, kind: 0, room: 0, alive: false })
    emulator.slot(1, { x: 64, y: 296, kind: 1, room: 0 })
    emulator.slot(2, { x: 99, y: 296, vx: -1, kind: 1, room: 0, facesLeft: true })
    // Slot 3 is not built: whatever it holds is not an entity.
    emulator.slot(3, { x: 1, y: 1, kind: 1, room: 0, built: false })
    const live = readLive(emulator, mapOf(bytes), section)
    if (live.state !== 'running') throw new Error(`expected a running game, got ${JSON.stringify(live)}`)
    expect(live).toMatchObject({ frame: 120, room: 'entry', camera: { x: 16, y: 160 }, note: null })
    expect(live.rows[0]).toEqual({ kind: 'player', x: 30, y: 290, w: 10, h: 14, vx: 256, vy: -512, onGround: false, hitWall: false, hitCeiling: false })
    expect(live.rows.slice(1).map((r) => (r as LiveEntityRow).index)).toEqual([1, 2])
    expect(live.rows[2]).toMatchObject({ kind: 'entity', index: 2, type: 'sign', room: 'entry', x: 99, y: 296, vx: -1, facesLeft: true, hitbox: { x: -4, y: -16, w: 8, h: 16 } })
    expect((live.rows[1] as LiveEntityRow).properties).toEqual(expect.arrayContaining([{ name: 'text', value: 'Café ahead' }]))
  })

  it('follows the game frame by frame', () => {
    const emulator = machine()
    emulator.publish()
    emulator.slot(1, { x: 64, y: 296, kind: 1, room: 0 })
    const map = mapOf(bytes)
    const before = readLive(emulator, map, section)
    emulator.publish({ frame: 121 })
    emulator.slot(1, { x: 65, y: 296, kind: 1, room: 0 })
    const after = readLive(emulator, map, section)
    if (before.state !== 'running' || after.state !== 'running') throw new Error('expected a running game')
    expect([before.frame, (before.rows[1] as LiveEntityRow).x]).toEqual([120, 64])
    expect([after.frame, (after.rows[1] as LiveEntityRow).x]).toEqual([121, 65])
  })

  it('waits for a game that has not published yet', () => {
    expect(readLive(machine(), mapOf(bytes), section)).toEqual({ state: 'waiting', message: expect.stringContaining('not started') })
  })

  it('lists only the player, and says why, for a ROM from before the table or a game without it', () => {
    const emulator = machine()
    emulator.publish()
    const older = readLive(emulator, mapOf(rom(3)), indexSection(rom(3)))
    expect(older).toMatchObject({ state: 'running', note: expect.stringContaining('Build again'), rows: [{ kind: 'player' }] })
    const without = machine()
    without.publish({ cell: false })
    expect(readLive(without, mapOf(bytes), section)).toMatchObject({ state: 'running', note: expect.stringContaining('data::entities()'), rows: [{ kind: 'player' }] })
  })

  it('says what is wrong with a table it cannot read', () => {
    const emulator = machine()
    emulator.publish()
    emulator.view.setUint32(emulator.at(CELL) + 8, 100, true)
    expect(readLive(emulator, mapOf(bytes), section)).toMatchObject({ state: 'problem', message: expect.stringContaining('100 bytes') })
    emulator.view.setUint32(emulator.at(CELL) + 8, SLOT, true)
    emulator.view.setUint32(emulator.at(CELL) + 4, 100_000, true)
    expect(readLive(emulator, mapOf(bytes), section)).toMatchObject({ state: 'problem', message: expect.stringContaining('not in EWRAM or IWRAM') })
  })
})

describe('active rooms', () => {
  it('match the runtime on the shared fixture', () => {
    const lines = readFileSync(`${FIXTURE}active-rooms.txt`, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    const rooms: RoomPlace[] = lines[0]!
      .replace('rooms:', '')
      .trim()
      .split(/\s+/)
      .map((place, i) => {
        const [x, y] = place === '-' ? [0, 0] : place.split(',').map(Number)
        return { id: `r${i}`, onMap: place !== '-', left: x! * 240, top: y! * 160, width: 240, height: 160 }
      })
    for (const line of lines.slice(1)) {
      const [here, expected] = line.split(':')
      expect(activeRooms(rooms, Number(here)), `the rooms active with room ${here}`).toEqual(expected!.trim().split(/\s+/).map(Number))
    }
  })
})
