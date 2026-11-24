// Entity types as prefabs (US-014): a placed entity stores only what differs from its type.
import { describe, expect, it } from 'vitest'
import { emptyRoom, entityOverride, newProject, overriddenProps, redundantProps, shownEntityValue, typeValue, writeSection } from '../src/index.ts'
import { FORMAT_VERSION, Tileset } from '../src/index.ts'
import type { EntityType, Manifest } from '../src/index.ts'
import { readPlacements, readSection } from '../src/datasection.ts'
import type { Documents } from '../src/validate.ts'

/** A sentry with two properties of its own and a patrol: 40 steps, the default pace of 2. */
const sentry: EntityType = {
  id: 'sentry',
  name: 'Sentry',
  colour: '#e5484d',
  props: [
    { name: 'mood', type: 'enum', default: 'calm', options: ['calm', 'angry'] },
    { name: 'shield', type: 'int', default: 3 },
    { name: 'armed', type: 'bool', default: false },
  ],
  behaviours: [{ id: 'patrol', props: { patrol: 40 } }],
}

describe('what a type gives', () => {
  it('is the default of its own property, the type\'s value for a behaviour\'s, or the behaviour\'s default', () => {
    expect(typeValue(sentry, 'shield')).toBe(3)
    expect(typeValue(sentry, 'patrol')).toBe(40)
    expect(typeValue(sentry, 'patrol_pace')).toBe(2)
  })

  it('is nothing for a name the type does not have, or a required value nobody sets', () => {
    expect(typeValue(sentry, 'colour')).toBeUndefined()
    const pickup: EntityType = { ...sentry, behaviours: [{ id: 'ability-pickup', props: {} }] }
    expect(typeValue(pickup, 'grants_ability')).toBeUndefined()
  })
})

describe('a placed entity\'s value', () => {
  it('is the type\'s until the entity sets its own, and says what it would be without it', () => {
    expect(shownEntityValue(sentry, {}, 'shield')).toEqual({ value: 3, inherited: 3, overridden: false })
    expect(shownEntityValue(sentry, { shield: 9 }, 'shield')).toEqual({ value: 9, inherited: 3, overridden: true })
    expect(shownEntityValue(sentry, { patrol: 8 }, 'patrol')).toEqual({ value: 8, inherited: 40, overridden: true })
    // A value set to false is a value, not nothing.
    expect(shownEntityValue({ ...sentry, props: [{ name: 'armed', type: 'bool', default: true }] }, { armed: false }, 'armed')).toEqual({ value: false, inherited: true, overridden: true })
  })

  it('is stored when it differs from the type\'s, for an own property and for a behaviour\'s', () => {
    expect(entityOverride(sentry, {}, 'shield', 9)).toEqual({ shield: 9 })
    expect(entityOverride(sentry, { shield: 9 }, 'mood', 'angry')).toEqual({ shield: 9, mood: 'angry' })
    expect(entityOverride(sentry, {}, 'armed', true)).toEqual({ armed: true })
    expect(entityOverride(sentry, {}, 'patrol_pace', 3)).toEqual({ patrol_pace: 3 })
  })

  it('is not stored when it equals what the type gives: the entity follows the type', () => {
    expect(entityOverride(sentry, { shield: 9 }, 'shield', 3)).toEqual({})
    expect(entityOverride(sentry, {}, 'mood', 'calm')).toEqual({})
    expect(entityOverride(sentry, {}, 'armed', false)).toEqual({})
    // The type's 40, not the behaviour's default of 32.
    expect(entityOverride(sentry, {}, 'patrol', 40)).toEqual({})
    expect(entityOverride(sentry, {}, 'patrol', 32)).toEqual({ patrol: 32 })
    expect(entityOverride(sentry, {}, 'patrol_pace', 2)).toEqual({})
  })

  it('goes back to the type\'s with a reset, and leaves the others alone', () => {
    expect(entityOverride(sentry, { shield: 9, mood: 'angry' }, 'shield', undefined)).toEqual({ mood: 'angry' })
    expect(entityOverride(sentry, { mood: 'angry' }, 'shield', undefined)).toEqual({ mood: 'angry' })
  })
})

describe('the props that are written', () => {
  const props = { shield: 3, mood: 'angry', patrol: 40, patrol_pace: 3, ghost: 1 }

  it('name the redundant values, in order', () => {
    expect(redundantProps(sentry, props)).toEqual(['shield', 'patrol'])
    expect(redundantProps(sentry, {})).toEqual([])
  })

  it('are left with the ones that differ, and a name the type does not have, which validation reports', () => {
    expect(overriddenProps(sentry, props)).toEqual({ mood: 'angry', patrol_pace: 3, ghost: 1 })
    expect(overriddenProps(sentry, { shield: 4 })).toEqual({ shield: 4 })
  })
})

// The values the game is given, read back from the section a project is written as.
describe('copies that kept the type\'s value', () => {
  const manifest: Manifest = { entityTypes: [{ id: 'sentry', sprite: null }], tilesets: [{ id: 'none', tiles: 1, palettes: 1 }], pictures: [], tracks: [] }
  const docsWith = (type: EntityType, entityProps: Record<string, number | boolean | string>[]): Documents => {
    const room = { ...emptyRoom('Hall', 1, 1, 'none'), entities: entityProps.map((props, n) => ({ type: 'sentry', x: 10 + n, y: 10, props })) }
    const { project, world, audio } = newProject('Test')
    return {
      project: { ...project, entityTypes: [type] },
      world,
      audio,
      tilesets: { none: Tileset.parse({ version: FORMAT_VERSION, name: 'None', image: 'assets/none.png' }) },
      sprites: {},
      rooms: { hall: room },
    }
  }
  const valuesOf = (type: EntityType, entityProps: Record<string, number | boolean | string>[]) => {
    const written = writeSection(docsWith(type, entityProps), manifest, 4096)
    if ('problems' in written) throw new Error(written.problems.join('; '))
    // The section is read where it sits in a ROM that holds only it.
    const rom = new Uint8Array(written.bytes)
    const section = readSection(rom)!
    return readPlacements(rom, section).entities.map((e) => Object.fromEntries(e.properties.map((p) => [p.name, p.value])))
  }

  it('are given the type\'s value, and a changed default reaches the ones that stored nothing', () => {
    const before = valuesOf(sentry, [{}, { shield: 7 }])
    expect(before.map((v) => v.shield)).toEqual([3, 7])
    const raised = { ...sentry, props: sentry.props.map((p) => (p.name === 'shield' ? { ...p, default: 5 } : p)) }
    const after = valuesOf(raised, [{}, { shield: 7 }])
    expect(after.map((v) => v.shield)).toEqual([5, 7])
  })

  it('are the same bytes whether the value is stored or not, as long as it matches the type', () => {
    const stored = writeSection(docsWith(sentry, [{ shield: 3, mood: 'calm', patrol: 40 }]), manifest, 4096)
    const left = writeSection(docsWith(sentry, [{}]), manifest, 4096)
    if ('problems' in stored || 'problems' in left) throw new Error('did not write')
    expect(Array.from(stored.bytes)).toEqual(Array.from(left.bytes))
  })
})
