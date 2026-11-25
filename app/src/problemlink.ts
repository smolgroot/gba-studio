// Where a problem in the Problems panel opens. Most open the file they are in; one about
// an entity type opens that type on the Entities page (US-019). Every entity-type message
// starts `entity type "<id>"`; app/test/problemlink.test.ts checks that against real
// validation, so a reworded message fails a test rather than the link.
import type { Problem } from '@pecten-studio/core'
import type { Selection } from './store.ts'

/** The item a problem's file belongs to, if it is one that opens. */
export function selectionForFile(file: string): Selection | null {
  const match = /^studio\/(?:(room|tileset|sprite)s\/([^/]+)|(world|project|audio))\.json$/.exec(file)
  if (!match) return null
  return match[1] ? { kind: match[1] as 'room' | 'tileset' | 'sprite', id: match[2]! } : { kind: match[3] as 'world' | 'project' | 'audio' }
}

/** The item a problem opens: its entity type when it is about one, else its file. */
export function selectionForProblem(problem: Pick<Problem, 'file' | 'message'>): Selection | null {
  if (problem.file === 'studio/project.json') {
    const type = /^entity type "([^"]+)"/.exec(problem.message)
    if (type) return { kind: 'entities', id: type[1]! }
  }
  return selectionForFile(problem.file)
}
