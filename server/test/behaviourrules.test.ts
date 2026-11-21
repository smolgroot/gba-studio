// Behaviours on entity types, checked as codegen checks them (codegen/src/behaviours.rs).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BEHAVIOURS, Project, Room, Tileset, World, behaviourDeclaration, behaviourProps, behaviourValues, validateProject } from '@pecten-studio/core'
import type { Documents, EntityType } from '@pecten-studio/core'

const FIXTURE = fileURLToPath(new URL('../../codegen/fixture/bad-behaviours/', import.meta.url))

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

describe('behaviour problems', () => {
  it('are those codegen reports, in the same words', () => {
    const problems = validateProject(load(FIXTURE), () => true).map((p) => `${p.file}: ${p.message}`)
    const expected = readFileSync(path.join(FIXTURE, 'expected.txt'), 'utf8').split('\n').filter(Boolean)
    expect(problems.sort()).toEqual(expected.sort())
  })

  it('are errors, and a behaviour property on a placed entity is not an unknown one', () => {
    const docs = load(FIXTURE)
    expect(validateProject(docs, () => true).every((p) => p.severity === 'error')).toBe(true)
    expect(validateProject(docs, () => true).some((p) => p.message.includes('its type does not define'))).toBe(false)
  })

  it('are none for a type with good settings', () => {
    const docs = load(FIXTURE)
    docs.project!.entityTypes = [{ id: 'bot', name: 'Bot', colour: '#000000', props: [], behaviours: [{ id: 'patrol', props: { patrol: 40 } }, { id: 'hazard', props: {} }] }]
    docs.rooms.a!.entities = [{ type: 'bot', x: 10, y: 10, props: { patrol_pace: 4 } }]
    expect(validateProject(docs, () => true)).toEqual([])
  })
})

describe('behaviour values', () => {
  const type: EntityType = {
    id: 'lift', name: 'Lift', colour: '#000000', props: [],
    behaviours: [{ id: 'moving-platform', props: { travel_y: -64 } }, { id: 'checkpoint', props: {} }],
  }

  it('are the declared properties in order, from the entity, else the type, else the default', () => {
    expect(behaviourValues(type, { travel_pace: 3 })).toEqual([
      { name: 'travel_x', value: 0 },
      { name: 'travel_y', value: -64 },
      { name: 'travel_pace', value: 3 },
    ])
  })

  it('are refused when one is missing or does not fit', () => {
    expect(behaviourValues(type, { travel_pace: 0 })).toBeNull()
    const key: EntityType = { ...type, behaviours: [{ id: 'ability-pickup', props: {} }] }
    expect(behaviourValues(key, {})).toBeNull()
    expect(behaviourValues(key, { grants_ability: 2 })).toEqual([{ name: 'grants_ability', value: 2 }])
  })
})

describe('the behaviour schemas', () => {
  it('list every behaviour by number, each with its properties in order', () => {
    expect(BEHAVIOURS.map((b) => b.number)).toEqual(BEHAVIOURS.map((_, i) => i))
    for (const behaviour of BEHAVIOURS) {
      expect(Object.keys(behaviour.schema.properties).sort()).toEqual([...behaviour.order].sort())
      expect(behaviour.schema.additionalProperties).toBe(false)
    }
    expect(behaviourProps(behaviourDeclaration('moving-platform')!).map((p) => p.name)).toEqual(['travel_x', 'travel_y', 'travel_pace'])
    expect(behaviourDeclaration('ability-pickup')!.schema.required).toEqual(['grants_ability'])
  })
})
