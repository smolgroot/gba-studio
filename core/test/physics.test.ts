import { describe, expect, it } from 'vitest'
import {
  PLATFORMER_PRESETS, Physics, Project, TOP_DOWN_PRESETS, jumpArc, newBody, newPlatformerState, newProject, newTopDownState,
  platformerFigures, stepBody, updatePlatformer, updateTopDown,
} from '../src/index.ts'
import type { SolidCells, TopDownPhysics } from '../src/index.ts'

const defaults = Physics.parse({})
const map = (rows: string[]): SolidCells => (col, row) => rows[row]?.[col] === '#'

describe('physics settings', () => {
  it('gives a project saved without them the defaults', () => {
    const { physics: _left, ...old } = newProject('Old').project
    const parsed = Project.parse(old)
    expect(parsed.physics.mode).toBe('platformer')
    expect(parsed.physics.platformer.gravity).toBe(48)
    expect(parsed.physics.topDown.movement).toBe('free')
  })
  it('fills in what a partial block leaves out and refuses what is out of range', () => {
    expect(Physics.parse({ platformer: { gravity: 10 } }).platformer).toMatchObject({ gravity: 10, jumpSpeed: 1100 })
    expect(Physics.safeParse({ platformer: { gravity: 0 } }).success).toBe(false)
    expect(Physics.safeParse({ topDown: { directions: 6 } }).success).toBe(false)
    expect(Physics.safeParse({ mode: 'racing' }).success).toBe(false)
  })
  it('has presets the schema accepts', () => {
    for (const { physics } of PLATFORMER_PRESETS) expect(Physics.safeParse({ platformer: physics }).success).toBe(true)
    for (const { physics } of TOP_DOWN_PRESETS) expect(Physics.safeParse({ topDown: physics }).success).toBe(true)
  })
})

describe('the preview moves like the game', () => {
  // The same numbers are asserted of the game's code in runtime/src/physics.rs.
  it('jumps as high and as long', () => {
    expect(jumpArc(defaults.platformer, Infinity)).toEqual({ height: 47, frames: 45 })
    expect(jumpArc(defaults.platformer, 1)).toEqual({ height: 9, frames: 20 })
    expect(jumpArc({ ...defaults.platformer, gravity: 30, fallGravity: 70, maxFallSpeed: 700, jumpSpeed: 900 }, Infinity)).toEqual({ height: 50, frames: 54 })
  })
  it('allows one air jump, then none until landing', () => {
    const physics = { ...defaults.platformer, airJumps: 1 }
    const state = newPlatformerState()
    const body = newBody(0, 0, 8, 8)
    const press = { direction: 0, jumpPressed: true, jumpHeld: true }
    body.onGround = true
    updatePlatformer(state, body, physics, { ...press, jumpPressed: false })
    body.onGround = false
    expect(updatePlatformer(state, body, physics, press)).toBe(true)
    expect(updatePlatformer(state, body, physics, press)).toBe(false)
  })
  it('lands on a floor and stops there', () => {
    const solid = map(['....', '....', '....', '####'])
    const body = newBody(8, 0, 8, 8)
    const state = newPlatformerState()
    for (let i = 0; i < 60; i++) {
      updatePlatformer(state, body, defaults.platformer, { direction: 0, jumpPressed: false, jumpHeld: false })
      stepBody(body, solid)
    }
    expect(body.onGround).toBe(true)
    expect(body.y + body.h).toBe(24)
  })
  it('works out the figures shown in the tab', () => {
    const figures = platformerFigures({ ...defaults.platformer, groundAcceleration: 100 })
    expect(figures.jumpHeight).toBe(47)
    expect(figures.airFrames).toBe(45)
    expect(figures.framesToRun).toBe(4)
    expect(figures.framesToStop).toBe(0)
  })
})

describe('top-down movement', () => {
  const walk = (physics: TopDownPhysics, solid: SolidCells, x: number, y: number, dx: number, dy: number, frames: number) => {
    const body = newBody(x, y, 6, 6)
    const state = newTopDownState()
    for (let i = 0; i < frames; i++) updateTopDown(state, body, solid, physics, dx, dy)
    return body
  }
  it('has no gravity and stops at walls', () => {
    const solid = map(['########', '#......#', '#......#', '#......#', '#......#', '########'])
    const body = walk({ ...defaults.topDown, cornerSlide: 0 }, solid, 10, 10, 0, 1, 60)
    expect(body.y + body.h).toBe(40)
    expect(body.hitWall).toBe(true)
  })
  it('keeps diagonals as fast as straight lines', () => {
    const body = walk(defaults.topDown, () => false, 0, 0, 1, 1, 1)
    expect([body.vx, body.vy]).toEqual([181, 181])
  })
  it('slides around a corner it clips', () => {
    const body = walk(defaults.topDown, map(['........', '...#....', '........', '........']), 10, 14, 1, 0, 30)
    expect(body.y).toBe(16)
    expect(body.x).toBeGreaterThan(32)
  })
  it('finishes grid steps and refuses blocked ones', () => {
    const solid = map(['##########', '#........#', '#........#', '#...#....#', '#........#', '##########'])
    const physics: TopDownPhysics = { ...defaults.topDown, movement: 'grid', gridSize: 8 }
    const body = newBody(8, 24, 8, 8)
    const state = newTopDownState()
    updateTopDown(state, body, solid, physics, 1, 0)
    for (let i = 0; i < 20; i++) updateTopDown(state, body, solid, physics, 0, 0)
    expect([body.x, body.y]).toEqual([16, 24])
    for (let i = 0; i < 40; i++) updateTopDown(state, body, solid, physics, 1, 0)
    expect(body.x).toBe(24)
    expect(body.hitWall).toBe(true)
  })
})
