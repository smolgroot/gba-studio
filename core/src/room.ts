// Helpers for making and reshaping rooms, shared by the editors and the tests.
import { rleDecode, rleEncode, rleLength } from './rle.ts'
import { FORMAT_VERSION, Id, SCREEN } from './schema.ts'
import type { Room } from './schema.ts'

/** A document id from a display name: "Crystal Cave 2" gives "crystal-cave-2". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents, split off by the line above
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return Id.safeParse(slug).success ? slug : 'item'
}

/** `base`, or `base-2`, `base-3`... if it is taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

export function roomSize(room: Pick<Room, 'width' | 'height'>): { cols: number; rows: number } {
  return { cols: room.width * SCREEN.cols, rows: room.height * SCREEN.rows }
}

export function emptyRoom(name: string, width: number, height: number, tileset: string): Room {
  return {
    version: FORMAT_VERSION,
    name,
    width,
    height,
    tileset,
    layers: [{ name: 'Ground', data: [width * SCREEN.cols * height * SCREEN.rows, 0] }],
    entities: [],
  }
}

/** A grid of cells cut or padded to a new size, keeping its top-left corner. */
export function resizeGrid(cells: Uint16Array, cols: number, rows: number, newCols: number, newRows: number): Uint16Array {
  const out = new Uint16Array(newCols * newRows)
  const copyCols = Math.min(cols, newCols)
  for (let row = 0; row < Math.min(rows, newRows); row++) {
    out.set(cells.subarray(row * cols, row * cols + copyCols), row * newCols)
  }
  return out
}

/** The room at a new size in screens. What no longer fits (tiles, entities) is dropped. */
export function resizeRoom(room: Room, width: number, height: number): Room {
  const from = roomSize(room)
  const to = roomSize({ width, height })
  const resize = (data: readonly number[]): number[] => {
    // Data of the wrong length is replaced by an empty grid rather than carried over.
    const cells = rleLength(data) === from.cols * from.rows ? rleDecode(data) : new Uint16Array(from.cols * from.rows)
    return rleEncode(resizeGrid(cells, from.cols, from.rows, to.cols, to.rows))
  }
  const collision = room.collision ? resize(room.collision) : undefined
  return {
    ...room,
    width,
    height,
    layers: room.layers.map((layer) => ({ ...layer, data: resize(layer.data) })),
    collision: collision && collision.length > 2 ? collision : collision?.[1] ? collision : undefined,
    entities: room.entities.filter((e) => e.x < width * SCREEN.width && e.y < height * SCREEN.height),
  }
}
