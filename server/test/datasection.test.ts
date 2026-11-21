// The level data section in a built ROM: tools find it by its magic number, and what
// the game plays comes from it. Runs on the sample's dev ROM when it has been built.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runRom, type Step } from '../src/emulator.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const ROM = path.join(REPO, 'sample/dist/sample-dev.gba')
const CORE = path.join(REPO, 'app/public/wasm/pecten.js')
const MAGIC = Buffer.from('PECTDATA')

/** The layout of runtime/src/data/layout.rs and docs/reference/data-section.md. */
const HEADER = 20
const SECTIONS = 9
const GLOBALS = 6
const PHYSICS = 8
/** Physics fields are i32s after the globals' first 8 bytes; this is the jump speed. */
const JUMP_SPEED = 8

function find(rom: Buffer): number[] {
  const found: number[] = []
  for (let at = rom.indexOf(MAGIC); at >= 0; at = rom.indexOf(MAGIC, at + 1)) found.push(at)
  return found
}

describe.skipIf(!existsSync(ROM))('the data section of the sample ROM', () => {
  const rom = readFileSync(ROM)

  it('is there once, 4-aligned, with a header and a table that fit it', () => {
    const found = find(rom)
    expect(found, 'no data section: rebuild the sample (cd sample && cargo build)').toHaveLength(1)
    const start = found[0]!
    expect(start % 4).toBe(0)
    expect(rom.readUInt16LE(start + 8)).toBe(1)
    expect(rom.readUInt16LE(start + 10)).toBe(SECTIONS)
    const used = rom.readUInt32LE(start + 12)
    const capacity = rom.readUInt32LE(start + 16)
    expect(capacity).toBeGreaterThanOrEqual(used + 4096)
    expect(start + capacity).toBeLessThanOrEqual(rom.length)
    for (let n = 0; n < SECTIONS; n++) {
      const offset = rom.readUInt32LE(start + HEADER + n * 8)
      const length = rom.readUInt32LE(start + HEADER + n * 8 + 4)
      expect(offset % 4).toBe(0)
      expect(offset + length).toBeLessThanOrEqual(used)
    }
    expect(rom.subarray(start + used, start + capacity).every((byte) => byte === 0)).toBe(true)
  })

  // Proves the game reads the section at run time, rather than having its values
  // built into the code, where patching the ROM would not reach them.
  it.skipIf(!existsSync(CORE))('drives the game: a patched jump speed jumps differently', async () => {
    const start = find(rom)[0]!
    const globals = start + rom.readUInt32LE(start + HEADER + GLOBALS * 8)
    const field = globals + PHYSICS + JUMP_SPEED * 4
    const patched = Buffer.from(rom)
    patched.writeInt32LE((rom.readInt32LE(field) * 3) >> 1, field)
    const walk: Step[] = [
      { frames: 60, keys: [] },
      // Mid-jump: a stronger jump is higher by now. (Walking right soon meets a wall at any speed.)
      { frames: 15, keys: ['A'] },
    ]
    const [before] = (await runRom(rom, walk)).slice(-1)
    const [after] = (await runRom(patched, walk)).slice(-1)
    const [again] = (await runRom(rom, walk)).slice(-1)
    expect(Buffer.from(before!.data).equals(Buffer.from(again!.data)), 'runs are repeatable').toBe(true)
    expect(Buffer.from(before!.data).equals(Buffer.from(after!.data)), 'the patched speed shows').toBe(false)
  })
})
