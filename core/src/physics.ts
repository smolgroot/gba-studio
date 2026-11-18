// The movement of `runtime/src/physics.rs`, for the Physics tab's preview and its
// figures. It covers what the preview needs, solid cells only, with the same integer
// steps as the game: change the two together. `core/test/physics.test.ts` and the Rust
// tests assert the same numbers.
import { Physics, TILE } from './schema.ts'
import type { PlatformerPhysics, TopDownPhysics } from './schema.ts'

/** Velocities are in 1/256 of a pixel per frame. */
export const SUB = 256
export const FRAMES_PER_SECOND = 60

/** Whether a cell stops a body. */
export type SolidCells = (col: number, row: number) => boolean

export interface Body {
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
  subX: number
  subY: number
  onGround: boolean
  hitWall: boolean
  hitCeiling: boolean
}

export function newBody(x: number, y: number, w: number, h: number): Body {
  return { x, y, w, h, vx: 0, vy: 0, subX: 0, subY: 0, onGround: false, hitWall: false, hitCeiling: false }
}

const floorDiv = (value: number, by: number) => Math.floor(value / by)

function blockedAt(body: Body, solid: SolidCells, x: number, y: number): boolean {
  for (let row = floorDiv(y, TILE); row <= floorDiv(y + body.h - 1, TILE); row++) {
    for (let col = floorDiv(x, TILE); col <= floorDiv(x + body.w - 1, TILE); col++) if (solid(col, row)) return true
  }
  return false
}

function floorUnder(body: Body, solid: SolidCells): boolean {
  const feet = body.y + body.h
  if (feet % TILE !== 0) return false
  const row = feet / TILE
  for (let col = floorDiv(body.x, TILE); col <= floorDiv(body.x + body.w - 1, TILE); col++) if (solid(col, row)) return true
  return false
}

/** One frame of side-on movement, as `Body::step`. */
export function stepBody(body: Body, solid: SolidCells): void {
  body.hitWall = false
  body.hitCeiling = false

  body.subX += body.vx
  const dx = Math.trunc(body.subX / SUB)
  body.subX -= dx * SUB
  for (let i = 0; i < Math.abs(dx); i++) {
    const next = body.x + Math.sign(dx)
    if (blockedAt(body, solid, next, body.y)) {
      body.hitWall = true
      body.subX = 0
      break
    }
    body.x = next
  }

  body.subY += body.vy
  const dy = Math.trunc(body.subY / SUB)
  body.subY -= dy * SUB
  for (let i = 0; i < Math.abs(dy); i++) {
    if (dy > 0) {
      if (floorUnder(body, solid)) break
      body.y++
    } else {
      if (blockedAt(body, solid, body.x, body.y - 1)) {
        body.hitCeiling = true
        body.vy = 0
        body.subY = 0
        break
      }
      body.y--
    }
  }
  body.onGround = body.vy >= 0 && floorUnder(body, solid)
  if (body.onGround) {
    body.vy = 0
    body.subY = 0
  }
}

function slideAround(body: Body, solid: SolidCells, dx: number, dy: number, reach: number): void {
  const [acrossX, acrossY] = [Math.abs(dy), Math.abs(dx)]
  const open = [true, true]
  for (let distance = 1; distance <= reach; distance++) {
    for (const [index, side] of [-1, 1].entries()) {
      const x = body.x + acrossX * side * distance
      const y = body.y + acrossY * side * distance
      open[index] = open[index]! && !blockedAt(body, solid, x, y)
      if (open[index] && !blockedAt(body, solid, x + dx, y + dy)) {
        body.x += acrossX * side
        body.y += acrossY * side
        return
      }
    }
  }
}

/** One frame of movement seen from above, as `Body::step_top_down`. */
export function stepBodyTopDown(body: Body, solid: SolidCells, cornerSlide: number): void {
  body.hitWall = false
  body.hitCeiling = false
  body.onGround = false

  body.subX += body.vx
  const dx = Math.trunc(body.subX / SUB)
  body.subX -= dx * SUB
  for (let i = 0; i < Math.abs(dx); i++) {
    if (blockedAt(body, solid, body.x + Math.sign(dx), body.y)) {
      body.hitWall = true
      body.subX = 0
      if (body.vy === 0) slideAround(body, solid, Math.sign(dx), 0, cornerSlide)
      break
    }
    body.x += Math.sign(dx)
  }

  body.subY += body.vy
  const dy = Math.trunc(body.subY / SUB)
  body.subY -= dy * SUB
  for (let i = 0; i < Math.abs(dy); i++) {
    if (blockedAt(body, solid, body.x, body.y + Math.sign(dy))) {
      body.hitWall = true
      body.subY = 0
      if (body.vx === 0) slideAround(body, solid, 0, Math.sign(dy), cornerSlide)
      break
    }
    body.y += Math.sign(dy)
  }
}

function approach(value: number, target: number, rate: number): number {
  if (rate <= 0) return target
  return value < target ? Math.min(value + rate, target) : Math.max(value - rate, target)
}

export interface PlatformerInput {
  direction: number
  jumpPressed: boolean
  jumpHeld: boolean
}
export interface PlatformerState {
  coyote: number
  buffer: number
  airJumps: number
}
export const newPlatformerState = (): PlatformerState => ({ coyote: 0, buffer: 0, airJumps: 0 })

/** Sets the velocity for this frame, before `stepBody`. Returns whether the body jumped. */
export function updatePlatformer(state: PlatformerState, body: Body, physics: PlatformerPhysics, input: PlatformerInput): boolean {
  const rate = !body.onGround ? physics.airAcceleration : input.direction !== 0 ? physics.groundAcceleration : physics.groundFriction
  body.vx = approach(body.vx, input.direction * physics.runSpeed, rate)

  if (body.onGround) {
    state.coyote = physics.coyoteFrames
    state.airJumps = physics.airJumps
  }
  if (input.jumpPressed) state.buffer = physics.jumpBufferFrames + 1
  let jumped = false
  if (state.buffer > 0) {
    if (body.onGround || state.coyote > 0) {
      jumped = true
      state.coyote = 0
    } else if (state.airJumps > 0) {
      jumped = true
      state.airJumps--
    }
  }
  if (jumped) {
    body.vy = -physics.jumpSpeed
    state.buffer = 0
  }
  state.buffer = Math.max(0, state.buffer - 1)
  if (!body.onGround) state.coyote = Math.max(0, state.coyote - 1)

  if (!input.jumpHeld && body.vy < -physics.jumpCut) body.vy = -physics.jumpCut
  body.vy = Math.min(body.vy + (body.vy >= 0 ? physics.fallGravity : physics.gravity), physics.maxFallSpeed)
  return jumped
}

export interface TopDownState {
  heldX: number
  heldY: number
  horizontal: boolean
  stepX: number
  stepY: number
  left: number
  sub: number
}
export const newTopDownState = (): TopDownState => ({ heldX: 0, heldY: 0, horizontal: false, stepX: 0, stepY: 0, left: 0, sub: 0 })

function oneAxis(state: TopDownState, dx: number, dy: number): [number, number] {
  const both = dx !== 0 && dy !== 0
  if (both) {
    if (state.heldX === 0) state.horizontal = true
    else if (state.heldY === 0) state.horizontal = false
  } else {
    state.horizontal = dx !== 0
  }
  state.heldX = dx
  state.heldY = dy
  return !both ? [dx, dy] : state.horizontal ? [dx, 0] : [0, dy]
}

/** Moves the body for this frame. `dx` and `dy` are -1, 0 or 1; down is positive. */
export function updateTopDown(state: TopDownState, body: Body, solid: SolidCells, physics: TopDownPhysics, dx: number, dy: number): void {
  const [singleX, singleY] = oneAxis(state, dx, dy)
  if (physics.movement === 'grid') return updateGrid(state, body, solid, physics, singleX, singleY)
  const [mx, my] = physics.directions === 4 ? [singleX, singleY] : [dx, dy]
  const speed = mx !== 0 && my !== 0 && physics.normalizeDiagonal ? Math.trunc((physics.speed * 181) / SUB) : physics.speed
  body.vx = approach(body.vx, mx * speed, mx !== 0 ? physics.acceleration : physics.friction)
  body.vy = approach(body.vy, my * speed, my !== 0 ? physics.acceleration : physics.friction)
  stepBodyTopDown(body, solid, physics.cornerSlide)
}

function updateGrid(state: TopDownState, body: Body, solid: SolidCells, physics: TopDownPhysics, mx: number, my: number): void {
  body.hitWall = false
  body.hitCeiling = false
  body.onGround = false
  if (state.left === 0) {
    if (mx === 0 && my === 0) {
      state.sub = 0
    } else {
      let free = true
      for (let n = 1; n <= physics.gridSize && free; n++) free = !blockedAt(body, solid, body.x + mx * n, body.y + my * n)
      if (free) {
        state.stepX = mx
        state.stepY = my
        state.left = physics.gridSize
      } else {
        body.hitWall = true
        state.sub = 0
      }
    }
  }
  if (state.left === 0) {
    body.vx = 0
    body.vy = 0
    return
  }
  state.sub += physics.speed
  const pixels = Math.min(Math.trunc(state.sub / SUB), state.left)
  state.sub -= pixels * SUB
  state.left -= pixels
  body.x += state.stepX * pixels
  body.y += state.stepY * pixels
  body.vx = state.stepX * physics.speed
  body.vy = state.stepY * physics.speed
}

/** Jumps once from a flat floor; returns the height reached and the frames in the air. */
export function jumpArc(physics: PlatformerPhysics, heldFrames: number): { height: number; frames: number } {
  const floorRow = 4000
  const floorY = floorRow * TILE
  const solid: SolidCells = (_col, row) => row >= floorRow
  const body = newBody(0, floorY - 8, 8, 8)
  body.onGround = true
  const state = newPlatformerState()
  let height = 0
  let frames = 0
  do {
    updatePlatformer(state, body, physics, { direction: 0, jumpPressed: frames === 0, jumpHeld: frames < heldFrames })
    stepBody(body, solid)
    frames++
    height = Math.max(height, floorY - (body.y + body.h))
  } while (!body.onGround && frames <= 5000)
  return { height, frames }
}

/** What the numbers come to, for showing beside them. */
export function platformerFigures(physics: PlatformerPhysics) {
  const full = jumpArc(physics, Infinity)
  const hop = jumpArc(physics, 1)
  const framesTo = (rate: number) => (rate <= 0 ? 0 : Math.ceil(physics.runSpeed / rate))
  return {
    jumpHeight: full.height,
    airFrames: full.frames,
    hopHeight: hop.height,
    jumpDistance: Math.trunc((physics.runSpeed * full.frames) / SUB),
    framesToRun: framesTo(physics.groundAcceleration),
    framesToStop: framesTo(physics.groundFriction),
  }
}

/** Starting points for the Physics tab. */
export const PLATFORMER_PRESETS: ReadonlyArray<{ name: string; description: string; physics: PlatformerPhysics }> = [
  { name: 'Classic', description: 'The default: instant, direct control', physics: Physics.parse({}).platformer },
  {
    name: 'Tight',
    description: 'Quick, precise, forgiving of timing',
    physics: { gravity: 56, fallGravity: 80, maxFallSpeed: 1280, runSpeed: 416, groundAcceleration: 64, groundFriction: 80, airAcceleration: 48, jumpSpeed: 1260, jumpCut: 320, airJumps: 0, coyoteFrames: 5, jumpBufferFrames: 5 },
  },
  {
    name: 'Floaty',
    description: 'Slow arcs with a double jump',
    physics: { gravity: 24, fallGravity: 28, maxFallSpeed: 640, runSpeed: 320, groundAcceleration: 24, groundFriction: 16, airAcceleration: 14, jumpSpeed: 800, jumpCut: 300, airJumps: 1, coyoteFrames: 6, jumpBufferFrames: 6 },
  },
  {
    name: 'Heavy',
    description: 'Slow to start and stop, hard landings',
    physics: { gravity: 80, fallGravity: 110, maxFallSpeed: 1792, runSpeed: 300, groundAcceleration: 16, groundFriction: 20, airAcceleration: 8, jumpSpeed: 1300, jumpCut: 700, airJumps: 0, coyoteFrames: 2, jumpBufferFrames: 2 },
  },
]

export const TOP_DOWN_PRESETS: ReadonlyArray<{ name: string; description: string; physics: TopDownPhysics }> = [
  {
    name: 'Action adventure',
    description: 'Free movement in 8 directions',
    physics: { movement: 'free', speed: 320, acceleration: 64, friction: 80, directions: 8, normalizeDiagonal: true, cornerSlide: 4, gridSize: 16 },
  },
  {
    name: 'Tile-based RPG',
    description: 'One 16 pixel step at a time',
    physics: { movement: 'grid', speed: 256, acceleration: 0, friction: 0, directions: 4, normalizeDiagonal: true, cornerSlide: 0, gridSize: 16 },
  },
]
