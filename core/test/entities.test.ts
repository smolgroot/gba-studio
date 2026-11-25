// Entity types on their own page (US-019): usage counts, the delete question, and the
// type an address shows.
import { describe, expect, it } from 'vitest'
import { deleteTypeQuestion, emptyRoom, newProject, pickType, placedCounts, typeAfterDelete, typeUsage, withNewType, withoutType } from '../src/index.ts'
import type { EntityType, Room } from '../src/index.ts'

const type = (id: string, name = id): EntityType => ({ id, name, colour: '#ffffff', props: [], behaviours: [] })
const at = (t: string) => ({ type: t, x: 0, y: 0, props: {} })
const rooms = (): Record<string, Room> => ({
  entry: { ...emptyRoom('Entry', 1, 1, 'ts'), entities: [at('sentry'), at('coin'), at('sentry')] },
  shaft: { ...emptyRoom('Shaft', 1, 1, 'ts'), entities: [at('sentry')] },
  empty: emptyRoom('Empty', 1, 1, 'ts'),
})

describe('typeUsage', () => {
  it('counts a type per room, in room order, leaving out rooms without it', () => {
    expect(typeUsage(rooms(), 'sentry')).toEqual([{ room: 'entry', roomName: 'Entry', count: 2 }, { room: 'shaft', roomName: 'Shaft', count: 1 }])
  })
  it('finds a type placed in one room only', () => {
    expect(typeUsage(rooms(), 'coin')).toEqual([{ room: 'entry', roomName: 'Entry', count: 1 }])
  })
  it('is empty for a type that is not placed', () => {
    expect(typeUsage(rooms(), 'door')).toEqual([])
    expect(typeUsage({}, 'sentry')).toEqual([])
  })
})

describe('placedCounts', () => {
  it('totals every type across the rooms', () => {
    expect(placedCounts(rooms())).toEqual({ sentry: 3, coin: 1 })
  })
})

describe('deleteTypeQuestion', () => {
  it('asks nothing when the type is not placed', () => {
    expect(deleteTypeQuestion(type('door', 'Door'), [])).toBeNull()
  })
  it('names how many entities in how many rooms, and which rooms', () => {
    expect(deleteTypeQuestion(type('sentry', 'Sentry bot'), typeUsage(rooms(), 'sentry'))).toBe(
      'Delete the entity type “Sentry bot”? 3 entities in 2 rooms (Entry, Shaft) use it; they stay in their rooms and show as problems until they get another type.',
    )
  })
  it('says it in the singular for one entity', () => {
    expect(deleteTypeQuestion(type('coin', 'Coin'), typeUsage(rooms(), 'coin'))).toBe(
      'Delete the entity type “Coin”? 1 entity in 1 room (Entry) uses it; it stays in its room and shows as a problem until it gets another type.',
    )
  })
})

describe('adding and deleting types', () => {
  it('adds a type with an id no other type has', () => {
    const { project } = newProject('T')
    const first = withNewType({ ...project, entityTypes: [] })
    const second = withNewType(first.project)
    expect(second.project.entityTypes.map((t) => t.id)).toEqual([first.type.id, second.type.id])
    expect(first.type.id).not.toBe(second.type.id)
  })
  it('removes only the type, leaving the others in order', () => {
    const { project } = newProject('T')
    const p = { ...project, entityTypes: [type('a'), type('b'), type('c')] }
    expect(withoutType(p, 'b').entityTypes.map((t) => t.id)).toEqual(['a', 'c'])
  })
  it('shows the next type after a delete, else the one before', () => {
    const types = [type('a'), type('b'), type('c')]
    expect(typeAfterDelete(types, 1)?.id).toBe('c')
    expect(typeAfterDelete(types, 2)?.id).toBe('b')
    expect(typeAfterDelete([type('a')], 0)).toBeUndefined()
  })
})

describe('pickType', () => {
  const types = [type('a'), type('b')]
  it('shows the type the address names', () => expect(pickType(types, 'b')?.id).toBe('b'))
  it('shows the first type for no id or one that no longer exists', () => {
    expect(pickType(types, undefined)?.id).toBe('a')
    expect(pickType(types, 'gone')?.id).toBe('a')
  })
  it('shows none when there are no types', () => expect(pickType([], 'a')).toBeUndefined())
})
