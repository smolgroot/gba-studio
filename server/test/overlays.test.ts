// Debug overlays (US-022) on the sample's dev ROM, run headless: they land where the
// game's pixels are, they read what the physics reads, and they cost the game
// nothing. Skipped until the sample has been built (cd sample && cargo build).
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { OVERLAYS, drawShapes, indexSection, overlayShapes, readDebugMap, readLive } from '@pecten-studio/core'
import type { DebugMap, LiveView, Overlay, SectionIndex, Shape } from '@pecten-studio/core'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const ROM = path.join(REPO, 'sample/dist/sample-dev.gba')
const CORE = path.join(REPO, 'app/public/wasm/pecten.js')
const ready = existsSync(ROM) && existsSync(CORE) && readDebugMap(new Uint8Array(readFileSync(ROM))) !== null

const W = 240
const ALL = new Set<Overlay>(OVERLAYS)
/** Frames to run two games side by side: enough to walk and jump across the first room. */
const FRAMES = 200
const pixelAt = (pixels: Uint8Array, x: number, y: number) => Array.from(pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 3))

interface Emulator {
  step_frame: () => Uint8Array
  set_pressed_keys: (keys: number) => void
  read_ram: (addr: number, len: number) => Uint8Array
  write_ram: (addr: number, data: Uint8Array) => void
  patch_rom: (offset: number, data: Uint8Array) => void
  save_state: () => Uint8Array
  free: () => void
}

describe.skipIf(!ready)('overlays on the sample', () => {
  let bytes: Uint8Array
  let map: DebugMap
  let section: SectionIndex
  let mod: { WasmEmulator: new (rom: Uint8Array, bootIntro: boolean) => Emulator }
  beforeAll(async () => {
    bytes = new Uint8Array(readFileSync(ROM))
    const found = readDebugMap(bytes)
    if (!found || !('map' in found)) throw new Error('the sample has no debug map: rebuild it')
    map = found.map
    section = indexSection(bytes)!
    mod = await import(pathToFileURL(CORE).href)
    await (mod as unknown as { default: (o: unknown) => Promise<unknown> }).default({ module_or_path: await readFile(CORE.replace(/\.js$/, '_bg.wasm')) })
  })

  const running = (emulator: Emulator): Extract<LiveView, { state: 'running' }> => {
    const view = readLive(emulator, map, section)
    if (view.state !== 'running') throw new Error(`expected a running game, got ${JSON.stringify(view)}`)
    return view
  }

  it('reads the collision the game was given: a class for each cell of each room', () => {
    expect(section.cells).toHaveLength(section.rooms.length)
    section.cells.forEach((room, i) => {
      expect(room.cells.length, section.rooms[i]!.id).toBe(room.cols * room.rows)
      expect(room.cols * 8).toBe(section.rooms[i]!.width)
      for (const cls of room.cells) expect(section.classes[cls], `class ${cls}`).toBeDefined()
    })
    const kinds = new Set(section.classes.map((c) => c.kind))
    expect(kinds.has('solid')).toBe(true)
    expect(section.classes.filter((c) => c.kind === 'slope').every((c) => c.slope !== null)).toBe(true)
  })

  it('puts the hitboxes and the floor where the game draws them', () => {
    const emulator = new mod.WasmEmulator(bytes, false)
    try {
      for (let i = 0; i < 120; i++) emulator.step_frame()
      const pixels = emulator.step_frame().slice()
      const view = running(emulator)
      const player = view.rows[0]!
      if (player.kind !== 'player') throw new Error('the player is first')
      expect(player.onGround).toBe(true)

      const before = pixels.slice()
      drawShapes(pixels, overlayShapes(view, section, new Set<Overlay>(['hitboxes'])))
      const [left, top] = [player.x - view.camera.x, player.y - view.camera.y]
      // The box's top-left pixel is the overlay's, one pixel in from it the game's.
      expect(pixelAt(pixels, left, top)).toEqual([61, 220, 132])
      expect(pixelAt(pixels, left + 1, top + 1)).toEqual(pixelAt(before, left + 1, top + 1))
      expect(pixelAt(pixels, left + player.w - 1, top + player.h - 1)).toEqual([61, 220, 132])

      // The cell under a standing player's feet is one the physics stops it on: it is drawn.
      const feet = { x: player.x + Math.floor(player.w / 2) - view.camera.x, y: player.y + player.h - view.camera.y }
      const cell = { x: feet.x - (((feet.x + view.camera.x) % 8) + 8) % 8, y: feet.y - (((feet.y + view.camera.y) % 8) + 8) % 8 }
      const under = overlayShapes(view, section, new Set<Overlay>(['collision'])).filter((s: Shape) => s.type === 'fill' && cell.x >= s.x && cell.x < s.x + s.w && feet.y >= s.y && feet.y < s.y + s.h)
      expect(under.length, 'nothing drawn under the feet').toBeGreaterThan(0)
    } finally {
      emulator.free()
    }
  })

  it('costs the game nothing: the same game with every overlay on ends in the same state', () => {
    const [watched, plain] = [new mod.WasmEmulator(bytes, false), new mod.WasmEmulator(bytes, false)]
    // The studio's emulator, as the overlays see it: reading only.
    const readOnly = {
      read_ram: (a: number, n: number) => watched.read_ram(a, n),
      write_ram: () => {
        throw new Error('an overlay wrote to the game')
      },
      patch_rom: () => {
        throw new Error('an overlay patched the ROM')
      },
    }
    let painted = 0
    try {
      for (let frame = 0; frame < FRAMES; frame++) {
        // Walk right, jump now and then.
        const keys = frame < 30 ? 0 : 16 | (frame % 50 < 10 ? 1 : 0)
        watched.set_pressed_keys(keys)
        plain.set_pressed_keys(keys)
        const shown = watched.step_frame().slice()
        const unshown = plain.step_frame()
        expect(shown, `frame ${frame} picture`).toEqual(unshown)
        const view = readLive(readOnly, map, section)
        const shapes = overlayShapes(view, section, ALL)
        const copy = shown.slice()
        drawShapes(copy, shapes)
        if (view.state === 'running' && copy.some((b, i) => b !== shown[i])) painted++
      }
      expect(painted, 'the overlays drew nothing').toBeGreaterThan(FRAMES - 30)
      // The whole machine, memory and registers: equal, so the game has not noticed.
      expect(watched.save_state()).toEqual(plain.save_state())
    } finally {
      watched.free()
      plain.free()
    }
  }, 60_000)
})
