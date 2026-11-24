// Behaviours through the MCP tools: a write answers with the problems it left, and the
// schemas an agent can ask for include each behaviour's properties.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyRoom } from '@pecten-studio/core'
import { Builder } from '../src/build.ts'
import { ProjectFolder } from '../src/project.ts'
import { TOOLS, documentSchemas } from '../src/tools.ts'
import type { ToolContext } from '../src/tools.ts'

let folder: string
let context: ToolContext

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-behaviours-'))
  const project = new ProjectFolder(folder)
  await project.init('Test')
  context = { project, builder: new Builder(project, () => {}) }
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const call = (name: string, args: Record<string, unknown>) => {
  const tool = TOOLS.find((t) => t.name === name)!
  return tool.run(tool.input.parse(args) as never, context)
}

describe('behaviours through the tools', () => {
  it('answers a write with the behaviour problems it left', async () => {
    const project = JSON.parse(readFileSync(path.join(folder, 'studio/project.json'), 'utf8'))
    project.entityTypes.push({ id: 'bot', name: 'Bot', colour: '#000000', behaviours: [{ id: 'patrol', props: { patrol_pace: 0 } }] })
    const answer = await call('write_document', { kind: 'project', document: project })
    expect(answer.text).toContain('entity type "bot": patrol_pace is 0; it is a whole number from 1 to 255')
  })

  it('gives each behaviour as JSON Schema with the document schemas', () => {
    const schemas = documentSchemas() as { behaviours: { id: string; schema: { properties: Record<string, unknown> } }[] }
    const patrol = schemas.behaviours.find((b) => b.id === 'patrol')
    expect(Object.keys(patrol!.schema.properties)).toContain('patrol_pace')
  })
})

describe('entity_type_add_behaviour and entity_type_remove_behaviour', () => {
  const project = () => JSON.parse(readFileSync(path.join(folder, 'studio/project.json'), 'utf8'))
  const type = (id: string) => project().entityTypes.find((t: { id: string }) => t.id === id)
  beforeEach(async () => {
    await call('entity_type_set', { id: 'bot', name: 'Bot' })
  })

  it('lists every behaviour with its properties in the description', () => {
    const tool = TOOLS.find((t) => t.name === 'entity_type_add_behaviour')!
    expect(tool.description).toContain('moving-platform')
    expect(tool.description).toContain('patrol_pace (whole number 1 to 255, default 2)')
    expect(tool.description).toContain('grants_ability (whole number 0 to 31, required)')
  })

  it('adds behaviours in order, before another, and changes values of one the type has', async () => {
    const answer = await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'patrol', props: { patrol: 48 } })
    expect(answer.text).toContain('Added behaviour "patrol" to entity type "bot"')
    expect(answer.text).toContain('No problems')
    await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'hazard' })
    await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'checkpoint', before: 'hazard' })
    const changed = await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'patrol', props: { patrol_pace: 3 } })
    expect(changed.text).toContain('Changed behaviour "patrol" of entity type "bot"')
    expect(type('bot').behaviours).toEqual([
      { id: 'patrol', props: { patrol: 48, patrol_pace: 3 } },
      { id: 'checkpoint', props: {} },
      { id: 'hazard', props: {} },
    ])
  })

  it('answers with the problems a value leaves', async () => {
    const answer = await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'patrol', props: { patrol_pace: 0 } })
    expect(answer.text).toContain('patrol_pace is 0; it is a whole number from 1 to 255')
  })

  it('refuses an unknown type, behaviour or place, saying what there is', async () => {
    await expect(call('entity_type_add_behaviour', { type: 'ghost', behaviour: 'patrol' })).rejects.toThrow('there is no entity type "ghost"; the types are player-start, bot')
    await expect(call('entity_type_add_behaviour', { type: 'bot', behaviour: 'patroll' })).rejects.toThrow('there is no behaviour "patroll"; the behaviours are patrol, collectible')
    await expect(call('entity_type_add_behaviour', { type: 'bot', behaviour: 'hazard', before: 'patrol' })).rejects.toThrow('entity type "bot" has no behaviour "patrol" to go before; it has none')
    await expect(call('entity_type_remove_behaviour', { type: 'bot', behaviour: 'patrol' })).rejects.toThrow('entity type "bot" has no behaviour "patrol"; it has none')
  })

  it('removes a behaviour and says how many placed entities still override its properties', async () => {
    await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'patrol' })
    await call('write_document', { kind: 'room', id: 'hall', document: emptyRoom('Hall', 1, 1, 'none') })
    await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10, props: { patrol: 8 } })
    const answer = await call('entity_type_remove_behaviour', { type: 'bot', behaviour: 'patrol' })
    expect(answer.text).toContain('Removed behaviour "patrol" from entity type "bot". 1 placed entity still sets its properties')
    expect(type('bot').behaviours).toEqual([])
  })
})


describe('entities store only what differs from their type (US-014)', () => {
  const room = () => JSON.parse(readFileSync(path.join(folder, 'studio/rooms/hall.json'), 'utf8')) as { entities: { type: string; props: Record<string, unknown> }[] }
  beforeEach(async () => {
    await call('entity_type_set', {
      id: 'bot',
      name: 'Bot',
      props: [
        { name: 'mood', type: 'enum', default: 'calm', options: ['calm', 'angry'] },
        { name: 'shield', type: 'int', default: 3 },
      ],
    })
    await call('entity_type_add_behaviour', { type: 'bot', behaviour: 'patrol', props: { patrol: 40 } })
    await call('write_document', { kind: 'room', id: 'hall', document: emptyRoom('Hall', 1, 1, 'none') })
  })

  it('leaves out a value equal to the type\'s when an entity is added, and says which', async () => {
    const answer = await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10, props: { shield: 3, mood: 'angry', patrol: 40, patrol_pace: 3 } })
    expect(room().entities[0]!.props).toEqual({ mood: 'angry', patrol_pace: 3 })
    expect(answer.text).toContain('Left out 2 values that Bot already has (shield, patrol): the entity follows the type.')
  })

  it('says nothing when every value differs, and keeps them', async () => {
    const answer = await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10, props: { shield: 4 } })
    expect(room().entities[0]!.props).toEqual({ shield: 4 })
    expect(answer.text).not.toContain('Left out')
  })

  it('names one value in the singular', async () => {
    const answer = await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10, props: { mood: 'calm' } })
    expect(answer.text).toContain('Left out 1 value that Bot already has (mood)')
  })

  it('does the same when an entity is updated, and a patrol at the behaviour\'s default is a value when the type sets another', async () => {
    await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10 })
    const answer = await call('entity_update', { room: 'hall', index: 0, props: { shield: 3, patrol: 32 } })
    expect(room().entities[0]!.props).toEqual({ patrol: 32 })
    expect(answer.text).toContain('Left out 1 value that Bot already has (shield)')
  })

  it('compares with the type the entity has after a change of type', async () => {
    await call('entity_type_set', { id: 'crab', name: 'Crab', props: [{ name: 'shield', type: 'int', default: 9 }] })
    await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10, props: { shield: 9 } })
    expect(room().entities[0]!.props).toEqual({ shield: 9 })
    await call('entity_update', { room: 'hall', index: 0, type: 'crab' })
    expect(room().entities[0]).toMatchObject({ type: 'crab', props: {} })
  })

  it('keeps a name the type does not have, which the answer reports as a problem', async () => {
    const answer = await call('entity_add', { room: 'hall', type: 'bot', x: 10, y: 10, props: { ghost: 1 } })
    expect(room().entities[0]!.props).toEqual({ ghost: 1 })
    expect(answer.text).toContain('has a property "ghost" its type does not define')
  })
})
