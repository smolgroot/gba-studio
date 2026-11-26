// Problems about an entity type open it on the Entities page (US-019). Run against real
// validation, so a message worded without the `entity type "<id>"` start fails here.
import { describe, expect, it } from 'vitest'
import { emptyRoom, newProject, validateProject } from '@pecten-studio/core'
import type { Documents, EntityType } from '@pecten-studio/core'
import { selectionForFile, selectionForProblem } from '../src/problemlink.ts'

const broken: EntityType[] = [
  { id: 'ghost', name: 'Ghost', colour: '#ffffff', sprite: 'missing', props: [], behaviours: [] },
  { id: 'twin', name: 'Twin', colour: '#ffffff', props: [{ name: 'hp', type: 'int', default: 1 }, { name: 'hp', type: 'int', default: 2 }], behaviours: [] },
  { id: 'huge', name: 'Huge', colour: '#ffffff', props: [{ name: 'hp', type: 'int', default: 2 ** 40 }], behaviours: [] },
  { id: 'odd', name: 'Odd', colour: '#ffffff', props: [], behaviours: [{ id: 'no-such-behaviour', props: {} }] },
  { id: 'fast', name: 'Fast', colour: '#ffffff', props: [], behaviours: [{ id: 'patrol', props: { patrol_pace: -5, nonsense: 1 } }] },
  // US-017: a reference limited to a type the project does not have.
  { id: 'lever', name: 'Lever', colour: '#ffffff', props: [{ name: 'opens', type: 'ref', default: '', types: ['gate'] }], behaviours: [] },
]

function docs(): Documents {
  const { project, world, audio } = newProject('T')
  return {
    project: { ...project, entityTypes: [...broken, broken[0]!] },
    world,
    audio,
    tilesets: {},
    sprites: {},
    rooms: { entry: { ...emptyRoom('Entry', 1, 1, 'ts'), entities: [{ type: 'nobody', x: 0, y: 0, props: {} }] } },
  }
}

describe('a problem about an entity type', () => {
  const problems = validateProject(docs(), () => true)
  const about = (id: string) => problems.filter((p) => p.file === 'studio/project.json' && p.message.includes(`"${id}"`))

  it.each(broken.map((t) => t.id))('opens %s on the Entities page', (id) => {
    const found = about(id)
    expect(found.length).toBeGreaterThan(0)
    for (const problem of found) expect(selectionForProblem(problem)).toEqual({ kind: 'entities', id })
  })

  it('covers every problem in project.json that names a type', () => {
    for (const problem of problems.filter((p) => p.file === 'studio/project.json' && /entity type/.test(p.message))) {
      expect(selectionForProblem(problem)?.kind).toBe('entities')
    }
  })

  it('leaves a problem in a room opening the room', () => {
    const inRoom = problems.filter((p) => p.file === 'studio/rooms/entry.json')
    expect(inRoom.length).toBeGreaterThan(0)
    for (const problem of inRoom) expect(selectionForProblem(problem)).toEqual({ kind: 'room', id: 'entry' })
  })
})

describe('other problems', () => {
  it('open their file as before', () => {
    expect(selectionForProblem({ file: 'studio/project.json', message: 'collision class "x" is defined twice' })).toEqual({ kind: 'project' })
    expect(selectionForProblem({ file: 'studio/world.json', message: 'x' })).toEqual({ kind: 'world' })
    expect(selectionForFile('assets/a.png')).toBeNull()
  })
})
