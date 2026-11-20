import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOMGEN, ROOMGEN_STYLES, ROOM_CELL, TILEGEN_BLOCKS, generateRoom, isSlopeCell, rleDecode, roomgenCells, roomgenDocument, tilegenLayout } from '../src/index.ts'
import type { GeneratedRoom, RoomgenOptions } from '../src/index.ts'

const ALL = { left: true, right: true, top: true, bottom: true }
const env = (blockSize: number, blocks: readonly string[] = TILEGEN_BLOCKS) => ({ blockSize, jumpHeight: 49, jumpDistance: 69, blocks })

/**
 * Where a player can get to from a cell, roughly as the game moves: walk, climb a step of up
 * to a jump, jump a gap, fall, jump up through and drop down through one-way platforms.
 * Cells are where the player stands: not solid, over rock, a platform or a slope (or a slope itself).
 */
function reach(room: GeneratedRoom, from: [number, number]) {
  const { cols: C, rows: R, cells } = room
  const { jump, gap } = room.metrics
  const cell = (x: number, y: number) => (x < 0 || x >= C || y >= R ? -1 : y < 0 ? ROOM_CELL.air : cells[y * C + x]!)
  const blocks = (x: number, y: number) => cell(x, y) === ROOM_CELL.rock
  const supports = (c: number) => c === ROOM_CELL.rock || c === ROOM_CELL.platform || isSlopeCell(c)
  const stand = (x: number, y: number) => {
    const c = cell(x, y)
    if (c === -1 || c === ROOM_CELL.rock || c === ROOM_CELL.spikes) return false
    return isSlopeCell(c) || supports(cell(x, y + 1))
  }
  const seen = new Set<number>()
  let fellOut = false
  const queue: Array<[number, number]> = []
  const visit = (x: number, y: number) => {
    if (x < 0 || x >= C || y < 0 || y >= R) return
    const k = y * C + x
    if (seen.has(k) || !stand(x, y)) return
    seen.add(k)
    queue.push([x, y])
  }
  /** Falls down column x from row y to where it lands. */
  const fall = (x: number, y: number) => {
    let yy = y
    while (yy < R && !stand(x, yy)) {
      if (blocks(x, yy) || cell(x, yy) === ROOM_CELL.spikes) return
      yy++
    }
    if (yy >= R) fellOut = true
    else visit(x, yy)
  }
  visit(...from)
  while (queue.length) {
    const [x, y] = queue.shift()!
    /** The highest row reached rising up column c from row y, through air and platforms. */
    const rise = (c: number) => {
      let top = y
      for (let d = 1; d <= jump && !blocks(c, y - d) && y - d >= 0; d++) top = y - d
      return top
    }
    const top = rise(x)
    for (let yy = y - 1; yy >= top; yy--) if (cell(x, yy) !== ROOM_CELL.platform) visit(x, yy)
    for (const dir of [-1, 1]) {
      // Rise up to a jump, in this column or the next one over (a jump that sets off sideways),
      // then drift across up to a running jump's width, landing or falling.
      const columns = blocks(x + dir, y) ? [x] : [x, x + dir]
      for (const c of columns) {
        for (let yy = y; yy >= rise(c); yy--) {
          for (let k = c - x + dir; Math.abs(k) <= gap + 1; k += dir) {
            const nx = x + k
            if (blocks(nx, yy)) break
            if (stand(nx, yy)) visit(nx, yy)
            else fall(nx, yy)
          }
        }
      }
    }
    // Drop through a platform.
    if (cell(x, y + 1) === ROOM_CELL.platform) fall(x, y + 2)
  }
  return { seen: (x: number, y: number) => seen.has(y * C + x), fellOut, cells: seen }
}

function exitsReachable(room: GeneratedRoom) {
  const { exits, cols: C, metrics } = room
  const start: [number, number] = exits.left ? [0, exits.left.y] : exits.right ? [C - 1, exits.right.y] : [-1, -1]
  const r = reach(room, start)
  const problems: string[] = []
  if (exits.left && !r.seen(0, exits.left.y)) problems.push('left')
  if (exits.right && !r.seen(C - 1, exits.right.y)) problems.push('right')
  if (exits.bottom && !r.fellOut) problems.push('bottom')
  if (exits.top) {
    // Standing within a jump of the top edge, under the opening or close beside it.
    const { x, width } = exits.top
    const near = [...r.cells].some((k) => {
      const cx = k % C
      const cy = Math.floor(k / C)
      return cy <= metrics.jump && cx >= x - metrics.gap - 1 && cx < x + width + metrics.gap + 1
    })
    if (!near) problems.push('top')
  }
  return problems
}

const show = (room: GeneratedRoom) =>
  Array.from({ length: room.rows }, (_, y) => Array.from(room.cells.slice(y * room.cols, (y + 1) * room.cols), (c) => '.#=^/\\/</>'[c]).join('')).join('\n')

describe('room generator', () => {
  it('can walk from the left exit to every other exit, in every style, size and block size', () => {
    const failures: string[] = []
    for (const blockSize of [8, 16, 32]) {
      for (const style of ROOMGEN_STYLES) {
        for (const [width, height] of [[1, 1], [2, 1], [1, 2], [3, 2], [2, 3]] as const) {
          for (let seed = 1; seed <= 8; seed++) {
            const options: RoomgenOptions = { ...DEFAULT_ROOMGEN, ...style.options, width, height, seed, exits: ALL }
            const room = generateRoom(options, env(blockSize))
            const problems = exitsReachable(room)
            if (problems.length) failures.push(`${style.id} ${width}x${height} @${blockSize}px seed ${seed}: ${problems.join(', ')}\n${show(room)}`)
          }
        }
      }
    }
    expect(failures.length, failures.slice(0, 3).join('\n\n')).toBe(0)
    // Hundreds of rooms: about 4.5 s alone, more beside the other tests.
  }, 20_000)

  it('keeps the room closed except at its exits', () => {
    const room = generateRoom({ ...DEFAULT_ROOMGEN, width: 2, height: 2, exits: { left: false, right: false, top: false, bottom: false } }, env(16))
    const { cols: C, rows: R, cells } = room
    for (let x = 0; x < C; x++) {
      expect(cells[x]).toBe(ROOM_CELL.rock)
      expect(cells[(R - 1) * C + x]).toBe(ROOM_CELL.rock)
    }
    for (let y = 0; y < R; y++) {
      expect(cells[y * C]).toBe(ROOM_CELL.rock)
      expect(cells[y * C + C - 1]).toBe(ROOM_CELL.rock)
    }
  })

  it('is the same for the same seed and different for another', () => {
    const a = generateRoom({ ...DEFAULT_ROOMGEN, seed: 3 }, env(16))
    const b = generateRoom({ ...DEFAULT_ROOMGEN, seed: 3 }, env(16))
    const c = generateRoom({ ...DEFAULT_ROOMGEN, seed: 4 }, env(16))
    expect(a.ground).toEqual(b.ground)
    expect(a.cells).not.toEqual(c.cells)
  })

  it('keeps the layout when only the dressing changes', () => {
    const a = generateRoom({ ...DEFAULT_ROOMGEN, decoration: 0, backWall: 'none' }, env(16))
    const b = generateRoom({ ...DEFAULT_ROOMGEN, decoration: 100, backWall: 'full' }, env(16))
    expect(a.cells).toEqual(b.cells)
    expect(a.back).toBeNull()
    expect(b.back!.some(Boolean)).toBe(true)
  })

  it('makes linear levels flat without slopes, and caverns with them', () => {
    const flat = generateRoom({ ...DEFAULT_ROOMGEN, layout: 'levels', variation: 0, slopes: 0, width: 4 }, env(16))
    expect([...flat.cells].some(isSlopeCell)).toBe(false)
    let sloped = 0
    for (let seed = 1; seed <= 5; seed++) {
      const room = generateRoom({ ...DEFAULT_ROOMGEN, ...ROOMGEN_STYLES.find((s) => s.id === 'caverns')!.options, width: 3, seed }, env(16))
      sloped += [...room.cells].filter(isSlopeCell).length
    }
    expect(sloped).toBeGreaterThan(10)
  })

  it('leaves slopes out for a sheet made before they existed', () => {
    const old = tilegenLayout(128, 64)!
    expect(old).toEqual({ blockSize: 16, rows: 4, blocks: TILEGEN_BLOCKS.slice(0, 32) })
    expect(tilegenLayout(128, 80)?.rows).toBe(5)
    expect(tilegenLayout(100, 64)).toBeNull()
    const room = generateRoom({ ...DEFAULT_ROOMGEN, slopes: 100, variation: 100, layout: 'caverns', width: 3 }, env(16, old.blocks))
    expect([...room.cells].some(isSlopeCell)).toBe(false)
    expect(room.ground.every((n) => n === null || old.blocks.includes(n))).toBe(true)
  })

  it('writes tile cells for the whole room, cutting a block that runs past its edge', () => {
    // 32 px blocks: a one-screen room is 7.5 blocks wide.
    const room = generateRoom({ ...DEFAULT_ROOMGEN, width: 1, height: 1 }, env(32))
    expect(room.cols).toBe(8)
    const cells = roomgenCells(room, room.ground)
    expect(cells.length).toBe(30 * 20)
    // Top-left is rock filling: a tile of the sheet's top three rows, which are 32 tiles wide.
    expect(cells[0]).toBeGreaterThan(0)
    const doc = roomgenDocument(room, 'Test', 'tiles')
    expect(doc.width).toBe(1)
    expect(rleDecode(doc.layers.at(-1)!.data).length).toBe(600)
    expect(doc.layers.map((l) => l.name)).toEqual(['Back wall', 'Ground'])
  })
})
