// MCP tools that give entity types their behaviours from the runtime's library. The
// description lists every behaviour with its properties, from core/src/behaviourschema.ts,
// so an agent can fill them in without guessing.
import { z } from 'zod'
import { BEHAVIOURS, Id, behaviourDeclaration, behaviourFields, withBehaviour, withoutBehaviour } from '@pecten-studio/core'
import type { EntityType, Project } from '@pecten-studio/core'
import { HttpError } from './project.ts'
import { documents, saveAndReport, tool } from './toolkit.ts'
import type { Tool, ToolContext } from './tools.ts'

/** Each behaviour on a line: its id, what it does and its properties. */
function behaviourList(): string {
  return BEHAVIOURS.map((b) => {
    const fields = behaviourFields(b.id).map((f) => {
      const allows = f.kind === 'int' ? `whole number ${f.min} to ${f.max}` : 'true or false'
      return `${f.name} (${allows}, ${f.required ? 'required' : `default ${f.default}`})`
    })
    return `- ${b.id}: ${b.summary}${fields.length ? ` Properties: ${fields.join(', ')}.` : ''}`
  }).join('\n')
}

const names = (list: readonly { id: string }[]) => list.map((x) => x.id).join(', ') || 'none'

/** The project and the entity type named, or an error that says which types there are. */
async function typeOf(context: ToolContext, id: string): Promise<{ project: Project; type: EntityType }> {
  const { docs } = await documents(context)
  const project = docs.project
  if (!project) throw new HttpError(409, 'studio/project.json is missing or has errors')
  const type = project.entityTypes.find((t) => t.id === id)
  if (!type) throw new HttpError(404, `there is no entity type "${id}"; the types are ${names(project.entityTypes)}`)
  return { project, type }
}

function saveType(context: ToolContext, project: Project, type: EntityType, done: string) {
  return saveAndReport(context, 'project', undefined, { ...project, entityTypes: project.entityTypes.map((t) => (t.id === type.id ? type : t)) }, done)
}

export const BEHAVIOUR_TOOLS: Tool[] = [
  tool(
    'entity_type_add_behaviour',
    `Gives an entity type a behaviour from the runtime's library, with the type's values for its properties; or, if the type has it, changes those values. Left-out properties take the default; placed entities can override one with a property of the same name (entity_update). The game runs a type's behaviours in their order: a new one goes last, or before the one named in "before". The behaviours:\n${behaviourList()}`,
    z.object({
      type: Id.describe('The entity type'),
      behaviour: z.string().describe('A behaviour id from the list'),
      props: z.record(z.string(), z.union([z.number().int(), z.boolean()])).default({}),
      before: z.string().optional().describe('A behaviour the type has, to put this one ahead of'),
    }),
    async ({ type: id, behaviour, props, before }, context) => {
      const { project, type } = await typeOf(context, id)
      if (!behaviourDeclaration(behaviour)) throw new HttpError(400, `there is no behaviour "${behaviour}"; the behaviours are ${names(BEHAVIOURS)}`)
      if (before !== undefined && !type.behaviours.some((b) => b.id === before)) {
        throw new HttpError(400, `entity type "${id}" has no behaviour "${before}" to go before; it has ${names(type.behaviours)}`)
      }
      const had = type.behaviours.some((b) => b.id === behaviour)
      const done = had ? `Changed behaviour "${behaviour}" of entity type "${id}".` : `Added behaviour "${behaviour}" to entity type "${id}".`
      return saveType(context, project, withBehaviour(type, behaviour, props, before), done)
    },
  ),

  tool(
    'entity_type_remove_behaviour',
    'Takes a behaviour away from an entity type. Placed entities keep any values they set for its properties; the answer says how many, and the project then warns about them.',
    z.object({ type: Id, behaviour: z.string() }),
    async ({ type: id, behaviour }, context) => {
      const { project, type } = await typeOf(context, id)
      if (!type.behaviours.some((b) => b.id === behaviour)) throw new HttpError(404, `entity type "${id}" has no behaviour "${behaviour}"; it has ${names(type.behaviours)}`)
      const { docs } = await documents(context)
      const props = behaviourFields(behaviour).map((f) => f.name)
      const setting = Object.values(docs.rooms)
        .flatMap((room) => room.entities)
        .filter((e) => e.type === id && Object.keys(e.props).some((name) => props.includes(name))).length
      const left = setting ? ` ${setting} placed ${setting === 1 ? 'entity still sets' : 'entities still set'} its properties.` : ''
      return saveType(context, project, withoutBehaviour(type, behaviour), `Removed behaviour "${behaviour}" from entity type "${id}".${left}`)
    },
  ),
]
