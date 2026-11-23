// Tile and palette budgets from the PNGs on disk: the same numbers as the build helper,
// and a problem on the room that goes over.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artLookup, backgroundCost, roomBudget, tilesetCost } from '@pecten-studio/core'
import type { ArtResult } from '@pecten-studio/core'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectFolder } from '../src/project.ts'

const codegenFixture = fileURLToPath(new URL('../../codegen/fixture', import.meta.url))

interface FixtureImage {
  name: string
  colours: string[]
  rows: string[]
  tileset: { tiles: number; palettes: number } | { error: string }
  background: { tiles: number; palettes: number } | { error: string }
}
const fixture = JSON.parse(readFileSync(path.join(codegenFixture, 'budget.json'), 'utf8')) as { images: FixtureImage[] }

/** RGBA pixels of a fixture image: `#rrggbb` or `#rrggbbaa` colours, `.` transparent. */
function pixels(image: FixtureImage): { rgba: Uint8ClampedArray; width: number; height: number } {
  const colours = image.colours.map((hex) => {
    const byte = (n: number) => (hex.length > 1 + n * 2 ? parseInt(hex.slice(1 + n * 2, 3 + n * 2), 16) : 255)
    return [byte(0), byte(1), byte(2), byte(3)]
  })
  const rows = image.rows.map((row) => row.split(' '))
  const width = rows[0]!.length
  const rgba = new Uint8ClampedArray(width * rows.length * 4)
  rows.forEach((row, y) => row.forEach((p, x) => {
    if (p !== '.') rgba.set(colours[Number(p)]!, (y * width + x) * 4)
  }))
  return { rgba, width, height: rows.length }
}

function expectResult(got: ArtResult, expected: FixtureImage['tileset'], what: string) {
  if ('error' in expected) {
    expect('error' in got ? got.error : got, what).toMatch(new RegExp(`^${expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  } else expect(got, what).toEqual(expected)
}

describe('tile and palette counts match the build helper (codegen/fixture/budget.json)', () => {
  for (const image of fixture.images) {
    it(image.name, () => {
      const { rgba, width, height } = pixels(image)
      expectResult(tilesetCost(rgba, width, height), image.tileset, `${image.name} as a tileset`)
      expectResult(backgroundCost(rgba, width, height), image.background, `${image.name} as a background`)
    })
  }

  it('counts a full 1024-tile image fast enough to follow painting', () => {
    // 256x256 pixels, 1024 tiles, each with all 15 colours of one of 16 groups: 16 full palettes.
    const rgba = new Uint8ClampedArray(256 * 256 * 4)
    for (let i = 0; i < 256 * 256; i++) {
      const tile = Math.floor(i / 256 / 8) * 32 + Math.floor((i % 256) / 8)
      const colour = (tile % 16) * 15 + (i % 15)
      rgba.set([(colour % 16) * 16, Math.floor(colour / 16) * 16, 128, 255], i * 4)
    }
    const start = performance.now()
    const cost = tilesetCost(rgba, 256, 256)
    expect(performance.now() - start).toBeLessThan(100)
    expect(cost).toEqual({ tiles: 1024, palettes: 16 })
  })
})

describe('budgets of the build helper\'s fixture project', () => {
  it('match codegen/fixture/budget.json, which the build helper is checked against', async () => {
    const expected = JSON.parse(readFileSync(path.join(codegenFixture, 'budget.json'), 'utf8')).project
    const project = new ProjectFolder(codegenFixture)
    const { docs } = await project.load()
    const art = artLookup(await project.artCosts(docs))
    for (const [id, tileset] of Object.entries(docs.tilesets)) expect(art(tileset.image, 'tileset'), id).toEqual(expected.tilesets[id])
    for (const [file, cost] of Object.entries(expected.pictures)) expect(art(file, 'background'), file).toEqual(cost)
    for (const [id, budget] of Object.entries(expected.rooms)) expect(roomBudget(docs, id, art), id).toMatchObject(budget as object)
  })
})

describe('budget problems', () => {
  let folder: string | undefined
  afterEach(() => folder && rmSync(folder, { recursive: true, force: true }))

  /** A picture of 16 tiles, each with 15 colours of its own: 16 palettes. */
  function busyPicture(): Buffer {
    const png = new PNG({ width: 128, height: 8 })
    for (let x = 0; x < 128; x++) {
      for (let y = 0; y < 8; y++) {
        const colour = Math.floor(x / 8) * 15 + ((x + y) % 15)
        png.data.set([(colour % 16) * 16, Math.floor(colour / 16) * 16, 64, 255], (y * 128 + x) * 4)
      }
    }
    return PNG.sync.write(png)
  }

  it('puts a room over 16 palettes in Problems, and takes it out when the picture is fixed', async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'pecten-budget-'))
    const project = new ProjectFolder(folder)
    await project.init('Test')
    mkdirSync(path.join(folder, 'assets'), { recursive: true })
    mkdirSync(path.join(folder, 'studio/tilesets'), { recursive: true })
    mkdirSync(path.join(folder, 'studio/rooms'), { recursive: true })
    writeFileSync(path.join(folder, 'assets/tiles.png'), PNG.sync.write(new PNG({ width: 8, height: 8 })))
    writeFileSync(path.join(folder, 'assets/busy.png'), busyPicture())
    writeFileSync(path.join(folder, 'studio/tilesets/t.json'), JSON.stringify({ version: 1, name: 'T', image: 'assets/tiles.png', collision: {} }))
    writeFileSync(
      path.join(folder, 'studio/rooms/r.json'),
      JSON.stringify({ version: 1, name: 'R', width: 1, height: 1, tileset: 't', layers: [{ name: 'L', data: [600, 0] }], backgrounds: [{ image: 'assets/busy.png', parallax: { x: 0, y: 0 } }], entities: [] }),
    )
    const over = (await project.load()).problems.filter((p) => p.file === 'studio/rooms/r.json' && p.message.startsWith('its backgrounds'))
    expect(over).toEqual([
      {
        severity: 'error',
        file: 'studio/rooms/r.json',
        message: 'its backgrounds need 16 palettes and tileset "t" 1, which is 17; the GBA has 16 for backgrounds. Use fewer colour combinations in the pictures',
      },
    ])

    // A plainer picture of the same name: the old count must not be kept.
    const plain = new PNG({ width: 16, height: 8 })
    plain.data.fill(255)
    writeFileSync(path.join(folder, 'assets/busy.png'), PNG.sync.write(plain))
    const after = (await project.load()).problems.filter((p) => p.message.startsWith('its backgrounds'))
    expect(after).toEqual([])
  })
})
