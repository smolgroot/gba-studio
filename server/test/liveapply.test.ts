// Live apply (US-003) on the sample's dev ROM: an edit goes into the game that is
// running, and the player stays where they are. Each test runs two emulators with the
// same buttons: one takes the change live, the other does not, so anything that
// differs between them is the change's doing.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIVE_CHANGES, applyLive, liveTaken, planLiveApply, readDebugMap, readGameState, rleDecode, rleEncode } from '@pecten-studio/core'
import type { DebugMap, LiveTarget } from '@pecten-studio/core'
import { Builder } from '../src/build.ts'
import { patchRom } from '../src/patch.ts'
import { ProjectFolder } from '../src/project.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const SAMPLE = path.join(REPO, 'sample')
const ROM = 'dist/sample-dev.gba'
const CORE = path.join(REPO, 'app/public/wasm/pecten.js')
const sampleRom = path.join(SAMPLE, ROM)
const ready = existsSync(sampleRom) && (() => {
  const map = readDebugMap(new Uint8Array(readFileSync(sampleRom)))
  return !!map && 'map' in map && !!map.map.inbox
})()

interface Emulator extends LiveTarget {
  step_frame(): Uint8Array
  set_pressed_keys(keys: number): void
  free(): void
}
type Core = { default: (o: { module_or_path: Uint8Array }) => Promise<unknown>; WasmEmulator: new (rom: Uint8Array, intro: boolean) => Emulator }
let core: Core
const RIGHT = 16

let folder: string
let project: ProjectFolder
let builder: Builder
const file = (rel: string) => path.join(folder, rel)
const doc = (rel: string) => JSON.parse(readFileSync(file(`studio/${rel}`), 'utf8')) as Record<string, any>
const save = (rel: string, json: unknown) => writeFileSync(file(`studio/${rel}`), JSON.stringify(json, null, 2))

/** Two emulators of the same ROM, pressing the same buttons. */
class Pair {
  live: Emulator
  control: Emulator
  screen: [Uint8Array, Uint8Array] = [new Uint8Array(), new Uint8Array()]
  constructor(rom: Uint8Array) {
    this.live = new core.WasmEmulator(rom, false)
    this.control = new core.WasmEmulator(rom, false)
  }
  run(frames: number, keys = 0) {
    for (let i = 0; i < frames; i++) {
      this.live.set_pressed_keys(keys)
      this.control.set_pressed_keys(keys)
      this.screen = [Uint8Array.from(this.live.step_frame()), Uint8Array.from(this.control.step_frame())]
    }
  }
  free() {
    this.live.free()
    this.control.free()
  }
}
const state = (emulator: Emulator, map: DebugMap) => readGameState(map, emulator.read_ram(map.state.address, map.state.size)) as any

/** Patches the ROM file from the project, as Patch on change does, and returns the new bytes. */
async function patched(): Promise<Uint8Array> {
  const result = await patchRom(project, builder, 'dev')
  expect(result.status).toBe('patched')
  return new Uint8Array(readFileSync(file(ROM)))
}

/** Every file but the ROM an hour in the past, so the ROM is newer than its inputs. */
function age(dir: string): void {
  const past = new Date(Date.now() - 3_600_000)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) age(full)
    else if (full !== file(ROM)) utimesSync(full, past, past)
  }
}

beforeEach(async () => {
  if (!ready) return
  const mod = (await import(pathToFileURL(CORE).href)) as Core
  await mod.default({ module_or_path: await readFile(CORE.replace(/\.js$/, '_bg.wasm')) })
  core = mod
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-live-'))
  for (const part of ['studio', 'assets', 'src', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'rust-toolchain.toml', ROM]) cpSync(path.join(SAMPLE, part), file(part), { recursive: true })
  project = new ProjectFolder(folder)
  builder = new Builder(project, () => undefined)
  const settings = doc('project.json')
  settings.build.dev = 'true'
  save('project.json', settings)
  age(folder)
  expect((await builder.run('dev')).exitCode).toBe(0)
})
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
})

describe.skipIf(!ready || !existsSync(CORE))('live apply on the sample', () => {
  it('shows painted tiles within a few frames, and the player keeps their position and state', async () => {
    const running = new Uint8Array(readFileSync(file(ROM)))
    const map = (readDebugMap(running) as { map: DebugMap }).map
    const pair = new Pair(running)
    try {
      pair.run(120)
      // A few steps only: the hero meets a wall at x 767.
      pair.run(4, RIGHT)
      const { cameraX, cameraY } = state(pair.live, map)

      // A cell of the front layer of "entry" (origin 720, 160) near the top middle of the screen.
      const room = doc('rooms/entry.json')
      const front = room.layers.at(-1)
      const cells = rleDecode(front.data)
      const [col, row] = [Math.floor((cameraX - 720) / 8) + 15, Math.floor((cameraY - 160) / 8) + 3]
      const cell = row * room.width * 30 + col
      cells[cell] = cells[cell] === 0 ? 2 : 0
      front.data = rleEncode(cells)
      save('rooms/entry.json', room)

      const plan = planLiveApply(running, await patched())
      if (plan.kind !== 'apply') throw new Error(`expected a live apply, got ${JSON.stringify(plan)}`)
      expect(plan.changes).toBe(LIVE_CHANGES.tiles)
      const before = state(pair.live, map)
      const generation = applyLive(pair.live, plan)

      // Keep walking for 5 video frames. Redrawing the view takes about two frames on
      // the sample, so the game runs two updates fewer in that time: it is compared with
      // the other game at the same update (the block's frame count), not the same video frame.
      const control = new Map<number, { state: any; screen: Uint8Array }>()
      const live: { state: any; screen: Uint8Array }[] = []
      control.set(before.frame, { state: state(pair.control, map), screen: pair.screen[1] })
      for (let frame = 1; frame <= 5; frame++) {
        pair.run(1, RIGHT)
        live.push({ state: state(pair.live, map), screen: pair.screen[0] })
        const other = state(pair.control, map)
        control.set(other.frame, { state: other, screen: pair.screen[1] })
      }
      expect(liveTaken(pair.live, map, generation)).toBe(true)
      expect(live.at(-1)!.state.frame, 'at most two updates lost').toBeGreaterThanOrEqual(before.frame + 3)

      /** Pixels that differ from the other game at the same update, inside the tile and outside it. */
      const compare = (step: { state: any; screen: Uint8Array }) => {
        const other = control.get(step.state.frame)!
        const [x0, y0] = [720 + col * 8 - step.state.cameraX, 160 + row * 8 - step.state.cameraY]
        let inside = 0
        const outside: number[] = []
        for (let i = 0; i < step.screen.length; i += 4) {
          if ([0, 1, 2].every((k) => step.screen[i + k] === other.screen[i + k])) continue
          const [x, y] = [(i / 4) % 240, Math.floor(i / 4 / 240)]
          if (x >= x0 && x < x0 + 8 && y >= y0 && y < y0 + 8) inside++
          else outside.push(x, y)
        }
        return { inside, outside }
      }
      const shown = live.findIndex((step) => compare(step).inside > 0)
      expect(shown, 'the tile appears within 5 frames').toBeGreaterThanOrEqual(0)

      // Then the player, the camera and the room are as in the game that took no change,
      // and only the tile's pixels differ.
      for (const step of live.slice(shown)) {
        const other = control.get(step.state.frame)!.state
        expect(step.state.player).toEqual(other.player)
        expect([step.state.cameraX, step.state.cameraY, step.state.room]).toEqual([other.cameraX, other.cameraY, other.room])
        expect(compare(step).outside.slice(0, 10), 'pixels that changed outside the tile').toEqual([])
      }
      expect(live.at(-1)!.state.player.x).toBeGreaterThan(before.player.x)
    } finally {
      pair.free()
    }
  })

  it('takes physics changes on the next frame', async () => {
    const running = new Uint8Array(readFileSync(file(ROM)))
    const map = (readDebugMap(running) as { map: DebugMap }).map
    const pair = new Pair(running)
    try {
      pair.run(120)
      pair.run(30, RIGHT)
      const runSpeed = doc('project.json').physics?.platformer?.runSpeed ?? 384
      expect(state(pair.live, map).player.vx).toBe(runSpeed)

      const settings = doc('project.json')
      settings.physics = { ...settings.physics, platformer: { ...settings.physics?.platformer, runSpeed: runSpeed * 2 } }
      save('project.json', settings)
      const plan = planLiveApply(running, await patched())
      if (plan.kind !== 'apply') throw new Error(`expected a live apply, got ${JSON.stringify(plan)}`)
      expect(plan.changes).toBe(LIVE_CHANGES.physics)
      applyLive(pair.live, plan)

      pair.run(1, RIGHT)
      expect(state(pair.live, map).player.vx).toBeGreaterThan(runSpeed)
      expect(state(pair.control, map).player.vx).toBe(runSpeed)
    } finally {
      pair.free()
    }
  })

  it('respawns only the entities that changed, and keeps the others collected when numbers move', async () => {
    const running = new Uint8Array(readFileSync(file(ROM)))
    const map = (readDebugMap(running) as { map: DebugMap }).map
    const pair = new Pair(running)
    try {
      pair.run(120)
      const { collected, collectedWords } = state(pair.live, map)
      const bits = (emulator: Emulator) => {
        const bytes = emulator.read_ram(collected, collectedWords * 4)
        return Array.from({ length: collectedWords * 32 }, (_, n) => (bytes[n >> 3]! >> (n & 7)) & 1).flatMap((bit, n) => (bit ? [n] : []))
      }
      // The game numbers entities room by room, rooms by id: "entry" is first, so its
      // entities are 0 to 8 in the order of the file. Take coins 1 and 2 as if touched.
      const take = new Uint8Array(collectedWords * 4)
      take[0] = 0b110
      pair.live.write_ram(collected, take)
      expect(bits(pair.live)).toEqual([1, 2])

      // Move coin 1, and add a coin before both, so every number after it moves on by one.
      const room = doc('rooms/entry.json')
      room.entities[1].x += 4
      room.entities.unshift({ type: 'coin', x: 40, y: 92, props: {} })
      save('rooms/entry.json', room)
      const plan = planLiveApply(running, await patched())
      if (plan.kind !== 'apply') throw new Error(`expected a live apply, got ${JSON.stringify(plan)}`)
      expect(plan.changes).toBe(LIVE_CHANGES.entities)
      expect(plan.renumber.slice(0, 4)).toEqual([1, null, 3, 4])
      applyLive(pair.live, plan)
      pair.run(2)

      // Coin 2 is now 3 and still taken; the moved coin (now 2) and the new one (0) are back.
      expect(bits(pair.live)).toEqual([3])
    } finally {
      pair.free()
    }
  })

  it('restarts instead when something other than level data changed, or the ROM cannot take it', async () => {
    const running = new Uint8Array(readFileSync(file(ROM)))
    expect(planLiveApply(running, running)).toEqual({ kind: 'same' })
    const code = running.slice()
    code[0x200] = code[0x200]! ^ 0xff
    expect(planLiveApply(running, code)).toEqual({ kind: 'restart', reason: 'something other than level data changed' })
    const release = running.slice()
    const magic = Buffer.from(release).indexOf('PECTDBUG')
    release.fill(0, magic, magic + 8)
    expect(planLiveApply(running, release)).toEqual({ kind: 'restart', reason: 'the ROM has no debug record (a release build)' })
    expect(planLiveApply(running, running.slice(0, -4))).toMatchObject({ kind: 'restart' })
  })
})
