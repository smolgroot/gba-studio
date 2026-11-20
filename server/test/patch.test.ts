// Patching level data into the sample's built ROM. Needs the sample's dev ROM
// (cd sample && cargo build, then the dev build command) and the emulator core.
import { execFile, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSection, rleDecode, rleEncode } from '@pecten-studio/core'
import { Builder } from '../src/build.ts'
import { runRom, type Step } from '../src/emulator.ts'
import { patchRom } from '../src/patch.ts'
import { ProjectFolder } from '../src/project.ts'
import { TOOLS } from '../src/tools.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const SAMPLE = path.join(REPO, 'sample')
const ROM = 'dist/sample-dev.gba'
const ready = existsSync(path.join(SAMPLE, ROM)) && readSection(new Uint8Array(readFileSync(path.join(SAMPLE, ROM)))) !== null
const core = existsSync(path.join(REPO, 'app/public/wasm/pecten.js'))

let folder: string
let project: ProjectFolder
let builder: Builder
let messages: unknown[]

/** A copy of the sample's project, assets and dev ROM: all a patch needs. */
function copySample(to: string): void {
  for (const part of ['studio', 'assets', ROM]) cpSync(path.join(SAMPLE, part), path.join(to, part), { recursive: true })
}
const doc = (file: string) => JSON.parse(readFileSync(path.join(folder, 'studio', file), 'utf8')) as Record<string, unknown> & { [key: string]: any }
const save = (file: string, json: unknown) => writeFileSync(path.join(folder, 'studio', file), JSON.stringify(json, null, 2))
const rom = () => new Uint8Array(readFileSync(path.join(folder, ROM)))
const screen = async (bytes: Uint8Array, steps: Step[] = [{ frames: 60, keys: [] }]) => Buffer.from((await runRom(bytes, steps)).at(-1)!.data)

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-patch-'))
  copySample(folder)
  project = new ProjectFolder(folder)
  messages = []
  builder = new Builder(project, (message) => messages.push(message))
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe.skipIf(!ready)('patching the sample ROM', () => {
  it('leaves the ROM alone when the data has not changed', async () => {
    const before = rom()
    const result = await patchRom(project, builder)
    expect(result.status).toBe('unchanged')
    expect(Buffer.from(rom()).equals(Buffer.from(before))).toBe(true)
    expect(messages).toEqual([])
  })

  // One edit of each kind the story names; each must show in the game.
  const edits: [string, () => void, Step[]?][] = [
    ['tiles', () => {
      const room = doc('rooms/entry.json')
      const front = room.layers.at(-1)
      const cells = rleDecode(front.data)
      for (let col = 0; col < 12; col++) cells[14 * 60 + col] = 2
      front.data = rleEncode(cells)
      save('rooms/entry.json', room)
    }],
    ['collision', () => {
      // The floor under the hero becomes empty: it falls.
      const room = doc('rooms/entry.json')
      const cells = room.collision ? rleDecode(room.collision) : new Uint16Array(60 * 20)
      for (let col = 0; col < 8; col++) for (let row = 17; row < 20; row++) cells[row * 60 + col] = 1
      room.collision = rleEncode(cells)
      save('rooms/entry.json', room)
    }],
    ['entities', () => {
      const room = doc('rooms/entry.json')
      room.entities.push({ type: 'coin', x: 60, y: 120, props: {} })
      save('rooms/entry.json', room)
    }],
    ['entity properties', () => {
      // A sentry that no longer patrols stands where it was placed.
      const room = doc('rooms/entry.json')
      const sentry = room.entities.find((e: { type: string }) => e.type === 'sentry-bot')
      sentry.props = { ...sentry.props, patrol: 0 }
      save('rooms/entry.json', room)
    }],
    ['world placement', () => {
      // The shaft off the map: hopping right ends at a wall instead of in it.
      const world = doc('world.json')
      world.rooms = world.rooms.filter((r: { room: string }) => r.room !== 'shaft')
      save('world.json', world)
    }, [{ frames: 60, keys: [] }, ...Array.from({ length: 16 }, (_, i): Step => ({ frames: i % 2 ? 12 : 36, keys: i % 2 ? ['Right'] : ['Right', 'A'] })), { frames: 120, keys: ['Right'] }]],
    ['physics', () => {
      const project = doc('project.json')
      project.physics = { ...project.physics, platformer: { ...project.physics?.platformer, jumpSpeed: 1600 } }
      save('project.json', project)
    }, [{ frames: 60, keys: [] }, { frames: 15, keys: ['A'] }]],
  ]
  for (const [what, edit, steps] of edits) {
    it(`patches a change to ${what}, and the game shows it`, { timeout: 30_000 }, async () => {
      const before = rom()
      edit()
      const result = await patchRom(project, builder)
      expect(result.status, JSON.stringify(result)).toBe('patched')
      if (result.status !== 'patched') return
      expect(result.ms).toBeLessThan(500)
      const after = rom()
      const section = readSection(before)!
      // Nothing outside the section changed.
      expect(Buffer.from(after.subarray(0, section.start)).equals(Buffer.from(before.subarray(0, section.start)))).toBe(true)
      expect(Buffer.from(after.subarray(section.start + section.capacity)).equals(Buffer.from(before.subarray(section.start + section.capacity)))).toBe(true)
      expect(messages).toMatchObject([{ type: 'rom-patched' }])
      if (core) expect((await screen(after, steps)).equals(await screen(before, steps)), 'the game looks different').toBe(false)
    })
  }

  it('says when the data no longer fits, and that a build makes room', async () => {
    const room = doc('rooms/entry.json')
    for (let i = 0; i < 400; i++) room.entities.push({ type: 'coin', x: 8 + (i % 400), y: 40, props: {} })
    save('rooms/entry.json', room)
    const result = await patchRom(project, builder)
    expect(result).toMatchObject({ status: 'needs-build', reasons: [expect.stringMatching(/level data is now \d+ bytes and this build of the game has room for \d+; build the game/)] })
  })

  it('says when something the game compiled has changed', async () => {
    const settings = doc('project.json')
    settings.entityTypes.push({ id: 'bat', name: 'Bat', colour: '#000000', props: [] })
    save('project.json', settings)
    expect(await patchRom(project, builder)).toMatchObject({ status: 'needs-build', reasons: ['entity type "bat" is new'] })
  })

  it('stops on a document that does not load', async () => {
    writeFileSync(path.join(folder, 'studio/rooms/entry.json'), '{ not json')
    expect(await patchRom(project, builder)).toMatchObject({ status: 'invalid' })
  })

  it('is a command with exit codes, and a tool for agents', async () => {
    const cli = path.join(REPO, 'server/src/cli.ts')
    const run = promisify(execFile)
    const { stdout } = await run('node', [cli, 'patch', folder, '--json'])
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, status: 'unchanged' })
    const settings = doc('project.json')
    settings.entityTypes.push({ id: 'bat', name: 'Bat', colour: '#000000', props: [] })
    save('project.json', settings)
    const failed = await run('node', [cli, 'patch', folder]).catch((error: { code: number; stdout: string }) => error)
    expect(failed).toMatchObject({ code: 3, stdout: expect.stringContaining('Needs a build: entity type "bat" is new') })

    const tool = TOOLS.find((t) => t.name === 'patch_rom')!
    const answer = await tool.run({ mode: 'dev' } as never, { project, builder })
    expect(answer.text).toContain('Needs a build')
  })
})

// Compiles the sample twice, so it runs only when asked: PECTEN_STUDIO_ROM_TESTS=1.
describe.skipIf(!ready || !process.env.PECTEN_STUDIO_ROM_TESTS)('a patched ROM and a full build', () => {
  it('are the same bytes, for the same data section', { timeout: 900_000 }, async () => {
    // Built in the sample's own target folder, so the files the game includes are at
    // the same paths in both builds. The sample is rebuilt from its own project after.
    const build = (projectFolder: string, out: string) => {
      execFileSync('cargo', ['build'], { cwd: SAMPLE, env: { ...process.env, PECTEN_STUDIO_PROJECT: projectFolder }, stdio: 'ignore' })
      execFileSync('agb-gbafix', [path.join(SAMPLE, 'target/thumbv4t-none-eabi/debug/sample'), '-o', out], { stdio: 'ignore' })
    }
    try {
      build(folder, path.join(folder, ROM))
      // Data edits: a coin added, an entity moved, a property and the physics changed.
      const room = doc('rooms/entry.json')
      room.entities.push({ type: 'coin', x: 60, y: 120, props: {} })
      room.entities[1].x += 8
      save('rooms/entry.json', room)
      const settings = doc('project.json')
      settings.physics = { ...settings.physics, platformer: { ...settings.physics?.platformer, jumpSpeed: 1500 } }
      save('project.json', settings)
      const result = await patchRom(project, builder)
      expect(result.status).toBe('patched')
      if (result.status !== 'patched') return

      // The same project, built in full with the reserve that gives the same capacity.
      settings.build = { ...settings.build, dataReserve: result.capacity - result.used }
      save('project.json', settings)
      const full = path.join(folder, 'full.gba')
      build(folder, full)
      const patched = rom()
      const built = new Uint8Array(readFileSync(full))
      expect(built.length).toBe(patched.length)
      const firstDifference = built.findIndex((byte, i) => byte !== patched[i])
      expect(firstDifference, `first different byte at ${firstDifference}`).toBe(-1)
    } finally {
      execFileSync('cargo', ['build'], { cwd: SAMPLE, stdio: 'ignore' })
    }
  })
})
