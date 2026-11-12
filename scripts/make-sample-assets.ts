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

function encode(w: number, h: number, pixels: Uint8Array): Buffer {
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0)
  head.writeUInt32BE(h, 4)
  head.set([8, 6, 0, 0, 0], 8)
  const lines = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) lines.set(pixels.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(lines)), chunk('IEND', new Uint8Array())])
}

// The placeholder hero: four 16x16 frames drawn from text. `.` is transparent.
const HERO_COLOURS: Record<string, Rgb> = { o: [24, 20, 37], b: [76, 159, 254], w: [240, 240, 240], s: [245, 217, 10], r: [229, 72, 77] }
const BODY = [
  '....oooooo......',
  '...obbbbbbo.....',
  '..obbbbbbbbo....',
  '..obbwobbwoo....',
  '..obbwobbwoo....',
  '..obbbbbbbbo....',
  '..obbbrrrbbo....',
  '...obbbbbbo.....',
  '..oossssssoo....',
  '.osobbbbbboso...',
  '.osobbbbbboso...',
  '..oobbbbbboo....',
]
const LEGS: string[][] = [
  ['...obbobbo......', '...obbobbo......', '...orrorro......', '...oooooo.......'], // idle
  ['..obbo.obbo.....', '.obbo...obbo....', '.orro...orro....', '.ooo....ooo.....'], // run, legs apart
  ['...obbbbo.......', '....obbo........', '....orro........', '....oooo........'], // run, legs together
  ['..obbo..obbo....', '..orro..orro....', '..ooo...ooo.....', '................'], // jump
]
const hero = new Uint8Array(64 * 16 * 4)
LEGS.forEach((legs, frame) => {
  ;[...BODY, ...legs].forEach((row, y) => {
    ;[...row].forEach((c, x) => {
      const colour = HERO_COLOURS[c]
      if (colour) hero.set([...colour, 255], (y * 64 + frame * 16 + x) * 4)
    })
  })
})

const dir = new URL('../sample/assets/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('tiles.png', dir), png)
writeFileSync(new URL('hero.png', dir), encode(64, 16, hero))
console.log('wrote sample/assets/hero.png (64x16, 4 frames of 16x16)')
console.log(`wrote sample/assets/tiles.png (${width}x${height}, ${COLS * ROWS} tiles)`)
