// Procedural tilesets for 2D platformers: a surface material (grass, snow, moss) over a
// body material (earth, bricks, cut stone, cobbles), cut into the blocks a level is built
// from. Pure and seeded: the same options always give the same pixels.
//
// What comes out is ready for the GBA build: the sheet is blocks laid edge to edge with no
// padding or margin, every size is a multiple of 8, and the whole sheet uses at most 15
// colours, so every 8x8 tile fits one 16-colour palette.
import { fromBgr555, toBgr555 } from './gba.ts'

export type BodyPattern = 'earth' | 'bricks' | 'stone' | 'cobble' | 'wood' | 'panels'
export type TopStyle = 'smooth' | 'rough' | 'battlements'
export type TileCollision = 'empty' | 'solid' | 'oneway' | 'slope' | 'hazard'

export interface TilegenColours {
  surface: string
  surfaceDark: string
  body: string
  bodyDark: string
  accent: string
  accentDark: string
}

export interface TilegenOptions {
  /** Pixels a side of one block: 8 is one GBA tile, 16 is 2x2 tiles, 32 is 4x4. */
  blockSize: 8 | 16 | 32
  seed: number
  colours: TilegenColours
  /** Tones of the body, light to dark, 2 to 6. The surface gets up to 4. */
  shades: number
  /** Draw the surface layer (grass, snow, moss) over open tops. */
  surface: boolean
  /** Thickness of the surface layer, in pixels. */
  surfaceDepth: number
  /** How far the surface hangs down open sides, in pixels. */
  overhang: number
  /** Ragged bottom of the surface layer (drips), 0 to 4 pixels. */
  roughness: number
  /** How much open edges are eaten away, 0 to 3 pixels. */
  edgeNoise: number
  /** Rounding of outer corners, in pixels. */
  cornerRadius: number
  /** Contrast of the texture inside the body, 0 to 100. */
  texture: number
  /** Horizontal layers in earth, 0 to 100. */
  strata: number
  /** Stones embedded in earth, or knots in wood, 0 to 100. */
  pebbles: number
  pattern: BodyPattern
  top: TopStyle
  /** A dark line around every open edge. */
  outline: boolean
  /** Ordered dithering between tones. */
  dither: boolean
}

export interface TilegenPreset {
  id: string
  name: string
  options: Partial<TilegenOptions> & { colours: TilegenColours }
}

export const TILEGEN_PRESETS: readonly TilegenPreset[] = [
  { id: 'meadow', name: 'Meadow', options: { colours: { surface: '#8bd54e', surfaceDark: '#2e7a36', body: '#b9824f', bodyDark: '#3f2418', accent: '#ffd84a', accentDark: '#e0522c' }, pattern: 'earth', surface: true, top: 'smooth', strata: 25, pebbles: 35 } },
  { id: 'snowcap', name: 'Snowcap', options: { colours: { surface: '#f6faff', surfaceDark: '#93aed3', body: '#8e95a8', bodyDark: '#2c3043', accent: '#86dcff', accentDark: '#3a78b8' }, pattern: 'stone', surface: true, top: 'rough', roughness: 3, strata: 0 } },
  { id: 'dunes', name: 'Dunes', options: { colours: { surface: '#f5dc8a', surfaceDark: '#c99a42', body: '#d78f52', bodyDark: '#6e3420', accent: '#8ccf4a', accentDark: '#3d7a2c' }, pattern: 'earth', surface: true, top: 'smooth', strata: 80, pebbles: 10, roughness: 1 } },
  { id: 'volcanic', name: 'Volcanic', options: { colours: { surface: '#958a84', surfaceDark: '#4a403e', body: '#5e4c55', bodyDark: '#16111a', accent: '#ffbb4a', accentDark: '#e23e1a' }, pattern: 'cobble', surface: true, top: 'rough', roughness: 2, texture: 60 } },
  { id: 'castle', name: 'Castle', options: { colours: { surface: '#8fc55a', surfaceDark: '#3f6b2a', body: '#aeb1c0', bodyDark: '#33354a', accent: '#ffd25a', accentDark: '#d8561f' }, pattern: 'bricks', surface: false, top: 'battlements', edgeNoise: 0, cornerRadius: 0, texture: 35 } },
  { id: 'ruins', name: 'Mossy ruins', options: { colours: { surface: '#9ccc52', surfaceDark: '#3d6a2c', body: '#a39d8b', bodyDark: '#35312c', accent: '#f0e07a', accentDark: '#b05a8a' }, pattern: 'stone', surface: true, top: 'rough', roughness: 3, edgeNoise: 1, texture: 45 } },
  { id: 'town', name: 'Brick town', options: { colours: { surface: '#e8e4d8', surfaceDark: '#8f8a7c', body: '#d4704f', bodyDark: '#4e1e1c', accent: '#ffe48c', accentDark: '#5f86cc' }, pattern: 'bricks', surface: false, top: 'smooth', edgeNoise: 0, cornerRadius: 0, texture: 30 } },
  { id: 'crystal', name: 'Crystal cave', options: { colours: { surface: '#c793ff', surfaceDark: '#5f3aa8', body: '#56618a', bodyDark: '#151a30', accent: '#80f7e2', accentDark: '#2aa29d' }, pattern: 'cobble', surface: true, top: 'rough', roughness: 2, texture: 50 } },
  { id: 'swamp', name: 'Swamp', options: { colours: { surface: '#a4cf3e', surfaceDark: '#46661c', body: '#5e5c3c', bodyDark: '#1d1f14', accent: '#ef74b0', accentDark: '#8c2a5c' }, pattern: 'earth', surface: true, top: 'rough', roughness: 4, strata: 10, pebbles: 20, overhang: 6 } },
  { id: 'cabin', name: 'Wood cabin', options: { colours: { surface: '#9ccc52', surfaceDark: '#3d6a2c', body: '#cf9459', bodyDark: '#3a2012', accent: '#ffd25a', accentDark: '#d8561f' }, pattern: 'wood', surface: false, top: 'smooth', edgeNoise: 0, cornerRadius: 1, texture: 45, pebbles: 40, dither: false } },
  { id: 'spaceship', name: 'Spaceship', options: { colours: { surface: '#a8f4ff', surfaceDark: '#2f86b0', body: '#bcc4d2', bodyDark: '#262b38', accent: '#ffd24a', accentDark: '#ff5a36' }, pattern: 'panels', surface: true, surfaceDepth: 2, overhang: 0, roughness: 0, top: 'smooth', edgeNoise: 0, cornerRadius: 1, texture: 30, dither: false } },
  { id: 'reactor', name: 'Reactor deck', options: { colours: { surface: '#ffbe4d', surfaceDark: '#c2410c', body: '#6b7183', bodyDark: '#11131b', accent: '#86ff6e', accentDark: '#1d9a4c' }, pattern: 'panels', surface: true, surfaceDepth: 2, overhang: 0, roughness: 0, top: 'smooth', edgeNoise: 0, cornerRadius: 0, texture: 45, dither: true } },
  { id: 'ice', name: 'Ice palace', options: { colours: { surface: '#ffffff', surfaceDark: '#b6dcf5', body: '#bfe6fb', bodyDark: '#3e6ea6', accent: '#ffffff', accentDark: '#7fc6ff' }, pattern: 'stone', surface: false, top: 'battlements', edgeNoise: 0, cornerRadius: 0, texture: 25 } },
]

export const DEFAULT_TILEGEN: TilegenOptions = {
  blockSize: 16,
  seed: 1,
  colours: TILEGEN_PRESETS[0]!.options.colours,
  shades: 4,
  surface: true,
  surfaceDepth: 4,
  overhang: 3,
  roughness: 2,
  edgeNoise: 1,
  cornerRadius: 3,
  texture: 40,
  strata: 25,
  pebbles: 35,
  pattern: 'earth',
  top: 'smooth',
  outline: true,
  dither: true,
}

/** A preset's options over the defaults, its pixel sizes scaled to `blockSize`. */
export function presetOptions(preset: TilegenPreset, blockSize: TilegenOptions['blockSize'], seed: number): TilegenOptions {
  return scaleOptions({ ...DEFAULT_TILEGEN, ...preset.options, blockSize: 16, seed }, blockSize)
}

/** The options for another block size, pixel distances scaled to match. */
export function scaleOptions(options: TilegenOptions, blockSize: TilegenOptions['blockSize']): TilegenOptions {
  const k = blockSize / options.blockSize
  const px = (v: number, min = 0) => Math.max(min, Math.round(v * k))
  return {
    ...options,
    blockSize,
    surfaceDepth: px(options.surfaceDepth, 1),
    overhang: px(options.overhang),
    cornerRadius: px(options.cornerRadius),
    roughness: Math.min(4, px(options.roughness)),
  }
}

/** One block of the sheet and what it is for. */
export interface TilegenBlock {
  name: string
  label: string
  col: number
  row: number
  collision: TileCollision
  /** Slopes: the floor's height at the block's left and right edge, in block heights. */
  slope?: { from: number; to: number }
}

export interface GeneratedTileset {
  blockSize: number
  /** Size of the sheet in blocks. */
  cols: number
  rows: number
  /** Size of the sheet in pixels: multiples of 8. */
  width: number
  height: number
  /** RGBA pixels, row by row; air is fully transparent. */
  rgba: Uint8ClampedArray
  /** The colours the sheet can use, as `#rrggbb` already on the GBA's 15-bit grid. */
  palette: string[]
  blocks: TilegenBlock[]
}

// ---------------------------------------------------------------------------------------
// Layout. Names: t/b/l/r are the sides that face air.

interface Sides { t: boolean; b: boolean; l: boolean; r: boolean }
interface Corners { tl: boolean; tr: boolean; bl: boolean; br: boolean }
type BlockKind =
  | { type: 'ground'; open: Sides; diag?: Partial<Corners>; salt?: number }
  | { type: 'back'; salt?: number; feature?: 'window' | 'shadow' }
  | { type: 'deco'; deco: Deco }
  /** Ground under a straight floor rising from `from` to `to` block heights, left to right. */
  | { type: 'slope'; from: number; to: number }
type Deco = 'tuft' | 'flower' | 'rock' | 'torch' | 'spikes' | 'canister' | 'terminal' | 'crate' | 'lamp' | 'stalactite' | 'vine' | 'pipe' | 'cable'

/** Metal panels are for interiors: the outdoor decorations become machinery. */
const TECH_DECO: Partial<Record<Deco, [Deco, string]>> = {
  tuft: ['canister', 'Canister'],
  flower: ['terminal', 'Terminal'],
  rock: ['crate', 'Crate'],
  torch: ['lamp', 'Wall lamp'],
  stalactite: ['pipe', 'Pipe'],
  vine: ['cable', 'Cable'],
}

const S = (sides: string): Sides => ({ t: sides.includes('t'), b: sides.includes('b'), l: sides.includes('l'), r: sides.includes('r') })

const LAYOUT: ReadonlyArray<ReadonlyArray<[string, string, BlockKind, TileCollision]>> = [
  [
    ['tl', 'Top left', { type: 'ground', open: S('tl') }, 'solid'],
    ['t', 'Top', { type: 'ground', open: S('t') }, 'solid'],
    ['tr', 'Top right', { type: 'ground', open: S('tr') }, 'solid'],
    ['pillar-top', 'Pillar top', { type: 'ground', open: S('tlr') }, 'solid'],
    ['inner-tl', 'Inner corner top left', { type: 'ground', open: S(''), diag: { tl: true } }, 'solid'],
    ['inner-tr', 'Inner corner top right', { type: 'ground', open: S(''), diag: { tr: true } }, 'solid'],
    ['single', 'Single block', { type: 'ground', open: S('tblr') }, 'solid'],
    ['t-alt', 'Top, variant', { type: 'ground', open: S('t'), salt: 1 }, 'solid'],
  ],
  [
    ['l', 'Left', { type: 'ground', open: S('l') }, 'solid'],
    ['c', 'Fill', { type: 'ground', open: S('') }, 'solid'],
    ['r', 'Right', { type: 'ground', open: S('r') }, 'solid'],
    ['pillar', 'Pillar', { type: 'ground', open: S('lr') }, 'solid'],
    ['inner-bl', 'Inner corner bottom left', { type: 'ground', open: S(''), diag: { bl: true } }, 'solid'],
    ['inner-br', 'Inner corner bottom right', { type: 'ground', open: S(''), diag: { br: true } }, 'solid'],
    ['c-alt', 'Fill, variant', { type: 'ground', open: S(''), salt: 2 }, 'solid'],
    ['c-alt2', 'Fill, variant 2', { type: 'ground', open: S(''), salt: 3 }, 'solid'],
  ],
  [
    ['bl', 'Bottom left', { type: 'ground', open: S('bl') }, 'solid'],
    ['b', 'Bottom', { type: 'ground', open: S('b') }, 'solid'],
    ['br', 'Bottom right', { type: 'ground', open: S('br') }, 'solid'],
    ['pillar-bottom', 'Pillar bottom', { type: 'ground', open: S('blr') }, 'solid'],
    ['platform-l', 'Platform left', { type: 'ground', open: S('tbl') }, 'oneway'],
    ['platform', 'Platform', { type: 'ground', open: S('tb') }, 'oneway'],
    ['platform-r', 'Platform right', { type: 'ground', open: S('tbr') }, 'oneway'],
    ['spikes', 'Spikes', { type: 'deco', deco: 'spikes' }, 'hazard'],
  ],
  [
    ['tuft', 'Grass tuft', { type: 'deco', deco: 'tuft' }, 'empty'],
    ['flower', 'Flower', { type: 'deco', deco: 'flower' }, 'empty'],
    ['rock', 'Rock', { type: 'deco', deco: 'rock' }, 'empty'],
    ['torch', 'Torch', { type: 'deco', deco: 'torch' }, 'empty'],
    ['back', 'Back wall', { type: 'back' }, 'empty'],
    ['back-alt', 'Back wall, variant', { type: 'back', salt: 4 }, 'empty'],
    ['window', 'Back wall, window', { type: 'back', feature: 'window' }, 'empty'],
    ['back-shadow', 'Back wall, shadow', { type: 'back', feature: 'shadow' }, 'empty'],
  ],
  [
    ['slope-up', 'Slope up 45°', { type: 'slope', from: 0, to: 1 }, 'slope'],
    ['slope-down', 'Slope down 45°', { type: 'slope', from: 1, to: 0 }, 'slope'],
    ['gentle-up-1', 'Gentle slope up, low half', { type: 'slope', from: 0, to: 0.5 }, 'slope'],
    ['gentle-up-2', 'Gentle slope up, high half', { type: 'slope', from: 0.5, to: 1 }, 'slope'],
    ['gentle-down-1', 'Gentle slope down, high half', { type: 'slope', from: 1, to: 0.5 }, 'slope'],
    ['gentle-down-2', 'Gentle slope down, low half', { type: 'slope', from: 0.5, to: 0 }, 'slope'],
    ['stalactite', 'Stalactite', { type: 'deco', deco: 'stalactite' }, 'empty'],
    ['vine', 'Hanging vine', { type: 'deco', deco: 'vine' }, 'empty'],
  ],
]

/** Blocks in a row of the sheet. Sheets saved before slopes have only the first four rows. */
export const TILEGEN_COLS = 8

/** Block names in sheet order, for code that places blocks by name. */
export const TILEGEN_BLOCKS: readonly string[] = LAYOUT.flat().map(([name]) => name)

// ---------------------------------------------------------------------------------------
// Noise. Everything is periodic over one block, so a block meets copies of itself and its
// neighbours in the sheet without a seam.

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
const wrap = (v: number, n: number) => ((v % n) + n) % n
const smooth = (t: number) => t * t * (3 - 2 * t)

/** Value noise in [0, 1) with lattice cells of `cell` pixels, repeating every `period`. */
function valueNoise(x: number, y: number, cell: number, period: number, seed: number): number {
  const n = Math.max(1, Math.round(period / cell))
  const gx = Math.floor(x / cell)
  const gy = Math.floor(y / cell)
  const fx = smooth(x / cell - gx)
  const fy = smooth(y / cell - gy)
  const at = (i: number, j: number) => hash(wrap(gx + i, n), wrap(gy + j, n), seed)
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx
  return top + (bottom - top) * fy
}

/** A step noise along an edge: whole pixels 0..amplitude, changing every 2 pixels. */
function edgeOffset(t: number, period: number, amplitude: number, seed: number): number {
  if (amplitude <= 0) return 0
  return Math.floor(hash(wrap(Math.floor(t / 2), Math.max(1, period / 2)), 0, seed) * (amplitude + 1))
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------
// Colour.

type Rgb = [number, number, number]
function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1]!, 16) : 0
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
/** Snapped to what the GBA shows, so the preview is what the game draws. */
const onGrid = ([r, g, b]: Rgb): Rgb => fromBgr555(toBgr555(r, g, b))
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as Rgb
const ramp = (light: Rgb, dark: Rgb, n: number): Rgb[] => Array.from({ length: n }, (_, i) => onGrid(mix(light, dark, n === 1 ? 0 : i / (n - 1))))
const toHex = ([r, g, b]: Rgb) => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`

/** Where each material's tones sit in the palette. */
interface Palette {
  colours: Rgb[]
  surface: number[]
  body: number[]
  mortar: number
  outline: number
  accent: [number, number]
}

function buildPalette(options: TilegenOptions): Palette {
  const c = options.colours
  const colours: Rgb[] = []
  const add = (list: Rgb[]) => list.map((rgb) => colours.push(rgb) - 1)
  const bodyShades = Math.max(2, Math.min(6, Math.round(options.shades)))
  const surfaceShades = Math.max(2, Math.min(4, bodyShades))
  const surface = add(ramp(parseHex(c.surface), parseHex(c.surfaceDark), surfaceShades))
  const bodyDark = parseHex(c.bodyDark)
  const body = add(ramp(parseHex(c.body), bodyDark, bodyShades))
  const [mortar] = add([onGrid(mix(bodyDark, [0, 0, 0], 0.3))])
  const [outline] = add([onGrid(mix(bodyDark, [8, 4, 16], 0.65))])
  const accent = add([onGrid(parseHex(c.accent)), onGrid(parseHex(c.accentDark))])
  return { colours, surface, body, mortar: mortar!, outline: outline!, accent: [accent[0]!, accent[1]!] }
}

// ---------------------------------------------------------------------------------------
// Drawing one block into palette indices; -1 is air.

const AIR = -1

class Block {
  readonly px: Int8Array
  readonly size: number
  constructor(size: number) {
    this.size = size
    this.px = new Int8Array(size * size).fill(AIR)
  }
  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.size || y >= this.size ? AIR : this.px[y * this.size + x]!
  }
  set(x: number, y: number, colour: number) {
    if (x >= 0 && y >= 0 && x < this.size && y < this.size) this.px[y * this.size + x] = colour
  }
}

interface Ctx {
  o: TilegenOptions
  T: number
  pal: Palette
  seed: number
}

/** A tone 0 (light) .. 1 (dark) as one of `tones`, dithered if asked. */
function tone(ctx: Ctx, tones: number[], v: number, x: number, y: number): number {
  const n = tones.length
  const threshold = ctx.o.dither ? BAYER[(y & 3) * 4 + (x & 3)]! / 16 : 0.5
  const level = Math.floor(Math.max(0, Math.min(0.999, v)) * n + threshold - 0.5)
  return tones[Math.max(0, Math.min(n - 1, level))]!
}

/** Brick or stone courses: block height and width that repeat cleanly over a block. */
function courses(pattern: BodyPattern, T: number): { h: number; w: number } {
  if (pattern === 'stone') return { h: Math.max(4, T / 2), w: Math.max(4, T / 2) }
  return T === 8 ? { h: 4, w: 8 } : T === 16 ? { h: 4, w: 8 } : { h: 8, w: 16 }
}

type Material = { v: number } | { mortar: true } | { glow: 0 | 1 }

/** What the body material looks like at a pixel: a tone, the mortar between stones, or a light. */
function bodyAt(ctx: Ctx, x: number, y: number, salt: number): Material {
  const { o, T, seed } = ctx
  const contrast = o.texture / 100
  const grain = hash(wrap(x, T), wrap(y, T), seed + 11) - 0.5
  if (o.pattern === 'earth') {
    const n = 0.6 * valueNoise(x, y, Math.max(2, T / 4), T, seed + 21) + 0.4 * (grain + 0.5)
    let v = 0.42 + (n - 0.5) * contrast * 1.3
    if (o.strata > 0) {
      const wobble = valueNoise(x, 0, Math.max(2, T / 2), T, seed + 31) * 2
      const band = valueNoise(0, y + wobble, Math.max(2, T / 4), T, seed + 41)
      v += (band - 0.5) * (o.strata / 100) * 0.9
    }
    // Stones in the earth, each inside its own cell so variants never cross a seam.
    const cell = Math.max(4, T / 2)
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    const id = [wrap(cx, T / cell), wrap(cy, T / cell)] as const
    const pebbleSeed = seed + 51 + salt * 977
    if (hash(id[0], id[1], pebbleSeed) < o.pebbles / 100) {
      const r = 1 + Math.floor(hash(id[0], id[1], pebbleSeed + 1) * Math.max(1, cell / 4 - 0.5))
      const span = cell - 2 * r - 1
      const px = cx * cell + r + Math.floor(hash(id[0], id[1], pebbleSeed + 2) * Math.max(1, span)) + 0.5
      const py = cy * cell + r + Math.floor(hash(id[0], id[1], pebbleSeed + 3) * Math.max(1, span)) + 0.5
      const dx = x + 0.5 - px
      const dy = y + 0.5 - py
      const d = Math.hypot(dx, dy * 1.25)
      if (d <= r + 0.25) return { v: dx + dy < 0 ? 0.05 : 0.38 }
      if (d <= r + 1.1 && dy > 0) return { v: 0.85 }
    }
    return { v }
  }
  if (o.pattern === 'wood') return woodAt(ctx, x, y, salt, grain)
  if (o.pattern === 'panels') return panelAt(ctx, x, y, salt, grain)
  if (o.pattern === 'cobble') {
    const c = T === 8 ? 4 : 8
    const n = T / c
    const gx = Math.floor(x / c)
    const gy = Math.floor(y / c)
    let d1 = Infinity
    let d2 = Infinity
    let best: [number, number, number, number] = [0, 0, 0, 0]
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const ix = wrap(gx + i, n)
        const iy = wrap(gy + j, n)
        const pxl = (gx + i) * c + 1 + hash(ix, iy, seed + 61) * (c - 2)
        const pyl = (gy + j) * c + 1 + hash(ix, iy, seed + 62) * (c - 2)
        const d = Math.hypot(x + 0.5 - pxl, y + 0.5 - pyl)
        if (d < d1) {
          d2 = d1
          d1 = d
          best = [ix, iy, pxl, pyl]
        } else if (d < d2) d2 = d
      }
    }
    if (d2 - d1 < 1.1) return { mortar: true }
    const shade = hash(best[0], best[1], seed + 63 + salt * 977)
    const light = (best[2] - (x + 0.5) + (best[3] - (y + 0.5))) / c
    return { v: 0.3 + shade * 0.35 * (0.4 + contrast) - light * 0.55 + grain * contrast * 0.25 }
  }
  // Bricks and cut stone: staggered courses with a pixel of mortar right and below.
  const { h, w } = courses(o.pattern, T)
  const row = Math.floor(wrap(y, T) / h)
  const shifted = wrap(x + (row % 2 ? w / 2 : 0), T)
  const bx = Math.floor(shifted / w)
  const lx = shifted % w
  const ly = wrap(y, T) % h
  if (lx === w - 1 || ly === h - 1) return { mortar: true }
  const brickSeed = seed + 71 + salt * 977
  const shade = hash(bx, row, brickSeed)
  // Variants crack a few stones; the courses stay where they are, so nothing seams.
  if (salt && hash(bx, row, brickSeed + 1) < 0.35) {
    const crack = Math.floor(hash(bx, row, brickSeed + 2) * (w - 2))
    if (lx === crack + Math.floor(ly / 2) && ly > 0) return { mortar: true }
  }
  let v = 0.22 + shade * 0.45 * (0.3 + contrast)
  if (ly === 0 || lx === 0) v -= 0.3
  else if (ly === h - 2 || lx === w - 2) v += 0.25
  if (o.pattern === 'stone') v += grain * contrast * 0.5
  else if (hash(x, y, seed + 81) < contrast * 0.12) v += 0.35
  return { v }
}

/** Boards running across, one butt joint a board per block, grain along the board and knots. */
function woodAt(ctx: Ctx, x: number, y: number, salt: number, grain: number): Material {
  const { o, T, seed } = ctx
  const contrast = o.texture / 100
  const h = T === 32 ? 8 : 4
  const row = Math.floor(y / h)
  const ly = y % h
  if (ly === h - 1) return { mortar: true }
  // The joint is the same in every variant, so boards run on across a swapped block.
  const joint = Math.floor(hash(row, 0, seed + 91) * T)
  if (x === joint) return { mortar: true }
  const streak = hash(y, 0, seed + 94) - 0.5
  const along = valueNoise(x, ly * 3, Math.max(2, T / 2), T, seed + 93) - 0.5
  let v = 0.3 + hash(row, 1, seed + 92) * 0.25 + streak * contrast * 0.7 + along * contrast * 0.35 + grain * contrast * 0.1
  if (ly === 0) v -= 0.25
  else if (ly === h - 2) v += 0.2
  // Knots: a dark eye ringed lighter, away from the joint; variants move them.
  const knotSeed = seed + 95 + salt * 977
  if (hash(row, 2, knotSeed) < o.pebbles / 100) {
    const kx = wrap(joint + 2 + Math.floor(hash(row, 3, knotSeed) * (T - 4)), T) + 0.5
    const ky = row * h + (h - 1) / 2
    const d = Math.hypot(wrap(x + 0.5 - kx + T / 2, T) - T / 2, (y + 0.5 - ky) * 1.6)
    if (d < 0.9) return { v: 0.95 }
    if (d < 1.9) return { v: 0.6 }
  }
  return { v }
}

/** Riveted metal plates; some plates carry a vent or a light strip, which the variants move. */
function panelAt(ctx: Ctx, x: number, y: number, salt: number, grain: number): Material {
  const { o, T, seed } = ctx
  const contrast = o.texture / 100
  const p = T === 32 ? 16 : 8
  const n = T / p
  const px = x % p
  const py = y % p
  const pi = wrap(Math.floor(x / p), n)
  const pj = wrap(Math.floor(y / p), n)
  if (px === p - 1 || py === p - 1) return { mortar: true }
  const kind = hash(pi, pj, seed + 131 + salt * 977)
  const inner = px >= 2 && px <= p - 3
  if (kind < 0.22 && inner && py >= 2 && py <= p - 3 && py % 2 === 0) return { mortar: true }
  // Lights only on the variants, so a wall of plain fill stays calm and lights are sprinkled.
  if (salt && kind >= 0.22 && kind < 0.5 && inner) {
    const mid = Math.floor(p / 2) - 1
    if (py === mid) return { glow: 0 }
    if (py === mid + 1) return { glow: 1 }
  }
  if (px === 0 || py === 0) return { v: 0.08 }
  if (px === p - 2 || py === p - 2) return { v: 0.78 }
  const rivet = (c: number) => c === 1 || c === p - 3
  if (kind >= 0.5 && rivet(px) && rivet(py)) return { v: 0 }
  if (kind >= 0.5 && rivet(px) && rivet(py - 1)) return { v: 0.85 }
  const shade = hash(pi, pj, seed + 132)
  return { v: 0.32 + shade * 0.22 * (0.4 + contrast) + (hash(0, y, seed + 133) - 0.5) * contrast * 0.25 + grain * contrast * 0.1 }
}

function drawGround(ctx: Ctx, open: Sides, diag: Partial<Corners>, salt: number): Block {
  const { o, T, pal, seed } = ctx
  const block = new Block(T)
  const noise = Math.max(0, Math.min(3, o.edgeNoise))
  const radius = Math.max(0, Math.min(T / 2, o.cornerRadius))
  const crenel = Math.max(2, T / 4)
  const topOff = (x: number) => {
    if (o.top === 'battlements') return wrap(x, T) >= T / 2 ? crenel : 0
    return o.top === 'rough' ? edgeOffset(x, T, Math.max(1, noise), seed + 101) : 0
  }
  const sideOff = (t: number, side: string) => edgeOffset(t, T, noise, seed + 102 + side.charCodeAt(0))
  const cornerCut = (x: number, y: number, ax: boolean, ay: boolean) => {
    if (radius < 1 || o.top === 'battlements') return false
    const cx = ax ? radius : T - radius
    const cy = ay ? radius : T - radius
    const inX = ax ? x < radius : x >= T - radius
    const inY = ay ? y < radius : y >= T - radius
    return inX && inY && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius
  }
  /** Solid inside the block's own square, after edges and corners are cut. */
  const shape = (x: number, y: number) => {
    if (open.t && y < topOff(x)) return false
    if (open.b && T - 1 - y < sideOff(x, 'b')) return false
    if (open.l && x < sideOff(y, 'l')) return false
    if (open.r && T - 1 - x < sideOff(y, 'r')) return false
    if (open.t && open.l && cornerCut(x, y, true, true)) return false
    if (open.t && open.r && cornerCut(x, y, false, true)) return false
    if (open.b && open.l && cornerCut(x, y, true, false)) return false
    if (open.b && open.r && cornerCut(x, y, false, false)) return false
    return true
  }
  /** Solid anywhere, the neighbours included: closed sides continue, open ones are air. */
  const solid = (x: number, y: number) => {
    const dx = x < 0 ? -1 : x >= T ? 1 : 0
    const dy = y < 0 ? -1 : y >= T ? 1 : 0
    if (!dx && !dy) return shape(x, y)
    const sideX = dx < 0 ? !open.l : !open.r
    const sideY = dy < 0 ? !open.t : !open.b
    if (!dy) return sideX
    if (!dx) return sideY
    const corner = dx < 0 ? (dy < 0 ? diag.tl : diag.bl) : dy < 0 ? diag.tr : diag.br
    return sideX && sideY && !corner
  }

  // The outline takes the top row, so an outlined surface needs two to show.
  const depth = Math.max(o.outline && o.surface ? 2 : 1, Math.min(T - 1, o.surfaceDepth))
  const overhang = Math.max(0, Math.min(T - depth, o.overhang))
  const drip = (x: number) => edgeOffset(x + 1, T, Math.min(4, o.roughness), seed + 111)
  const sideThick = Math.max(1, Math.round(depth / 3))
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!shape(x, y)) continue
      const top = open.t ? topOff(x) : 0
      const dt = open.t ? y - top : Infinity
      const dl = open.l ? x - sideOff(y, 'l') : Infinity
      const dr = open.r ? T - 1 - x - sideOff(y, 'r') : Infinity
      const db = open.b ? T - 1 - y - sideOff(x, 'b') : Infinity
      const edge = o.outline && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))

      // The surface layer: over an open top, down open sides below it, and into inner corners.
      if (o.surface) {
        const reach = depth + drip(x)
        let f = -1
        if (open.t && dt < reach) f = dt / reach
        else if (open.t && open.l && dl < sideThick && dt < depth + overhang + drip(y)) f = 0.55 + (dt / (depth + overhang + 4)) * 0.45
        else if (open.t && open.r && dr < sideThick && dt < depth + overhang + drip(y + 7)) f = 0.55 + (dt / (depth + overhang + 4)) * 0.45
        else if (!open.t && diag.tl && !open.l) {
          const w = depth + overhang + 1
          if (x < w && y < reach * (1 - x / w)) f = y / reach
        } else if (!open.t && diag.tr && !open.r) {
          const w = depth + overhang + 1
          if (T - 1 - x < w && y < reach * (1 - (T - 1 - x) / w)) f = y / reach
        }
        if (f >= 0) {
          const grain = (hash(x, y, seed + 121) - 0.5) * (o.texture / 100) * 0.5
          const v = dt === 0 ? 0 : f * 0.95 + 0.12 + grain
          block.set(x, y, edge ? pal.outline : tone(ctx, pal.surface, v, x, y))
          continue
        }
      }
      if (edge) {
        block.set(x, y, pal.outline)
        continue
      }
      const material = bodyAt(ctx, x, y, salt)
      if ('mortar' in material) {
        block.set(x, y, pal.mortar)
        continue
      }
      if ('glow' in material) {
        block.set(x, y, pal.accent[material.glow])
        continue
      }
      let v = material.v
      // Light from the top left.
      if (o.surface && open.t && dt < depth + drip(x) + 2) v += 0.35
      else if (dt === 0 || dt === 1) v -= dt === 0 ? 0.45 : 0.2
      if (dl === 0) v -= 0.2
      if (dr <= 1) v += 0.25
      if (db <= 1) v += 0.3
      block.set(x, y, tone(ctx, pal.body, v, x, y))
    }
  }
  return block
}

/** Floor height at pixel column `x` of a slope block, in pixels over its bottom edge, 0 to T. */
function slopeHeight(T: number, from: number, to: number, x: number): number {
  return Math.max(0, Math.min(T, Math.round(T * (from + ((to - from) * (x + 0.5)) / T))))
}

/**
 * Ground under a straight floor. The ends meet the blocks beside it: the low end the top of
 * the ground below and to the side, the high end the top of the block beside it.
 */
function drawSlope(ctx: Ctx, from: number, to: number): Block {
  const { o, T, pal, seed } = ctx
  const block = new Block(T)
  const top = (x: number) => T - slopeHeight(T, from, to, x)
  const solid = (x: number, y: number) => y >= T || y >= top(x)
  const depth = Math.max(o.outline && o.surface ? 2 : 1, Math.min(T - 1, o.surfaceDepth))
  const drip = (x: number) => edgeOffset(x + 1, T, Math.min(4, o.roughness), seed + 111)
  for (let x = 0; x < T; x++) {
    for (let y = top(x); y < T; y++) {
      const dt = y - top(x)
      const edge = o.outline && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1))
      if (o.surface && dt < depth + drip(x)) {
        const grain = (hash(x, y, seed + 121) - 0.5) * (o.texture / 100) * 0.5
        const v = dt === 0 ? 0 : (dt / (depth + drip(x))) * 0.95 + 0.12 + grain
        block.set(x, y, edge ? pal.outline : tone(ctx, pal.surface, v, x, y))
        continue
      }
      if (edge) {
        block.set(x, y, pal.outline)
        continue
      }
      const material = bodyAt(ctx, x, y, 0)
      if ('mortar' in material) block.set(x, y, pal.mortar)
      else if ('glow' in material) block.set(x, y, pal.accent[material.glow])
      else {
        let v = material.v
        if (o.surface && dt < depth + drip(x) + 2) v += 0.35
        else if (dt <= 1) v -= dt === 0 ? 0.45 : 0.2
        block.set(x, y, tone(ctx, pal.body, v, x, y))
      }
    }
  }
  return block
}

function drawBack(ctx: Ctx, salt: number, feature?: 'window' | 'shadow'): Block {
  const { T, pal } = ctx
  const block = new Block(T)
  // The darkest tones only, so ground stands out in front of the wall.
  const back = pal.body.slice(Math.max(1, pal.body.length - 2))
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const material = bodyAt(ctx, x, y, salt)
      block.set(x, y, 'mortar' in material ? pal.outline : 'glow' in material ? tone(ctx, back, 0.95, x, y) : tone(ctx, back, material.v * 0.9 + 0.1, x, y))
    }
  }
  if (feature === 'shadow') {
    const band = Math.max(1, T / 8)
    for (let y = 0; y < band * 2; y++) {
      for (let x = 0; x < T; x++) if (y < band || (x + y) % 2 === 0) block.set(x, y, pal.outline)
    }
  }
  if (feature === 'window' && ctx.o.pattern === 'panels') {
    // A porthole: a dark ring, a light rim, space with a few stars and a glint on the glass.
    const c = T / 2
    const r = T * 0.3
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const dx = x + 0.5 - c
        const dy = y + 0.5 - c
        const d = Math.hypot(dx, dy)
        if (d <= r) block.set(x, y, T > 8 && d > r - 1.6 && dx + dy < -r * 0.6 ? pal.body[0]! : T > 8 && hash(x, y, ctx.seed + 141) < 0.07 ? pal.body[0]! : pal.outline)
        else if (d <= r + 1.2) block.set(x, y, dy < 0 ? pal.body[0]! : pal.body[1]!)
        else if (d <= r + 2 && T > 8) block.set(x, y, pal.outline)
      }
    }
  } else if (feature === 'window') {
    const x0 = T / 4
    const x1 = (3 * T) / 4 - 1
    const y0 = T / 4
    const y1 = T - Math.max(2, T / 8)
    const half = (x1 - x0) / 2
    const cx = (x0 + x1) / 2
    const inArch = (x: number, y: number, grow: number) =>
      x >= x0 - grow && x <= x1 + grow && y <= y1 + grow && (y >= y0 + half || Math.hypot(x - cx, (y - (y0 + half)) * 1.1) <= half + grow + 0.25)
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (inArch(x, y, 0)) block.set(x, y, x + y < x0 + y0 + 2 && T > 8 ? pal.accent[1] : pal.outline)
        else if (inArch(x, y, 1)) block.set(x, y, y > y1 ? pal.body[0]! : pal.body[1]!)
      }
    }
    // Panes: a mullion and a transom, for windows big enough to have them.
    if (T >= 16) {
      for (let y = y0 + 1; y <= y1; y++) block.set(Math.floor(cx), y, pal.body[1]!)
      for (let x = x0; x <= x1; x++) block.set(x, Math.round(y0 + half + 1), pal.body[1]!)
    }
  }
  return block
}

function drawDeco(ctx: Ctx, deco: Deco): Block {
  const { T, pal, seed } = ctx
  const block = new Block(T)
  const rand = mulberry32(seed * 31 + deco.length * 7 + deco.charCodeAt(0))
  const s = T / 16
  const disc = (cx: number, cy: number, rx: number, ry: number, colour: (x: number, y: number) => number) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) block.set(x, y, colour(x, y))
      }
    }
  }
  if (deco === 'tuft') {
    const blades = Math.max(3, Math.round(T / 3))
    for (let i = 0; i < blades; i++) {
      const base = Math.round(T * 0.2 + rand() * T * 0.6)
      const height = Math.max(2, Math.round(T * (0.3 + rand() * 0.4)))
      const lean = (rand() - 0.5) * 1.2
      for (let k = 0; k < height; k++) {
        const x = Math.round(base + lean * k * (T / 16))
        const f = k / height
        block.set(x, T - 1 - k, f > 0.7 ? pal.surface[0]! : f > 0.3 ? pal.surface[1]! : pal.surface[pal.surface.length - 1]!)
      }
    }
  } else if (deco === 'flower') {
    const cx = Math.floor(T / 2)
    const head = Math.round(T * 0.35)
    for (let y = head; y < T; y++) block.set(cx, y, pal.surface[pal.surface.length - 1]!)
    if (T >= 16) {
      block.set(cx - 1, T - 3 * s, pal.surface[1]!)
      block.set(cx - 2, T - 3 * s - 1, pal.surface[1]!)
      block.set(cx + 1, T - 5 * s, pal.surface[1]!)
      block.set(cx + 2, T - 5 * s - 1, pal.surface[1]!)
    }
    const r = Math.max(1, Math.round(2 * s))
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) disc(cx + 0.5 + dx * r, head + 0.5 + dy * r, r * 0.8 + 0.2, r * 0.8 + 0.2, () => pal.accent[0])
    block.set(cx, head, pal.accent[1])
    if (T >= 16) disc(cx + 0.5, head + 0.5, 1, 1, () => pal.accent[1])
  } else if (deco === 'rock') {
    const cx = T / 2
    const ry = Math.max(1.5, T * 0.22)
    const rx = Math.max(2.5, T * 0.36)
    const cy = T - ry
    disc(cx, cy, rx + 0.6, ry + 0.6, () => pal.outline)
    disc(cx, cy, rx - 0.4, ry - 0.4, (x, y) => tone(ctx, pal.body, 0.15 + (x - cx + (y - cy) * 1.5) / (rx * 2) + 0.2, x, y))
  } else if (deco === 'torch') {
    const cx = Math.floor(T / 2) - (T >= 16 ? 1 : 0)
    const width = Math.max(1, T / 8)
    const top = Math.round(T * 0.45)
    for (let y = top; y < Math.round(T * 0.9); y++) for (let x = cx; x < cx + width; x++) block.set(x, y, x === cx ? pal.body[pal.body.length - 2]! : pal.outline)
    for (let x = cx - width; x < cx + width * 2; x++) block.set(x, top, pal.body[1]!)
    const fx = cx + width / 2
    const fr = Math.max(1.2, T * 0.17)
    disc(fx, top - fr, fr, fr * 1.35, () => pal.accent[1])
    disc(fx, top - fr * 0.8, fr * 0.5, fr * 0.75, () => pal.accent[0])
  } else if (deco === 'canister') {
    const w = Math.max(4, Math.round(T * 0.5))
    const left = Math.floor((T - w) / 2)
    const top = Math.round(T * 0.3)
    const band = Math.round(top + (T - top) * 0.45)
    for (let y = top; y < T; y++) {
      for (let x = left; x < left + w; x++) {
        const edge = x === left || x === left + w - 1 || y === top || y === T - 1
        const across = (x - left) / (w - 1)
        const colour = edge ? pal.outline
          : y === band || (T >= 16 && y === band + 1) ? pal.accent[across < 0.5 ? 0 : 1]
          : y === top + 1 ? pal.body[0]!
          : tone(ctx, pal.body, 0.1 + across * 0.75, x, y)
        block.set(x, y, colour)
      }
    }
  } else if (deco === 'terminal') {
    const left = Math.round(T * 0.12)
    const right = T - 1 - left
    const top = Math.round(T * 0.35)
    for (let y = top; y < T; y++) {
      for (let x = left; x <= right; x++) {
        const edge = x === left || x === right || y === top || y === T - 1
        block.set(x, y, edge ? pal.outline : tone(ctx, pal.body, 0.25 + (y - top) / (T - top) * 0.5, x, y))
      }
    }
    // The screen, with lines of text, and a row of buttons under it.
    const sy0 = top + Math.max(1, T / 8)
    const sy1 = top + Math.round((T - top) * 0.55)
    for (let y = sy0; y <= sy1; y++) {
      for (let x = left + 2; x <= right - 2; x++) {
        const text = T >= 16 && (y - sy0) % 2 === 1 && y < sy1 && hash(x, y, ctx.seed + 151) < 0.7
        block.set(x, y, y === sy0 || y === sy1 || x === left + 2 || x === right - 2 ? pal.outline : text ? pal.surface[0]! : pal.accent[1])
      }
    }
    for (let x = left + 2; x <= right - 2; x += 2) block.set(x, sy1 + Math.max(1, Math.round(T / 10)), x % 4 ? pal.accent[0] : pal.surface[0]!)
  } else if (deco === 'crate') {
    const size = Math.max(6, Math.round(T * 0.8))
    const left = Math.floor((T - size) / 2)
    const top = T - size
    const frame = Math.max(1, Math.round(T / 10))
    for (let y = top; y < T; y++) {
      for (let x = left; x < left + size; x++) {
        const lx = x - left
        const ly = y - top
        const edge = lx === 0 || ly === 0 || lx === size - 1 || ly === size - 1
        const onFrame = lx <= frame || ly <= frame || lx >= size - 1 - frame || ly >= size - 1 - frame
        const brace = Math.abs(lx - ly) <= frame * 0.6
        const stripe = ly <= frame && ly > 0 && T >= 16 && Math.floor((lx + ly) / 2) % 2 === 0
        block.set(x, y, edge ? pal.outline : stripe ? pal.accent[0] : onFrame || brace ? pal.body[1]! : tone(ctx, pal.body, 0.55 + (ly / size) * 0.3, x, y))
      }
    }
  } else if (deco === 'lamp') {
    const w = Math.max(4, Math.round(T * 0.5))
    const left = Math.floor((T - w) / 2)
    const top = Math.round(T * 0.3)
    const h = Math.max(2, Math.round(T * 0.18))
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) block.set(x, y, y === top || x === left || x === left + w - 1 ? pal.outline : pal.body[1]!)
    for (let x = left + 1; x < left + w - 1; x++) block.set(x, top + h, pal.accent[0])
    // Light falling from it, dithered.
    for (let k = 1; k <= Math.max(1, T / 8); k++) {
      for (let x = left + 1 - k; x < left + w - 1 + k; x++) if ((x + k) % 2 === 0) block.set(x, top + h + k, pal.accent[1])
    }
  } else if (deco === 'stalactite') {
    // Hangs from the ceiling: a few points of rock, the longest in the middle.
    const points = T >= 16 ? 3 : 2
    for (let i = 0; i < points; i++) {
      const mid = ((i + 0.5) * T) / points
      const half = T / points / 2
      const length = Math.round(T * (i === Math.floor(points / 2) ? 0.8 : 0.35 + rand() * 0.25))
      for (let k = 0; k < length; k++) {
        const w = half * (1 - k / length)
        for (let x = Math.floor(mid - w); x < Math.ceil(mid + w); x++) {
          const side = x === Math.floor(mid - w) || x === Math.ceil(mid + w) - 1
          block.set(x, k, side && T > 8 ? pal.outline : tone(ctx, pal.body, 0.15 + (x - mid + half) / (half * 2) * 0.6, x, k))
        }
      }
    }
    for (let x = 0; x < T; x++) block.set(x, 0, pal.outline)
  } else if (deco === 'vine') {
    // Two strands hanging from the ceiling, swaying, with leaves along them.
    for (const [start, length] of [[T * 0.3, T], [T * 0.68, T * 0.6]] as const) {
      for (let y = 0; y < Math.round(length); y++) {
        const x = Math.round(start + Math.sin((y / T) * Math.PI * 2 + start) * (T / 10))
        block.set(x, y, pal.surface[pal.surface.length - 1]!)
        if (y % Math.max(2, Math.round(T / 4)) === 1) {
          const dir = (y >> 1) % 2 ? 1 : -1
          block.set(x + dir, y, pal.surface[1]!)
          if (T >= 16) block.set(x + dir * 2, y + 1, pal.surface[0]!)
        }
      }
    }
  } else if (deco === 'pipe') {
    const w = Math.max(2, Math.round(T * 0.3))
    const left = Math.floor((T - w) / 2)
    const end = Math.round(T * 0.7)
    for (let y = 0; y < end; y++) {
      for (let x = left - (y >= end - 2 ? 1 : 0); x < left + w + (y >= end - 2 ? 1 : 0); x++) {
        const edge = x <= left - (y >= end - 2 ? 1 : 0) || x >= left + w - 1 + (y >= end - 2 ? 1 : 0) || y === end - 1
        block.set(x, y, edge ? pal.outline : tone(ctx, pal.body, 0.1 + ((x - left) / w) * 0.7, x, y))
      }
    }
    block.set(left + Math.floor(w / 2), end + 1, pal.accent[0])
  } else if (deco === 'cable') {
    // A cable sagging between two hooks, with a light on it.
    for (let x = 0; x < T; x++) {
      const y = Math.round(1 + Math.sin((x / (T - 1)) * Math.PI) * T * 0.45)
      block.set(x, y, pal.outline)
      if (T >= 16) block.set(x, y + 1, pal.body[pal.body.length - 1]!)
    }
    const cx = Math.floor(T / 2)
    const cy = Math.round(1 + T * 0.45) + 2
    block.set(cx, cy, pal.accent[0])
    if (T >= 16) {
      block.set(cx - 1, cy, pal.accent[1])
      block.set(cx, cy + 1, pal.accent[1])
    }
  } else {
    const n = Math.max(2, T / 8)
    const w = T / n
    const height = Math.round(T * 0.65)
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < height; k++) {
        const y = T - 1 - k
        const half = (w / 2) * (1 - k / height)
        const mid = i * w + w / 2
        for (let x = Math.floor(mid - half); x < Math.ceil(mid + half); x++) {
          const edge = x === Math.floor(mid - half) || x === Math.ceil(mid + half) - 1
          block.set(x, y, edge && T > 8 ? pal.outline : x < mid ? pal.body[0]! : pal.body[Math.min(2, pal.body.length - 1)]!)
        }
      }
    }
    for (let x = 0; x < T; x++) block.set(x, T - 1, pal.outline)
  }
  return block
}

// ---------------------------------------------------------------------------------------

/** Draws the whole sheet. */
export function generateTileset(options: TilegenOptions): GeneratedTileset {
  const T = options.blockSize
  if (T % 8 !== 0) throw new Error('a block must be a multiple of 8 pixels')
  const pal = buildPalette(options)
  const ctx: Ctx = { o: options, T, pal, seed: Math.floor(options.seed) | 0 }
  // Interiors swap the outdoor decorations for machinery; the block names stay put.
  const tech = (deco: Deco, label = ''): [Deco, string] => (options.pattern === 'panels' && TECH_DECO[deco]) || [deco, label]
  const rows = LAYOUT.length
  const cols = LAYOUT[0]!.length
  const width = cols * T
  const height = rows * T
  const rgba = new Uint8ClampedArray(width * height * 4)
  const blocks: TilegenBlock[] = []
  LAYOUT.forEach((line, row) =>
    line.forEach(([name, label, kind, collision], col) => {
      const block =
        kind.type === 'ground' ? drawGround(ctx, kind.open, kind.diag ?? {}, kind.salt ?? 0)
        : kind.type === 'back' ? drawBack(ctx, kind.salt ?? 0, kind.feature)
        : kind.type === 'slope' ? drawSlope(ctx, kind.from, kind.to)
        : drawDeco(ctx, tech(kind.deco)[0])
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const colour = block.get(x, y)
          if (colour === AIR) continue
          const [r, g, b] = pal.colours[colour]!
          const i = ((row * T + y) * width + col * T + x) * 4
          rgba[i] = r
          rgba[i + 1] = g
          rgba[i + 2] = b
          rgba[i + 3] = 255
        }
      }
      blocks.push({
        name,
        label: kind.type === 'deco' ? tech(kind.deco, label)[1] : label,
        col,
        row,
        collision,
        ...(kind.type === 'slope' ? { slope: { from: kind.from, to: kind.to } } : {}),
      })
    }),
  )
  return { blockSize: T, cols, rows, width, height, rgba, palette: pal.colours.map(toHex), blocks }
}

/** A slope class's floor heights over a tile's bottom edge, 0 to 8 pixels at its left and right side. */
export interface SlopeHeights { left: number; right: number }

/**
 * Collision per 8x8 tile index, row by row over the sheet, as the tileset document stores it.
 * `classFor` names the project's class for a kind (and, for slopes, the floor heights the
 * tile needs), or nothing to leave tiles at the default.
 * A platform is one-way along its top row of tiles only; below that it is decoration. A slope
 * block is cut into tiles that are each a slope, solid (under the floor) or empty (over it).
 */
export function tilegenCollision(sheet: GeneratedTileset, classFor: (kind: TileCollision, slope?: SlopeHeights) => string | undefined): Record<string, string> {
  const per = sheet.blockSize / 8
  const tileCols = sheet.width / 8
  const out: Record<string, string> = {}
  for (const block of sheet.blocks) {
    if (block.collision === 'empty') continue
    for (let ty = 0; ty < per; ty++) {
      for (let tx = 0; tx < per; tx++) {
        let id: string | undefined
        if (block.slope) {
          const heights = slopeTile(sheet.blockSize, block.slope, tx, ty)
          id = heights === 'solid' ? classFor('solid') : heights === 'empty' ? undefined : classFor('slope', heights)
        } else {
          const kind = block.collision === 'oneway' && ty > 0 ? 'empty' : block.collision
          id = kind === 'empty' ? undefined : classFor(kind)
        }
        if (!id) continue
        // Leave tiles that are all air out: a cut-away corner should not block.
        if (blockTileEmpty(sheet, block.col * sheet.blockSize + tx * 8, block.row * sheet.blockSize + ty * 8)) continue
        out[String((block.row * per + ty) * tileCols + block.col * per + tx)] = id
      }
    }
  }
  return out
}

/** What one tile of a slope block is: its floor heights, or wholly solid or empty. */
export function slopeTile(T: number, slope: { from: number; to: number }, tx: number, ty: number): SlopeHeights | 'solid' | 'empty' {
  const per = T / 8
  // Floor height at the tile's left and right edge, over the bottom of its own row of tiles.
  const at = (x: number) => Math.max(0, Math.min(8, Math.round(T * (slope.from + ((slope.to - slope.from) * x) / T)) - (per - 1 - ty) * 8))
  const left = at(tx * 8)
  const right = at(tx * 8 + 8)
  if (left === 8 && right === 8) return 'solid'
  if (left === 0 && right === 0) return 'empty'
  return { left, right }
}

function blockTileEmpty(sheet: GeneratedTileset, left: number, top: number): boolean {
  for (let y = top; y < top + 8; y++) for (let x = left; x < left + 8; x++) if (sheet.rgba[(y * sheet.width + x) * 4 + 3]! >= 128) return false
  return true
}

/**
 * Picks the block for each solid cell of a map from its neighbours: a small autotiler for
 * previews. `solid(x, y)` says whether a cell is ground; the result is block names or null.
 */
export function autotile(cols: number, rows: number, solid: (x: number, y: number) => boolean, variety = 0): Array<Array<string | null>> {
  const at = (x: number, y: number) => (x < 0 || x >= cols ? solid(Math.max(0, Math.min(cols - 1, x)), y) : y >= rows ? true : y < 0 ? false : solid(x, y))
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => {
      if (!solid(x, y)) return null
      const t = !at(x, y - 1)
      const b = !at(x, y + 1)
      const l = !at(x - 1, y)
      const r = !at(x + 1, y)
      if (l && r) return t && b ? 'single' : t ? 'pillar-top' : b ? 'pillar-bottom' : 'pillar'
      if (t && b) return l ? 'platform-l' : r ? 'platform-r' : 'platform'
      if (t) return l ? 'tl' : r ? 'tr' : variety && hash(x, y, variety) < 0.25 ? 't-alt' : 't'
      if (b) return l ? 'bl' : r ? 'br' : 'b'
      if (l) return 'l'
      if (r) return 'r'
      if (!at(x - 1, y - 1)) return 'inner-tl'
      if (!at(x + 1, y - 1)) return 'inner-tr'
      if (!at(x - 1, y + 1)) return 'inner-bl'
      if (!at(x + 1, y + 1)) return 'inner-br'
      const roll = variety ? hash(x, y, variety + 1) : 1
      return roll < 0.15 ? 'c-alt' : roll < 0.3 ? 'c-alt2' : 'c'
    }),
  )
}
