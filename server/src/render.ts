// Pictures of a project for tools that cannot open the studio: a room as it is
// painted, a tileset with its grid, a frame of the running game.
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { SCREEN, TILE, rleDecode, rleLength, roomSize } from '@gba-studio/core'
import type { Documents, Room } from '@gba-studio/core'
import { HttpError } from './project.ts'
import type { ProjectFolder } from './project.ts'

export interface Picture {
  width: number
  height: number
  /** RGBA, row by row. */
  data: Uint8Array
}

export async function loadPng(project: ProjectFolder, path: string): Promise<Picture> {
  const bytes = await readFile(project.resolve(path)).catch(() => {
    throw new HttpError(404, `cannot read ${path}`)
  })
  const png = PNG.sync.read(bytes)
  return { width: png.width, height: png.height, data: png.data }
}

export function encodePng(picture: Picture): Buffer {
  const png = new PNG({ width: picture.width, height: picture.height })
  png.data = Buffer.from(picture.data.buffer, picture.data.byteOffset, picture.data.byteLength)
  return PNG.sync.write(png)
}

/** A picture enlarged by a whole factor, pixels kept square and sharp. */
export function scale(picture: Picture, factor: number): Picture {
  if (factor <= 1) return picture
  const out = new Uint8Array(picture.width * factor * picture.height * factor * 4)
  const source = new Uint32Array(picture.data.buffer, picture.data.byteOffset, picture.width * picture.height)
  const target = new Uint32Array(out.buffer)
  for (let y = 0; y < picture.height * factor; y++) {
    const row = Math.floor(y / factor) * picture.width
    for (let x = 0; x < picture.width * factor; x++) target[y * picture.width * factor + x] = source[row + Math.floor(x / factor)]!
  }
  return { width: picture.width * factor, height: picture.height * factor, data: out }
}

function blend(picture: Picture, x: number, y: number, [r, g, b]: [number, number, number], alpha: number): void {
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return
  const i = (y * picture.width + x) * 4
  picture.data[i] = picture.data[i]! * (1 - alpha) + r * alpha
  picture.data[i + 1] = picture.data[i + 1]! * (1 - alpha) + g * alpha
  picture.data[i + 2] = picture.data[i + 2]! * (1 - alpha) + b * alpha
  picture.data[i + 3] = 255
}
function fill(picture: Picture, x: number, y: number, w: number, h: number, colour: [number, number, number], alpha: number): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) blend(picture, x + dx, y + dy, colour, alpha)
}
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/** A room's layers as cells, and its collision overrides; wrong-sized data comes out empty. */
export function roomCells(room: Room): { cols: number; rows: number; layers: Uint16Array[]; collision: Uint16Array } {
  const { cols, rows } = roomSize(room)
  const cells = (data: readonly number[] | undefined) => (data && rleLength(data) === cols * rows ? rleDecode(data) : new Uint16Array(cols * rows))
  return { cols, rows, layers: room.layers.map((l) => cells(l.data)), collision: cells(room.collision) }
}

/** The collision class index that applies in each cell: an override, or the frontmost tile's class that is not empty. */
export function effectiveCollision(docs: Documents, room: Room): Uint8Array {
  const classes = docs.project?.collisionClasses ?? []
  const tileset = docs.tilesets[room.tileset]
  const byTile = new Map<number, number>()
  for (const [tile, id] of Object.entries(tileset?.collision ?? {})) {
    const index = classes.findIndex((c) => c.id === id)
    if (index >= 0) byTile.set(Number(tile), index)
  }
  const { cols, rows, layers, collision } = roomCells(room)
  const out = new Uint8Array(cols * rows)
  for (let i = 0; i < out.length; i++) {
    if (collision[i]! > 0) {
      out[i] = collision[i]! - 1
      continue
    }
    for (let l = layers.length - 1; l >= 0; l--) {
      const index = layers[l]![i]! > 0 ? byTile.get(layers[l]![i]! - 1) : undefined
      if (index !== undefined && classes[index]?.kind !== 'empty') {
        out[i] = index
        break
      }
    }
  }
  return out
}

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** A room, or a part of it given in tiles, drawn as the studio shows it. */
export async function renderRoom(project: ProjectFolder, docs: Documents, id: string, options: { region?: Region; collision?: boolean; entities?: boolean; backgrounds?: boolean }): Promise<Picture> {
  const room = docs.rooms[id]
  if (!room) throw new HttpError(404, `no room "${id}"`)
  const tileset = docs.tilesets[room.tileset]
  if (!tileset) throw new HttpError(409, `room "${id}" uses tileset "${room.tileset}", which does not exist`)
  const sheet = await loadPng(project, tileset.image)
  const sheetCols = Math.floor(sheet.width / TILE)
  const sheetTiles = sheetCols * Math.floor(sheet.height / TILE)
  const { cols, rows, layers } = roomCells(room)
  const region = options.region ?? { x: 0, y: 0, width: cols, height: rows }
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x + region.width > cols || region.y + region.height > rows) {
    throw new HttpError(400, `the region is outside the room, which is ${cols}x${rows} tiles`)
  }
  const picture: Picture = { width: region.width * TILE, height: region.height * TILE, data: new Uint8Array(region.width * TILE * region.height * TILE * 4) }
  // Empty cells show a dark backdrop rather than transparency.
  for (let i = 0; i < picture.data.length; i += 4) picture.data.set([22, 22, 22, 255], i)
  // Backgrounds repeat from the room's top-left corner, which is how they lie when the
  // camera is there. In the game they scroll slower than the room.
  for (const background of options.backgrounds === false ? [] : (room.backgrounds ?? [])) {
    const image = await loadPng(project, background.image).catch(() => null)
    if (!image) continue
    for (let y = 0; y < picture.height; y++) {
      for (let x = 0; x < picture.width; x++) {
        const s = (((y + region.y * TILE) % image.height) * image.width + ((x + region.x * TILE) % image.width)) * 4
        if (image.data[s + 3]! >= 128) picture.data.set(image.data.subarray(s, s + 4), (y * picture.width + x) * 4)
      }
    }
  }
  for (const layer of layers) {
    for (let cy = 0; cy < region.height; cy++) {
      for (let cx = 0; cx < region.width; cx++) {
        const tile = layer[(region.y + cy) * cols + region.x + cx]! - 1
        if (tile < 0 || tile >= sheetTiles) continue
        const sx = (tile % sheetCols) * TILE
        const sy = Math.floor(tile / sheetCols) * TILE
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const s = ((sy + y) * sheet.width + sx + x) * 4
            if (sheet.data[s + 3]! >= 128) picture.data.set(sheet.data.subarray(s, s + 4), ((cy * TILE + y) * picture.width + cx * TILE + x) * 4)
          }
        }
      }
    }
  }
  if (options.collision) {
    const classes = docs.project?.collisionClasses ?? []
    const effective = effectiveCollision(docs, room)
    for (let cy = 0; cy < region.height; cy++) {
      for (let cx = 0; cx < region.width; cx++) {
        const cls = classes[effective[(region.y + cy) * cols + region.x + cx]!]
        if (cls && cls.kind !== 'empty') fill(picture, cx * TILE, cy * TILE, TILE, TILE, rgb(cls.colour), 0.5)
      }
    }
  }
  if (options.entities !== false) {
    for (const entity of room.entities) {
      const type = docs.project?.entityTypes.find((t) => t.id === entity.type)
      // Entities stand on their position: the marker is the 8x8 box above it.
      const x = entity.x - region.x * TILE - TILE / 2
      const y = entity.y - region.y * TILE - TILE
      fill(picture, x - 1, y - 1, TILE + 2, TILE + 2, [255, 255, 255], 1)
      fill(picture, x, y, TILE, TILE, rgb(type?.colour ?? '#888888'), 1)
    }
  }
  // Screen boundaries, the unit rooms are sized in.
  for (let x = 0; x < picture.width; x++) for (let y = 0; y < picture.height; y++) {
    if ((x + region.x * TILE) % SCREEN.width === 0 || (y + region.y * TILE) % SCREEN.height === 0) blend(picture, x, y, [76, 159, 254], 0.45)
  }
  return picture
}

/** An image enlarged, with a line between cells of a given size so they can be counted row by row. */
export async function renderSheet(project: ProjectFolder, image: string, cellWidth: number, cellHeight: number, factor: number): Promise<{ picture: Picture; cols: number; rows: number }> {
  const sheet = await loadPng(project, image)
  const backdrop: Picture = { width: sheet.width, height: sheet.height, data: new Uint8Array(sheet.data.length) }
  for (let i = 0; i < sheet.data.length; i += 4) {
    if (sheet.data[i + 3]! >= 128) backdrop.data.set(sheet.data.subarray(i, i + 4), i)
    else backdrop.data.set([22, 22, 22, 255], i)
  }
  const picture = scale(backdrop, factor)
  for (let y = 0; y < picture.height; y++) for (let x = 0; x < picture.width; x++) {
    if (x % (cellWidth * factor) === 0 || y % (cellHeight * factor) === 0) blend(picture, x, y, [255, 255, 255], 0.35)
  }
  return { picture, cols: Math.floor(sheet.width / cellWidth), rows: Math.floor(sheet.height / cellHeight) }
}

/** A tileset enlarged with its tile grid: tile n is at column n % cols, row n / cols. */
export async function renderTileset(project: ProjectFolder, docs: Documents, id: string, factor: number): Promise<{ picture: Picture; cols: number; rows: number }> {
  const tileset = docs.tilesets[id]
  if (!tileset) throw new HttpError(404, `no tileset "${id}"`)
  return renderSheet(project, tileset.image, TILE, TILE, factor)
}
