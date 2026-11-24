// Changing an entity type's behaviours, as Project settings and the MCP tools do.
import { describe, expect, it } from 'vitest'
import {
  behaviourBlocker, behaviourFields, behaviourLabel, moveBehaviour, setBehaviourValue, withBehaviour, withoutBehaviour,
} from '../src/index.ts'
import type { EntityType } from '../src/index.ts'

const bot: EntityType = { id: 'bot', name: 'Bot', colour: '#000000', props: [], behaviours: [{ id: 'patrol', props: { patrol: 40 } }] }

describe('a behaviour form', () => {
  it('has a field for each declared property, in order, with range, default and whether it is required', () => {
    expect(behaviourFields('patrol')).toEqual([
      { name: 'patrol', summary: 'How far it walks each way, in pixels', kind: 'int', min: 0, max: 4096, default: 32, required: false },
      { name: 'patrol_pace', summary: 'Frames it takes to walk a pixel', kind: 'int', min: 1, max: 255, default: 2, required: false },
    ])
    expect(behaviourFields('ability-pickup')[0]).toMatchObject({ name: 'grants_ability', required: true, default: undefined })
    expect(behaviourFields('hazard')).toEqual([])
    expect(behaviourFields('nothing')).toEqual([])
  })

  it('is named in words', () => {
    expect(behaviourLabel('moving-platform')).toBe('Moving platform')
    expect(behaviourLabel('hazard')).toBe('Hazard')
  })
})

describe('changing a type\'s behaviours', () => {
  it('adds one at the end, or before another', () => {
    expect(withBehaviour(bot, 'hazard').behaviours.map((b) => b.id)).toEqual(['patrol', 'hazard'])
    expect(withBehaviour(bot, 'hazard', {}, 'patrol').behaviours.map((b) => b.id)).toEqual(['hazard', 'patrol'])
  })

  it('changes the values of one it has, keeping its place', () => {
    const changed = withBehaviour(withBehaviour(bot, 'hazard'), 'patrol', { patrol_pace: 3 })
    expect(changed.behaviours).toEqual([{ id: 'patrol', props: { patrol: 40, patrol_pace: 3 } }, { id: 'hazard', props: {} }])
  })

  it('removes one, and moves one up or down', () => {
    const two = withBehaviour(bot, 'hazard')
    expect(withoutBehaviour(two, 'patrol').behaviours.map((b) => b.id)).toEqual(['hazard'])
    expect(moveBehaviour(two, 'hazard', -1).behaviours.map((b) => b.id)).toEqual(['hazard', 'patrol'])
    expect(moveBehaviour(two, 'hazard', 1)).toBe(two)
  })

  it('writes a value, and leaves out one that is the default or cleared', () => {
    expect(setBehaviourValue(bot, 'patrol', 'patrol_pace', 4).behaviours[0]!.props).toEqual({ patrol: 40, patrol_pace: 4 })
    expect(setBehaviourValue(bot, 'patrol', 'patrol', 32).behaviours[0]!.props).toEqual({})
    expect(setBehaviourValue(bot, 'patrol', 'patrol', undefined).behaviours[0]!.props).toEqual({})
  })

  it('says why a behaviour cannot be added', () => {
    const shooter = withBehaviour(bot, 'shooter')
    expect(behaviourBlocker(shooter, 'projectile')).toBe('shares shot_speed with Shooter')
    expect(behaviourBlocker(shooter, 'shooter')).toBe('the type has it')
    expect(behaviourBlocker(shooter, 'hazard')).toBeUndefined()
    const full = { ...shooter, behaviours: ['patrol', 'hazard', 'door', 'shooter'].map((id) => ({ id, props: {} })) }
    expect(behaviourBlocker(full, 'checkpoint')).toBe('the type has 4, the most it can have')
  })
})
