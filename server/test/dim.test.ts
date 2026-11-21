// Darkening layers through the MCP tools: what is saved, what comes back, and that the pictures stay as they were.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { dimBgr555 } from '@pecten-studio/core'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Builder } from '../src/build.ts'
import { ProjectFolder } from '../src/project.ts'
import { TOOLS } from '../src/tools.ts'
import type { ToolContext } from '../src/tools.ts'

let folder: string
let context: ToolContext

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-dim-'))
  const project = new ProjectFolder(folder)
  await project.init('Test')
  context = { project, builder: new Builder(project, () => {}) }
  const sky = new PNG({ width: 16, height: 16 })
  sky.data.fill(200)
  mkdirSync(path.join(folder, 'assets/backgrounds'), { recursive: true })
  writeFileSync(path.join(folder, 'assets/backgrounds/sky.png'), PNG.sync.write(sky))
  await call('tileset_generate', { name: 'Meadow' })
  await call('room_generate', { name: 'First', tileset: 'meadow', style: 'halls', width: 1, height: 1, seed: 3 })
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const call = (name: string, args: Record<string, unknown>) => {
  const tool = TOOLS.find((t) => t.name === name)!
  return tool.run(tool.input.parse(args) as never, context)
}
const room = () => JSON.parse(readFileSync(path.join(folder, 'studio/rooms/first.json'), 'utf8'))
const hash = () => createHash('sha256').update(readFileSync(path.join(folder, 'assets/backgrounds/sky.png'))).digest('hex')

describe('room_update dimming', () => {
  it('sets the level, the tile layers and a background, and says what is left to fix', async () => {
    const before = hash()
    await call('room_update', { room: 'first', backgrounds: [{ image: 'assets/backgrounds/sky.png', parallax: { x: 25, y: 0 }, dim: true }] })
    const answer = await call('room_update', { room: 'first', dimLevel: 8, dimLayers: [0] })
    expect(answer.text).not.toContain('no layer is dimmed')
    expect(answer.text).not.toContain('nothing is darkened')
    const saved = room()
    expect(saved.dimLevel).toBe(8)
    expect(saved.layers[0].dim).toBe(true)
    expect(saved.layers.slice(1).every((l: { dim?: boolean }) => !l.dim)).toBe(true)
    expect(saved.backgrounds[0].dim).toBe(true)
    // The picture is only read.
    expect(hash()).toBe(before)
  })

  it('names layers by name and replaces the set each time', async () => {
    const name = room().layers[0].name
    await call('room_update', { room: 'first', dimLevel: 4, dimLayers: [name] })
    expect(room().layers[0].dim).toBe(true)
    await call('room_update', { room: 'first', dimLayers: [] })
    expect(room().layers.some((l: { dim?: boolean }) => l.dim)).toBe(false)
  })

  it('reports a level with no dimmed layer, and a dimmed layer with level 0, in the answer', async () => {
    const level = await call('room_update', { room: 'first', dimLevel: 5 })
    expect(level.text).toContain('no layer is dimmed, so the dim level 5 does nothing')
    await call('room_update', { room: 'first', dimLevel: 0, dimLayers: [0] })
    const zero = await call('room_update', { room: 'first', dimLayers: [0] })
    expect(zero.text).toContain('is set to dim, but the dim level is 0')
  })

  it('refuses a layer that is not there, and a level above 16, with what to do', async () => {
    await expect(call('room_update', { room: 'first', dimLayers: [9] })).rejects.toThrow(/no layer 9; layers are: 0 "/)
    expect(() => call('room_update', { room: 'first', dimLevel: 17 })).toThrow()
  })

  it('level 0 leaves the field out, as a project from before dimming', async () => {
    await call('room_update', { room: 'first', dimLevel: 6, dimLayers: [0] })
    await call('room_update', { room: 'first', dimLevel: 0, dimLayers: [] })
    expect('dimLevel' in room()).toBe(false)
  })

  it('shows in the overview', async () => {
    await call('room_update', { room: 'first', dimLevel: 3, dimLayers: [0] })
    const overview = JSON.parse((await call('project_overview', {})).text)
    expect(overview.rooms.first.dimLevel).toBe(3)
    expect(overview.rooms.first.layers[0]).toMatch(/\(dimmed\)$/)
  })
})

describe('dim preview rounding', () => {
  it('matches the fixture the runtime is tested against, which is the console\'s rounding', () => {
    const { cases } = JSON.parse(readFileSync(new URL('../../codegen/fixture/dim.json', import.meta.url), 'utf8')) as { cases: { level: number; in: number; out: number }[] }
    expect(cases.length).toBeGreaterThan(100)
    for (const c of cases) expect(dimBgr555(c.in, c.level), `${c.in} at ${c.level}`).toBe(c.out)
  })
})
