import { describe, expect, it } from 'vitest'
import { activeRooms, pickAt, rowKey } from '../src/inspect.ts'
import type { LiveEntityRow, LiveView, RoomPlace } from '../src/inspect.ts'

const entity = (index: number, x: number, y: number, hitbox = { x: -8, y: -16, w: 16, h: 16 }): LiveEntityRow => ({
  kind: 'entity',
  index,
  type: 'sign',
  room: 'entry',
  x,
  y,
  vx: 0,
  vy: 0,
  facesLeft: false,
  hitbox,
  properties: [],
})

/** The camera at (100, 50): a screen pixel (sx, sy) is the world pixel (100 + sx, 50 + sy). */
const view: LiveView = {
  state: 'running',
  frame: 10,
  room: 'entry',
  camera: { x: 100, y: 50 },
  note: null,
  rows: [
    { kind: 'player', x: 120, y: 60, w: 10, h: 14, vx: 0, vy: 0, onGround: true, hitWall: false, hitCeiling: false },
    entity(1, 200, 100),
    // A coin in front of a big door: both hold (196, 90).
    entity(2, 200, 100, { x: -24, y: -48, w: 48, h: 48 }),
    // No sprite, so no hitbox: picked by a small box on its feet.
    entity(3, 300, 140, { x: 0, y: 0, w: 0, h: 0 }),
  ],
}

describe('picking on the game screen', () => {
  it('adds the camera to a screen point and finds the entity under it', () => {
    expect(pickAt(view, 96, 40)).toMatchObject({ kind: 'entity', index: 1 })
  })

  it('takes the smallest of two overlapping boxes', () => {
    // (196, 90) is in both; entity 1 is 16x16, entity 2 is 48x48.
    expect(rowKey(pickAt(view, 96, 40)!)).toBe(1)
    // (180, 60) is only in the door.
    expect(rowKey(pickAt(view, 80, 10)!)).toBe(2)
  })

  it('finds the player by its body', () => {
    expect(pickAt(view, 25, 15)).toMatchObject({ kind: 'player' })
    expect(rowKey(pickAt(view, 25, 15)!)).toBe('player')
  })

  it('finds an entity with no hitbox by a small box standing on its feet', () => {
    expect(rowKey(pickAt(view, 200, 85)!)).toBe(3)
    expect(pickAt(view, 200, 95)).toBeNull()
  })

  it('finds nothing on an empty spot, or before the game runs', () => {
    expect(pickAt(view, 5, 150)).toBeNull()
    expect(pickAt({ state: 'waiting', message: 'not yet' }, 96, 40)).toBeNull()
  })
})

describe('active rooms', () => {
  const screen = (id: string, left: number | null, top = 0): RoomPlace => ({ id, onMap: left !== null, left: (left ?? 0) * 240, top: top * 160, width: 240, height: 160 })

  it('lists the room first, then those touching it by number', () => {
    const rooms = [screen('a', 0), screen('b', 1), screen('c', 3)]
    expect(activeRooms(rooms, 1)).toEqual([1, 0])
    expect(activeRooms(rooms, 2)).toEqual([2])
  })

  it('makes only the room active when it is off the map, or nothing for a room that is not there', () => {
    expect(activeRooms([screen('a', 0), screen('b', null)], 1)).toEqual([1])
    expect(activeRooms([screen('a', 0)], 4)).toEqual([])
  })

  it('stops at 16 rooms, as the runtime does', () => {
    // A room of 17 screens across, with 17 one-screen rooms along its top and bottom.
    const rooms = [{ ...screen('wide', 0, 1), width: 240 * 17 }, ...Array.from({ length: 17 }, (_, i) => screen(`top${i}`, i, 0)), ...Array.from({ length: 17 }, (_, i) => screen(`bottom${i}`, i, 2))]
    expect(activeRooms(rooms, 0)).toHaveLength(16)
  })
})
