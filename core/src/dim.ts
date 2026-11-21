// Darkening a room's layers: what the GBA's brightness-decrease effect does to a colour,
// and how a room's settings are stored in the data section.
import { fromBgr555, toBgr555 } from './gba.ts'
import type { Room } from './schema.ts'

/** Highest dim level: 16 sixteenths of the way to black. */
export const MAX_DIM = 16

/** Room flag bits the data section keeps the dim settings in; bits 0 and 1 are the map and music flags. */
export const DIM_TILES_SHIFT = 2
export const DIM_BACKGROUNDS_SHIFT = 5
export const DIM_LEVEL_SHIFT = 8

/** One 5-bit channel after the effect: the hardware subtracts `c * level / 16`, rounding down. */
function dimChannel(channel: number, level: number): number {
  return channel - Math.floor((channel * level) / 16)
}

/** A BGR555 colour darkened by `level` (0 to 16) the way the hardware does it. */
export function dimBgr555(colour: number, level: number): number {
  return dimChannel(colour & 31, level) | (dimChannel((colour >> 5) & 31, level) << 5) | (dimChannel((colour >> 10) & 31, level) << 10)
}

/** Darkens RGBA pixels in place: each colour is put on the GBA's 5-bit grid first, as the console would show it. Alpha is kept. */
export function dimRgba(rgba: Uint8ClampedArray | Uint8Array, level: number): void {
  if (level <= 0) return
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = fromBgr555(dimBgr555(toBgr555(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!), level))
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
  }
}

/** Which of a room's tile layers (back to front) and backgrounds are set to dim. */
export function dimmedLayers(room: Room): { tiles: boolean[]; backgrounds: boolean[] } {
  return { tiles: room.layers.map((l) => l.dim === true), backgrounds: (room.backgrounds ?? []).map((b) => b.dim === true) }
}

/** The dim bits of a room's flag word in the data section. */
export function dimFlags(room: Room): number {
  const { tiles, backgrounds } = dimmedLayers(room)
  const mask = (list: boolean[]) => list.reduce((bits, on, n) => bits | (on ? 1 << n : 0), 0)
  return (mask(tiles) << DIM_TILES_SHIFT) | (mask(backgrounds) << DIM_BACKGROUNDS_SHIFT) | ((room.dimLevel ?? 0) << DIM_LEVEL_SHIFT)
}
