// Runs a ROM without a screen on the Pecten core, the same one the Play panel uses.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HttpError } from './project.ts'
import type { Picture } from './render.ts'

let corePath = fileURLToPath(new URL('../../app/public/wasm/pecten.js', import.meta.url))
/** Points at the core's script, for a host that keeps it somewhere else. Its .wasm is beside it. */
export function setEmulatorCore(file: string): void {
  corePath = file
}

interface Emulator {
  step_frame: () => Uint8Array
  set_pressed_keys: (keys: number) => void
  free: () => void
}
interface Core {
  default: (options: { module_or_path: Uint8Array }) => Promise<unknown>
  WasmEmulator: new (rom: Uint8Array, bootIntro: boolean) => Emulator
}

export const KEY_BITS = { A: 1, B: 2, Select: 4, Start: 8, Right: 16, Left: 32, Up: 64, Down: 128, R: 256, L: 512 } as const
export type Key = keyof typeof KEY_BITS

let core: Promise<Core> | undefined
async function loadCore(): Promise<Core> {
  if (!existsSync(corePath)) throw new HttpError(503, 'the Pecten emulator core is not in app/public/wasm; run scripts/sync-pecten.sh')
  core ??= (async () => {
    const mod = (await import(pathToFileURL(corePath).href)) as Core
    await mod.default({ module_or_path: await readFile(corePath.replace(/\.js$/, '_bg.wasm')) })
    return mod
  })()
  return core
}

export interface Step {
  /** Video frames to run, at 59.73 a second. */
  frames: number
  /** Buttons held for those frames. */
  keys: Key[]
}

/** Boots a ROM and runs the steps in order; returns the screen at the end of each. */
export async function runRom(rom: Uint8Array, steps: Step[]): Promise<Picture[]> {
  const mod = await loadCore()
  const emulator = new mod.WasmEmulator(rom, false)
  try {
    const screens: Picture[] = []
    for (const step of steps) {
      const keys = step.keys.reduce((mask, key) => mask | KEY_BITS[key], 0)
      let pixels: Uint8Array = new Uint8Array(240 * 160 * 4)
      for (let frame = 0; frame < step.frames; frame++) {
        emulator.set_pressed_keys(keys)
        pixels = emulator.step_frame()
      }
      screens.push({ width: 240, height: 160, data: Uint8Array.from(pixels) })
    }
    return screens
  } finally {
    emulator.free()
  }
}
