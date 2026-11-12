// Writes the sample project's placeholder tileset: flat-colour test tiles, not art.
// Replace sample/assets/tiles.png with your own drawing; the studio reloads it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const TILE = 8
const COLS = 8
const ROWS = 2
const width = COLS * TILE
const height = ROWS * TILE
const rgba = new Uint8Array(width * height * 4)

type Rgb = [number, number, number]
const ROCK: Rgb = [92, 84, 110]
const ROCK_LIGHT: Rgb = [140, 130, 160]
const ROCK_DARK: Rgb = [58, 52, 74]
const STEEL: Rgb = [200, 196, 150]
const HAZARD: Rgb = [214, 64, 159]
const MOSS: Rgb = [70, 167, 88]

function put(tile: number, x: number, y: number, [r, g, b]: Rgb): void {
  const px = (tile % COLS) * TILE + x
  const py = Math.floor(tile / COLS) * TILE + y
  rgba.set([r, g, b, 255], (py * width + px) * 4)
}
/** Paints tile pixels where `inside` says so. */
function tile(index: number, inside: (x: number, y: number) => Rgb | null): void {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const colour = inside(x, y)
    if (colour) put(index, x, y, colour)
  }
}

// 0 stays transparent: the empty tile.
tile(1, (x, y) => ((x + y * 3) % 7 === 0 ? ROCK_DARK : ROCK)) // rock
tile(2, (x, y) => (y === 0 ? MOSS : y === 1 ? ROCK_LIGHT : (x + y * 3) % 7 === 0 ? ROCK_DARK : ROCK)) // rock with a top edge
tile(3, (_x, y) => (y === 0 ? STEEL : y === 1 ? ROCK_DARK : null)) // one-way girder
tile(4, (x, y) => (y >= TILE - 1 - x ? (y === TILE - 1 - x ? ROCK_LIGHT : ROCK) : null)) // slope up
tile(5, (x, y) => (y >= x ? (y === x ? ROCK_LIGHT : ROCK) : null)) // slope down
tile(6, (x, y) => (y >= TILE - 1 - (x < 4 ? x : 7 - x) * 2 ? HAZARD : null)) // spikes
tile(7, (x, y) => ((x ^ y) & 1 ? ROCK_DARK : null)) // back wall, no collision

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

const header = Buffer.alloc(13)
header.writeUInt32BE(width, 0)
header.writeUInt32BE(height, 4)
header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
const scanlines = Buffer.alloc((width * 4 + 1) * height)
for (let y = 0; y < height; y++) {
  scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scanlines)),
  chunk('IEND', new Uint8Array()),
])

const dir = new URL('../sample/assets/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('tiles.png', dir), png)
console.log(`wrote sample/assets/tiles.png (${width}x${height}, ${COLS * ROWS} tiles)`)
