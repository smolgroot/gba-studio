import { describe, expect, it } from 'vitest'
import {
  Project, Room, SCREEN, Sprite, Track, countColours, docPath, fromBgr555, newProject, rleDecode, rleEncode, rleLength,
  toBgr555, validateProject,
} from '../src/index.ts'
import type { Documents } from '../src/index.ts'

const CELLS = SCREEN.cols * SCREEN.rows

function docs(): Documents {
  const { project, world, audio } = newProject('Test')
  return {
    project,
    world: { ...world, rooms: [{ room: 'cave', x: 0, y: 0 }], start: 'cave' },
    audio,
    tilesets: { rock: { version: 1, name: 'Rock', image: 'assets/rock.png', collision: { '1': 'solid' } } },
    sprites: {},
    rooms: {
      cave: { version: 1, name: 'Cave', width: 1, height: 1, tileset: 'rock', layers: [{ name: 'Ground', data: [CELLS, 0] }], entities: [] },
    },
  }
}
const messages = (d: Documents, exists = () => true) => validateProject(d, exists).map((p) => p.message)

describe('rle', () => {
  it('round-trips', () => {
    const cells = [0, 0, 0, 5, 5, 1, 0, 0]
    expect(rleEncode(cells)).toEqual([3, 0, 2, 5, 1, 1, 2, 0])
    expect([...rleDecode(rleEncode(cells))]).toEqual(cells)
    expect(rleEncode([])).toEqual([])
  })
  it('rejects malformed data', () => {
    expect(rleLength([3, 0, 2])).toBeNull()
    expect(rleLength([0, 4])).toBeNull()
    expect(() => rleDecode([1])).toThrow()
  })
})

describe('colours', () => {
  it('converts to BGR555 and back', () => {
    expect(toBgr555(255, 0, 0)).toBe(31)
    expect(toBgr555(0, 0, 255)).toBe(31 << 10)
    expect(fromBgr555(toBgr555(255, 255, 255))).toEqual([255, 255, 255])
  })
  it('counts colours as the GBA sees them, without transparent pixels', () => {
    // 255 and 250 red share their top five bits; the third pixel is transparent.
    const rgba = new Uint8Array([255, 0, 0, 255, 250, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255])
    expect(countColours(rgba)).toBe(2)
  })
})

describe('schemas', () => {
  it('accepts the new-project template', () => {
    expect(Project.safeParse(newProject('X').project).success).toBe(true)
  })
  it('ties slope heights to slope classes', () => {
    const { project } = newProject('X')
    project.collisionClasses[1]!.slope = { left: 0, right: 8 }
    expect(Project.safeParse(project).success).toBe(false)
  })
  it('wants a soundfont for MIDI only', () => {
    expect(Track.safeParse({ id: 'a', name: 'A', file: 'a.mid', format: 'midi' }).success).toBe(false)
    expect(Track.safeParse({ id: 'a', name: 'A', file: 'a.mid', format: 'midi', soundfont: 'a.sf2' }).success).toBe(true)
    expect(Track.safeParse({ id: 'a', name: 'A', file: 'a.xm', format: 'xm', soundfont: 'a.sf2' }).success).toBe(false)
  })
  it('keeps asset paths inside the game folder', () => {
    const sprite = { version: 1, name: 'S', frame: { width: 16, height: 16 }, anchor: { x: 0, y: 0 } }
    expect(Sprite.safeParse({ ...sprite, image: 'assets/s.png' }).success).toBe(true)
    expect(Sprite.safeParse({ ...sprite, image: '../s.png' }).success).toBe(false)
    expect(Sprite.safeParse({ ...sprite, image: '/etc/passwd' }).success).toBe(false)
  })
  it('limits a room to three layers', () => {
    const layer = { name: 'L', data: [CELLS, 0] }
    const room = { version: 1, name: 'R', width: 1, height: 1, tileset: 't' }
    expect(Room.safeParse({ ...room, layers: [layer, layer, layer] }).success).toBe(true)
    expect(Room.safeParse({ ...room, layers: [layer, layer, layer, layer] }).success).toBe(false)
  })
  it('builds document paths and refuses bad ids', () => {
    expect(docPath('project')).toBe('studio/project.json')
    expect(docPath('room', 'cave-1')).toBe('studio/rooms/cave-1.json')
    expect(() => docPath('room', '../x')).toThrow()
    expect(() => docPath('room')).toThrow()
  })
})

describe('validateProject', () => {
  it('passes a consistent project', () => {
    expect(validateProject(docs(), () => true)).toEqual([])
  })
  it('reports missing asset files', () => {
    expect(messages(docs(), () => false)).toContain('file not found: assets/rock.png')
  })
  it('checks layer size against the room', () => {
    const d = docs()
    d.rooms.cave!.width = 2
    expect(messages(d)).toContain(`layer "Ground" holds ${CELLS} cells, the room has ${CELLS * 2}`)
  })
  it('checks references', () => {
    const d = docs()
    d.rooms.cave!.tileset = 'nope'
    d.rooms.cave!.entities = [{ type: 'ghost', x: 0, y: 0, props: {} }, { type: 'player-start', x: 240, y: 0, props: {} }]
    d.tilesets.rock!.collision['2'] = 'lava'
    d.world!.start = 'gone'
    const found = messages(d)
    expect(found).toContain('unknown tileset "nope"')
    expect(found).toContain('entity 0 has unknown type "ghost"')
    expect(found).toContain('entity 1 (player-start) is outside the room')
    expect(found).toContain('tile 2 uses unknown collision class "lava"')
    expect(found).toContain('start room "gone" does not exist')
  })
  it('finds overlapping rooms on the world grid', () => {
    const d = docs()
    d.rooms.hall = { ...d.rooms.cave!, name: 'Hall', width: 2, layers: [{ name: 'Ground', data: [CELLS * 2, 0] }] }
    d.world!.rooms.push({ room: 'hall', x: -1, y: 0 })
    expect(messages(d)).toContain('rooms "cave" and "hall" overlap')
    d.world!.rooms[1]!.x = 1
    expect(validateProject(d, () => true)).toEqual([])
  })
  it('rejects sprite frames the hardware has no size for', () => {
    const d = docs()
    d.sprites.hero = { version: 1, name: 'Hero', image: 'assets/hero.png', frame: { width: 24, height: 24 }, anchor: { x: 0, y: 0 }, animations: [] }
    expect(messages(d).some((m) => m.startsWith('frame 24x24 is not a GBA sprite size'))).toBe(true)
  })
})
