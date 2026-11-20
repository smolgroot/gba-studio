// Writes `<rom>.debug.json` beside a ROM a build made: where the game keeps its
// state, for tools reading the emulator's memory. See docs/reference/debug-map.md.
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { readDebugMap } from '@pecten-studio/core'
import type { ProjectFolder } from './project.ts'

export const debugMapPath = (rom: string) => `${rom}.debug.json`

/**
 * Writes the map for a ROM, or removes an old one when the ROM has no debug record
 * (a release build). Returns a line for the build log.
 */
export async function writeDebugMap(project: ProjectFolder, rom: string): Promise<string> {
  const file = project.resolve(debugMapPath(rom))
  const result = readDebugMap(new Uint8Array(await readFile(project.resolve(rom))))
  if (!result || 'problem' in result) {
    await rm(file, { force: true })
    return result ? `no debug map: ${result.problem}` : `no debug map: ${rom} has no debug record (release builds leave it out)`
  }
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ rom, ...result.map }, null, 2)}\n`)
  await rename(temporary, file)
  return `debug map: ${debugMapPath(rom)}`
}
