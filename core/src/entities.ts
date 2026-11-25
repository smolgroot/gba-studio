// Entity types on their own page (US-019): where a type is placed, the question asked
// before deleting one that is, and which type a page address shows.
import { uniqueId } from './room.ts'
import type { EntityType, Project, Room } from './schema.ts'

/** A room that places a type, and how many entities of it. */
export interface TypeUse {
  room: string
  roomName: string
  count: number
}

/** The rooms that place this type, in the order the rooms are given, with a count each. */
export function typeUsage(rooms: Record<string, Room>, typeId: string): TypeUse[] {
  return Object.entries(rooms).flatMap(([room, doc]) => {
    const count = doc.entities.filter((e) => e.type === typeId).length
    return count ? [{ room, roomName: doc.name, count }] : []
  })
}

/** How many entities of each type are placed across the rooms. */
export function placedCounts(rooms: Record<string, Room>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const doc of Object.values(rooms)) for (const e of doc.entities) counts[e.type] = (counts[e.type] ?? 0) + 1
  return counts
}

/**
 * What to ask before deleting a type, or null when nothing is placed and it can go at
 * once. Placed entities are left as they are: validation reports them until they get
 * another type.
 */
export function deleteTypeQuestion(type: Pick<EntityType, 'name'>, usage: TypeUse[]): string | null {
  if (!usage.length) return null
  const n = usage.reduce((sum, u) => sum + u.count, 0)
  const entities = n === 1 ? '1 entity' : `${n} entities`
  const rooms = usage.length === 1 ? '1 room' : `${usage.length} rooms`
  const verb = n === 1 ? 'uses' : 'use'
  const they = n === 1 ? 'it stays in its room and shows as a problem until it gets' : 'they stay in their rooms and show as problems until they get'
  return `Delete the entity type “${type.name}”? ${entities} in ${rooms} (${usage.map((u) => u.roomName).join(', ')}) ${verb} it; ${they} another type.`
}

/** The project without this type. Rooms are not changed. */
export function withoutType(project: Project, typeId: string): Project {
  return { ...project, entityTypes: project.entityTypes.filter((t) => t.id !== typeId) }
}

/** A new type with an id no other type has, and the project with it added at the end. */
export function withNewType(project: Project): { project: Project; type: EntityType } {
  const type: EntityType = { id: uniqueId('entity', project.entityTypes.map((t) => t.id)), name: 'New entity', colour: '#f5a524', props: [], behaviours: [] }
  return { project: { ...project, entityTypes: [...project.entityTypes, type] }, type }
}

/** The type a page address shows: the one it names, else the first, else none. */
export function pickType(types: EntityType[], id: string | undefined): EntityType | undefined {
  return types.find((t) => t.id === id) ?? types[0]
}

/** The type to show after deleting the one at `index`: the next, else the one before. */
export function typeAfterDelete(types: EntityType[], index: number): EntityType | undefined {
  return types[index + 1] ?? types[index - 1]
}
