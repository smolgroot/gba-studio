// The build status reports how much of each ROM's level data section is used (US-006).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSection } from '@pecten-studio/core'
import { Builder } from '../src/build.ts'
import { ProjectFolder } from '../src/project.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))

let folder: string
let builder: Builder

/** A ROM that is only a section header: magic, version 1, no parts, then used and capacity. */
function rom(used: number, capacity: number): Uint8Array {
  const bytes = new Uint8Array(256 + 20 + capacity)
  bytes.set([...'PECTDATA'].map((c) => c.charCodeAt(0)), 256)
  const view = new DataView(bytes.buffer)
  view.setUint16(256 + 8, 1, true)
  view.setUint32(256 + 12, used, true)
  view.setUint32(256 + 16, capacity, true)
  return bytes
}

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-buildstatus-'))
  mkdirSync(path.join(folder, 'studio'))
  const project = JSON.parse(readFileSync(path.join(REPO, 'sample/studio/project.json'), 'utf8'))
  project.build = { ...project.build, devRom: 'dev.gba', releaseRom: 'release.gba' }
  writeFileSync(path.join(folder, 'studio/project.json'), JSON.stringify(project))
  builder = new Builder(new ProjectFolder(folder), () => undefined)
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('level data use in the build status', () => {
  it('gives bytes used and capacity from the section header', async () => {
    writeFileSync(path.join(folder, 'dev.gba'), rom(1200, 4096))
    expect((await builder.status()).roms.dev?.data).toEqual({ used: 1200, capacity: 4096 })
  })

  it('is null for a ROM without a section', async () => {
    writeFileSync(path.join(folder, 'release.gba'), new Uint8Array(1024))
    expect((await builder.status()).roms.release?.data).toBeNull()
  })

  it('follows the ROM when it is rewritten', async () => {
    const file = path.join(folder, 'dev.gba')
    writeFileSync(file, rom(1200, 4096))
    await builder.status()
    writeFileSync(file, rom(2000, 4096))
    // A patch keeps the size; only the time tells the two apart.
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    expect((await builder.status()).roms.dev?.data).toEqual({ used: 2000, capacity: 4096 })
  })

  const sample = path.join(REPO, 'sample/dist/sample-dev.gba')
  it.skipIf(!existsSync(sample))('matches the sample ROM', async () => {
    const bytes = new Uint8Array(readFileSync(sample))
    writeFileSync(path.join(folder, 'dev.gba'), bytes)
    const section = readSection(bytes)
    expect((await builder.status()).roms.dev?.data).toEqual(section ? { used: section.used, capacity: section.capacity } : null)
  })
})
