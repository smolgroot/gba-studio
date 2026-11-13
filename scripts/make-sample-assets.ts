// Writes the sample project's placeholder images and sounds: flat-colour test tiles,
// a hero, collectibles, counter digits, two backgrounds, and four synthesised sound
// effects. Not art: replace any file under sample/assets/ with your own and the studio
// reloads it.
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

/** A sheet of 8x8 frames side by side, each drawn from eight rows of text. `.` is transparent. */
function sheet(frames: string[][], colours: Record<string, Rgb>): Buffer {
  const w = frames.length * 8
  const pixels = new Uint8Array(w * 8 * 4)
  frames.forEach((rows, frame) => {
    rows.forEach((row, y) => {
      ;[...row].forEach((c, x) => {
        const colour = colours[c]
        if (colour) pixels.set([...colour, 255], (y * w + frame * 8 + x) * 4)
      })
    })
  })
  return encode(w, 8, pixels)
}

// A coin turning: face on, three-quarters, edge on, three-quarters.
const COIN_COLOURS: Record<string, Rgb> = { o: [120, 72, 8], g: [245, 196, 30], l: [255, 240, 150], d: [196, 138, 14] }
const COIN_TURNED = ['...oo...', '..olgo..', '..olgo..', '..oggo..', '..oggo..', '..ogdo..', '..ogdo..', '...oo...']
const COIN = [
  ['..oooo..', '.olgggo.', 'olgggggo', 'olggdggo', 'olggdggo', 'oggggddo', '.ogdddo.', '..oooo..'],
  COIN_TURNED,
  ['...oo...', '...ogo..', '...ogo..', '...ogo..', '...ogo..', '...ogo..', '...ogo..', '...oo...'],
  COIN_TURNED,
]
// A diamond, and the same with a glint crossing it.
const DIAMOND_COLOURS: Record<string, Rgb> = { o: [16, 52, 96], c: [70, 200, 240], l: [190, 245, 255], d: [30, 130, 200], w: [255, 255, 255] }
const DIAMOND = [
  ['........', '.oooooo.', 'olllccdo', 'olccccdo', '.occcdo.', '..ocdo..', '...oo...', '........'],
  ['........', '.oooooo.', 'olwlccdo', 'owwwccdo', '.owccdo.', '..ocdo..', '...oo...', '........'],
]
// Digits 0 to 9 for the counter, one a frame.
const DIGIT_COLOURS: Record<string, Rgb> = { o: [24, 20, 37], w: [240, 240, 240] }
const SEGMENTS: Record<string, string[]> = {
  '0': ['www', 'w.w', 'w.w', 'w.w', 'www'],
  '1': ['.w.', 'ww.', '.w.', '.w.', 'www'],
  '2': ['www', '..w', 'www', 'w..', 'www'],
  '3': ['www', '..w', 'www', '..w', 'www'],
  '4': ['w.w', 'w.w', 'www', '..w', '..w'],
  '5': ['www', 'w..', 'www', '..w', 'www'],
  '6': ['www', 'w..', 'www', 'w.w', 'www'],
  '7': ['www', '..w', '..w', '.w.', '.w.'],
  '8': ['www', 'w.w', 'www', 'w.w', 'www'],
  '9': ['www', 'w.w', 'www', '..w', 'www'],
}
/** A 3x5 glyph centred in a frame with a dark outline, so it reads over any tile. */
function digit(glyph: string[]): string[] {
  const lit = (x: number, y: number) => glyph[y - 1]?.[x - 2] === 'w'
  return Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => {
      if (lit(x, y)) return 'w'
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lit(x + dx, y + dy)) return 'o'
      return '.'
    }).join(''),
  )
}

// Two pictures for behind the rooms, each 128 pixels wide and one screen tall, made to
// repeat sideways: a night sky over far mountains, and nearer hills with nothing above
// them, so the sky shows through. A few flat colours each: one GBA palette apiece.
const BACKDROP = { width: 128, height: 160 }
/** A zigzag between 0 and 1 that repeats every `period` pixels. */
const zigzag = (x: number, period: number) => Math.abs(((x / period) % 1) * 2 - 1)
function backdrop(colour: (x: number, y: number) => Rgb | null): Buffer {
  const pixels = new Uint8Array(BACKDROP.width * BACKDROP.height * 4)
  for (let y = 0; y < BACKDROP.height; y++) for (let x = 0; x < BACKDROP.width; x++) {
    const c = colour(x, y)
    if (c) pixels.set([...c, 255], (y * BACKDROP.width + x) * 4)
  }
  return encode(BACKDROP.width, BACKDROP.height, pixels)
}
const SKY: Rgb[] = [[14, 16, 36], [20, 24, 52], [28, 34, 70], [38, 46, 90]]
const STAR: Rgb = [206, 206, 232]
const far = backdrop((x, y) => {
  const top = BACKDROP.height - Math.round(26 + 30 * zigzag(x + 20, 64) + 10 * zigzag(x, 16))
  if (y > top) return [50, 44, 84]
  if (y === top) return [76, 66, 116]
  // A star wherever a scramble of the position says so, thinning out towards the mountains.
  if (y < 96 && (x * 37 + y * 101 + ((x * y) % 13) * 7) % 211 === 0) return STAR
  return SKY[Math.min(3, Math.floor(y / 36))]!
})
const near = backdrop((x, y) => {
  const top = BACKDROP.height - Math.round(34 + 34 * zigzag(x, 128) ** 2 + 6 * zigzag(x + 5, 32))
  return y > top + 1 ? [30, 26, 50] : y >= top ? [46, 40, 72] : null
})

const dir = new URL('../sample/assets/', import.meta.url)
mkdirSync(dir, { recursive: true })
const backgrounds = new URL('backgrounds/', dir)
mkdirSync(backgrounds, { recursive: true })
writeFileSync(new URL('far.png', backgrounds), far)
writeFileSync(new URL('near.png', backgrounds), near)
console.log(`wrote sample/assets/backgrounds/far.png and near.png (${BACKDROP.width}x${BACKDROP.height}, repeating sideways)`)
writeFileSync(new URL('tiles.png', dir), png)
writeFileSync(new URL('hero.png', dir), encode(64, 16, hero))
const sprites = new URL('sprites/', dir)
mkdirSync(sprites, { recursive: true })
writeFileSync(new URL('coin.png', sprites), sheet(COIN, COIN_COLOURS))
writeFileSync(new URL('diamond.png', sprites), sheet(DIAMOND, DIAMOND_COLOURS))
writeFileSync(new URL('digits.png', sprites), sheet('0123456789'.split('').map((d) => digit(SEGMENTS[d]!)), DIGIT_COLOURS))
console.log('wrote sample/assets/sprites/coin.png (32x8), diamond.png (16x8) and digits.png (80x8), frames of 8x8')
console.log('wrote sample/assets/hero.png (64x16, 4 frames of 16x16)')
console.log(`wrote sample/assets/tiles.png (${width}x${height}, ${COLS * ROWS} tiles)`)

// Sound effects: 8-bit mono WAV at the rate the game's mixer runs at (agb's
// Frequency::Hz10512). A file at any other rate plays at the wrong speed.
const RATE = 10512

/** A note or a glide: `from` to `to` in Hz over `seconds`, fading out from `volume`. */
type Tone = { from: number; to?: number; seconds: number; volume?: number; noise?: number }

/** Square-wave tones one after another. Only the harmonics the rate can carry are summed, so high notes stay clean. */
function synth(tones: Tone[]): Float32Array {
  const out = new Float32Array(Math.ceil(tones.reduce((sum, t) => sum + t.seconds, 0) * RATE))
  let at = 0
  let seed = 1
  for (const { from, to = from, seconds, volume = 1, noise = 0 } of tones) {
    const length = Math.round(seconds * RATE)
    let phase = 0
    for (let i = 0; i < length && at < out.length; i++, at++) {
      const t = i / length
      const hz = from + (to - from) * t
      phase += (2 * Math.PI * hz) / RATE
      let square = 0
      for (let k = 1; k * hz < RATE * 0.45; k += 2) square += Math.sin(k * phase) / k
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const hiss = (seed / 0x40000000 - 1) * noise
      // A few milliseconds of attack so a note does not start with a click.
      const envelope = Math.min(1, i / (RATE * 0.003)) * (1 - t) ** 1.5
      out[at] = (square * (4 / Math.PI) * (1 - noise) + hiss) * envelope * volume * 0.7
    }
  }
  return out
}

function wav(samples: Float32Array): Buffer {
  // A chunk of odd length is followed by a padding byte.
  const out = Buffer.alloc(44 + samples.length + (samples.length & 1))
  out.write('RIFF', 0, 'latin1')
  out.writeUInt32LE(out.length - 8, 4)
  out.write('WAVEfmt ', 8, 'latin1')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(1, 22) // mono
  out.writeUInt32LE(RATE, 24)
  out.writeUInt32LE(RATE, 28) // bytes a second
  out.writeUInt16LE(1, 32) // bytes a sample
  out.writeUInt16LE(8, 34) // bits a sample
  out.write('data', 36, 'latin1')
  out.writeUInt32LE(samples.length, 40)
  samples.forEach((sample, i) => out.writeUInt8(Math.round(128 + Math.max(-1, Math.min(1, sample)) * 127), 44 + i))
  return out
}

const SOUNDS: Record<string, Tone[]> = {
  // Two rising notes.
  coin: [{ from: 988, seconds: 0.06 }, { from: 1319, seconds: 0.3 }],
  // A quick arpeggio up an octave that rings out.
  diamond: [{ from: 1319, seconds: 0.06 }, { from: 1661, seconds: 0.06 }, { from: 1976, seconds: 0.06 }, { from: 2637, seconds: 0.45 }],
  // A harsh falling buzz.
  damage: [{ from: 420, to: 180, seconds: 0.1, noise: 0.5 }, { from: 240, to: 70, seconds: 0.28, noise: 0.35 }],
  // A short glide up.
  jump: [{ from: 280, to: 760, seconds: 0.14, volume: 0.8 }],
}
const audio = new URL('audio/', dir)
mkdirSync(audio, { recursive: true })
for (const [name, tones] of Object.entries(SOUNDS)) writeFileSync(new URL(`${name}.wav`, audio), wav(synth(tones)))
console.log(`wrote sample/assets/audio/${Object.keys(SOUNDS).join('.wav, ')}.wav (8-bit mono, ${RATE} Hz)`)
