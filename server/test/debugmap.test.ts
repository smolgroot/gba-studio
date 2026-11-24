// The debug map a build writes beside the ROM (US-020). The build command is swapped
// for a shell one-liner, so a "build" finds the sample's dev ROM already built. The
// last test runs that ROM and reads the game's state where the map says it is.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RAM_REGIONS, indexSection, readDebugMap, readGameState, readLive, writeLive } from '@pecten-studio/core'
import type { DebugMap, LiveEntityRow, LivePlayer, LiveView } from '@pecten-studio/core'
import { Builder } from '../src/build.ts'
import { ProjectFolder } from '../src/project.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const SAMPLE = path.join(REPO, 'sample')
const ROM = 'dist/sample-dev.gba'
const RELEASE = 'dist/sample.gba'
const CORE = path.join(REPO, 'app/public/wasm/pecten.js')
const ready = existsSync(path.join(SAMPLE, ROM)) && readDebugMap(new Uint8Array(readFileSync(path.join(SAMPLE, ROM)))) !== null

let folder: string
let builder: Builder
const file = (rel: string) => path.join(folder, rel)
const map = (rom: string) => JSON.parse(readFileSync(file(`${rom}.debug.json`), 'utf8')) as DebugMap & { rom: string }
const setBuild = (mode: 'dev' | 'release', command: string) => {
  const settings = JSON.parse(readFileSync(file('studio/project.json'), 'utf8'))
  settings.build[mode] = command
  writeFileSync(file('studio/project.json'), JSON.stringify(settings, null, 2))
}

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-debugmap-'))
  for (const part of ['studio', 'assets', ROM]) cpSync(path.join(SAMPLE, part), file(part), { recursive: true })
  builder = new Builder(new ProjectFolder(folder), () => undefined)
  setBuild('dev', 'true')
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe.skipIf(!ready)('the debug map a build writes', () => {
  it('is written beside the dev ROM, with the state block and its layout', async () => {
    const lines: string[] = []
    expect((await builder.run('dev', (line) => lines.push(line))).exitCode).toBe(0)
    expect(lines).toContain(`debug map: ${ROM}.debug.json`)
    const written = map(ROM)
    expect(written.rom).toBe(ROM)
    expect(written.version).toBe(5)
    expect(written.startOverride?.size).toBe(16)
    expect(written.inbox?.size).toBe(12)
    expect(written.entities?.slot.size).toBe(108)
    const ewram = RAM_REGIONS.ewram
    expect(written.state.address).toBeGreaterThanOrEqual(ewram.start)
    expect(written.state.address + written.state.size).toBeLessThanOrEqual(ewram.start + ewram.size)
    expect(written.state.fields.map((f) => f.name)).toEqual(['stamp', 'frame', 'room', 'cameraX', 'cameraY', 'player', 'collected', 'collectedWords'])
    expect(written.body.fields.map((f) => f.name)).toContain('vx')
    expect(written.dataSection?.address).toBeGreaterThan(0x0800_0000)
  })

  it('is left out for a ROM without a debug record, as release builds are, and an old one is removed', async () => {
    writeFileSync(file(`${RELEASE}.debug.json`), '{}')
    setBuild('release', `head -c 65536 /dev/zero > ${RELEASE}`)
    const lines: string[] = []
    expect((await builder.run('release', (line) => lines.push(line))).exitCode).toBe(0)
    expect(existsSync(file(`${RELEASE}.debug.json`))).toBe(false)
    expect(lines).toContain(`no debug map: ${RELEASE} has no debug record (release builds leave it out)`)
    // The dev ROM's map is its own file, untouched by the release build.
    await builder.run('dev')
    expect(existsSync(file(`${ROM}.debug.json`))).toBe(true)
  })

  it('is left alone by a build that fails', async () => {
    writeFileSync(file(`${ROM}.debug.json`), '{"kept":true}')
    setBuild('dev', 'false')
    expect((await builder.run('dev')).exitCode).toBe(1)
    expect(readFileSync(file(`${ROM}.debug.json`), 'utf8')).toBe('{"kept":true}')
  })

  describe.skipIf(!existsSync(CORE))('read from the running game', () => {
    /** EWRAM, out of an emulator save state: it is saved as its length, 256 KiB, then its bytes, then IWRAM's length. */
    function ewram(state: Uint8Array): Uint8Array {
      const view = new DataView(state.buffer, state.byteOffset, state.byteLength)
      const size = RAM_REGIONS.ewram.size
      for (let at = 0; at + 8 + size <= state.length; at++) {
        if (view.getUint32(at, true) === size && view.getUint32(at + 4 + size, true) === RAM_REGIONS.iwram.size) return state.subarray(at + 4, at + 4 + size)
      }
      throw new Error('no EWRAM in the save state')
    }

    it('holds the stamp, the start room and the hero where the map says, and follows the hero', async () => {
      await builder.run('dev')
      const debug = map(ROM)
      const mod = await import(pathToFileURL(CORE).href)
      await mod.default({ module_or_path: await readFile(CORE.replace(/\.js$/, '_bg.wasm')) })
      const emulator = new mod.WasmEmulator(new Uint8Array(readFileSync(file(ROM))), false)
      const state = () => {
        const at = debug.state.address - RAM_REGIONS.ewram.start
        return readGameState(debug, ewram(emulator.save_state()).subarray(at, at + debug.state.size)) as any
      }
      try {
        for (let i = 0; i < 120; i++) emulator.step_frame()
        const start = state()
        // The sample's start room is "entry", the first room by id; its player start is at (24, 136).
        expect(start.stamp).toBe(0x53475350)
        expect(start.room).toBe(0)
        const world = JSON.parse(readFileSync(file('studio/world.json'), 'utf8'))
        const entry = world.rooms.find((r: { room: string }) => r.room === 'entry')
        // A world cell is one screen.
        const origin = { x: entry.x * 240, y: entry.y * 160 }
        expect(start.player).toMatchObject({ x: origin.x + 24 - Math.floor(start.player.w / 2), y: origin.y + 136 - start.player.h, onGround: true })
        expect(start.collectedWords).toBeGreaterThan(0)
        // The collected bits are a local of the game's `main`, so on the stack in IWRAM.
        const inRam = Object.values(RAM_REGIONS).some((r) => start.collected >= r.start && start.collected + 4 * start.collectedWords <= r.start + r.size)
        expect(inRam).toBe(true)

        for (let i = 0; i < 60; i++) {
          emulator.set_pressed_keys(16) // Right
          emulator.step_frame()
        }
        const after = state()
        expect(after.frame - start.frame).toBe(60)
        expect(after.player.x).toBeGreaterThan(start.player.x)
      } finally {
        emulator.free()
      }
    })

    it('lists the player first, then the start room\'s entities where they were placed, and follows them', async () => {
      await builder.run('dev')
      const debug = map(ROM)
      const bytes = new Uint8Array(readFileSync(file(ROM)))
      const section = indexSection(bytes)
      const mod = await import(pathToFileURL(CORE).href)
      await mod.default({ module_or_path: await readFile(CORE.replace(/\.js$/, '_bg.wasm')) })
      const emulator = new mod.WasmEmulator(bytes, false)
      try {
        for (let i = 0; i < 120; i++) emulator.step_frame()
        const start = readLive(emulator, debug, section)
        if (start.state !== 'running') throw new Error(`expected a running game, got ${JSON.stringify(start)}`)
        expect(start.note).toBeNull()
        expect(start.room).toBe('entry')
        expect(start.rows[0]!.kind).toBe('player')
        // The start room and the room touching it, shaft, are active. Entities are
        // numbered room after room, by room id. The player start leaves the table on the
        // first frame; everything else is listed where it was placed (coins and diamonds
        // do not move).
        const world = JSON.parse(readFileSync(file('studio/world.json'), 'utf8'))
        const placed = ['entry', 'shaft'].flatMap((id) => {
          const room = JSON.parse(readFileSync(file(`studio/rooms/${id}.json`), 'utf8'))
          const place = world.rooms.find((r: { room: string }) => r.room === id)
          return (room.entities as { type: string; x: number; y: number }[]).map((e) => ({ ...e, room: id, x: place.x * 240 + e.x, y: place.y * 160 + e.y }))
        }).map((e, index) => ({ ...e, index })).filter((e) => e.type !== 'player-start')
        const entities = start.rows.slice(1) as LiveEntityRow[]
        expect(entities.map((e) => [e.index, e.type, e.room])).toEqual(placed.map((e) => [e.index, e.type, e.room]))
        for (const e of placed.filter((e) => e.type === 'coin' || e.type === 'diamond')) {
          expect(entities.find((row) => row.index === e.index)).toMatchObject({ x: e.x, y: e.y })
        }
        const sentry = (rows: typeof start.rows) => rows.find((r) => r.kind === 'entity' && r.type === 'sentry-bot') as LiveEntityRow
        expect(sentry(start.rows).properties.map((p) => p.name)).toContain('patrol')

        for (let i = 0; i < 60; i++) {
          emulator.set_pressed_keys(16) // Right
          emulator.step_frame()
        }
        const after = readLive(emulator, debug, section)
        if (after.state !== 'running') throw new Error('expected a running game')
        expect(after.frame - start.frame).toBe(60)
        expect(after.rows[0]!.x).toBeGreaterThan(start.rows[0]!.x)
        expect(sentry(after.rows).x).not.toBe(sentry(start.rows).x)
      } finally {
        emulator.free()
      }
    })

    it('takes a value changed in the list on the next frame', async () => {
      await builder.run('dev')
      const debug = map(ROM)
      const bytes = new Uint8Array(readFileSync(file(ROM)))
      const section = indexSection(bytes)
      const mod = await import(pathToFileURL(CORE).href)
      await mod.default({ module_or_path: await readFile(CORE.replace(/\.js$/, '_bg.wasm')) })
      const emulator = new mod.WasmEmulator(bytes, false)
      const read = () => {
        const live: LiveView = readLive(emulator, debug, section)
        if (live.state !== 'running') throw new Error(`expected a running game, got ${JSON.stringify(live)}`)
        return { live, player: live.rows[0] as LivePlayer, entity: (index: number) => live.rows.find((r) => r.kind === 'entity' && r.index === index) as LiveEntityRow | undefined }
      }
      const change = (target: 'player' | number, field: string, value: number | boolean) => expect(writeLive(emulator, debug, target, field, value)).toBeNull()
      try {
        for (let i = 0; i < 120; i++) emulator.step_frame()

        // A coin moved onto the player's feet is taken on the next frame: it leaves
        // the list and its collected bit is set.
        let now = read()
        const coin = now.live.rows.find((r) => r.kind === 'entity' && r.type === 'coin') as LiveEntityRow
        change(coin.index, 'x', now.player.x + Math.floor(now.player.w / 2))
        change(coin.index, 'y', now.player.y + now.player.h)
        emulator.step_frame()
        now = read()
        expect(now.entity(coin.index)).toBeUndefined()
        const block = readGameState(debug, emulator.read_ram(debug.state.address, debug.state.size)) as any
        const bits = emulator.read_ram(block.collected, block.collectedWords * 4)
        expect(bits[coin.index >> 3]! & (1 << (coin.index & 7))).not.toBe(0)

        // The sentry walks around its home: moving the home 40 pixels moves it 40.
        const sentry = now.live.rows.find((r) => r.kind === 'entity' && r.type === 'sentry-bot') as LiveEntityRow
        change(sentry.index, 'homeX', sentry.home!.x + 40)
        emulator.step_frame()
        now = read()
        expect(Math.abs(now.entity(sentry.index)!.x - (sentry.x + 40))).toBeLessThanOrEqual(1)

        // Taking an entity out by clearing alive.
        const other = now.live.rows.find((r) => r.kind === 'entity' && r.index !== sentry.index) as LiveEntityRow
        change(other.index, 'alive', false)
        emulator.step_frame()
        expect(read().entity(other.index)).toBeUndefined()

        // The player, standing still on the floor, moved 30 pixels right.
        const x = read().player.x + 30
        change('player', 'x', x)
        emulator.step_frame()
        expect(read().player.x).toBe(x)
        // The sample calls debug::apply_player_edit, so nothing is left waiting.
        expect(read().live.playerEditWaiting).toBe(false)
      } finally {
        emulator.free()
      }
    })
  })
})
