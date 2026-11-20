import { describe, expect, it } from 'vitest'
import { DEFAULT_TILEGEN, TILEGEN_BLOCKS, TILEGEN_PRESETS, autotile, countColours, generateTileset, presetOptions, slopeTile, tilegenCollision, toBgr555 } from '../src/index.ts'
import type { GeneratedTileset, TilegenOptions } from '../src/index.ts'

/** Distinct GBA colours in each 8x8 tile, the most any tile has. */
function worstTile(sheet: GeneratedTileset): number {
  let worst = 0
  for (let ty = 0; ty < sheet.height / 8; ty++) {
    for (let tx = 0; tx < sheet.width / 8; tx++) {
      const seen = new Set<number>()
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = ((ty * 8 + y) * sheet.width + tx * 8 + x) * 4
          if (sheet.rgba[i + 3]! >= 128) seen.add(toBgr555(sheet.rgba[i]!, sheet.rgba[i + 1]!, sheet.rgba[i + 2]!))
        }
      }
      worst = Math.max(worst, seen.size)
    }
  }
  return worst
}

const pixel = (sheet: GeneratedTileset, x: number, y: number) => Array.from(sheet.rgba.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4))
const blockAt = (sheet: GeneratedTileset, name: string) => sheet.blocks.find((b) => b.name === name)!

describe('tileset generator', () => {
  it('lays blocks edge to edge at multiples of 8, with no padding', () => {
    for (const blockSize of [8, 16, 32] as const) {
      const sheet = generateTileset({ ...DEFAULT_TILEGEN, blockSize })
      expect(sheet.width).toBe(sheet.cols * blockSize)
      expect(sheet.height).toBe(sheet.rows * blockSize)
      expect(sheet.width % 8).toBe(0)
      expect(sheet.height % 8).toBe(0)
      expect(sheet.blocks.map((b) => b.name)).toEqual(TILEGEN_BLOCKS)
      // Fill blocks are solid to the very edge: nothing between them.
      const fill = blockAt(sheet, 'c')
      for (let i = 0; i < blockSize; i++) {
        expect(pixel(sheet, fill.col * blockSize + i, fill.row * blockSize)[3]).toBe(255)
        expect(pixel(sheet, fill.col * blockSize, fill.row * blockSize + i)[3]).toBe(255)
      }
    }
  })

  it('fits one 16-colour palette for every preset, size and pattern', () => {
    for (const preset of TILEGEN_PRESETS) {
      for (const blockSize of [8, 16, 32] as const) {
        const options: TilegenOptions = { ...presetOptions(preset, blockSize, 7), shades: 6 }
        const sheet = generateTileset(options)
        expect(countColours(sheet.rgba)).toBeLessThanOrEqual(15)
        expect(worstTile(sheet)).toBeLessThanOrEqual(15)
        expect(sheet.palette.length).toBeLessThanOrEqual(15)
      }
    }
  })

  it('is the same for the same seed and different for another', () => {
    const a = generateTileset({ ...DEFAULT_TILEGEN, seed: 42 })
    const b = generateTileset({ ...DEFAULT_TILEGEN, seed: 42 })
    const c = generateTileset({ ...DEFAULT_TILEGEN, seed: 43 })
    expect(a.rgba).toEqual(b.rgba)
    expect(a.rgba).not.toEqual(c.rgba)
  })

  it('keeps variants on the same mortar lines as the fill, so they swap in without a seam', () => {
    for (const pattern of ['bricks', 'stone', 'cobble', 'wood', 'panels'] as const) {
      const T = 16
      const sheet = generateTileset({ ...DEFAULT_TILEGEN, pattern, shades: 4, outline: false })
      // Surface 4 tones, body 4, then mortar.
      const mortar = sheet.palette[8]!
      const mask = (name: string) => {
        const b = blockAt(sheet, name)
        return Array.from({ length: T * T }, (_, i) => {
          const [r, g, bl] = pixel(sheet, b.col * T + (i % T), b.row * T + Math.floor(i / T))
          return `#${((r! << 16) | (g! << 8) | bl!).toString(16).padStart(6, '0')}` === mortar
        })
      }
      const fill = mask('c')
      expect(fill.some(Boolean)).toBe(true)
      // A cracked stone adds mortar; it never moves a line.
      const variant = mask('c-alt')
      expect(fill.every((m, i) => !m || variant[i])).toBe(true)
    }
  })

  it('marks collision per 8x8 tile: ground solid, only the top of platforms one-way', () => {
    const sheet = generateTileset({ ...DEFAULT_TILEGEN, blockSize: 16 })
    const collision = tilegenCollision(sheet, (kind) => kind)
    const tileCols = sheet.width / 8
    const tile = (name: string, tx: number, ty: number) => {
      const b = blockAt(sheet, name)
      return collision[String((b.row * 2 + ty) * tileCols + b.col * 2 + tx)]
    }
    expect(tile('c', 0, 0)).toBe('solid')
    expect(tile('c', 1, 1)).toBe('solid')
    expect(tile('platform', 0, 0)).toBe('oneway')
    expect(tile('platform', 0, 1)).toBeUndefined()
    expect(tile('spikes', 0, 1)).toBe('hazard')
    expect(tile('tuft', 0, 1)).toBeUndefined()
    expect(tile('back', 0, 0)).toBeUndefined()
  })

  it('cuts slope blocks into slope, solid and empty tiles that meet their neighbours', () => {
    const sheet = generateTileset({ ...DEFAULT_TILEGEN, blockSize: 16 })
    const collision = tilegenCollision(sheet, (kind, slope) => (slope ? `${kind}-${slope.left}-${slope.right}` : kind))
    const tileCols = sheet.width / 8
    const tile = (name: string, tx: number, ty: number) => {
      const b = blockAt(sheet, name)
      return collision[String((b.row * 2 + ty) * tileCols + b.col * 2 + tx)]
    }
    // 45°: a slope tile at the bottom left and top right, solid under it, air over it.
    expect([tile('slope-up', 0, 1), tile('slope-up', 1, 1), tile('slope-up', 0, 0), tile('slope-up', 1, 0)]).toEqual(['slope-0-8', 'solid', undefined, 'slope-0-8'])
    expect([tile('slope-down', 0, 0), tile('slope-down', 0, 1), tile('slope-down', 1, 1)]).toEqual(['slope-8-0', 'solid', 'slope-8-0'])
    // Gentle: half a block of rise in each block, so the two halves join at the middle.
    expect([tile('gentle-up-1', 0, 1), tile('gentle-up-1', 1, 1), tile('gentle-up-1', 0, 0)]).toEqual(['slope-0-4', 'slope-4-8', undefined])
    expect([tile('gentle-up-2', 0, 1), tile('gentle-up-2', 0, 0), tile('gentle-up-2', 1, 0)]).toEqual(['solid', 'slope-0-4', 'slope-4-8'])
    expect([tile('gentle-down-1', 0, 0), tile('gentle-down-2', 1, 1)]).toEqual(['slope-8-4', 'slope-4-0'])
    // At 32 px the same slopes cut into four tiles a row.
    expect(slopeTile(32, { from: 0, to: 0.5 }, 1, 3)).toEqual({ left: 4, right: 8 })
    expect(slopeTile(32, { from: 0, to: 0.5 }, 3, 2)).toEqual({ left: 4, right: 8 })
    expect(slopeTile(32, { from: 0, to: 1 }, 3, 0)).toEqual({ left: 0, right: 8 })
    // Drawn as collided: air over the floor line, ground under it.
    const up = blockAt(sheet, 'slope-up')
    expect(pixel(sheet, up.col * 16 + 1, up.row * 16 + 2)[3]).toBe(0)
    expect(pixel(sheet, up.col * 16 + 14, up.row * 16 + 2)[3]).toBe(255)
  })

  it('turns decorations into machinery for metal interiors, keeping block names', () => {
    const outdoor = generateTileset({ ...DEFAULT_TILEGEN, pattern: 'earth' })
    const ship = generateTileset({ ...DEFAULT_TILEGEN, pattern: 'panels' })
    expect(ship.blocks.map((b) => b.name)).toEqual(outdoor.blocks.map((b) => b.name))
    expect(['tuft', 'flower', 'rock', 'torch', 'stalactite', 'vine'].map((n) => blockAt(ship, n).label)).toEqual(['Canister', 'Terminal', 'Crate', 'Wall lamp', 'Pipe', 'Cable'])
    expect(blockAt(outdoor, 'tuft').label).toBe('Grass tuft')
  })

  it('autotiles a map to the right pieces', () => {
    const map = ['....', '.##.', '.##.', '####']
    const tiles = autotile(4, 4, (x, y) => map[y]![x] === '#')
    expect(tiles[1]).toEqual([null, 'tl', 'tr', null])
    expect(tiles[2]).toEqual([null, 'l', 'r', null])
    // Past the map's edge counts as more ground, so the bottom row only opens upward.
    expect(tiles[3]).toEqual(['t', 'inner-tl', 'inner-tr', 't'])
    expect(autotile(3, 3, (x, y) => x === 1 && y === 1)[1]![1]).toBe('single')
  })
})
