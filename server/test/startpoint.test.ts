// "Play from here" (US-005) on the sample's dev ROM: the game starts in the room and
// at the spot the studio wrote into the emulator's copy of the ROM, and the file is
// untouched. Needs the dev ROM built with record version 3 (`pecten-studio build`).
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readDebugMap, readGameState, roomIndexOf, spotOfTile, startAt, startOverridePatch } from '@pecten-studio/core'
import type { DebugMap } from '@pecten-studio/core'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const ROM = path.join(REPO, 'sample/dist/sample-dev.gba')
const CORE = path.join(REPO, 'app/public/wasm/pecten.js')
const bytes = () => new Uint8Array(readFileSync(ROM))
const mapOf = (rom: Uint8Array) => {
  const result = readDebugMap(rom)
  return result && 'map' in result ? result.map : null
}
const ready = existsSync(ROM) && !!mapOf(bytes())?.startOverride && existsSync(CORE)

interface Emulator {
  step_frame(): Uint8Array
  read_ram(addr: number, len: number): Uint8Array
  patch_rom(offset: number, data: Uint8Array): void
  free(): void
}
type Core = { default: (o: { module_or_path: Uint8Array }) => Promise<unknown>; WasmEmulator: new (rom: Uint8Array, intro: boolean) => Emulator }

describe('the start override', () => {
  it('is the tile the author clicked, as an entity stands there', () => {
    expect(spotOfTile('shaft', 3, 4)).toEqual({ room: 'shaft', x: 28, y: 40 })
  })

  it('numbers rooms as the data section does, by sorted id', () => {
    expect(roomIndexOf(['shaft', 'entry', 'kitchen'], 'shaft')).toBe(2)
    expect(roomIndexOf(['entry'], 'nowhere')).toBe(-1)
  })

  it('writes set, room, x and y at the record, and nothing else', () => {
    const rom = new Uint8Array(0x400)
    new DataView(rom.buffer).setUint32(0x100 + 8, 3, true)
    rom.set([...'PECTDBUG'].map((c) => c.charCodeAt(0)), 0x100)
    const view = new DataView(rom.buffer)
    view.setUint32(0x100 + 12, 0x0200_0000, true)
    view.setUint32(0x100 + 16, 64, true)
    view.setUint32(0x100 + 20, 0x0200_0040, true)
    view.setUint32(0x100 + 24, 12, true)
    const map = mapOf(rom)!
    const patch = startOverridePatch(2, { x: 28, y: -8 }, map)
    if ('problem' in patch) throw new Error(patch.problem)
    expect(patch.offset).toBe(0x100 + 28)
    expect([...new Int32Array(patch.bytes.buffer)]).toEqual([1, 2, 28, -8])
  })

  it('says why a ROM cannot start anywhere else', () => {
    const none = { patch_rom: () => { throw new Error('written') } }
    expect(startAt(none, null, ['entry'], { room: 'entry', x: 0, y: 0 })).toEqual({ problem: expect.stringContaining('no debug record') })
    const old = { startOverride: null } as DebugMap
    expect(startAt(none, old, ['entry'], { room: 'entry', x: 0, y: 0 })).toEqual({ problem: expect.stringContaining('build the dev game again') })
  })
})

describe.skipIf(!ready)('Play from here on the sample', () => {
  it('starts in the chosen room at the chosen spot, and a release-style start is unchanged', async () => {
    const mod = (await import(pathToFileURL(CORE).href)) as Core
    await mod.default({ module_or_path: await readFile(CORE.replace(/\.js$/, '_bg.wasm')) })
    const rom = bytes()
    const map = mapOf(rom)!
    const rooms = ['entry', 'shaft']
    const run = (spot?: { room: string; x: number; y: number }) => {
      const emulator = new mod.WasmEmulator(rom, false)
      try {
        if (spot) expect(startAt(emulator, map, rooms, spot)).toBeNull()
        for (let i = 0; i < 10; i++) emulator.step_frame()
        return readGameState(map, emulator.read_ram(map.state.address, map.state.size)) as any
      } finally {
        emulator.free()
      }
    }
    const normal = run()
    const there = run(spotOfTile('shaft', 3, 4))
    expect(normal.room).toBe(roomIndexOf(rooms, 'entry'))
    expect(there.room).toBe(roomIndexOf(rooms, 'shaft'))
    // The shaft is at column 5 of the world grid (240 px a screen): the feet start at its x 28.
    expect(there.player.x + Math.trunc(there.player.w / 2)).toBe(5 * 240 + 28)
    expect(there.player.y + there.player.h).toBeGreaterThanOrEqual(40)
    expect(normal.player.x).not.toBe(there.player.x)
    // The file was not touched.
    expect(bytes()).toEqual(rom)
  })
})
