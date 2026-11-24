import { describe, expect, it } from 'vitest'
import { OVERLAYS, drawShapes, floorHeight, overlayShapes } from '../src/overlays.ts'
import type { Overlay, Shape } from '../src/overlays.ts'
import type { LiveEntityRow, LiveView, SectionIndex } from '../src/inspect.ts'

const W = 240
const H = 160

const entity = (index: number, x: number, y: number, hitbox = { x: -8, y: -16, w: 16, h: 16 }): LiveEntityRow => ({
  kind: 'entity',
  index,
  type: 'sign',
  room: 'entry',
  x,
  y,
  vx: 0,
  vy: 0,
  home: { x, y },
  facesLeft: false,
  hitbox,
  properties: [],
})

/** Two screens side by side, "entry" on the left. Collision: solid floor on the bottom row, a one-way ledge, a slope, a hazard and a custom cell. */
const entryCells = new Uint8Array(30 * 20)
const set = (col: number, row: number, cls: number) => (entryCells[row * 30 + col] = cls)
for (let col = 0; col < 30; col++) set(col, 19, 1)
set(4, 15, 2)
set(10, 18, 3)
set(12, 18, 4)
set(14, 18, 5)
const section: SectionIndex = {
  rooms: [
    { id: 'entry', onMap: true, left: 0, top: 0, width: 240, height: 160 },
    { id: 'hall', onMap: true, left: 240, top: 0, width: 480, height: 160 },
    { id: 'attic', onMap: false, left: 0, top: 0, width: 240, height: 160 },
  ],
  types: ['sign'],
  entities: [],
  classes: [
    { id: 'empty', kind: 'empty', slope: null },
    { id: 'solid', kind: 'solid', slope: null },
    { id: 'ledge', kind: 'oneway', slope: null },
    { id: 'ramp', kind: 'slope', slope: { left: 0, right: 8 } },
    { id: 'spikes', kind: 'hazard', slope: null },
    { id: 'door', kind: 'custom', slope: null },
  ],
  cells: [
    { cols: 30, rows: 20, cells: entryCells },
    { cols: 60, rows: 20, cells: new Uint8Array(60 * 20) },
    { cols: 30, rows: 20, cells: new Uint8Array(30 * 20).fill(1) },
  ],
}

const running = (camera: { x: number; y: number }, room = 'entry'): LiveView => ({
  state: 'running',
  frame: 1,
  room,
  camera,
  note: null,
  playerEditWaiting: false,
  rows: [
    { kind: 'player', x: 100, y: 120, w: 10, h: 14, vx: 0, vy: 0, onGround: true, hitWall: false, hitCeiling: false },
    entity(1, 200, 100),
    // No sprite, so no hitbox: shown by a cross on its feet.
    entity(2, 60, 80, { x: 0, y: 0, w: 0, h: 0 }),
  ],
})

const only = (...names: Overlay[]) => new Set<Overlay>(names)
const frame = () => new Uint8Array(W * H * 4)
const pixel = (pixels: Uint8Array, x: number, y: number) => Array.from(pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))

describe('which overlays draw', () => {
  const view = running({ x: 0, y: 0 })

  it('draws nothing with every overlay off', () => {
    expect(overlayShapes(view, section, only())).toEqual([])
  })

  it.each(OVERLAYS)('draws only its own shapes with %s on', (overlay) => {
    const shapes = overlayShapes(view, section, only(overlay))
    expect(shapes.length).toBeGreaterThan(0)
    expect(new Set(shapes.map((s) => s.overlay))).toEqual(new Set([overlay]))
  })

  it('draws the four sets together with all on', () => {
    const all = overlayShapes(view, section, new Set(OVERLAYS))
    const parts = OVERLAYS.flatMap((o) => overlayShapes(view, section, only(o)))
    expect(all).toHaveLength(parts.length)
    expect(new Set(all.map((s) => s.overlay))).toEqual(new Set(OVERLAYS))
  })

  it('draws nothing before the game runs', () => {
    expect(overlayShapes({ state: 'waiting', message: 'not yet' }, section, new Set(OVERLAYS))).toEqual([])
    expect(overlayShapes({ state: 'problem', message: 'no' }, section, new Set(OVERLAYS))).toEqual([])
  })

  it('still draws what needs no level data without it', () => {
    const shapes = overlayShapes(view, null, new Set(OVERLAYS))
    expect(new Set(shapes.map((s) => s.overlay))).toEqual(new Set<Overlay>(['hitboxes', 'camera']))
  })
})

describe('where overlays land, in game pixels', () => {
  const find = (shapes: Shape[], type: Shape['type'], x: number, y: number) => shapes.find((s) => s.type === type && s.x === x && s.y === y)

  it('puts a hitbox at its world pixel minus the camera, at whole screens and between them', () => {
    for (const camera of [{ x: 0, y: 0 }, { x: -20, y: -30 }, { x: 37, y: 11 }]) {
      const view = running(camera)
      // The player's body is (100, 120) 10x14; the sign's box is from (192, 84) 16x16.
      const shapes = overlayShapes(view, section, only('hitboxes'))
      expect(find(shapes, 'box', 100 - camera.x, 120 - camera.y)).toMatchObject({ w: 10, h: 14 })
      expect(find(shapes, 'box', 192 - camera.x, 84 - camera.y)).toMatchObject({ w: 16, h: 16 })
    }
  })

  it('puts a cross on the feet of an entity with no hitbox', () => {
    expect(find(overlayShapes(running({ x: 10, y: 5 }), section, only('hitboxes')), 'cross', 50, 75)).toBeDefined()
  })

  it('leaves out what is wholly off the screen', () => {
    // The camera is far from every box.
    expect(overlayShapes(running({ x: 1000, y: 1000 }), section, only('hitboxes'))).toEqual([])
  })

  it('puts each cell kind at its tile, and a room border at its corner', () => {
    const camera = { x: 16, y: 8 }
    const shapes = overlayShapes(running(camera), section, only('collision', 'rooms'))
    const at = (col: number, row: number) => [col * 8 - camera.x, row * 8 - camera.y] as const
    // A solid floor cell, a one-way line along the top of its cell, a hazard and a custom cell.
    expect(find(shapes, 'fill', ...at(8, 19))).toMatchObject({ overlay: 'collision', w: 8, h: 8 })
    expect(find(shapes, 'fill', ...at(4, 15))).toMatchObject({ overlay: 'collision', w: 8, h: 2 })
    expect(find(shapes, 'box', ...at(12, 18))).toMatchObject({ overlay: 'collision', w: 8, h: 8 })
    expect(find(shapes, 'box', ...at(14, 18))).toMatchObject({ overlay: 'collision', w: 8, h: 8 })
    expect(find(shapes, 'box', -camera.x, -camera.y)).toMatchObject({ overlay: 'rooms', w: 240, h: 160 })
    // The next room's border begins where "entry" ends.
    expect(find(shapes, 'box', 240 - camera.x, -camera.y)).toMatchObject({ overlay: 'rooms', w: 480, h: 160 })
  })

  it('draws a slope as the floor the physics gives each pixel column', () => {
    const shapes = overlayShapes(running({ x: 0, y: 0 }), section, only('collision'))
    // The ramp is cell (10, 18): pixels x 80 to 87, y 144 to 151, rising from 0 to 8.
    const columns = shapes.filter((s): s is Extract<Shape, { type: 'fill' }> => s.type === 'fill' && s.w === 1 && s.x >= 80 && s.x < 88)
    expect(columns.map((s) => s.h)).toEqual(Array.from({ length: 8 }, (_, x) => floorHeight(0, 8, x)).filter((h) => h > 0))
    for (const s of columns) expect(s.y + s.h).toBe(152)
  })

  it('follows the physics\' floor height: 1 to 8 on a 45 degree rise', () => {
    expect(Array.from({ length: 8 }, (_, x) => floorHeight(0, 8, x))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(Array.from({ length: 8 }, (_, x) => floorHeight(8, 0, x))).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
    expect(Array.from({ length: 8 }, (_, x) => floorHeight(4, 4, x))).toEqual([4, 4, 4, 4, 4, 4, 4, 4])
  })

  it('draws only the cells in view', () => {
    // Camera on the second screen of the world: only the bottom row of "hall" is in view and it is empty there.
    const shapes = overlayShapes(running({ x: 300, y: 0 }, 'hall'), section, only('collision'))
    expect(shapes).toEqual([])
  })

  it('puts the camera cross at the middle of the view, whatever the camera', () => {
    for (const camera of [{ x: 0, y: 0 }, { x: -50, y: 700 }]) {
      expect(overlayShapes(running(camera), section, only('camera'))).toEqual([expect.objectContaining({ type: 'cross', x: 120, y: 80 })])
    }
  })

  it('draws a room that is off the map only while the player is in it, at the origin', () => {
    // "entry" and "hall" are both in view from here.
    const camera = { x: 100, y: 0 }
    expect(overlayShapes(running(camera), section, only('rooms')).filter((s) => s.type === 'box')).toHaveLength(2)
    const inAttic = overlayShapes(running(camera, 'attic'), section, only('rooms')).filter((s) => s.type === 'box')
    expect(inAttic).toHaveLength(3)
    expect(inAttic.find((s) => s.x === -camera.x && s.w === 240 && s.colour[3] === 0.8)).toBeDefined()
  })

  it('marks the room the player is in more strongly than the others', () => {
    const boxes = overlayShapes(running({ x: 100, y: 0 }), section, only('rooms')).filter((s) => s.type === 'box')
    expect(boxes[0]!.colour[3]).toBeGreaterThan(boxes[1]!.colour[3])
  })

  it('draws the screens of a room bigger than one as faint lines', () => {
    const camera = { x: 100, y: 0 }
    const lines = overlayShapes(running(camera), section, only('rooms')).filter((s) => s.type === 'fill')
    // "hall" is two screens wide: one line down the middle, at world x 480.
    expect(lines).toEqual([expect.objectContaining({ x: 480 - camera.x, y: 0, w: 1, h: 160 })])
  })
})

describe('painting into the frame', () => {
  const colour = [255, 0, 0, 1] as const

  it('draws a box one game pixel wide, inside its rectangle', () => {
    const pixels = frame()
    drawShapes(pixels, [{ overlay: 'hitboxes', type: 'box', x: 10, y: 20, w: 5, h: 4, colour }])
    let painted = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pixel(pixels, x, y)[0] === 255) painted++
    // The outline of a 5x4 box: 2 * 5 + 2 * (4 - 2) pixels.
    expect(painted).toBe(14)
    expect(pixel(pixels, 10, 20)).toEqual([255, 0, 0, 0])
    expect(pixel(pixels, 14, 23)[0]).toBe(255)
    expect(pixel(pixels, 15, 20)[0]).toBe(0)
    expect(pixel(pixels, 11, 21)[0]).toBe(0)
  })

  it('blends a translucent shape over the picture, once at the corners of a box', () => {
    const pixels = frame().fill(100)
    drawShapes(pixels, [{ overlay: 'collision', type: 'box', x: 0, y: 0, w: 4, h: 4, colour: [200, 100, 100, 0.5] }])
    expect(pixel(pixels, 0, 0).slice(0, 3)).toEqual([150, 100, 100])
    expect(pixel(pixels, 3, 3).slice(0, 3)).toEqual([150, 100, 100])
  })

  it('clips at the edges of the screen and does not wrap', () => {
    const pixels = frame()
    drawShapes(pixels, [
      { overlay: 'rooms', type: 'box', x: -3, y: -3, w: 10, h: 10, colour },
      { overlay: 'rooms', type: 'box', x: W - 5, y: H - 5, w: 20, h: 20, colour },
      { overlay: 'hitboxes', type: 'cross', x: 0, y: H - 1, arm: 6, colour },
    ])
    // The left and top sides of the first box are out of view; its right and bottom sides are in.
    expect(pixel(pixels, 6, 0)[0]).toBe(255)
    expect(pixel(pixels, 0, 6)[0]).toBe(255)
    expect(pixel(pixels, 0, 0)[0]).toBe(0)
    // Nothing came round to the far side: the second box's right side is out of view, its left side in view.
    expect(pixel(pixels, W - 1, 0)[0]).toBe(0)
    expect(pixel(pixels, W - 5, H - 1)[0]).toBe(255)
    expect(pixel(pixels, 5, 3)[0]).toBe(0)
    expect(pixels.length).toBe(W * H * 4)
  })

  it('changes nothing when every shape is out of view or there are none', () => {
    const pixels = frame().fill(7)
    drawShapes(pixels, [])
    drawShapes(pixels, [{ overlay: 'rooms', type: 'fill', x: W, y: 0, w: 5, h: 5, colour }, { overlay: 'rooms', type: 'fill', x: -9, y: -9, w: 9, h: 9, colour }])
    expect(pixels.every((b) => b === 7)).toBe(true)
  })

  it('draws a cross of two arms through a pixel', () => {
    const pixels = frame()
    drawShapes(pixels, [{ overlay: 'camera', type: 'cross', x: 120, y: 80, arm: 4, colour }])
    expect(pixel(pixels, 116, 80)[0]).toBe(255)
    expect(pixel(pixels, 124, 80)[0]).toBe(255)
    expect(pixel(pixels, 120, 76)[0]).toBe(255)
    expect(pixel(pixels, 120, 84)[0]).toBe(255)
    expect(pixel(pixels, 125, 80)[0]).toBe(0)
    expect(pixel(pixels, 121, 81)[0]).toBe(0)
  })
})
