// Metroidvania rooms built from the tileset generator's blocks. The room is laid out on a
// grid of blocks (cells), then dressed: ground is autotiled, steps become slopes, and back
// walls and decorations are added. Everything is sized from the jump, so a generated room
// can be walked from each exit to every other one.
import { rleEncode } from './rle.ts'
import { FORMAT_VERSION, SCREEN } from './schema.ts'
import type { Room } from './schema.ts'
import { TILEGEN_BLOCKS, TILEGEN_COLS, autotile } from './tilegen.ts'

/** Levels: flat floors on steps, joined end to end. Caverns: wandering floors and ceilings. Shaft: a climb. */
export type RoomLayout = 'levels' | 'caverns' | 'shaft'
export type BackWall = 'none' | 'patches' | 'full'

export interface RoomgenOptions {
  seed: number
  /** Size in screens. */
  width: number
  height: number
  layout: RoomLayout
  /** 0 to 100: how much floors, ceilings and walls wander. */
  variation: number
  /** 0 to 100: how many one-block steps become slopes. */
  slopes: number
  /** 0 to 100: one-way platforms in tall spaces. */
  platforms: number
  /** 0 to 100: small places, lofts dug into low ceilings with a platform for a floor. */
  nooks: number
  /** 0 to 100: spike pits in long floors. */
  hazards: number
  /** 0 to 100: tufts, rocks, stalactites, vines and torches. */
  decoration: number
  backWall: BackWall
  exits: { left: boolean; right: boolean; top: boolean; bottom: boolean }
}

export const DEFAULT_ROOMGEN: RoomgenOptions = {
  seed: 1,
  width: 2,
  height: 1,
  layout: 'levels',
  variation: 35,
  slopes: 0,
  platforms: 35,
  nooks: 20,
  hazards: 20,
  decoration: 40,
  backWall: 'patches',
  exits: { left: true, right: true, top: false, bottom: false },
}

/** Starting points that set the shape sliders; seed, size, exits and dressing stay. */
export const ROOMGEN_STYLES: ReadonlyArray<{ id: string; name: string; description: string; options: Pick<RoomgenOptions, 'layout' | 'variation' | 'slopes' | 'platforms' | 'nooks' | 'hazards'> }> = [
  { id: 'corridor', name: 'Corridor', description: 'Flat floors on a few levels', options: { layout: 'levels', variation: 15, slopes: 0, platforms: 25, nooks: 10, hazards: 15 } },
  { id: 'halls', name: 'Stepped halls', description: 'Levels with slopes between them', options: { layout: 'levels', variation: 55, slopes: 70, platforms: 45, nooks: 30, hazards: 25 } },
  { id: 'caverns', name: 'Caverns', description: 'Wandering ground, slopes and small places', options: { layout: 'caverns', variation: 70, slopes: 85, platforms: 40, nooks: 70, hazards: 20 } },
  { id: 'shaft', name: 'Shaft', description: 'A vertical climb on ledges', options: { layout: 'shaft', variation: 40, slopes: 30, platforms: 20, nooks: 40, hazards: 0 } },
]

/** What the room is made for: the tileset's block size and blocks, and how far the player jumps. */
export interface RoomgenEnv {
  blockSize: number
  /** Pixels, the full jump's height and how far it carries at full run (see `platformerFigures`). */
  jumpHeight: number
  jumpDistance: number
  /** Block names the tileset has. Blocks it lacks (slopes, on older sheets) are not used. */
  blocks: Iterable<string>
}

/** Room sizes in blocks that follow from the block size and the jump. */
export interface RoomgenMetrics {
  /** Highest step, in blocks, that a jump climbs. */
  jump: number
  /** Widest gap, in blocks, that a running jump clears. */
  gap: number
  /** Air the player needs over a floor. */
  head: number
  /** Height of a side exit and width of one in the floor or ceiling. */
  door: number
  /** Ground left between two levels. */
  slab: number
  /** Air a level aims for. */
  tierAir: number
}

export interface RoomExits {
  /** The row the player stands in, at the room's edge. */
  left?: { y: number }
  right?: { y: number }
  /** The opening's first column and width. */
  top?: { x: number; width: number }
  bottom?: { x: number; width: number }
}

export interface GeneratedRoom {
  blockSize: number
  /** Size in blocks. The last column or row is cut when the room is not a whole number of blocks. */
  cols: number
  rows: number
  /** Size in 8x8 tiles. */
  tileCols: number
  tileRows: number
  /** What each block is, row by row: see `ROOM_CELL`. */
  cells: Uint8Array
  /** Block names for the ground layer (and decorations), row by row; null is empty. */
  ground: Array<string | null>
  /** Block names for the back wall layer, or null without one. */
  back: Array<string | null> | null
  exits: RoomExits
  metrics: RoomgenMetrics
}

export const ROOM_CELL = {
  air: 0,
  rock: 1,
  platform: 2,
  spikes: 3,
  slopeUp: 4,
  slopeDown: 5,
  gentleUp1: 6,
  gentleUp2: 7,
  gentleDown1: 8,
  gentleDown2: 9,
} as const

const AIR = 0
const ROCK = 1
const PLAT = 2
const SPIKES = 3
const SU = 4
const SD = 5
const GU1 = 6
const GU2 = 7
const GD1 = 8
const GD2 = 9
const SLOPE_NAMES: Record<number, string> = { [SU]: 'slope-up', [SD]: 'slope-down', [GU1]: 'gentle-up-1', [GU2]: 'gentle-up-2', [GD1]: 'gentle-down-1', [GD2]: 'gentle-down-2' }
export const isSlopeCell = (c: number) => c >= SU

/** Cell flags: laid out on purpose, so later passes leave it; or a way through, kept clear. */
const STRUCT = 1
const PASSAGE = 2

// ---------------------------------------------------------------------------------------

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
type Rand = () => number
const randInt = (rand: Rand, a: number, b: number) => (b <= a ? a : a + Math.floor(rand() * (b - a + 1)))
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Smooth noise in [0, 1) over lattice cells of `cell` blocks. */
function noise(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell)
  const gy = Math.floor(y / cell)
  const s = (t: number) => t * t * (3 - 2 * t)
  const fx = s(x / cell - gx)
  const fy = s(y / cell - gy)
  const at = (i: number, j: number) => hash(gx + i, gy + j, seed)
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx
  return top + (bottom - top) * fy
}

class Grid {
  readonly cells: Uint8Array
  /** Which level carved an air cell; -1 for rock and for shafts. */
  readonly tier: Int8Array
  readonly flags: Uint8Array
  readonly C: number
  readonly R: number
  constructor(C: number, R: number) {
    this.C = C
    this.R = R
    this.cells = new Uint8Array(C * R).fill(ROCK)
    this.tier = new Int8Array(C * R).fill(-1)
    this.flags = new Uint8Array(C * R)
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.C && y < this.R
  }
  get(x: number, y: number): number {
    return this.inside(x, y) ? this.cells[y * this.C + x]! : ROCK
  }
  set(x: number, y: number, cell: number, flags = 0) {
    if (!this.inside(x, y)) return
    this.cells[y * this.C + x] = cell
    this.flags[y * this.C + x]! |= flags
  }
  carve(x: number, y: number, tier: number, flags = 0) {
    if (!this.inside(x, y)) return
    this.set(x, y, AIR, flags)
    this.tier[y * this.C + x] = tier
  }
  flag(x: number, y: number): number {
    return this.inside(x, y) ? this.flags[y * this.C + x]! : 0
  }
  mark(x: number, y: number, flags: number) {
    if (this.inside(x, y)) this.flags[y * this.C + x]! |= flags
  }
  tierAt(x: number, y: number): number {
    return this.inside(x, y) ? this.tier[y * this.C + x]! : -1
  }
  /** Rows in column x where one can stand: air over rock or a platform. */
  floors(x: number): number[] {
    const out: number[] = []
    for (let y = 0; y < this.R - 1; y++) {
      const below = this.get(x, y + 1)
      if (this.get(x, y) === AIR && (below === ROCK || below === PLAT)) out.push(y)
    }
    return out
  }
}

export function roomgenMetrics(env: Pick<RoomgenEnv, 'blockSize' | 'jumpHeight' | 'jumpDistance'>): RoomgenMetrics {
  const T = env.blockSize
  const jumpHeight = env.jumpHeight > 0 ? env.jumpHeight : 48
  const head = Math.max(2, Math.ceil(40 / T))
  const jump = clamp(Math.floor((jumpHeight - 4) / T), 1, 8)
  return {
    jump,
    gap: clamp(Math.floor(((env.jumpDistance > 0 ? env.jumpDistance : 64) * 0.5) / T), 1, 8),
    head,
    door: Math.max(2, Math.ceil(48 / T)),
    slab: Math.max(2, Math.ceil(24 / T)),
    tierAir: Math.max(head + jump + 1, Math.round((jumpHeight * 1.5 + 48) / T)),
  }
}

/**
 * Builds a room. The same options and environment always give the same room. Each pass
 * draws from its own random stream, so moving one slider leaves the rest of the room alone.
 */
export function generateRoom(options: RoomgenOptions, env: RoomgenEnv): GeneratedRoom {
  const T = env.blockSize
  if (T % 8 !== 0 || T <= 0) throw new Error('a block must be a multiple of 8 pixels')
  const o: RoomgenOptions = {
    ...options,
    width: clamp(Math.round(options.width), 1, 32),
    height: clamp(Math.round(options.height), 1, 32),
  }
  const per = T / 8
  const tileCols = o.width * SCREEN.cols
  const tileRows = o.height * SCREEN.rows
  const C = Math.ceil(tileCols / per)
  const R = Math.ceil(tileRows / per)
  const has = new Set(env.blocks)
  const m = roomgenMetrics(env)
  const seed = Math.floor(o.seed) | 0
  const stream = (salt: number) => mulberry32(Math.imul(seed, 7919) + Math.imul(salt, 104729))

  const g = new Grid(C, R)
  const slopes = ['slope-up', 'slope-down', 'gentle-up-1', 'gentle-up-2', 'gentle-down-1', 'gentle-down-2'].every((n) => has.has(n))
  const ramps = slopes ? clamp(o.slopes, 0, 100) / 100 : 0
  const exits = o.layout === 'shaft' ? shaft(g, o, m, stream(1)) : tiered(g, o, m, stream(1), ramps)
  addNooks(g, m, stream(2), o.nooks)
  if (slopes) addSlopes(g, stream(5), o.slopes)
  addPits(g, m, stream(4), o.hazards)
  addPlatforms(g, m, stream(3), o.platforms)
  const { ground, back } = dress(g, o, has, stream(6), seed)
  return { blockSize: T, cols: C, rows: R, tileCols, tileRows, cells: g.cells, ground, back, exits, metrics: m }
}

// ---------------------------------------------------------------------------------------
// Levels and caverns: bands of air stacked down the room, joined by holes with platforms.

interface Tier {
  top: number
  bot: number
  /** First rock row under each column. */
  floor: Int16Array
  /** First air row in each column. */
  ceil: Int16Array
  locked: Uint8Array
  /** The height of the level's flat stretches, once it has one. */
  anchor?: number
}

function tiered(g: Grid, o: RoomgenOptions, m: RoomgenMetrics, rand: Rand, ramps: number): RoomExits {
  const { C, R } = g
  const caverns = o.layout === 'caverns'
  const v = clamp(o.variation, 0, 100) / 100
  const inner = R - 2
  const n = Math.max(1, Math.floor((inner + m.slab) / (m.tierAir + m.slab)))
  const air = inner - (n - 1) * m.slab
  const tiers: Tier[] = []
  let row = 1
  for (let k = 0; k < n; k++) {
    const h = Math.floor(air / n) + (k >= n - (air % n) ? 1 : 0)
    tiers.push({ top: row, bot: row + h - 1, floor: new Int16Array(C), ceil: new Int16Array(C), locked: new Uint8Array(C) })
    row += h + m.slab
  }

  for (const t of tiers) {
    const hi = t.bot + 1
    const lo = Math.min(hi, t.top + m.head + (caverns ? 0 : 1))
    if (caverns) {
      let level = hi - randInt(rand, 0, Math.floor((hi - lo) / 2))
      for (let x = 0; x < C; x++) {
        if (hi > lo && rand() < 0.15 + 0.6 * v) {
          const step = rand() < 0.2 * v ? randInt(rand, 1, m.jump) : 1
          const mid = (lo + hi) / 2
          const dir = rand() < 0.5 + ((level - mid) / (hi - lo + 1)) * 0.8 ? -1 : 1
          level = clamp(level + dir * step, lo, hi)
        }
        t.floor[x] = level
      }
    } else {
      // Levels: long flat runs; variation shortens them and makes the steps more frequent and taller.
      const low = Math.max(lo, hi - Math.max(1, Math.round((hi - lo) * (0.35 + 0.65 * v))))
      let level = hi - (hi > low && rand() < 0.4 ? 1 : 0)
      let x = 0
      while (x < C) {
        const len = randInt(rand, Math.round(lerp(8, 3, v)), Math.round(lerp(16, 7, v)))
        for (let i = 0; i < len && x < C; i++) t.floor[x++] = level
        if (hi > low && rand() < 0.3 + 0.6 * v) {
          const step = randInt(rand, 1, Math.max(1, Math.min(m.jump, 1 + Math.round(v * (m.jump - 1)))))
          let dir = rand() < 0.5 ? -1 : 1
          if (level + dir * step < low || level + dir * step > hi) dir = -dir
          level = clamp(level + dir * step, low, hi)
        }
      }
    }
  }

  /**
   * A flat stretch of floor that later steps keep. Every one in a level is at the same height,
   * the first one's, so two never meet in a wall; the floor between them wanders freely.
   */
  const flatten = (t: Tier, x0: number, x1: number, wanted: number) => {
    t.anchor ??= wanted
    for (let x = Math.max(0, x0); x <= Math.min(C - 1, x1); x++) {
      t.floor[x] = t.anchor
      t.locked[x] = 1
    }
  }
  const busy: Array<Array<[number, number]>> = tiers.map(() => [])
  const free = (k: number, a: number, b: number) => busy[k]!.every(([p, q]) => b + 2 < p || a - 2 > q)

  const exits: RoomExits = {}
  const bottom = tiers[n - 1]!
  const top = tiers[0]!
  // Left exits low, right exits high: with several levels the room is a climb.
  const leftT = bottom
  const rightT = n > 1 ? top : bottom
  if (o.exits.left) {
    flatten(leftT, 0, 3, leftT.floor[2]!)
    busy[n - 1]!.push([0, 3])
  }
  if (o.exits.right) {
    flatten(rightT, C - 4, C - 1, rightT.floor[C - 3]!)
    busy[tiers.indexOf(rightT)]!.push([C - 4, C - 1])
  }

  // Holes between levels, at alternate ends (levels) or anywhere (caverns).
  const w = Math.min(m.door, Math.max(1, C - 4))
  const holes: Array<{ k: number; x0: number }> = []
  for (let k = 0; k < n - 1; k++) {
    const ends = (n - 2 - k) % 2 === 0 ? [C - 1 - w, 1] : [1, C - 1 - w]
    const spots: number[] = []
    if (caverns) {
      const count = 1 + (rand() < v ? 1 : 0)
      for (let tries = 0; tries < 20 && spots.length < count; tries++) {
        const x0 = randInt(rand, 2, C - 2 - w)
        if (free(k, x0, x0 + w - 1) && free(k + 1, x0, x0 + w - 1) && spots.every((s) => Math.abs(s - x0) > w + 3)) spots.push(x0)
      }
    }
    if (!spots.length) spots.push(ends[0]!)
    for (const x0 of spots) {
      const upper = tiers[k]!
      const lower = tiers[k + 1]!
      const mid = x0 + (w >> 1)
      flatten(upper, x0 - 2, x0 + w + 1, upper.floor[mid]!)
      flatten(lower, x0 - 1, x0 + w, lower.floor[mid]!)
      busy[k]!.push([x0 - 2, x0 + w + 1])
      busy[k + 1]!.push([x0 - 1, x0 + w])
      holes.push({ k, x0 })
    }
  }

  /**
   * Where an opening in the ceiling or floor goes: somewhere free, else over or under a hole
   * that is already flat, else as near the middle as it can be without meeting another opening.
   */
  const openings: Array<[number, number]> = []
  const opening = (k: number, width: number, hole: { k: number; x0: number } | undefined): number => {
    const clear = (x0: number) => openings.every(([a, b]) => x0 + width < a - 1 || x0 > b + 1)
    const take = (x0: number, flat: boolean) => {
      if (flat) {
        flatten(tiers[k]!, x0 - 1, x0 + width, tiers[k]!.floor[x0]!)
        busy[k]!.push([x0 - 1, x0 + width])
      }
      openings.push([x0, x0 + width - 1])
      return x0
    }
    for (let tries = 0; tries < 30; tries++) {
      const x0 = randInt(rand, 3, Math.max(3, C - 3 - width))
      if (free(k, x0 - 1, x0 + width) && clear(x0)) return take(x0, true)
    }
    if (hole && clear(hole.x0)) return take(hole.x0, false)
    const mid = clamp(Math.floor((C - width) / 2), 1, C - 1 - width)
    for (let d = 0; d < C; d++) for (const x0 of [mid - d, mid + d]) if (x0 >= 1 && x0 <= C - 1 - width && clear(x0)) return take(x0, true)
    return take(mid, true)
  }
  // A hole in the floor stays narrow enough to jump over, for those going past it.
  const drop = Math.max(1, Math.min(w, m.gap))
  const topAt = o.exits.top ? opening(0, w, holes.find((h) => h.k === 0)) : -1
  const bottomAt = o.exits.bottom ? opening(n - 1, drop, holes.findLast((h) => h.k === n - 2)) : -1

  for (const t of tiers) {
    // Steps taller than a block become staircases over the flat floor before them, for slopes.
    if (ramps > 0) {
      for (let x = 1; x < C - 1; x++) {
        const d = t.floor[x]! - t.floor[x + 1]!
        if (Math.abs(d) < 2 || rand() >= ramps) continue
        const n = Math.abs(d) - 1
        // Up: the run left of the step climbs; down: the run right of it descends.
        const cols = d > 0 ? Array.from({ length: n }, (_, i) => x - i) : Array.from({ length: n }, (_, i) => x + 2 + i)
        const level = d > 0 ? t.floor[x]! : t.floor[x + 1]!
        if (!cols.every((c) => c > 0 && c < C - 1 && !t.locked[c] && t.floor[c] === level)) continue
        cols.forEach((c, i) => (t.floor[c] = level - (n - i)))
        x += d > 0 ? 0 : n + 1
      }
    }
    // No step taller than a jump, keeping the flattened places as they are.
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 1; x < C; x++) if (!t.locked[x]) t.floor[x] = clamp(t.floor[x]!, t.floor[x - 1]! - m.jump, t.floor[x - 1]! + m.jump)
      for (let x = C - 2; x >= 0; x--) if (!t.locked[x]) t.floor[x] = clamp(t.floor[x]!, t.floor[x + 1]! - m.jump, t.floor[x + 1]! + m.jump)
    }
    for (let x = 0; x < C; x++) t.floor[x] = clamp(t.floor[x]!, t.top + 1, t.bot + 1)

    // Ceilings: flat with the odd beam (levels) or wandering (caverns), always clear of the floor.
    if (caverns) {
      let level = t.top + randInt(rand, 0, 1)
      for (let x = 0; x < C; x++) {
        if (rand() < 0.2 + 0.5 * v) level = clamp(level + (rand() < 0.5 ? -1 : 1), t.top, t.top + 1 + Math.round(v * 3))
        t.ceil[x] = level
      }
    } else {
      t.ceil.fill(t.top)
      for (let x = 2; x < C - 2; x++) {
        if (rand() < v * 0.08) {
          const len = randInt(rand, 2, 5)
          const drop = randInt(rand, 1, 2)
          for (let i = 0; i < len && x < C - 2; i++) t.ceil[x++] = t.top + drop
        }
      }
    }
    for (let x = 0; x < C; x++) {
      let lowest = t.floor[x]!
      for (let d = -2; d <= 2; d++) lowest = Math.min(lowest, t.floor[clamp(x + d, 0, C - 1)]!)
      t.ceil[x] = clamp(t.ceil[x]!, t.top, Math.max(t.top, lowest - m.head))
    }
  }

  tiers.forEach((t, k) => {
    for (let x = 1; x < C - 1; x++) for (let y = t.ceil[x]!; y < t.floor[x]!; y++) g.carve(x, y, k)
  })

  const door = (t: Tier, k: number, x0: number, x1: number, edge: number): number => {
    const level = t.floor[edge]!
    for (let x = x0; x <= x1; x++) for (let y = Math.max(1, level - m.door); y < level; y++) g.carve(x, y, k, x === edge ? PASSAGE : 0)
    return level - 1
  }
  if (o.exits.left) exits.left = { y: door(leftT, n - 1, 0, 3, 0) }
  if (o.exits.right) exits.right = { y: door(rightT, tiers.indexOf(rightT), C - 4, C - 1, C - 1) }

  /** One-way platforms evenly up a shaft of air from the floor at `from`, none more than a jump apart, up to `stop`. */
  const ladder = (x0: number, from: number, stop: number) => {
    const count = Math.ceil((from - stop) / m.jump) - 1
    for (let i = 1; i <= count; i++) {
      const p = stop + Math.round((i * (from - stop)) / (count + 1))
      for (let x = x0; x < x0 + w; x++) g.set(x, p, PLAT, STRUCT)
    }
  }
  for (const { k, x0 } of holes) {
    const upper = tiers[k]!
    const lower = tiers[k + 1]!
    for (let x = x0; x < x0 + w; x++) {
      for (let y = upper.floor[x]!; y < lower.floor[x]!; y++) g.carve(x, y, k + 1, PASSAGE)
      for (let y = upper.floor[x]! - m.head; y < upper.floor[x]!; y++) g.mark(x, y, PASSAGE)
    }
    ladder(x0, lower.floor[x0]!, upper.floor[x0]!)
    for (let x = x0; x < x0 + w; x++) g.set(x, upper.floor[x0]!, PLAT, STRUCT)
  }
  if (topAt >= 0) {
    for (let x = topAt; x < topAt + w; x++) for (let y = 0; y < top.ceil[x]!; y++) g.carve(x, y, 0, PASSAGE)
    ladder(topAt, top.floor[topAt]!, 0)
    exits.top = { x: topAt, width: w }
  }
  if (bottomAt >= 0) {
    for (let x = bottomAt; x < bottomAt + drop; x++) for (let y = bottom.floor[x]!; y < R; y++) g.carve(x, y, n - 1, PASSAGE)
    exits.bottom = { x: bottomAt, width: drop }
  }
  return exits
}

// ---------------------------------------------------------------------------------------
// Shaft: one tall space, climbed on ledges that alternate sides a jump apart.

function shaft(g: Grid, o: RoomgenOptions, m: RoomgenMetrics, rand: Rand): RoomExits {
  const { C, R } = g
  const v = clamp(o.variation, 0, 100) / 100
  const maxWall = Math.max(0, Math.min(3, Math.floor((C - 2 - m.door - 2 * m.gap) / 2), Math.round(3 * v)))
  const lw = new Int16Array(R)
  const rw = new Int16Array(R)
  let a = 0
  let b = 0
  for (let y = 1; y < R - 1; y++) {
    if (rand() < 0.15 + 0.5 * v) a = clamp(a + (rand() < 0.5 ? -1 : 1), 0, maxWall)
    if (rand() < 0.15 + 0.5 * v) b = clamp(b + (rand() < 0.5 ? -1 : 1), 0, maxWall)
    // Keep the walls straight by the exits.
    const low = y >= R - 2 - m.door - 1
    lw[y] = o.exits.left && low ? 0 : a
    rw[y] = o.exits.right && y <= m.door + m.jump + 2 ? 0 : b
  }
  for (let y = 1; y < R - 1; y++) for (let x = 1 + lw[y]!; x <= C - 2 - rw[y]!; x++) g.carve(x, y, 0)

  const ledges: Array<{ y: number; side: 'left' | 'right'; x0: number; x1: number }> = []
  let side: 'left' | 'right' = o.exits.left ? 'right' : rand() < 0.5 ? 'left' : 'right'
  const below = { left: R - 1, right: R - 1 }
  let inner = -1
  /** Each side's last ledge's inner end. */
  const ends: { left?: number; right?: number } = {}
  for (let y = R - 1 - m.jump; y >= 2; y -= m.jump) {
    const first = y === R - 1 - m.jump
    // Measured where the shaft is narrowest from the ledge up to a head over it, so there is
    // room to stand on it; it still runs out to the wall at its own row.
    let left = 1 + lw[y]!
    let right = C - 2 - rw[y]!
    for (let k = 1; k <= m.head && y - k > 0; k++) {
      left = Math.max(left, 1 + lw[y - k]!)
      right = Math.min(right, C - 2 - rw[y - k]!)
    }
    const S = right - left + 1
    let least = clamp(Math.ceil((S - m.gap) / 2), Math.min(2, Math.max(1, S - 1)), Math.max(1, S - 1))
    let most = Math.max(least, Math.min(S - 1, Math.floor(S / 2) + Math.round(v * 2)))
    // Solid where there is room to stand under it, or as a step on the floor; one-way otherwise.
    const space = below[side] - (y + 2)
    const solid = space >= m.head || (first && space <= 0)
    if (inner >= 0) {
      // Reach the last ledge: its inner end no further than a running jump, with a column of
      // air left between the two to jump up through.
      const need = side === 'right' ? right - (inner + m.gap + 1) + 1 : inner - m.gap - 1 - left + 1
      let room = Math.max(1, (side === 'right' ? right - inner : inner - left) - 1)
      // A solid ledge reaches no further out than the one below it on this side, or it would
      // be in the way of the jump up from that one.
      const under = ends[side]
      if (solid && under !== undefined) room = Math.max(1, Math.min(room, side === 'right' ? right - under + 1 : under - left + 1))
      least = clamp(Math.max(least, need), 1, room)
      most = clamp(most, least, room)
    }
    const width = randInt(rand, least, most)
    const x0 = side === 'left' ? 1 + lw[y]! : right - width + 1
    const x1 = side === 'left' ? left + width - 1 : C - 2 - rw[y]!
    for (let x = x0; x <= x1; x++) {
      if (solid) {
        g.set(x, y, ROCK, STRUCT)
        if (y + 1 < R - 1) g.set(x, y + 1, ROCK, STRUCT)
      } else g.set(x, y, PLAT, STRUCT)
      for (let k = 1; k <= m.head && y - k > 0; k++) if (g.get(x, y - k) === AIR) g.mark(x, y - k, STRUCT)
    }
    ledges.push({ y, side, x0, x1 })
    inner = side === 'left' ? x1 : x0
    ends[side] = inner
    below[side] = y
    side = side === 'left' ? 'right' : 'left'
  }

  const exits: RoomExits = {}
  if (o.exits.left) {
    // Through the wall only, so a ledge beside the exit stays.
    for (let y = Math.max(1, R - 1 - m.door); y < R - 1; y++) for (let x = 0; x <= lw[y]!; x++) g.carve(x, y, 0, PASSAGE)
    exits.left = { y: R - 2 }
  }
  if (o.exits.right) {
    const ledge = ledges.filter((l) => l.side === 'right').at(-1)
    const y = ledge ? ledge.y : R - 1
    const from = ledge ? ledge.x1 + 1 : C - 2 - rw[R - 2]!
    for (let x = from; x < C; x++) for (let k = 1; k <= m.door && y - k > 0; k++) g.carve(x, y - k, 0, PASSAGE)
    exits.right = { y: y - 1 }
  }
  const w = Math.min(m.door, C - 2)
  const mid = clamp(Math.floor((C - w) / 2), 1, C - 1 - w)
  if (o.exits.top) {
    for (let x = mid; x < mid + w; x++) for (let y = 0; y < R - 1 && g.get(x, y) !== AIR; y++) g.carve(x, y, 0, PASSAGE)
    exits.top = { x: mid, width: w }
  }
  if (o.exits.bottom) {
    // In the floor where no ledge stands on it, nearest the middle, clear of the left exit,
    // with a column of floor kept on each side to climb the ledge beside it from. Narrower if
    // that is the only way it fits.
    const open = (x0: number, width: number) => {
      if (x0 < 3 || x0 > C - 1 - width) return false
      for (let x = x0 - 1; x <= x0 + width; x++) if (g.get(x, R - 2) !== AIR || g.flag(x, R - 2) & PASSAGE) return false
      return true
    }
    let at = clamp(Math.floor((C - 1) / 2), 1, C - 2)
    let drop = 1
    search: for (let width = Math.max(1, Math.min(w, m.gap)); width >= 1; width--) {
      const centre = Math.floor((C - width) / 2)
      for (let d = 0; d < C; d++) {
        for (const x0 of [centre - d, centre + d]) {
          if (open(x0, width)) {
            at = x0
            drop = width
            break search
          }
        }
      }
    }
    for (let x = at; x < at + drop; x++) g.carve(x, R - 1, 0, PASSAGE)
    exits.bottom = { x: at, width: drop }
  }
  return exits
}

// ---------------------------------------------------------------------------------------
// Passes over any layout.

/** Small places: a loft dug into a low ceiling, floored with a platform a jump up (a niche when the jump is one block). */
function addNooks(g: Grid, m: RoomgenMetrics, rand: Rand, amount: number) {
  const { C, R } = g
  const tries = Math.round(((clamp(amount, 0, 100) / 100) * C * R) / 12)
  for (let i = 0; i < tries; i++) {
    const x = randInt(rand, 2, C - 3)
    const floors = g.floors(x).filter((y) => g.get(x, y + 1) === ROCK)
    if (!floors.length) continue
    const y = floors[randInt(rand, 0, floors.length - 1)]!
    const tier = g.tierAt(x, y)
    const w = randInt(rand, 2, 4)
    const nh = m.head + (rand() < 0.5 ? 1 : 0)
    const x0 = x - randInt(rand, 0, w - 1)
    const x1 = x0 + w - 1
    const p = y + 1 - m.jump
    const top = p - nh
    if (x0 < 1 || x1 > C - 2 || top - 2 < 0 || y + 1 >= R) continue
    let ok = true
    let rock = 0
    for (let xx = x0; xx <= x1 && ok; xx++) {
      if (g.get(xx, y) !== AIR || g.get(xx, y + 1) !== ROCK || g.flag(xx, y + 1)) ok = false
      for (let yy = top; yy <= y && ok; yy++) {
        const c = g.get(xx, yy)
        if (g.flag(xx, yy)) ok = false
        else if (c === ROCK) rock++
        else if (c !== AIR || g.tierAt(xx, yy) !== tier) ok = false
      }
    }
    for (let xx = x0 - 1; xx <= x1 + 1 && ok; xx++) for (const yy of [top - 2, top - 1]) if (g.get(xx, yy) !== ROCK || g.flag(xx, yy)) ok = false
    for (const xx of [x0 - 1, x1 + 1]) {
      for (let yy = top; yy < p && ok; yy++) {
        const c = g.get(xx, yy)
        if ((c === AIR && g.tierAt(xx, yy) !== tier) || (c !== AIR && c !== ROCK) || g.flag(xx, yy) & PASSAGE) ok = false
      }
    }
    if (!ok || rock < w * 2) continue
    for (let xx = x0; xx <= x1; xx++) {
      for (let yy = top; yy <= y; yy++) g.carve(xx, yy, tier, STRUCT)
      // With a jump of one block there is no loft to climb to: it stays a niche off the floor.
      if (p < y) g.set(xx, p, PLAT, STRUCT)
    }
  }
}

/** One-way platforms a jump over the floor, sometimes stacked, where there is room. */
function addPlatforms(g: Grid, m: RoomgenMetrics, rand: Rand, amount: number) {
  const { C, R } = g
  const tries = Math.round(((clamp(amount, 0, 100) / 100) * C * R) / 24)
  const fits = (x0: number, w: number, p: number, tier: number) => {
    if (x0 < 1 || x0 + w > C - 1 || p - m.head < 1) return false
    if (g.get(x0 - 1, p) === PLAT || g.get(x0 + w, p) === PLAT) return false
    for (let x = x0; x < x0 + w; x++) {
      for (let y = p - m.head; y <= p + 1; y++) if (y < R && (g.get(x, y) !== AIR || g.flag(x, y) || g.tierAt(x, y) !== tier)) return false
    }
    return true
  }
  for (let i = 0; i < tries; i++) {
    const x = randInt(rand, 1, C - 2)
    const floors = g.floors(x)
    if (!floors.length) continue
    let y = floors[randInt(rand, 0, floors.length - 1)]!
    const tier = g.tierAt(x, y)
    const stack = 1 + (rand() < 0.35 ? 1 : 0)
    for (let level = 0; level < stack; level++) {
      const p = y + 1 - m.jump
      // With a jump of one block a platform would lie on the floor.
      if (p >= y) break
      const w = randInt(rand, 2, 3 + Math.min(3, m.gap))
      const x0 = clamp(x - randInt(rand, 0, w - 1), 1, C - 1 - w)
      if (!fits(x0, w, p, tier)) break
      for (let xx = x0; xx < x0 + w; xx++) g.set(xx, p, PLAT, STRUCT)
      y = p - 1
    }
  }
}

/** Spike pits, never wider than a running jump clears, sunk one block into long floors. */
function addPits(g: Grid, m: RoomgenMetrics, rand: Rand, amount: number) {
  if (amount <= 0) return
  const { C, R } = g
  const chance = (clamp(amount, 0, 100) / 100) * 0.45
  const ok = (x: number, y: number) => {
    if (g.get(x, y) !== AIR || g.flag(x, y) || g.flag(x, y + 1)) return false
    if (g.get(x, y + 1) !== ROCK || g.get(x, y + 2) !== ROCK || g.get(x, y + 3) !== ROCK) return false
    for (let k = 1; k < m.head; k++) if (g.get(x, y - k) !== AIR) return false
    return true
  }
  for (let y = 1; y < R - 4; y++) {
    let x = 1
    while (x < C - 1) {
      let len = 0
      while (x + len < C - 1 && ok(x + len, y)) len++
      let a = x + 2
      while (a <= x + len - 3) {
        const w = randInt(rand, 1, Math.min(m.gap, x + len - 2 - a))
        if (rand() < chance) {
          for (let xx = a; xx < a + w; xx++) g.set(xx, y + 1, SPIKES, STRUCT)
          a += w + randInt(rand, 3, 6)
        } else a += randInt(rand, 2, 5)
      }
      x += len + 1
    }
  }
}

/** Turns one-block steps into slopes: 45° in one block, or gentle over two. */
function addSlopes(g: Grid, rand: Rand, amount: number) {
  if (amount <= 0) return
  const { C, R } = g
  const chance = clamp(amount, 0, 100) / 100
  const open = (x: number, y: number) => g.get(x, y) === AIR && !(g.flag(x, y) & STRUCT)
  const ground = (x: number, y: number) => g.get(x, y) === ROCK
  for (let y = 1; y < R - 1; y++) {
    // Up, left to right, so a staircase becomes one long slope.
    for (let x = 1; x < C - 1; x++) {
      if (!open(x, y) || !ground(x, y + 1) || !ground(x + 1, y) || ground(x + 1, y - 1) || g.get(x, y - 1) !== AIR) continue
      const base = g.get(x - 1, y + 1)
      if (!open(x - 1, y) || !(base === ROCK || base === SU || base === GU2)) continue
      if (rand() >= chance) continue
      const gentle = base === ROCK && g.get(x - 1, y - 1) === AIR && open(x - 2, y) && [ROCK, SU, GU2].includes(g.get(x - 2, y + 1)) && rand() < 0.5
      if (gentle) {
        g.set(x - 1, y, GU1)
        g.set(x, y, GU2)
      } else g.set(x, y, SU)
    }
    // Down, right to left.
    for (let x = C - 2; x >= 1; x--) {
      if (!open(x, y) || !ground(x, y + 1) || !ground(x - 1, y) || ground(x - 1, y - 1) || g.get(x, y - 1) !== AIR) continue
      const base = g.get(x + 1, y + 1)
      if (!open(x + 1, y) || !(base === ROCK || base === SD || base === GD1)) continue
      if (rand() >= chance) continue
      const gentle = base === ROCK && g.get(x + 1, y - 1) === AIR && open(x + 2, y) && [ROCK, SD, GD1].includes(g.get(x + 2, y + 1)) && rand() < 0.5
      if (gentle) {
        g.set(x, y, GD1)
        g.set(x + 1, y, GD2)
      } else g.set(x, y, SD)
    }
  }
}

const TOPS = new Set(['t', 't-alt', 'tl', 'tr', 'pillar-top', 'single'])
const BOTTOMS = new Set(['b', 'bl', 'br', 'pillar-bottom', 'single'])

/** Block names for the ground and back layers. */
function dress(g: Grid, o: RoomgenOptions, has: Set<string>, rand: Rand, seed: number): { ground: Array<string | null>; back: Array<string | null> | null } {
  const { C, R } = g
  const solid = (x: number, y: number) => {
    const c = g.get(clamp(x, 0, C - 1), clamp(y, 0, R - 1))
    return c === ROCK || isSlopeCell(c)
  }
  // Padded by a cell all round, so the room's edges carry on past it instead of opening to air.
  const auto = autotile(C + 2, R + 2, (x, y) => solid(x - 1, y - 1), (seed & 0xffff) + 1)
  const ground: Array<string | null> = new Array(C * R).fill(null)
  const at = (x: number, y: number) => (g.inside(x, y) ? ground[y * C + x] : null)
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < C; x++) {
      const c = g.get(x, y)
      let name: string | null = null
      if (c === ROCK) name = auto[y + 1]![x + 1]!
      else if (isSlopeCell(c)) name = SLOPE_NAMES[c]!
      else if (c === SPIKES) name = 'spikes'
      else if (c === PLAT) {
        const closed = (cell: number) => cell === PLAT || cell === ROCK || isSlopeCell(cell)
        const l = !closed(g.get(x - 1, y))
        const r = !closed(g.get(x + 1, y))
        name = l && !r ? 'platform-l' : r && !l ? 'platform-r' : 'platform'
      }
      ground[y * C + x] = name && has.has(name) ? name : null
    }
  }

  let back: Array<string | null> | null = null
  if (o.backWall !== 'none' && has.has('back')) {
    back = new Array(C * R).fill(null)
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < C; x++) {
        const c = g.get(x, y)
        if (c === ROCK) continue
        if (o.backWall === 'patches' && noise(x, y, 5, seed + 17) < 0.45) continue
        const roll = rand()
        const name = g.get(x, y - 1) === ROCK && !isSlopeCell(c) ? 'back-shadow' : roll < 0.035 ? 'window' : roll < 0.25 ? 'back-alt' : 'back'
        back[y * C + x] = has.has(name) ? name : 'back'
      }
    }
  }

  const amount = clamp(o.decoration, 0, 100) / 100
  if (amount > 0) {
    const lastTorch = new Map<number, number>()
    for (let y = 1; y < R - 1; y++) {
      for (let x = 1; x < C - 1; x++) {
        if (g.get(x, y) !== AIR || g.flag(x, y) & PASSAGE || ground[y * C + x]) continue
        const under = g.get(x, y + 1) === ROCK ? at(x, y + 1) : null
        const over = g.get(x, y - 1) === ROCK ? at(x, y - 1) : null
        let name: string | null = null
        if (under && TOPS.has(under) && rand() < amount * 0.35) {
          const roll = rand()
          name = roll < 0.5 ? 'tuft' : roll < 0.75 ? 'flower' : 'rock'
        } else if (over && BOTTOMS.has(over) && g.get(x, y + 1) === AIR && rand() < amount * 0.3) {
          name = rand() < 0.5 ? 'stalactite' : 'vine'
        } else if (back?.[y * C + x] && !under && !over && g.get(x, y + 1) === AIR && g.get(x - 1, y) === AIR && g.get(x + 1, y) === AIR && rand() < amount * 0.06) {
          // Torches on the back wall, a few blocks apart.
          if (Math.abs((lastTorch.get(y) ?? -99) - x) > 5 && Math.abs((lastTorch.get(y - 1) ?? -99) - x) > 5) {
            name = 'torch'
            lastTorch.set(y, x)
          }
        }
        if (name && has.has(name)) ground[y * C + x] = name
      }
    }
  }
  return { ground, back }
}

// ---------------------------------------------------------------------------------------
// From blocks to tiles.

/**
 * Whether an image is laid out like the tileset generator's sheet, and if so its block size
 * and the blocks it has. Sheets saved before slopes are four rows of blocks; now they are five.
 */
export function tilegenLayout(width: number, height: number): { blockSize: 8 | 16 | 32; rows: number; blocks: string[] } | null {
  const T = width / TILEGEN_COLS
  if (T !== 8 && T !== 16 && T !== 32) return null
  const rows = height / T
  if (rows !== 4 && rows !== 5) return null
  return { blockSize: T, rows, blocks: TILEGEN_BLOCKS.slice(0, rows * TILEGEN_COLS) }
}

/** A layer of block names as room cells: 0 is empty, n is tile n-1 of the generator's sheet. */
export function roomgenCells(room: GeneratedRoom, names: ReadonlyArray<string | null>): Uint16Array {
  const per = room.blockSize / 8
  const sheetTileCols = TILEGEN_COLS * per
  const index = new Map(TILEGEN_BLOCKS.map((name, i) => [name, i]))
  const out = new Uint16Array(room.tileCols * room.tileRows)
  for (let by = 0; by < room.rows; by++) {
    for (let bx = 0; bx < room.cols; bx++) {
      const name = names[by * room.cols + bx]
      const i = name ? index.get(name) : undefined
      if (i === undefined) continue
      const col = i % TILEGEN_COLS
      const row = Math.floor(i / TILEGEN_COLS)
      for (let ty = 0; ty < per; ty++) {
        const y = by * per + ty
        if (y >= room.tileRows) break
        for (let tx = 0; tx < per; tx++) {
          const x = bx * per + tx
          if (x >= room.tileCols) break
          out[y * room.tileCols + x] = (row * per + ty) * sheetTileCols + col * per + tx + 1
        }
      }
    }
  }
  return out
}

/** The room document: a back wall layer when there is one, then the ground. */
export function roomgenDocument(room: GeneratedRoom, name: string, tileset: string): Room {
  const width = room.tileCols / SCREEN.cols
  const height = room.tileRows / SCREEN.rows
  const layers = [{ name: 'Ground', data: rleEncode(roomgenCells(room, room.ground)) }]
  if (room.back) layers.unshift({ name: 'Back wall', data: rleEncode(roomgenCells(room, room.back)) })
  return { version: FORMAT_VERSION, name, width, height, tileset, layers, entities: [] }
}
