import { describe, expect, it } from 'vitest'
import { Room, Sprite, Tileset, budgetProblems, budgetState, imageBudget, rleEncode, roomBudget, validateProject } from '../src/index.ts'
import type { ArtCost, ArtResult, Documents } from '../src/index.ts'

// A project of one tileset of `tiles` tiles in `palettes` palettes, and rooms on it.
const layer = (cells: number[]) => ({ name: 'L', data: rleEncode([...cells, ...new Array<number>(600 - cells.length).fill(0)]) })
function project(rooms: Record<string, object>, art: Record<string, ArtResult>): { docs: Documents; art: (path: string) => ArtResult | undefined } {
  const docs: Documents = {
    tilesets: { t: Tileset.parse({ version: 1, name: 'T', image: 'assets/t.png', collision: {} }) },
    sprites: {},
    rooms: Object.fromEntries(Object.entries(rooms).map(([id, r]) => [id, Room.parse({ version: 1, name: id, width: 1, height: 1, tileset: 't', entities: [], ...r })])),
  }
  return { docs, art: (path) => art[path] }
}
const sky = (image: string) => ({ image, parallax: { x: 50, y: 0 } })

describe('room budgets', () => {
  const art: Record<string, ArtCost> = { 'assets/t.png': { tiles: 40, palettes: 3 }, 'assets/a.png': { tiles: 300, palettes: 4 }, 'assets/b.png': { tiles: 700, palettes: 9 } }

  it('counts the tiles every room of the tileset uses, and each picture once', () => {
    const { docs, art: lookup } = project({
      one: { layers: [layer([1, 2, 3])], backgrounds: [sky('assets/a.png'), sky('assets/a.png')] },
      two: { layers: [layer([3, 4]), layer([5])] },
    }, art)
    expect(roomBudget(docs, 'one', lookup)).toEqual({ tiles: 305, palettes: 7, tilesetTiles: 5, tilesetPalettes: 3, pictureTiles: 300, picturePalettes: 4 })
    expect(roomBudget(docs, 'two', lookup)).toMatchObject({ tiles: 5, palettes: 3 })
    expect(budgetProblems(docs, lookup)).toEqual([])
  })

  it('follows a room being painted: a stroke with new tiles counts at once', () => {
    const { docs, art: lookup } = project({ one: { layers: [layer([1])] } }, art)
    const painted = { ...docs, rooms: { one: { ...docs.rooms.one!, layers: [layer([1, 7, 8])] } } }
    expect(roomBudget(docs, 'one', lookup)?.tiles).toBe(1)
    expect(roomBudget(painted, 'one', lookup)?.tiles).toBe(3)
  })

  it('reports a room over 16 palettes or 1024 tiles on the room, in the build\'s words', () => {
    const { docs, art: lookup } = project({ big: { layers: [layer([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])], backgrounds: [sky('assets/a.png'), sky('assets/b.png')] } }, art)
    const budget = roomBudget(docs, 'big', lookup)!
    expect(budget).toMatchObject({ tiles: 1025, palettes: 16 })
    expect(budgetProblems(docs, lookup)).toEqual([
      {
        severity: 'error',
        file: 'studio/rooms/big.json',
        message: 'its backgrounds have 1000 distinct tiles and the rooms drawn with tileset "t" use 25, which is 1025; video memory holds 1024. Make the pictures smaller or more repetitive',
      },
    ])
    const more = project({ big: { layers: [layer([1])], backgrounds: [sky('assets/b.png'), sky('assets/c.png')] } }, { ...art, 'assets/c.png': { tiles: 10, palettes: 5 } })
    expect(budgetProblems(more.docs, more.art)).toEqual([
      {
        severity: 'error',
        file: 'studio/rooms/big.json',
        message: 'its backgrounds need 14 palettes and tileset "t" 3, which is 17; the GBA has 16 for backgrounds. Use fewer colour combinations in the pictures',
      },
    ])
  })

  it('reports a tileset or picture the build could not convert on the item that uses it', () => {
    const { docs, art: lookup } = project({ a: { layers: [layer([1])], backgrounds: [sky('assets/bad.png')] }, b: { layers: [layer([1])], backgrounds: [sky('assets/bad.png')] } }, {
      'assets/t.png': { error: 'tile 3 uses 16 colours; a GBA tile can use 15 plus transparency' },
      'assets/bad.png': { error: 'tile 16 needs a 17th palette; the tiles\' colours must fit 16 palettes of 15. Use fewer colour combinations across tiles' },
    })
    expect(budgetProblems(docs, lookup)).toEqual([
      { severity: 'error', file: 'studio/tilesets/t.json', message: 'assets/t.png: tile 3 uses 16 colours; a GBA tile can use 15 plus transparency' },
      { severity: 'error', file: 'studio/rooms/a.json', message: 'background assets/bad.png: tile 16 needs a 17th palette; the tiles\' colours must fit 16 palettes of 15. Use fewer colour combinations across tiles' },
    ])
  })

  it('reports a tileset of more than 1024 tiles', () => {
    const { docs, art: lookup } = project({}, { 'assets/t.png': { tiles: 1100, palettes: 2 } })
    expect(budgetProblems(docs, lookup)).toEqual([{ severity: 'error', file: 'studio/tilesets/t.json', message: 'assets/t.png has 1100 tiles; a GBA background can address 1024' }])
  })

  it('adds the budget problems to validation only when the pictures were read', () => {
    const { docs, art: lookup } = project({ big: { layers: [layer([1])], backgrounds: [sky('assets/b.png'), sky('assets/c.png')] } }, { ...art, 'assets/c.png': { tiles: 10, palettes: 5 } })
    const exists = () => true
    const without = validateProject(docs, exists)
    const withArt = validateProject(docs, exists, lookup)
    expect(withArt.length).toBe(without.length + 1)
    expect(withArt.at(-1)?.message).toMatch(/^its backgrounds need 14 palettes/)
  })
})

describe('readout colour', () => {
  it('is amber close to the limit and red over it', () => {
    expect(budgetState(921, 1024)).toBe('ok')
    expect(budgetState(922, 1024)).toBe('near')
    expect(budgetState(1024, 1024)).toBe('near')
    expect(budgetState(1025, 1024)).toBe('over')
    expect(budgetState(15, 16)).toBe('near')
    expect(budgetState(14, 16)).toBe('ok')
    expect(budgetState(17, 16)).toBe('over')
  })
})

describe('an image being painted', () => {
  const art = { 'tileset:assets/t.png': { tiles: 40, palettes: 3 }, 'background:assets/a.png': { tiles: 300, palettes: 4 } }
  /** An image of `tiles` tiles in a row, each with one colour of its own. */
  const painted = (tiles: number) => {
    const width = tiles * 8
    const data = new Uint8ClampedArray(width * 8 * 4)
    for (let i = 0; i < width * 8; i++) data.set([Math.floor((i % width) / 8) * 8, 0, 0, 255], i * 4)
    return { data, width, height: 8 }
  }

  it('counts its unsaved pixels as a background in the rooms that show it', () => {
    const { docs } = project({ one: { layers: [layer([1, 2])], backgrounds: [sky('assets/a.png')] }, two: { layers: [layer([1])] } }, {})
    const result = imageBudget(docs, art, 'assets/a.png', painted(5))!
    expect(result.as).toBe('background')
    expect(result.own).toEqual({ tiles: 5, palettes: 1 })
    // The saved picture had 300 tiles; the unsaved one has 5.
    expect(result.worst).toMatchObject({ id: 'one', budget: { tiles: 2 + 5, palettes: 3 + 1 } })
  })

  it('counts a tileset image against the fullest room drawn with it', () => {
    const { docs } = project({ one: { layers: [layer([1])] }, two: { layers: [layer([1])], backgrounds: [sky('assets/a.png')] } }, {})
    const result = imageBudget(docs, art, 'assets/t.png', painted(3))
    expect(result).toMatchObject({ as: 'tileset', own: { tiles: 3, palettes: 1 }, worst: { id: 'two', budget: { tiles: 1 + 300, palettes: 1 + 4 } } })
  })

  it('has no background budget for a sprite sheet', () => {
    const { docs } = project({}, {})
    const sprites = { s: Sprite.parse({ version: 1, name: 'S', image: 'assets/s.png', frame: { width: 16, height: 16 }, anchor: { x: 8, y: 16 } }) }
    expect(imageBudget({ ...docs, sprites }, art, 'assets/s.png', painted(2))).toBeNull()
  })

  it('shows an image no room uses as a tileset would count it', () => {
    const { docs } = project({}, {})
    expect(imageBudget(docs, art, 'assets/new.png', painted(2))).toEqual({ own: { tiles: 2, palettes: 1 }, as: 'tileset', worst: null })
  })
})
