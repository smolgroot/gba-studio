// An entity type's own properties (US-016): the definitions the interface edits, the
// stored values a change breaks, and the changes that reach the rooms.
import { describe, expect, it } from 'vitest'
import {
  I32_MAX, I32_MIN, PROPERTY_TYPES, PropertyDef, behaviourBlocker, dropMisfits, editProperty, emptyRoom, entityOverride, newMisfits, newProject, newProperty, propertyAllows, propertyMisfit, propertyMisfits,
  propertyNameProblem, propertyUsage, renameProperty, validateProject, withLimits, withOptions, withPropertyType, withoutProperty,
} from '../src/index.ts'
import type { Documents, EntityType, PropertyDef as Def, Room } from '../src/index.ts'

const sentry: EntityType = {
  id: 'sentry',
  name: 'Sentry',
  colour: '#e5484d',
  props: [
    { name: 'mood', type: 'enum', default: 'calm', options: ['calm', 'angry'] },
    { name: 'shield', type: 'int', default: 3, min: 0, max: 9 },
    { name: 'armed', type: 'bool', default: false },
    { name: 'label', type: 'string', default: '' },
  ],
  behaviours: [{ id: 'patrol', props: {} }],
}

/** Two rooms with sentries and a coin, storing values as the interface would. */
const rooms = (): Record<string, Room> => ({
  entry: { ...emptyRoom('Entry', 1, 1, 'ts'), entities: [
    { type: 'sentry', x: 10, y: 10, props: { mood: 'angry', shield: 7 } },
    { type: 'coin', x: 20, y: 10, props: { mood: 'loud' } },
    { type: 'sentry', x: 30, y: 10, props: {} },
  ] },
  shaft: { ...emptyRoom('Shaft', 1, 1, 'ts'), entities: [{ type: 'sentry', x: 5, y: 5, props: { armed: true, label: 'north' } }] },
  attic: { ...emptyRoom('Attic', 1, 1, 'ts'), entities: [{ type: 'coin', x: 5, y: 5, props: {} }] },
})

describe('a property definition', () => {
  it('can be an int with limits, a bool, text or one of a list: all four parse', () => {
    for (const def of sentry.props) expect(PropertyDef.safeParse(def).success, def.name).toBe(true)
    expect(PROPERTY_TYPES.map((t) => t.value)).toEqual(['int', 'bool', 'string', 'enum', 'ref'])
  })

  it('takes min and max only on an int, in order, with the default between', () => {
    const base: Def = { name: 'n', type: 'int', default: 5 }
    expect(PropertyDef.safeParse({ ...base, min: 0, max: 9 }).success).toBe(true)
    expect(PropertyDef.safeParse({ ...base, min: 5, max: 5 }).success).toBe(true)
    expect(PropertyDef.safeParse({ ...base, min: 9, max: 0 }).error?.issues[0]?.message).toBe('min is more than max')
    expect(PropertyDef.safeParse({ ...base, min: 6 }).error?.issues[0]?.message).toBe('default is outside min and max')
    expect(PropertyDef.safeParse({ ...base, max: 4 }).error?.issues[0]?.message).toBe('default is outside min and max')
    expect(PropertyDef.safeParse({ name: 'b', type: 'bool', default: true, min: 0 }).error?.issues[0]?.message).toBe('min and max go with type "int", and only with it')
    expect(PropertyDef.safeParse({ ...base, max: I32_MAX + 1 }).success).toBe(false)
    expect(PropertyDef.safeParse({ ...base, min: I32_MIN - 1 }).success).toBe(false)
    // As before: no limits is fine, so older projects load as they were.
    expect(PropertyDef.safeParse(base).success).toBe(true)
  })
})

describe('what a definition allows', () => {
  it('says so in words', () => {
    expect(propertyAllows(sentry.props[0]!)).toBe('one of calm, angry')
    expect(propertyAllows(sentry.props[1]!)).toBe('a whole number from 0 to 9')
    // A limit left out is the edge of 32 bits, so a value past it is never told it satisfies the limit it broke.
    expect(propertyAllows({ name: 'a', type: 'int', default: 0, min: 1 })).toBe('a whole number from 1 to 2147483647')
    expect(propertyAllows({ name: 'a', type: 'int', default: 0, max: 1 })).toBe('a whole number from -2147483648 to 1')
    expect(propertyAllows({ name: 'a', type: 'int', default: 0 })).toBe('a whole number that fits in 32 bits')
    expect(propertyAllows(sentry.props[2]!)).toBe('true or false')
    expect(propertyAllows(sentry.props[3]!)).toBe('text')
  })

  it('accepts what fits and says what does not, naming the property and the value', () => {
    expect(propertyMisfit(sentry.props[0]!, 'angry')).toBeNull()
    expect(propertyMisfit(sentry.props[0]!, 'loud')).toBe('mood is "loud"; it is one of calm, angry')
    expect(propertyMisfit(sentry.props[0]!, 3)).toBe('mood is 3; it is one of calm, angry')
    expect(propertyMisfit(sentry.props[1]!, 9)).toBeNull()
    expect(propertyMisfit(sentry.props[1]!, 10)).toBe('shield is 10; it is a whole number from 0 to 9')
    expect(propertyMisfit(sentry.props[1]!, 2.5)).toBe('shield is 2.5; it is a whole number from 0 to 9')
    expect(propertyMisfit(sentry.props[1]!, 'x')).toBe('shield is "x"; it is a whole number from 0 to 9')
    expect(propertyMisfit(sentry.props[2]!, 1)).toBe('armed is 1; it is true or false')
    expect(propertyMisfit(sentry.props[3]!, false)).toBe('label is false; it is text')
    expect(propertyMisfit(sentry.props[3]!, '')).toBeNull()
  })

  it('holds an int with no limits to 32 bits, as the game does', () => {
    const free: Def = { name: 'n', type: 'int', default: 0 }
    expect(propertyMisfit(free, I32_MAX)).toBeNull()
    expect(propertyMisfit(free, I32_MIN)).toBeNull()
    expect(propertyMisfit(free, I32_MAX + 1)).toContain('32 bits')
    // With one limit set the other is still 32 bits, and the message does not say the value is fine.
    expect(propertyMisfit({ name: 'n', type: 'int', default: 0, min: 0 }, 3000000000)).toBe('n is 3000000000; it is a whole number from 0 to 2147483647')
    expect(propertyMisfit({ name: 'n', type: 'int', default: 0, max: 9 }, -3000000000)).toBe('n is -3000000000; it is a whole number from -2147483648 to 9')
  })
})

describe('a change of kind', () => {
  const kinds = ['int', 'bool', 'string', 'enum', 'ref'] as const
  it('gives a valid definition from each kind to each other kind', () => {
    const limitedRef: Def = { name: 'opens', type: 'ref', default: '', types: ['door'] }
    for (const from of [...sentry.props, limitedRef]) {
      for (const to of kinds) {
        const next = withPropertyType(from, to)
        expect(PropertyDef.safeParse(next).success, `${from.type} to ${to}`).toBe(true)
        expect(next.name).toBe(from.name)
        expect(next.type).toBe(to)
        expect(propertyMisfit(next, next.default), `${from.type} to ${to}: the default fits`).toBeNull()
        expect(next.options !== undefined).toBe(to === 'enum')
        expect(next.min === undefined && next.max === undefined || to === 'int').toBe(true)
        expect(next.types === undefined || (to === 'ref' && from.type === 'ref')).toBe(true)
      }
    }
  })

  it('leaves the definition alone for the same kind, and starts a list from the old text default', () => {
    expect(withPropertyType(sentry.props[1]!, 'int')).toBe(sentry.props[1])
    expect(withPropertyType({ name: 'p', type: 'string', default: 'north' }, 'enum')).toEqual({ name: 'p', type: 'enum', default: 'north', options: ['north'] })
    expect(withPropertyType({ name: 'p', type: 'int', default: 4 }, 'enum')).toEqual({ name: 'p', type: 'enum', default: 'option', options: ['option'] })
  })
})

describe('options and limits', () => {
  const mood = sentry.props[0]!
  it('reads options from comma separated text, leaving out blanks and repeats', () => {
    expect(withOptions(mood, ' calm, angry ,, angry, sleepy')).toMatchObject({ options: ['calm', 'angry', 'sleepy'], default: 'calm' })
  })

  it('moves the default to the first option when its option is taken out, and refuses an empty list', () => {
    expect(withOptions(mood, 'angry, sleepy')).toMatchObject({ options: ['angry', 'sleepy'], default: 'angry' })
    expect(withOptions(mood, ' , ')).toBeNull()
    expect(PropertyDef.safeParse(withOptions(mood, 'angry, sleepy'))).toMatchObject({ success: true })
  })

  it('sets limits, moves the default inside them, and refuses a smallest over the largest', () => {
    const shield = sentry.props[1]!
    expect(withLimits(shield, 0, 2)).toMatchObject({ min: 0, max: 2, default: 2 })
    expect(withLimits(shield, 5, undefined)).toMatchObject({ min: 5, default: 5 })
    expect(withLimits(shield, undefined, undefined)).toEqual({ name: 'shield', type: 'int', default: 3 })
    expect(withLimits(shield, 5, 1)).toBeNull()
    expect(PropertyDef.safeParse(withLimits(shield, 0, 2)).success).toBe(true)
  })
})

describe('a property name', () => {
  it('is accepted when it is snake_case and free', () => {
    expect(propertyNameProblem(sentry, 0, 'temper')).toBeNull()
    expect(propertyNameProblem(sentry, 0, 'mood')).toBeNull() // its own, unchanged
  })

  it('is refused when it is not snake_case, is another property, or is a behaviour\'s', () => {
    expect(propertyNameProblem(sentry, 0, 'Mood')).toContain('lowercase letters')
    expect(propertyNameProblem(sentry, 0, '1st')).toContain('lowercase letters')
    expect(propertyNameProblem(sentry, 0, '')).toContain('lowercase letters')
    expect(propertyNameProblem(sentry, 0, 'shield')).toBe('Sentry already has a property "shield".')
    expect(propertyNameProblem(sentry, 0, 'patrol')).toBe('"patrol" is a property of the patrol behaviour, which Sentry has.')
  })

  it('makes a free name for a new property', () => {
    expect(newProperty(sentry)).toEqual({ name: 'property', type: 'int', default: 0 })
    const withOne = { ...sentry, props: [...sentry.props, newProperty(sentry)] }
    expect(newProperty(withOne).name).toBe('property_2')
    expect(PropertyDef.safeParse(newProperty(sentry)).success).toBe(true)
  })
})

describe('the stored values a definition no longer fits', () => {
  it('lists none when the values fit, and none for entities that store nothing or are of another type', () => {
    expect(propertyMisfits(rooms(), sentry)).toEqual([])
  })

  it('lists the room, entity, value and reason for each that does not fit', () => {
    const narrower: EntityType = { ...sentry, props: sentry.props.map((p) => (p.name === 'shield' ? { ...p, max: 5 } : p.name === 'mood' ? { ...p, options: ['calm'] } : p)) }
    expect(propertyMisfits(rooms(), narrower)).toEqual([
      { room: 'entry', roomName: 'Entry', entity: 0, name: 'mood', value: 'angry', problem: 'mood is "angry"; it is one of calm' },
      { room: 'entry', roomName: 'Entry', entity: 0, name: 'shield', value: 7, problem: 'shield is 7; it is a whole number from 0 to 5' },
    ])
  })

  it('lists the values a change of kind breaks: int to bool, bool to enum', () => {
    const retyped = (name: string, to: Def['type']): EntityType => ({ ...sentry, props: sentry.props.map((p) => (p.name === name ? withPropertyType(p, to) : p)) })
    expect(propertyMisfits(rooms(), retyped('shield', 'bool')).map((m) => [m.entity, m.name, m.value])).toEqual([[0, 'shield', 7]])
    expect(propertyMisfits(rooms(), retyped('armed', 'enum')).map((m) => [m.room, m.name, m.value])).toEqual([['shaft', 'armed', true]])
  })

  it('does not list a value of an entity of another type that has the same name', () => {
    // The coin stores mood "loud", but a coin has no sentry properties.
    expect(propertyMisfits(rooms(), { ...sentry, props: [{ name: 'mood', type: 'bool', default: false }] }).map((m) => m.entity)).toEqual([0])
  })

  it('counts only what the change broke, not what was already wrong', () => {
    const before: EntityType = { ...sentry, props: sentry.props.map((p) => (p.name === 'shield' ? { ...p, max: 5 } : p)) }
    const after: EntityType = { ...before, props: before.props.map((p) => (p.name === 'mood' ? { ...p, options: ['calm'] } : p)) }
    expect(propertyMisfits(rooms(), before).map((m) => m.name)).toEqual(['shield'])
    expect(newMisfits(rooms(), before, after).map((m) => m.name)).toEqual(['mood'])
  })

  it('is what validation reports, in the room\'s file, as an error', () => {
    const { project, world, audio } = newProject('T')
    const broken: Documents = {
      project: { ...project, entityTypes: [...project.entityTypes, { ...sentry, props: sentry.props.map((p) => (p.name === 'mood' ? { ...p, options: ['calm'] } : p)) }] },
      world: { ...world, rooms: [{ room: 'entry', x: 0, y: 0 }], start: 'entry' },
      audio,
      tilesets: {},
      sprites: {},
      rooms: { entry: rooms().entry! },
    }
    const problems = validateProject(broken, () => true).filter((p) => p.file === 'studio/rooms/entry.json')
    expect(problems).toContainEqual({ severity: 'error', file: 'studio/rooms/entry.json', message: 'entity 0 (sentry): mood is "angry"; it is one of calm' })
    // Nothing for the entity that stores nothing, and the coin has no definitions to fit.
    expect(problems.filter((p) => p.message.includes('it is one of'))).toHaveLength(1)
  })
})

describe('changes that reach the rooms', () => {
  const project = { entityTypes: [sentry] }

  it('renames a property in the type and the stored values under it, in the rooms that have any', () => {
    const before = rooms()
    const change = renameProperty(project, before, 'sentry', 'mood', 'temper')
    expect(change.project.entityTypes[0]!.props[0]).toMatchObject({ name: 'temper', type: 'enum', options: ['calm', 'angry'] })
    expect(Object.keys(change.rooms)).toEqual(['entry'])
    expect(change.rooms.entry!.entities[0]!.props).toEqual({ shield: 7, temper: 'angry' })
    // The coin's "mood" belongs to a coin, and the room with no values is not in the answer.
    expect(change.rooms.entry!.entities[1]).toBe(before.entry!.entities[1])
    expect(change.rooms.shaft).toBeUndefined()
  })

  it('deletes a property from the type and the stored values of its entities', () => {
    const before = rooms()
    const change = withoutProperty(project, before, 'sentry', 'armed')
    expect(change.project.entityTypes[0]!.props.map((p) => p.name)).toEqual(['mood', 'shield', 'label'])
    expect(Object.keys(change.rooms)).toEqual(['shaft'])
    expect(change.rooms.shaft!.entities[0]!.props).toEqual({ label: 'north' })
    expect(withoutProperty(project, before, 'sentry', 'label').rooms.shaft!.entities[0]!.props).toEqual({ armed: true })
  })

  it('finds the entities that store a value for a property', () => {
    expect(propertyUsage(rooms(), 'sentry', 'mood')).toEqual([{ room: 'entry', roomName: 'Entry', entity: 0, value: 'angry' }])
    expect(propertyUsage(rooms(), 'sentry', 'shield')).toHaveLength(1)
    expect(propertyUsage(rooms(), 'sentry', 'nothing')).toEqual([])
  })

  it('drops only the values asked for, keeps the others, and leaves unchanged rooms out', () => {
    const before = rooms()
    const narrower: EntityType = { ...sentry, props: sentry.props.map((p) => (p.name === 'shield' ? { ...p, max: 5 } : p)) }
    const changed = dropMisfits(before, propertyMisfits(before, narrower))
    expect(Object.keys(changed)).toEqual(['entry'])
    expect(changed.entry!.entities[0]!.props).toEqual({ mood: 'angry' })
    expect(changed.entry!.entities[1]).toBe(before.entry!.entities[1])
    // The entity then has the type's default, which fits.
    expect(propertyMisfits(changed, narrower)).toEqual([])
    expect(dropMisfits(before, [])).toEqual({})
  })

  it('leaves the entity following the type once its value is dropped: stored nothing, shows the default', () => {
    const changed = dropMisfits(rooms(), [{ room: 'shaft', roomName: 'Shaft', entity: 0, name: 'armed', value: true, problem: '' }])
    expect(changed.shaft!.entities[0]!.props).toEqual({ label: 'north' })
    // And a value equal to the type's is still not stored by the panel's rule.
    expect(entityOverride(sentry, {}, 'armed', false)).toEqual({})
  })
})

describe('one change of a definition, with what it drops', () => {
  const project = { entityTypes: [sentry] }

  it('gives the project with it, the rooms without the values it breaks, and those values', () => {
    const before = rooms()
    const plan = editProperty(project, before, 'sentry', 1, { ...sentry.props[1]!, max: 5 })!
    expect(plan.project.entityTypes[0]!.props[1]).toMatchObject({ name: 'shield', max: 5 })
    expect(plan.broken.map((m) => [m.room, m.entity, m.name])).toEqual([['entry', 0, 'shield']])
    expect(plan.rooms.entry!.entities[0]!.props).toEqual({ mood: 'angry' })
    expect(Object.keys(plan.rooms)).toEqual(['entry'])
  })

  it('drops nothing when the change breaks nothing, and nothing for a row that is not there', () => {
    const plan = editProperty(project, rooms(), 'sentry', 1, { ...sentry.props[1]!, default: 4 })!
    expect(plan.broken).toEqual([])
    expect(plan.rooms).toEqual({})
    expect(editProperty(project, rooms(), 'sentry', 9, sentry.props[0]!)).toBeNull()
    expect(editProperty(project, rooms(), 'ghost', 0, sentry.props[0]!)).toBeNull()
  })

  it('is worked out from the documents it is given: the same change on newer rooms drops the newer values', () => {
    // A question that stayed open while a room changed: confirming uses the room as it is then.
    const newer = rooms()
    newer.shaft = { ...newer.shaft!, entities: [{ type: 'sentry', x: 1, y: 1, props: { shield: 8 } }] }
    const plan = editProperty(project, newer, 'sentry', 1, { ...sentry.props[1]!, max: 5 })!
    expect(plan.broken.map((m) => [m.room, m.value])).toEqual([['entry', 7], ['shaft', 8]])
  })
})

describe('an int default', () => {
  it('past 32 bits is a problem in the project, as the game would wrap it', () => {
    const { project, world, audio } = newProject('T')
    const docs: Documents = { project: { ...project, entityTypes: [...project.entityTypes, { ...sentry, props: [{ name: 'score', type: 'int', default: 5000000000 }] }] }, world, audio, tilesets: {}, sprites: {}, rooms: {} }
    expect(validateProject(docs, () => true)).toContainEqual({ severity: 'error', file: 'studio/project.json', message: 'entity type "sentry": property "score" has default 5000000000; it is a whole number that fits in 32 bits' })
    const fine: Documents = { ...docs, project: { ...docs.project!, entityTypes: [...project.entityTypes, { ...sentry, props: [{ name: 'score', type: 'int', default: 2000000000 }] }] } }
    expect(validateProject(fine, () => true).filter((p) => p.message.includes('score'))).toEqual([])
  })
})

describe('adding a behaviour to a type with its own property of the same name', () => {
  it('is refused up front, as the property is refused the other way round', () => {
    const coin: EntityType = { id: 'coin', name: 'Coin', colour: '#000000', props: [{ name: 'value', type: 'int', default: 1 }], behaviours: [] }
    expect(behaviourBlocker(coin, 'collectible')).toBe('the type has its own property value')
    expect(behaviourBlocker({ ...coin, props: [] }, 'collectible')).toBeUndefined()
    expect(propertyNameProblem({ ...coin, props: [], behaviours: [{ id: 'collectible', props: {} }] }, 0, 'value')).toBe('"value" is a property of the collectible behaviour, which Coin has.')
  })
})
