// Background tiles and palettes as the build helper counts them, so the editors can
// show them while painting. The packing is the one in codegen/src/image.rs, step for
// step: another packing would give another palette count. Both are checked against
// codegen/fixture/budget.json.
import { toBgr555 } from './gba.ts'
import { rleDecode, rleLength } from './rle.ts'
import { SCREEN, docPath } from './schema.ts'
import type { Room } from './schema.ts'
import type { Documents, Problem } from './validate.ts'

/** Tiles one background can address, and all that video memory holds at once. */
export const MAX_BG_TILES = 1024
/** Palettes of 16 colours for backgrounds. */
export const BG_PALETTES = 16
/** Colours a tile can use beside transparency. */
const COLOURS = 15
const TILE = 8

/** What an image needs in video memory. */
export interface ArtCost {
  tiles: number
  palettes: number
}
/** A cost, or why the build could not convert the image, in its words. */
export type ArtResult = ArtCost | { error: string }
/** How an image is used: tiles to paint with, or a background picture whose repeated tiles count once. */
export type ArtUse = 'tileset' | 'background'
/** The cost of an image of the game folder by its path and use, or `undefined` if it was not read. */
export type ArtLookup = (path: string, as: ArtUse) => ArtResult | undefined
/** Costs as the server sends them with the project, by `artKey`. */
export type ArtCosts = Record<string, ArtResult>

export const artKey = (path: string, as: ArtUse): string => `${as}:${path}`

/** A lookup over costs sent by the server, with `live` (what is being painted and not yet saved) in front. */
export function artLookup(costs: ArtCosts, live?: ArtCosts): ArtLookup {
  return (path, as) => live?.[artKey(path, as)] ?? costs[artKey(path, as)]
}

interface Packed {
  palettes: number[][]
  /** Which palette each tile is drawn with. */
  tilePalettes: number[]
  /** Tiles across the image. */
  cols: number
}

function pack(rgba: ArrayLike<number>, width: number, height: number): Packed | { error: string } {
  if (width % TILE !== 0 || height % TILE !== 0) return { error: `is ${width}x${height} pixels; an image of tiles must be a multiple of 8 each way` }
  const cols = width / TILE
  const count = cols * (height / TILE)
  const palettes: number[][] = []
  const tilePalettes: number[] = []
  for (let tile = 0; tile < count; tile++) {
    const colours = tileColours(rgba, width, (tile % cols) * TILE, Math.floor(tile / cols) * TILE)
    if (colours.length > COLOURS) return { error: `tile ${tile} uses ${colours.length} colours; a GBA tile can use ${COLOURS} plus transparency` }
    // The palette that needs the fewest colours added to hold this tile's; the first of equals.
    let best = -1
    let bestMissing = Infinity
    for (let p = 0; p < palettes.length; p++) {
      const palette = palettes[p]!
      const missing = colours.filter((c) => !palette.includes(c)).length
      if (palette.length + missing <= COLOURS && missing < bestMissing) {
        best = p
        bestMissing = missing
      }
    }
    if (best < 0) {
      if (palettes.length === BG_PALETTES) {
        return { error: `tile ${tile} needs a 17th palette; the tiles' colours must fit ${BG_PALETTES} palettes of ${COLOURS}. Use fewer colour combinations across tiles` }
      }
      palettes.push([])
      best = palettes.length - 1
    }
    for (const colour of colours) if (!palettes[best]!.includes(colour)) palettes[best]!.push(colour)
    tilePalettes.push(best)
  }
  return { palettes, tilePalettes, cols }
}

/** The GBA colours of one tile, sorted as the build's ordered set sorts them. */
function tileColours(rgba: ArrayLike<number>, width: number, left: number, top: number): number[] {
  const seen = new Set<number>()
  for (let y = top; y < top + TILE; y++) {
    for (let x = left; x < left + TILE; x++) {
      const i = (y * width + x) * 4
      if (rgba[i + 3]! >= 128) seen.add(toBgr555(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!))
    }
  }
  return [...seen].sort((a, b) => a - b)
}

/** Tiles and palettes of an image used as a tileset: every 8x8 cell is a tile. RGBA pixels. */
export function tilesetCost(rgba: ArrayLike<number>, width: number, height: number): ArtResult {
  const packed = pack(rgba, width, height)
  if ('error' in packed) return packed
  // The build always makes one palette, even for an image with nothing drawn.
  return { tiles: packed.tilePalettes.length, palettes: Math.max(1, packed.palettes.length) }
}

/** Tiles and palettes of an image used as a background picture: a tile that repeats, in the same palette, counts once. */
export function backgroundCost(rgba: ArrayLike<number>, width: number, height: number): ArtResult {
  const packed = pack(rgba, width, height)
  if ('error' in packed) return packed
  const seen = new Set<string>()
  packed.tilePalettes.forEach((p, tile) => {
    const palette = packed.palettes[p]!
    const left = (tile % packed.cols) * TILE
    const top = Math.floor(tile / packed.cols) * TILE
    // The tile as the hardware stores it: each pixel's index in its palette, 0 for clear.
    let key = `${p}:`
    for (let y = top; y < top + TILE; y++) {
      for (let x = left; x < left + TILE; x++) {
        const i = (y * width + x) * 4
        key += rgba[i + 3]! >= 128 ? (palette.indexOf(toBgr555(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)) + 1).toString(16) : '0'
      }
    }
    seen.add(key)
  })
  return { tiles: seen.size, palettes: Math.max(1, packed.palettes.length) }
}

/** What a room puts in video memory, and where it comes from. */
export interface RoomBudget {
  /** Background tiles in video memory, of {@link MAX_BG_TILES}. */
  tiles: number
  /** Background palettes, of {@link BG_PALETTES}. */
  palettes: number
  /** Distinct tiles used by every room drawn with this room's tileset: they share its tiles in memory. */
  tilesetTiles: number
  tilesetPalettes: number
  /** Distinct tiles of the room's pictures, each picture counted once. */
  pictureTiles: number
  picturePalettes: number
}

const costOf = (art: ArtLookup, path: string, as: ArtUse): ArtCost | undefined => {
  const result = art(path, as)
  return result && !('error' in result) ? result : undefined
}

// Decoding every room's layers on each stroke would be slow in a big project: a room
// document is replaced, never changed, on an edit, so its tiles are kept by object.
const usedByRoom = new WeakMap<Room, Set<number> | null>()

/** The distinct tiles a room's layers use, or `null` when the build would skip the room. */
function usedTiles(room: Room): Set<number> | null {
  const known = usedByRoom.get(room)
  if (known !== undefined) return known
  const cells = room.width * SCREEN.cols * room.height * SCREEN.rows
  let used: Set<number> | null = new Set<number>()
  if (room.layers.length === 0 || room.layers.length > 3 || room.layers.some((l) => rleLength(l.data) !== cells)) used = null
  else for (const layer of room.layers) for (const cell of rleDecode(layer.data)) if (cell > 0) used.add(cell)
  usedByRoom.set(room, used)
  return used
}

/** The tiles every room drawn with `tileset` uses, together. */
function tilesetUse(docs: Documents, tileset: string): number {
  const all = new Set<number>()
  for (const room of Object.values(docs.rooms)) {
    if (room.tileset !== tileset) continue
    for (const tile of usedTiles(room) ?? []) all.add(tile)
  }
  return all.size
}

/**
 * The background tiles and palettes a room needs on screen, counted as the build does:
 * the tiles of all rooms on its tileset with its pictures' distinct tiles, and the
 * tileset's palettes with its pictures'. `null` for a missing room or tileset.
 */
export function roomBudget(docs: Documents, roomId: string, art: ArtLookup): RoomBudget | null {
  const room = docs.rooms[roomId]
  const tileset = room && docs.tilesets[room.tileset]
  if (!room || !tileset) return null
  const own = costOf(art, tileset.image, 'tileset')
  // Two backgrounds showing one picture share its tiles and palettes.
  const pictures = [...new Set((room.backgrounds ?? []).map((b) => b.image))].flatMap((path) => costOf(art, path, 'background') ?? [])
  const tilesetTiles = tilesetUse(docs, room.tileset)
  const tilesetPalettes = own?.palettes ?? 0
  const pictureTiles = pictures.reduce((sum, c) => sum + c.tiles, 0)
  const picturePalettes = pictures.reduce((sum, c) => sum + c.palettes, 0)
  return { tiles: tilesetTiles + pictureTiles, palettes: tilesetPalettes + picturePalettes, tilesetTiles, tilesetPalettes, pictureTiles, picturePalettes }
}

/** The problems a build would stop on over tiles and palettes, on the tileset or room they are about, in the build's words. */
export function budgetProblems(docs: Documents, art: ArtLookup): Problem[] {
  const problems: Problem[] = []
  const add = (file: string, message: string) => problems.push({ severity: 'error', file, message })
  const sorted = <T>(record: Record<string, T>) => Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  for (const [id, tileset] of sorted(docs.tilesets)) {
    const result = art(tileset.image, 'tileset')
    if (!result) continue
    if ('error' in result) add(docPath('tileset', id), `${tileset.image}: ${result.error}`)
    else if (result.tiles > MAX_BG_TILES) add(docPath('tileset', id), `${tileset.image} has ${result.tiles} tiles; a GBA background can address ${MAX_BG_TILES}`)
  }

  // A picture that cannot be converted is reported once, on the first room (by id) that shows it.
  const reported = new Set<string>()
  for (const [id, room] of sorted(docs.rooms)) {
    for (const { image } of room.backgrounds ?? []) {
      const result = art(image, 'background')
      if (reported.has(image) || !result || !('error' in result)) continue
      reported.add(image)
      add(docPath('room', id), `background ${image}: ${result.error}`)
    }
  }

  for (const [id, room] of sorted(docs.rooms)) {
    if (!room.backgrounds?.length) continue
    const budget = roomBudget(docs, id, art)
    if (!budget) continue
    const name = room.tileset
    if (budget.palettes > BG_PALETTES) {
      add(docPath('room', id), `its backgrounds need ${budget.picturePalettes} palettes and tileset "${name}" ${budget.tilesetPalettes}, which is ${budget.palettes}; the GBA has ${BG_PALETTES} for backgrounds. Use fewer colour combinations in the pictures`)
    }
    if (budget.tiles > MAX_BG_TILES) {
      add(docPath('room', id), `its backgrounds have ${budget.pictureTiles} distinct tiles and the rooms drawn with tileset "${name}" use ${budget.tilesetTiles}, which is ${budget.tiles}; video memory holds ${MAX_BG_TILES}. Make the pictures smaller or more repetitive`)
    }
  }
  return problems
}

/** RGBA pixels of an image, as a canvas holds them. */
export interface Pixels {
  data: ArrayLike<number>
  width: number
  height: number
}

/**
 * What an image being painted costs where the project uses it, from its unsaved
 * pixels: its own tiles and palettes (as a background if only rooms show it, else as a
 * tileset), and the room it brings closest to a limit, if any room uses it. `null` for
 * a sprite sheet, which takes sprite memory, not background memory.
 */
export function imageBudget(docs: Documents, art: ArtCosts, path: string, pixels: Pixels): { own: ArtResult; as: ArtUse; worst: { id: string; name: string; budget: RoomBudget } | null } | null {
  const asTileset = Object.values(docs.tilesets).some((t) => t.image === path)
  const asBackground = Object.values(docs.rooms).some((r) => r.backgrounds?.some((b) => b.image === path))
  const asSprite = Object.values(docs.sprites).some((s) => s.image === path || s.palette === path)
  if (asSprite && !asTileset && !asBackground) return null
  const live: ArtCosts = {}
  if (asTileset) live[artKey(path, 'tileset')] = tilesetCost(pixels.data, pixels.width, pixels.height)
  if (asBackground) live[artKey(path, 'background')] = backgroundCost(pixels.data, pixels.width, pixels.height)
  // An image nothing uses yet is counted as a tileset, its usual first use.
  const as: ArtUse = asBackground && !asTileset ? 'background' : 'tileset'
  const own = live[artKey(path, as)] ?? tilesetCost(pixels.data, pixels.width, pixels.height)
  const lookup = artLookup(art, live)
  const tilesets = new Set(Object.entries(docs.tilesets).filter(([, t]) => t.image === path).map(([id]) => id))
  const fill = (b: RoomBudget) => Math.max(b.tiles / MAX_BG_TILES, b.palettes / BG_PALETTES)
  let worst: { id: string; name: string; budget: RoomBudget } | null = null
  for (const [id, room] of Object.entries(docs.rooms)) {
    if (!tilesets.has(room.tileset) && !room.backgrounds?.some((b) => b.image === path)) continue
    const budget = roomBudget(docs, id, lookup)
    if (budget && (!worst || fill(budget) > fill(worst.budget))) worst = { id, name: room.name, budget }
  }
  return { own, as, worst }
}

/** How a readout of `used` against `limit` is coloured: amber from 90%, red over. */
export function budgetState(used: number, limit: number): 'ok' | 'near' | 'over' {
  if (used > limit) return 'over'
  return used * 10 >= limit * 9 ? 'near' : 'ok'
}
