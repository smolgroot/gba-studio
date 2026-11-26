// References between entities, checked as codegen checks them (codegen/src/refs.rs).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Project, Room, Tileset, World, validateProject, writeSection } from '@pecten-studio/core'
import type { Documents } from '@pecten-studio/core'

const FIXTURE = fileURLToPath(new URL('../../codegen/fixture/bad-refs/', import.meta.url))

function load(folder: string): Documents {
  const json = (file: string) => JSON.parse(readFileSync(path.join(folder, 'studio', file), 'utf8')) as unknown
  const all = <T>(dir: string, parse: (value: unknown) => T) =>
    Object.fromEntries(readdirSync(path.join(folder, 'studio', dir)).map((f) => [f.slice(0, -5), parse(json(`${dir}/${f}`))]))
  return {
    project: Project.parse(json('project.json')),
    world: World.parse(json('world.json')),
    tilesets: all('tilesets', (v) => Tileset.parse(v)),
    sprites: {},
    rooms: all('rooms', (v) => Room.parse(v)),
  }
}

const expected = readFileSync(path.join(FIXTURE, 'expected.txt'), 'utf8').split('\n').filter(Boolean).sort()

describe('reference problems', () => {
  it('are those codegen reports, in the same words, as errors in Problems', () => {
    const problems = validateProject(load(FIXTURE), () => true)
    expect(problems.map((p) => `${p.file}: ${p.message}`).sort()).toEqual(expected)
    expect(problems.every((p) => p.severity === 'error')).toBe(true)
  })

  it('stop the studio patching a section, in the same words', () => {
    const compiled = { entityTypes: [], tilesets: [{ id: 'tiles', tiles: 16, palettes: 1 }], pictures: [], tracks: [] }
    const result = writeSection(load(FIXTURE), compiled, 1 << 16)
    expect('problems' in result && result.problems.sort()).toEqual(expected)
  })
})
