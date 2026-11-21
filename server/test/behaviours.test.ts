// Behaviours through the MCP tools: a write answers with the problems it left, and the
// schemas an agent can ask for include each behaviour's properties.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
