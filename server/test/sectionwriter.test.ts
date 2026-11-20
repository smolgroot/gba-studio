import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Audio, Project, Room, Sprite, Tileset, World, needsBuild, readSection, writeSection } from '@pecten-studio/core'
import type { Documents } from '@pecten-studio/core'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURE = path.join(REPO, 'codegen/fixture')
/** Written by codegen's tests from the same project: the bytes a build puts in the ROM. */
const EXPECTED = path.join(FIXTURE, 'expected/studio_data.bin')

function load(folder: string): Documents {
  const json = (file: string) => JSON.parse(readFileSync(path.join(folder, 'studio', file), 'utf8')) as unknown
  const all = <T>(dir: string, parse: (value: unknown) => T) =>
    Object.fromEntries(
      readdirSync(path.join(folder, 'studio', dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => [f.slice(0, -5), parse(json(`${dir}/${f}`))]),
    )
  return {
    project: Project.parse(json('project.json')),
    world: World.parse(json('world.json')),
    audio: Audio.parse(json('audio.json')),
    tilesets: all('tilesets', (v) => Tileset.parse(v)),
    sprites: all('sprites', (v) => Sprite.parse(v)),
    rooms: all('rooms', (v) => Room.parse(v)),
  }
}

const expected = new Uint8Array(readFileSync(EXPECTED))
const section = readSection(expected)!

describe('the data section', () => {
  it('is found and read back from what codegen wrote', () => {
    expect(section.start).toBe(0)
    expect(section.version).toBe(1)
    expect(section.capacity).toBe(expected.length)
    expect(section.rooms).toEqual(['entry', 'shaft'])
    expect(section.classes[1]).toBe('solid')
    expect(section.manifest.tilesets).toEqual([{ id: 'tiles', tiles: 16, palettes: expect.any(Number) as number }])
    expect(section.manifest.pictures.map((p) => p.id)).toEqual(['assets/sky.png'])
    expect(section.manifest.entityTypes.find((t) => t.id === 'player-start')?.sprite).toBe('hero')
  })

  it('is written byte for byte as codegen writes it', () => {
    const written = writeSection(load(FIXTURE), section.manifest, section.capacity)
    if ('problems' in written) throw new Error(written.problems.join('\n'))
    expect(written.used).toBe(section.used)
    const firstDifference = written.bytes.findIndex((byte, i) => byte !== expected[i])
    expect(firstDifference, `first different byte at ${firstDifference}`).toBe(-1)
  })

  it('writes edits to data, and refuses data past the capacity', () => {
    const docs = load(FIXTURE)
    docs.project!.physics.platformer.jumpSpeed = 1500
    const room = Object.values(docs.rooms)[0]!
    room.entities.push({ type: room.entities[0]!.type, x: 40, y: 40, props: {} })
    const written = writeSection(docs, section.manifest, section.capacity)
    if ('problems' in written) throw new Error(written.problems.join('\n'))
    expect(written.used).toBeGreaterThan(section.used)
    expect(written.bytes.length).toBe(section.capacity)
    const tight = writeSection(docs, section.manifest, written.used - 4)
    expect('problems' in tight && tight.problems[0]).toMatch(/level data is now \d+ bytes and this build of the game has room for \d+; build the game/)
  })

  it('reports what codegen would refuse', () => {
    const docs = load(FIXTURE)
    const room = docs.rooms.entry!
    room.layers[0]!.data = [room.width * 30 * room.height * 20, 99]
    const written = writeSection(docs, section.manifest, section.capacity)
    expect('problems' in written && written.problems).toEqual([`studio/rooms/entry.json: layer "${room.layers[0]!.name}" uses tile 98, which tileset "tiles" does not have`])
  })
})

describe('what needs a build rather than a patch', () => {
  const counts = { tiles: 16 }
  it('nothing, for the project the ROM was built from', () => {
    expect(needsBuild(load(FIXTURE), section, counts)).toEqual([])
  })

  it('names what changed on the compiled side', () => {
    const docs = load(FIXTURE)
    docs.project!.entityTypes.push({ id: 'bat', name: 'Bat', colour: '#000000', props: [] })
    docs.project!.entityTypes[0]!.sprite = undefined
    docs.rooms.cave = docs.rooms.entry!
    docs.audio!.tracks.push({ id: 'boss', name: 'Boss', file: 'assets/boss.xm', format: 'xm' })
    docs.rooms.shaft!.backgrounds = [{ image: 'assets/stars.png', parallax: { x: 0, y: 0 } }]
    const reasons = needsBuild(docs, section, { tiles: 32 })
    expect(reasons).toContain('entity type "bat" is new')
    expect(reasons.some((r) => /entity type ".*" has another sprite/.test(r))).toBe(true)
    expect(reasons).toContain('room "cave" is new')
    expect(reasons).toContain('music track "boss" is new')
    expect(reasons).toContain('background picture "assets/stars.png" is new')
    expect(reasons).toContain('tileset "tiles" now has 32 tiles, the game has 16')
  })
})
