// Behaviours on entity types: checking a project's settings against the runtime's
// declarations, and the values written for each entity. Codegen does the same in
// codegen/src/behaviours.rs, in the same words: both are tested against
// codegen/fixture/bad-behaviours/expected.txt.
import { BEHAVIOURS, MAX_BEHAVIOURS } from './behaviourschema.ts'
import type { EntityType, Room } from './schema.ts'

export { BEHAVIOURS, MAX_BEHAVIOURS }

export type BehaviourDeclaration = (typeof BEHAVIOURS)[number]
type PropSchema = { type: 'integer'; minimum: number; maximum: number; default?: number; description: string } | { type: 'boolean'; default?: boolean; description: string }
type Value = number | boolean | string

/** A behaviour by its id in projects. */
export function behaviourDeclaration(id: string): BehaviourDeclaration | undefined {
  return BEHAVIOURS.find((b) => b.id === id)
}

/** A behaviour's properties in the order the ROM holds them, with their schemas. */
export function behaviourProps(declaration: BehaviourDeclaration): { name: string; schema: PropSchema }[] {
  const properties = declaration.schema.properties as Record<string, PropSchema>
  return declaration.order.map((name) => ({ name, schema: properties[name]! }))
}

function accepts(schema: PropSchema, value: Value): boolean {
  if (schema.type === 'boolean') return typeof value === 'boolean'
  return typeof value === 'number' && Number.isInteger(value) && schema.minimum <= value && value <= schema.maximum
}

function allows(schema: PropSchema): string {
  return schema.type === 'boolean' ? 'true or false' : `a whole number from ${schema.minimum} to ${schema.maximum}`
}

/** The type's behaviours the runtime knows, each with the type's values, each once. */
function known(type: EntityType): { declaration: BehaviourDeclaration; values: Record<string, Value> }[] {
  const seen = new Set<string>()
  return type.behaviours.flatMap((used) => {
    const declaration = behaviourDeclaration(used.id)
    if (!declaration || seen.has(used.id)) return []
    seen.add(used.id)
    return [{ declaration, values: used.props }]
  })
}

/** Problems with the entity types' behaviours, in `project.json`. */
export function behaviourTypeProblems(types: EntityType[]): string[] {
  const problems: string[] = []
  for (const type of types) {
    const t = type.id
    if (type.behaviours.length > MAX_BEHAVIOURS) problems.push(`entity type "${t}" has ${type.behaviours.length} behaviours; an entity can have at most ${MAX_BEHAVIOURS}`)
    for (const [i, used] of type.behaviours.entries()) {
      const declaration = behaviourDeclaration(used.id)
      if (!declaration) {
        problems.push(`entity type "${t}" has unknown behaviour "${used.id}"; the behaviours are ${BEHAVIOURS.map((b) => b.id).join(', ')}`)
        continue
      }
      if (type.behaviours.slice(0, i).some((before) => before.id === used.id)) {
        problems.push(`entity type "${t}" has behaviour "${used.id}" twice`)
        continue
      }
      const props = behaviourProps(declaration)
      // In name order, as codegen reads them from a JSON object.
      for (const [name, value] of Object.entries(used.props).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const prop = props.find((p) => p.name === name)
        if (!prop) {
          problems.push(
            props.length === 0
              ? `entity type "${t}": behaviour "${used.id}" has no property "${name}"; it has none`
              : `entity type "${t}": behaviour "${used.id}" has no property "${name}"; its properties are ${props.map((p) => p.name).join(', ')}`,
          )
        } else if (!accepts(prop.schema, value)) {
          problems.push(`entity type "${t}": ${name} is ${JSON.stringify(value)}; it is ${allows(prop.schema)}`)
        }
      }
      for (const prop of props) {
        if (type.props.some((own) => own.name === prop.name)) {
          problems.push(`entity type "${t}" has its own property "${prop.name}", which behaviour "${used.id}" also has; rename its own`)
        }
      }
    }
    const behaviours = known(type).map((k) => k.declaration)
    for (const [i, first] of behaviours.entries()) {
      for (const second of behaviours.slice(i + 1)) {
        for (const name of first.order.filter((n) => (second.order as readonly string[]).includes(n))) {
          problems.push(`entity type "${t}": behaviours "${first.id}" and "${second.id}" both have property "${name}"; a type can have only one of them`)
        }
      }
    }
  }
  return problems
}

/** Problems with a placed entity's behaviour properties. */
export function behaviourEntityProblems(n: number, type: EntityType, entity: Room['entities'][number]): string[] {
  const problems: string[] = []
  const at = `entity ${n} (${type.id})`
  for (const { declaration, values } of known(type)) {
    for (const { name, schema } of behaviourProps(declaration)) {
      const value = entity.props[name]
      if (value !== undefined && !accepts(schema, value)) problems.push(`${at}: ${name} is ${JSON.stringify(value)}; it is ${allows(schema)}`)
      else if (value === undefined && schema.default === undefined && values[name] === undefined) {
        problems.push(`${at}: ${name} has no value; behaviour "${declaration.id}" needs it, and the type does not set it`)
      }
    }
  }
  return problems
}

/** Whether a placed entity's property belongs to one of its type's behaviours. */
export function isBehaviourProp(type: EntityType, name: string): boolean {
  return known(type).some(({ declaration }) => (declaration.order as readonly string[]).includes(name))
}

/**
 * Where each of a type's behaviours starts among its entities' properties, for the data
 * section: after the type's own, each behaviour's properties in turn, in the order
 * `behaviourValues` writes them.
 */
export function behaviourPositions(type: EntityType): { number: number; at: number }[] {
  let at = type.props.length
  return known(type).map(({ declaration }) => {
    const position = { number: declaration.number, at }
    at += declaration.order.length
    return position
  })
}

/**
 * The behaviour properties written for an entity after its type's own: each of the
 * type's behaviours in turn, its properties in declared order. Each value is the
 * entity's own, else the type's, else the default. `null` when one is missing or does
 * not fit, which the problems above report.
 */
export function behaviourValues(type: EntityType, entityProps: Record<string, Value>): { name: string; value: number | boolean }[] | null {
  const out: { name: string; value: number | boolean }[] = []
  for (const { declaration, values } of known(type)) {
    for (const { name, schema } of behaviourProps(declaration)) {
      const value = entityProps[name] ?? values[name] ?? schema.default
      if (value === undefined || !accepts(schema, value)) return null
      out.push({ name, value: value as number | boolean })
    }
  }
  return out
}

// Editing: what Project settings, the room panel and the MCP tools do to behaviours.

/** One field of a behaviour's form, from its declaration. */
export interface BehaviourField {
  name: string
  summary: string
  kind: 'int' | 'bool'
  min?: number
  max?: number
  default: number | boolean | undefined
  /** It has no default: a type or each placed entity must set it. */
  required: boolean
}

/** The fields of a behaviour's form, in the order it declares its properties; none for an unknown id. */
export function behaviourFields(id: string): BehaviourField[] {
  const declaration = behaviourDeclaration(id)
  if (!declaration) return []
  return behaviourProps(declaration).map(({ name, schema }) =>
    schema.type === 'integer'
      ? { name, summary: schema.description, kind: 'int', min: schema.minimum, max: schema.maximum, default: schema.default, required: schema.default === undefined }
      : { name, summary: schema.description, kind: 'bool', default: schema.default, required: schema.default === undefined },
  )
}

/** A behaviour's id in words: `moving-platform` is "Moving platform". */
export function behaviourLabel(id: string): string {
  const words = id.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The type with a behaviour added, or with new values merged into one it has, which
 * keeps its place. A new one goes at the end, or before the behaviour `before`.
 */
export function withBehaviour(type: EntityType, id: string, props: Record<string, Value> = {}, before?: string): EntityType {
  const has = type.behaviours.find((b) => b.id === id)
  if (has) return { ...type, behaviours: type.behaviours.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...props } } : b)) }
  const behaviours = [...type.behaviours]
  const at = before === undefined ? -1 : behaviours.findIndex((b) => b.id === before)
  behaviours.splice(at < 0 ? behaviours.length : at, 0, { id, props: { ...props } })
  return { ...type, behaviours }
}

export function withoutBehaviour(type: EntityType, id: string): EntityType {
  return { ...type, behaviours: type.behaviours.filter((b) => b.id !== id) }
}

/** Moves a behaviour one place earlier (-1) or later (1) in the order the game runs them; the same type if it cannot. */
export function moveBehaviour(type: EntityType, id: string, by: -1 | 1): EntityType {
  const from = type.behaviours.findIndex((b) => b.id === id)
  const to = from + by
  if (from < 0 || to < 0 || to >= type.behaviours.length) return type
  const behaviours = [...type.behaviours]
  ;[behaviours[from], behaviours[to]] = [behaviours[to]!, behaviours[from]!]
  return { ...type, behaviours }
}

/** Sets the type's value for a behaviour property. A value equal to the default, or none, is left out. */
export function setBehaviourValue(type: EntityType, id: string, name: string, value: number | boolean | undefined): EntityType {
  const field = behaviourFields(id).find((f) => f.name === name)
  return {
    ...type,
    behaviours: type.behaviours.map((b) => {
      if (b.id !== id) return b
      const { [name]: _, ...rest } = b.props
      return { ...b, props: value === undefined || value === field?.default ? rest : { ...rest, [name]: value } }
    }),
  }
}

/** Why a behaviour cannot be added to a type, in a few words; undefined if it can. */
export function behaviourBlocker(type: EntityType, id: string): string | undefined {
  if (type.behaviours.some((b) => b.id === id)) return 'the type has it'
  if (type.behaviours.length >= MAX_BEHAVIOURS) return `the type has ${MAX_BEHAVIOURS}, the most it can have`
  const names = behaviourFields(id).map((f) => f.name)
  for (const { declaration } of known(type)) {
    const shared = (declaration.order as readonly string[]).find((n) => names.includes(n))
    if (shared) return `shares ${shared} with ${behaviourLabel(declaration.id)}`
  }
  return undefined
}
