// Behaviours on entity types: checking a project's settings against the runtime's
// declarations, and the values written for each entity. Codegen does the same in
// codegen/src/behaviours.rs, in the same words: both are tested against
// codegen/fixture/bad-behaviours/expected.txt.
import { BEHAVIOURS } from './behaviourschema.ts'
import type { EntityType, Room } from './schema.ts'

export { BEHAVIOURS }

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
