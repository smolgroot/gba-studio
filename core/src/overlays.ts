// Debug overlays on the game screen (US-022): what the physics sees, drawn by the
// studio over the picture the emulator made. Nothing here touches the emulator or
// the ROM, so an overlay costs the game nothing. See design/US-022.md.
import { rowBox } from './inspect.ts'
import type { LiveView, SectionIndex } from './inspect.ts'

/** The screen, in game pixels. */
export const SCREEN_WIDTH = 240
export const SCREEN_HEIGHT = 160
const TILE = 8

/** Each overlay has its own toggle. */
export const OVERLAYS = ['hitboxes', 'collision', 'camera', 'rooms'] as const
export type Overlay = (typeof OVERLAYS)[number]

/** Red, green, blue and how much of it covers the picture, 0 to 1. */
export type Colour = readonly [number, number, number, number]

/**
 * A shape on the game screen, in game pixels from its top-left corner. Edges may lie
 * past the screen: `drawShapes` clips them, so a box cut by the edge loses only the
 * sides that are out of view.
 */
export type Shape =
  | { overlay: Overlay; type: 'fill'; x: number; y: number; w: number; h: number; colour: Colour }
  /** One game pixel wide, inside the rectangle. */
  | { overlay: Overlay; type: 'box'; x: number; y: number; w: number; h: number; colour: Colour }
  /** Two arms crossing at a pixel, each reaching `arm` pixels from it. */
  | { overlay: Overlay; type: 'cross'; x: number; y: number; arm: number; colour: Colour }

const PLAYER: Colour = [61, 220, 132, 1]
const ENTITY: Colour = [255, 176, 0, 1]
const SOLID: Colour = [229, 72, 77, 0.4]
const ONE_WAY: Colour = [0, 200, 255, 0.9]
const SLOPE: Colour = [167, 139, 250, 0.5]
const HAZARD: Colour = [245, 165, 36, 0.5]
const CUSTOM: Colour = [230, 230, 230, 0.7]
const CAMERA: Colour = [255, 92, 205, 1]
const HERE: Colour = [255, 255, 255, 0.8]
const THERE: Colour = [255, 255, 255, 0.4]
const GRID: Colour = [255, 255, 255, 0.18]

/** Whether any part of a rectangle of the screen is in view. */
const inView = (x: number, y: number, w: number, h: number) => w > 0 && h > 0 && x < SCREEN_WIDTH && y < SCREEN_HEIGHT && x + w > 0 && y + h > 0

/** How high a slope's floor stands over a tile's bottom edge at pixel column `x` (0 to 7): as the runtime's `CollisionClass::floor_height`. */
export function floorHeight(left: number, right: number, x: number): number {
  return left + Math.floor(((right - left) * (2 * x + 1) + 8) / 16)
}

/** The rooms to draw: those on the map, and the player's room wherever it is. */
function roomsToDraw(view: Extract<LiveView, { state: 'running' }>, section: SectionIndex): number[] {
  const here = section.rooms.findIndex((r) => r.id === view.room)
  return section.rooms.flatMap((r, i) => (i === here || r.onMap ? [i] : []))
}

/**
 * The shapes of the overlays that are on, in game pixels of the screen: each world
 * pixel is placed at itself minus the camera, so they line up with the game at any
 * zoom. Nothing for a game that is not running; the rooms and the cells need the
 * running ROM's level data (`section`).
 */
export function overlayShapes(view: LiveView, section: SectionIndex | null, on: ReadonlySet<Overlay>): Shape[] {
  if (view.state !== 'running') return []
  const [cx, cy] = [view.camera.x, view.camera.y]
  const shapes: Shape[] = []

  if (on.has('hitboxes')) {
    for (const row of view.rows) {
      const colour = row.kind === 'player' ? PLAYER : ENTITY
      if (row.kind === 'entity' && (row.hitbox.w === 0 || row.hitbox.h === 0)) {
        // No hitbox (no sprite): where its feet are.
        const [x, y] = [row.x - cx, row.y - cy]
        if (inView(x - 3, y - 3, 7, 7)) shapes.push({ overlay: 'hitboxes', type: 'cross', x, y, arm: 3, colour })
        continue
      }
      const [x, y, w, h] = rowBox(row)
      if (inView(x - cx, y - cy, w, h)) shapes.push({ overlay: 'hitboxes', type: 'box', x: x - cx, y: y - cy, w, h, colour })
    }
  }

  if (on.has('collision') && section) {
    for (const i of roomsToDraw(view, section)) {
      const [place, room] = [section.rooms[i]!, section.cells[i]]
      if (!room) continue
      // The room's cells under the screen, in the room's own columns and rows.
      const [left, top] = [place.left - cx, place.top - cy]
      const [firstCol, lastCol] = [Math.max(0, Math.floor(-left / TILE)), Math.min(room.cols - 1, Math.floor((SCREEN_WIDTH - 1 - left) / TILE))]
      const [firstRow, lastRow] = [Math.max(0, Math.floor(-top / TILE)), Math.min(room.rows - 1, Math.floor((SCREEN_HEIGHT - 1 - top) / TILE))]
      for (let row = firstRow; row <= lastRow; row++) {
        for (let col = firstCol; col <= lastCol; col++) {
          const info = section.classes[room.cells[row * room.cols + col]!]
          if (!info || info.kind === 'empty') continue
          const [x, y] = [left + col * TILE, top + row * TILE]
          const shape = (overlay: 'collision', type: 'fill' | 'box', sx: number, sy: number, w: number, h: number, colour: Colour): Shape => ({ overlay, type, x: sx, y: sy, w, h, colour })
          if (info.kind === 'solid') shapes.push(shape('collision', 'fill', x, y, TILE, TILE, SOLID))
          else if (info.kind === 'oneway') shapes.push(shape('collision', 'fill', x, y, TILE, 2, ONE_WAY))
          else if (info.kind === 'hazard') shapes.push(shape('collision', 'fill', x, y, TILE, TILE, HAZARD), shape('collision', 'box', x, y, TILE, TILE, HAZARD))
          else if (info.kind === 'custom') shapes.push(shape('collision', 'box', x, y, TILE, TILE, CUSTOM))
          else if (info.slope) {
            for (let px = 0; px < TILE; px++) {
              const height = Math.min(TILE, floorHeight(info.slope.left, info.slope.right, px))
              if (height > 0) shapes.push(shape('collision', 'fill', x + px, y + TILE - height, 1, height, SLOPE))
            }
          }
        }
      }
    }
  }

  if (on.has('rooms') && section) {
    for (const i of roomsToDraw(view, section)) {
      const place = section.rooms[i]!
      const [x, y] = [place.left - cx, place.top - cy]
      if (!inView(x, y, place.width, place.height)) continue
      // The faint lines are the screens of the map, where a room is bigger than one.
      for (let at = SCREEN_WIDTH; at < place.width; at += SCREEN_WIDTH) shapes.push({ overlay: 'rooms', type: 'fill', x: x + at, y, w: 1, h: place.height, colour: GRID })
      for (let at = SCREEN_HEIGHT; at < place.height; at += SCREEN_HEIGHT) shapes.push({ overlay: 'rooms', type: 'fill', x, y: y + at, w: place.width, h: 1, colour: GRID })
      shapes.push({ overlay: 'rooms', type: 'box', x, y, w: place.width, h: place.height, colour: place.id === view.room ? HERE : THERE })
    }
  }

  // The camera is the world pixel at the screen's top-left, so what it looks at is the
  // middle of the view. How a game aims it is the game's own code, which the studio cannot see.
  if (on.has('camera')) shapes.push({ overlay: 'camera', type: 'cross', x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2, arm: 4, colour: CAMERA })

  return shapes
}

/**
 * Paints shapes into the game's picture: `pixels` is the 240 by 160 frame in RGBA, as
 * the emulator hands it out, and is changed in place, so give it a copy of what the
 * emulator keeps if that matters. Whatever lies off the screen is left out.
 */
export function drawShapes(pixels: Uint8Array | Uint8ClampedArray, shapes: readonly Shape[]): void {
  const put = (x: number, y: number, [r, g, b, a]: Colour) => {
    if (x < 0 || y < 0 || x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) return
    const at = (y * SCREEN_WIDTH + x) * 4
    pixels[at] = Math.round(pixels[at]! * (1 - a) + r * a)
    pixels[at + 1] = Math.round(pixels[at + 1]! * (1 - a) + g * a)
    pixels[at + 2] = Math.round(pixels[at + 2]! * (1 - a) + b * a)
  }
  const fill = (x: number, y: number, w: number, h: number, colour: Colour) => {
    const [x0, y0, x1, y1] = [Math.max(0, x), Math.max(0, y), Math.min(SCREEN_WIDTH, x + w), Math.min(SCREEN_HEIGHT, y + h)]
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) put(px, py, colour)
  }
  for (const shape of shapes) {
    if (shape.type === 'fill') fill(shape.x, shape.y, shape.w, shape.h, shape.colour)
    else if (shape.type === 'box') {
      // Four sides that do not overlap, so a translucent box has no darker corners.
      const { x, y, w, h, colour } = shape
      fill(x, y, w, 1, colour)
      if (h > 1) fill(x, y + h - 1, w, 1, colour)
      fill(x, y + 1, 1, h - 2, colour)
      if (w > 1) fill(x + w - 1, y + 1, 1, h - 2, colour)
    } else {
      const { x, y, arm, colour } = shape
      fill(x - arm, y, arm * 2 + 1, 1, colour)
      fill(x, y - arm, 1, arm, colour)
      fill(x, y + 1, 1, arm, colour)
    }
  }
}
