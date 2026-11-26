// An entity type's own properties (US-016): what a definition allows, which stored
// values of placed entities no longer fit a changed one, and the changes that reach the
// rooms (a rename, a delete, dropping values that do not fit). The interface, the
// validation and the MCP tool share these, so they say the same things. A placed entity
// stores a value only where it differs from the type's (US-014: `prefab.ts`). See
// design/US-016.md.
import { behaviourFields } from './behaviours.ts'
import { I32_MAX, I32_MIN, Id } from './schema.ts'
import type { EntityType, PropertyDef, Room } from './schema.ts'

type Value = number | boolean | string

/** The kinds of property a type can have, as the interface names them. */
export const PROPERTY_TYPES: ReadonlyArray<{ value: PropertyDef['type']; label: string }> = [
  { value: 'int', label: 'Integer' },
  { value: 'bool', label: 'Boolean' },
  { value: 'string', label: 'Text' },
  { value: 'enum', label: 'One of a list' },
  { value: 'ref', label: 'Another entity' },
]

/** What a definition allows, in words: "a whole number from 0 to 9", "true or false", "one of calm, angry". */
export function propertyAllows(def: PropertyDef): string {
  if (def.type === 'bool') return 'true or false'
  if (def.type === 'string') return 'text'
  if (def.type === 'enum') return `one of ${(def.options ?? []).join(', ')}`
  if (def.type === 'ref') return `the id of an entity${def.types ? ` of type ${def.types.map((t) => `"${t}"`).join(' or ')}` : ''}, or "" for none`
  // A limit left out is the edge of what 32 bits hold, and the words say so: a value past it does not fit.
  if (def.min === undefined && def.max === undefined) return 'a whole number that fits in 32 bits'
  return `a whole number from ${def.min ?? I32_MIN} to ${def.max ?? I32_MAX}`
}

/** Why a value does not fit a definition, as "mood is "loud"; it is one of calm, angry"; null if it fits. */
export function propertyMisfit(def: PropertyDef, value: unknown): string | null {
  const fits =
    def.type === 'bool'
      ? typeof value === 'boolean'
      : def.type === 'string'
        ? typeof value === 'string'
        : def.type === 'enum'
          ? typeof value === 'string' && (def.options ?? []).includes(value)
          : def.type === 'ref'
            // Whether an entity has the id is a question across rooms: see refs.ts.
            ? typeof value === 'string' && (value === '' || Id.safeParse(value).success)
            : typeof value === 'number' && Number.isInteger(value) && value >= (def.min ?? I32_MIN) && value <= (def.max ?? I32_MAX)
  return fits ? null : `${def.name} is ${JSON.stringify(value)}; it is ${propertyAllows(def)}`
}

/** A stored value of a placed entity that does not fit its type's definition. */
export interface PropertyMisfit {
  room: string
  roomName: string
  /** The entity's number in its room. */
  entity: number
  name: string
  value: Value
  /** "mood is "loud"; it is one of calm, angry". */
  problem: string
}

/** The stored values of entities of `type` that do not fit the type's own properties. Behaviour properties are checked with the behaviours. */
export function propertyMisfits(rooms: Readonly<Record<string, Room>>, type: EntityType): PropertyMisfit[] {
  const out: PropertyMisfit[] = []
  for (const [room, doc] of Object.entries(rooms)) {
    doc.entities.forEach((entity, index) => {
      if (entity.type !== type.id) return
      for (const def of type.props) {
        const value = entity.props[def.name]
        const problem = value === undefined ? null : propertyMisfit(def, value)
        if (problem) out.push({ room, roomName: doc.name, entity: index, name: def.name, value: value!, problem })
      }
    })
  }
  return out
}

const keyOf = (m: PropertyMisfit) => `${m.room}\u0000${m.entity}\u0000${m.name}`

/** The values that fit the type as it was and do not fit it as it will be: what a change breaks, not what was already wrong. */
export function newMisfits(rooms: Readonly<Record<string, Room>>, before: EntityType, after: EntityType): PropertyMisfit[] {
  const was = new Set(propertyMisfits(rooms, before).map(keyOf))
  return propertyMisfits(rooms, after).filter((m) => !was.has(keyOf(m)))
}

/** The entities that store a value for a property, with the value. */
export function propertyUsage(rooms: Readonly<Record<string, Room>>, typeId: string, name: string): { room: string; roomName: string; entity: number; value: Value }[] {
  return Object.entries(rooms).flatMap(([room, doc]) =>
    doc.entities.flatMap((entity, index) => (entity.type === typeId && entity.props[name] !== undefined ? [{ room, roomName: doc.name, entity: index, value: entity.props[name]! }] : [])),
  )
}

/** The documents a change to a type's properties made, and only those. */
export interface PropertyChange<P extends { entityTypes: EntityType[] }> {
  project: P
  rooms: Record<string, Room>
}

/**
 * What changing the definition at `index` does: the project with it, the rooms with the
 * stored values it breaks dropped (only rooms that change), and those values, so the
 * author can be asked first. Works from the documents as they are now, so a question
 * that has been open for a while still writes what is there.
 */
export function editProperty<P extends { entityTypes: EntityType[] }>(project: P, rooms: Readonly<Record<string, Room>>, typeId: string, index: number, next: PropertyDef): { project: P; rooms: Record<string, Room>; broken: PropertyMisfit[] } | null {
  const type = project.entityTypes.find((t) => t.id === typeId)
  if (!type || !type.props[index]) return null
  const after = withProps(type, type.props.map((p, i) => (i === index ? next : p)))
  const broken = newMisfits(rooms, type, after)
  return { project: { ...project, entityTypes: project.entityTypes.map((t) => (t.id === typeId ? after : t)) }, rooms: dropMisfits(rooms, broken), broken }
}

/** The rooms with the stored values dropped, so those entities follow their type's default. Only rooms that change are returned. */
export function dropMisfits(rooms: Readonly<Record<string, Room>>, drop: readonly PropertyMisfit[]): Record<string, Room> {
  const byRoom = new Map<string, PropertyMisfit[]>()
  for (const m of drop) byRoom.set(m.room, [...(byRoom.get(m.room) ?? []), m])
  const out: Record<string, Room> = {}
  for (const [id, list] of byRoom) {
    const room = rooms[id]
    if (!room) continue
    out[id] = { ...room, entities: room.entities.map((entity, index) => {
      const names = list.filter((m) => m.entity === index).map((m) => m.name)
      return names.length === 0 ? entity : { ...entity, props: Object.fromEntries(Object.entries(entity.props).filter(([name]) => !names.includes(name))) }
    }) }
  }
  return out
}

/** A new definition of one kind from one of another: a valid default of the new kind, and the options and limits that go with it. */
export function withPropertyType(def: PropertyDef, type: PropertyDef['type']): PropertyDef {
  if (def.type === type) return def
  const { name } = def
  if (type === 'bool') return { name, type, default: false }
  if (type === 'string') return { name, type, default: '' }
  if (type === 'ref') return { name, type, default: '' }
  if (type === 'enum') {
    const first = typeof def.default === 'string' && def.default !== '' ? def.default : 'option'
    return { name, type, default: first, options: [first] }
  }
  return { name, type, default: 0 }
}

/**
 * The definition with its options read from text, one per comma: trimmed, blank and
 * repeated ones left out. The default stays if it is still an option, else it is the first.
 * Null if no option is left, which a list cannot have.
 */
export function withOptions(def: PropertyDef, text: string): PropertyDef | null {
  const options = [...new Set(text.split(',').map((o) => o.trim()).filter((o) => o !== ''))]
  if (options.length === 0) return null
  return { ...def, options, default: options.includes(def.default as string) ? def.default : options[0]! }
}

/** A ref's definition limited to some entity types; none (an empty list) lets it point at any. */
export function withTypes(def: PropertyDef, types: readonly string[]): PropertyDef {
  const { types: _types, ...rest } = def
  return types.length ? { ...rest, types: [...new Set(types)] } : rest
}

/** The definition with new limits (undefined: none). The default moves to the nearest limit if it would be outside. Null if the smallest is over the largest. */
export function withLimits(def: PropertyDef, min: number | undefined, max: number | undefined): PropertyDef | null {
  if (min !== undefined && max !== undefined && min > max) return null
  const { min: _min, max: _max, ...rest } = def
  const clamped = typeof def.default === 'number' ? Math.min(max ?? I32_MAX, Math.max(min ?? I32_MIN, def.default)) : def.default
  return { ...rest, default: clamped, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
}

const SNAKE = /^[a-z][a-z0-9_]*$/

/** The names a type's behaviours already use for their properties. */
function behaviourNames(type: EntityType): string[] {
  return type.behaviours.flatMap((b) => behaviourFields(b.id).map((f) => f.name))
}

/** Why `next` cannot be the name of the property at `index`, in the author's terms; null if it can. */
export function propertyNameProblem(type: EntityType, index: number, next: string): string | null {
  if (!SNAKE.test(next)) return 'A name is lowercase letters, digits and _, starting with a letter: it becomes a field in the game\'s code.'
  if (type.props.some((p, i) => i !== index && p.name === next)) return `${type.name} already has a property "${next}".`
  const behaviour = type.behaviours.find((b) => behaviourFields(b.id).some((f) => f.name === next))
  if (behaviour) return `"${next}" is a property of the ${behaviour.id} behaviour, which ${type.name} has.`
  return null
}

/** A new property for the end of a type's list: an integer with a free name and a default of 0. */
export function newProperty(type: EntityType): PropertyDef {
  const taken = new Set([...type.props.map((p) => p.name), ...behaviourNames(type)])
  let name = 'property'
  for (let n = 2; taken.has(name); n++) name = `property_${n}`
  return { name, type: 'int', default: 0 }
}

function withProps(type: EntityType, props: PropertyDef[]): EntityType {
  return { ...type, props }
}

/** The type with a property renamed, and the stored values of its entities under the new name. */
export function renameProperty<P extends { entityTypes: EntityType[] }>(project: P, rooms: Readonly<Record<string, Room>>, typeId: string, from: string, to: string): PropertyChange<P> {
  const entityTypes = project.entityTypes.map((t) => (t.id === typeId ? withProps(t, t.props.map((p) => (p.name === from ? { ...p, name: to } : p))) : t))
  const changed: Record<string, Room> = {}
  for (const [id, room] of Object.entries(rooms)) {
    if (!room.entities.some((e) => e.type === typeId && e.props[from] !== undefined)) continue
    changed[id] = {
      ...room,
      entities: room.entities.map((e) => {
        if (e.type !== typeId || e.props[from] === undefined) return e
        const { [from]: value, ...rest } = e.props
        return { ...e, props: { ...rest, [to]: value! } }
      }),
    }
  }
  return { project: { ...project, entityTypes }, rooms: changed }
}

/** The type without a property, and its entities without the values they stored for it. */
export function withoutProperty<P extends { entityTypes: EntityType[] }>(project: P, rooms: Readonly<Record<string, Room>>, typeId: string, name: string): PropertyChange<P> {
  const entityTypes = project.entityTypes.map((t) => (t.id === typeId ? withProps(t, t.props.filter((p) => p.name !== name)) : t))
  const used = propertyUsage(rooms, typeId, name).map((u) => ({ room: u.room, roomName: u.roomName, entity: u.entity, name, value: u.value, problem: '' }))
  return { project: { ...project, entityTypes }, rooms: dropMisfits(rooms, used) }
}
