// "Play from here" (US-005): where a dev game starts when the author asks for a room
// and a tile. The game reads a start override from its ROM's debug record
// (pecten_studio_rt::debug::start_override); the studio writes it into the emulator's
// copy of the cartridge, never into the file. See design/US-005.md.
import { ROM_ADDRESS } from './debugmap.ts'
import type { DebugMap } from './debugmap.ts'
import type { LiveTarget } from './liveapply.ts'

const TILE = 8

/** A room and a point in it, in room pixels: where an entity placed on that tile stands (the middle of its bottom edge). */
export interface StartSpot {
  /** The room's id. */
  room: string
  x: number
  y: number
}

/** The spot for the tile at a column and row of a room. */
export const spotOfTile = (room: string, column: number, row: number): StartSpot => ({ room, x: column * TILE + TILE / 2, y: (row + 1) * TILE })

/** What to write into the ROM to start at a spot: the bytes and where they go. */
export function startOverridePatch(roomIndex: number, spot: Pick<StartSpot, 'x' | 'y'>, map: DebugMap): { offset: number; bytes: Uint8Array } | { problem: string } {
  const target = map.startOverride
  if (!target) return { problem: 'this ROM was built before "Play from here": build the dev game again' }
  const bytes = new Uint8Array(target.size)
  const view = new DataView(bytes.buffer)
  for (const [name, value] of [['set', 1], ['room', roomIndex], ['x', spot.x], ['y', spot.y]] as const) {
    view.setInt32(target.fields.find((f) => f.name === name)!.offset, value, true)
  }
  return { offset: target.address - ROM_ADDRESS, bytes }
}

/** The room's number in the data section: its place among the sorted room ids. */
export const roomIndexOf = (roomIds: readonly string[], room: string): number => [...roomIds].sort().indexOf(room)

/**
 * Makes a freshly loaded game start at a spot. Call it before the first frame. Returns a
 * problem, in the author's terms, when the ROM cannot start anywhere but the start room.
 */
export function startAt(emulator: Pick<LiveTarget, 'patch_rom'>, map: DebugMap | null, roomIds: readonly string[], spot: StartSpot): { problem: string } | null {
  if (!map) return { problem: 'this ROM has no debug record, so it always starts in the start room. Build the dev game to play from here' }
  const index = roomIndexOf(roomIds, spot.room)
  if (index < 0) return { problem: `there is no room "${spot.room}"` }
  const patch = startOverridePatch(index, spot, map)
  if ('problem' in patch) return patch
  emulator.patch_rom(patch.offset, patch.bytes)
  return null
}
