// The generator tools: a tileset, a room on it and a converted picture, by tool calls only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Builder } from '../src/build.ts'
import { ProjectFolder } from '../src/project.ts'
import { TOOLS } from '../src/tools.ts'
import type { ToolContext } from '../src/tools.ts'

let folder: string
let project: ProjectFolder
let context: ToolContext

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-gen-'))
  project = new ProjectFolder(folder)
  await project.init('Test')
  context = { project, builder: new Builder(project, () => {}) }
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const call = (name: string, args: Record<string, unknown>) => {
  const tool = TOOLS.find((t) => t.name === name)!
  return tool.run(tool.input.parse(args) as never, context)
}
const json = (file: string) => JSON.parse(readFileSync(path.join(folder, file), 'utf8'))
const png = (file: string) => PNG.sync.read(readFileSync(path.join(folder, file)))

describe('tileset_generate', () => {
  it('writes the picture under generated/, saves a tileset with collision and slope classes, and shows it', async () => {
    const answer = await call('tileset_generate', { name: 'Ice Cave', preset: 'ice', block_size: 8 })
    expect(answer.images).toHaveLength(1)
    expect(answer.text).toContain('Made tileset "ice-cave"')
    expect(answer.text).toContain('No problems in studio/tilesets/ice-cave.json')
    const tileset = json('studio/tilesets/ice-cave.json')
    expect(tileset.image).toBe('generated/tilesets/ice-cave.png')
    expect(Object.keys(tileset.collision).length).toBeGreaterThan(0)
    const sheet = png(tileset.image)
    expect(sheet.width % 8).toBe(0)
    expect(sheet.height % 8).toBe(0)
    // Every class a tile names exists in the project, including the slopes it added.
    const ids = json('studio/project.json').collisionClasses.map((c: { id: string }) => c.id)
    for (const id of Object.values<string>(tileset.collision)) expect(ids).toContain(id)
    expect(ids.length).toBeGreaterThan(6)
  })

  it('applies colour overrides and never replaces a file', async () => {
    await call('tileset_generate', { name: 'Tiles', colours: { surface: '#ff0000' } })
    const again = await call('tileset_generate', { name: 'Tiles' })
    expect(again.text).toContain('generated/tilesets/tiles-2.png')
    expect(existsSync(path.join(folder, 'generated/tilesets/tiles.png'))).toBe(true)
    expect(json('studio/tilesets/tiles-2.json').image).toBe('generated/tilesets/tiles-2.png')
    expect(png('generated/tilesets/tiles.png').data.equals(png('generated/tilesets/tiles-2.png').data)).toBe(false)
  })
})

describe('room_generate', () => {
  it('goes from an empty project to a validated tileset and room by tool calls only', async () => {
    await call('tileset_generate', { name: 'Meadow' })
    const answer = await call('room_generate', { name: 'First room', tileset: 'meadow', style: 'halls', width: 2, height: 1, seed: 7 })
    expect(answer.images).toHaveLength(1)
    // The only thing left to do is to put it on the map, and the answer says so.
    expect(answer.text).not.toContain('error:')
    expect(answer.text).toContain('not placed in the world')
    await call('world_place', { room: 'first-room', x: 0, y: 0, start: true })
    const room = json('studio/rooms/first-room.json')
    expect(room.tileset).toBe('meadow')
    expect(room.width).toBe(2)
    expect((await call('validate', {})).text).not.toContain('error:')
    // Same seed, same room.
    await call('room_generate', { name: 'Twin', tileset: 'meadow', style: 'halls', width: 2, height: 1, seed: 7 })
    expect(json('studio/rooms/twin.json').layers).toEqual(room.layers)
  })

  it('says what to do when the tileset is not a generator sheet', async () => {
    const sheet = new PNG({ width: 16, height: 16 })
    mkdirSync(path.join(folder, 'assets'))
    writeFileSync(path.join(folder, 'assets/hand.png'), PNG.sync.write(sheet))
    await call('tileset_create', { name: 'Hand', image: 'assets/hand.png' })
    await expect(call('room_generate', { name: 'x', tileset: 'hand' })).rejects.toThrow(/not laid out like a generated sheet.*tileset_generate/)
    await expect(call('room_generate', { name: 'x', tileset: 'nope' })).rejects.toThrow(/no tileset "nope".*tileset_generate/)
  })
})

describe('pixel_art_convert', () => {
  it('converts a picture to a small palette picture under generated/pixelart/, leaving the source alone', async () => {
    const source = new PNG({ width: 64, height: 48 })
    for (let i = 0; i < 64 * 48; i++) source.data.set([(i * 7) % 256, (i * 3) % 256, (i * 11) % 256, 255], i * 4)
    mkdirSync(path.join(folder, 'assets'))
    const bytes = PNG.sync.write(source)
    writeFileSync(path.join(folder, 'assets/photo.png'), bytes)
    const answer = await call('pixel_art_convert', { source: 'assets/photo.png', name: 'Hero', size: 16, canvas: 'tiles', colours: 8 })
    expect(answer.text).toContain('generated/pixelart/hero.png')
    const out = png('generated/pixelart/hero.png')
    expect(out.width % 8).toBe(0)
    expect(out.width).toBeLessThanOrEqual(16)
    const colours = new Set<number>()
    for (let i = 0; i < out.width * out.height; i++) if (out.data[i * 4 + 3]! > 0) colours.add(out.data.readUInt32LE(i * 4))
    expect(colours.size).toBeLessThanOrEqual(8)
    expect(readFileSync(path.join(folder, 'assets/photo.png')).equals(bytes)).toBe(true)
    await call('pixel_art_convert', { source: 'assets/photo.png', name: 'Hero', size: 16 })
    expect(existsSync(path.join(folder, 'generated/pixelart/hero-2.png'))).toBe(true)
    await expect(call('pixel_art_convert', { source: 'assets/photo.png', name: 'Big', colours: 40 })).rejects.toThrow(/at most 15 colours/)
  })
})

describe('where generated files go', () => {
  it('writes only under generated/, and only PNGs', async () => {
    const data = Buffer.from('x')
    await expect(project.writeGenerated('assets/x.png', data)).rejects.toThrow(/generated\//)
    await expect(project.writeGenerated('generated/../assets/x.png', data)).rejects.toThrow(/generated\//)
    await expect(project.writeGenerated('generated/x.txt', data)).rejects.toThrow(/generated\//)
    await expect(project.writeGenerated('generated/.hidden/x.png', data)).rejects.toThrow(/generated\//)
    expect(await project.writeGenerated('generated/x.png', data)).toBe('generated/x.png')
    expect(await project.writeGenerated('generated/x.png', data)).toBe('generated/x-2.png')
  })

  it('leaves the author\'s assets folder as it was', async () => {
    mkdirSync(path.join(folder, 'assets'))
    writeFileSync(path.join(folder, 'assets/mine.png'), 'mine')
    await call('tileset_generate', { name: 'T' })
    await call('room_generate', { name: 'R', tileset: 't' })
    expect(readdirSync(path.join(folder, 'assets'))).toEqual(['mine.png'])
  })
})
