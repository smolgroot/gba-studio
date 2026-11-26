// References between placed entities (US-017). A `ref` property holds the id of the
// entity it points at. An entity is given an id when something first points at it, and
// an id names one entity in the project, so a reference survives the entity moving and
// the entities before it being deleted. The panel, the map, validation, the section
// writer and the tools share these, so they agree. Codegen does the same in
// codegen/src/refs.rs. See design/US-017.md.
import { entityOverride } from './prefab.ts'
import { Id, SCREEN, docPath } from './schema.ts'
import type { Entity, EntityType, PropertyDef, Room, World } from './schema.ts'

type Rooms = Readonly<Record<string, Room>>

/** Room ids in the order the game numbers rooms and their entities: by id, as codegen sorts them. */
export const roomOrder = (rooms: Rooms): string[] => Object.keys(rooms).sort()

/** A placed entity, found by its room and its place in the room's list. */
export interface PlacedEntity {
  room: string
  index: number
  entity: Entity
}

/** Every entity that has an id, by id. When two share one, the first in the game's order is kept: validation reports the other. */
export function entitiesById(rooms: Rooms): Map<string, PlacedEntity> {
  const out = new Map<string, PlacedEntity>()
  for (const room of roomOrder(rooms)) {
    rooms[room]!.entities.forEach((entity, index) => {
      if (entity.id !== undefined && !out.has(entity.id)) out.set(entity.id, { room, index, entity })
    })
  }
  return out
}

/**
 * The game's number for each entity that has an id: entities counted room by room,
 * rooms in id order, as `World::entity_index` counts them. A reference is written to the
 * ROM as this number.
 */
export function entityNumbers(rooms: Rooms): Map<string, number> {
  const out = new Map<string, number>()
  let number = 0
  for (const room of roomOrder(rooms)) {
    for (const entity of rooms[room]!.entities) {
      if (entity.id !== undefined && !out.has(entity.id)) out.set(entity.id, number)
      number++
    }
  }
  return out
}

/** The entity with this id, if one has it. */
export function findEntity(rooms: Rooms, id: string): PlacedEntity | null {
  return entitiesById(rooms).get(id) ?? null
}

/** A type's properties that point at another entity. */
export const refProps = (type: EntityType): PropertyDef[] => type.props.filter((p) => p.type === 'ref')

/** What a reference of an entity holds: its own value, else its type's, which is always "" (none). */
export const refValue = (entity: Entity, def: PropertyDef): unknown => entity.props[def.name] ?? def.default

/** A value a reference can follow: an id. "" (none) and values of the wrong kind are not. */
const followable = (value: unknown): value is string => typeof value === 'string' && value !== '' && Id.safeParse(value).success

/** An id no entity has, for an entity of `typeId`: `door-1`, `door-2`…, cut to the 48 characters an id may have. */
export function freeEntityId(rooms: Rooms, typeId: string): string {
  const taken = new Set(Object.values(rooms).flatMap((room) => room.entities.flatMap((e) => (e.id === undefined ? [] : [e.id]))))
  for (let n = 1; ; n++) {
    const suffix = `-${n}`
    const id = typeId.slice(0, 48 - suffix.length) + suffix
    if (!taken.has(id)) return id
  }
}

/** An entity a reference may point at, as the panel offers it. */
export interface RefTarget {
  room: string
  roomName: string
  index: number
  type: string
  /** Its id, if it has one yet: choosing it gives it one if not. */
  id: string | undefined
  /** In the room of the entity that points: offered first. */
  here: boolean
  /** "door-1 · Door at 120, 96", or "Door at 120, 96 (entity 4)" for one with no id yet. */
  label: string
}

/**
 * The entities that the property `def` of the entity at `index` in `roomId` may point
 * at: of the types it allows, never the entity itself; this room's first, then the
 * other rooms' in the game's order.
 */
export function refTargets(rooms: Rooms, types: readonly EntityType[], roomId: string, index: number, def: PropertyDef): RefTarget[] {
  const order = [roomId, ...roomOrder(rooms).filter((r) => r !== roomId)].filter((r) => rooms[r])
  return order.flatMap((room) =>
    rooms[room]!.entities.flatMap((entity, n): RefTarget[] => {
      if (room === roomId && n === index) return []
      if (def.types && !def.types.includes(entity.type)) return []
      const name = types.find((t) => t.id === entity.type)?.name ?? entity.type
      const at = `${name} at ${entity.x}, ${entity.y}`
      return [{ room, roomName: rooms[room]!.name, index: n, type: entity.type, id: entity.id, here: room === roomId, label: entity.id ? `${entity.id} · ${at}` : `${at} (entity ${n})` }]
    }),
  )
}

const withEntity = (room: Room, index: number, entity: Entity): Room => ({ ...room, entities: room.entities.map((e, i) => (i === index ? entity : e)) })

/**
 * The rooms that change when the entity at `index` in `roomId` points its property
 * `prop` at `target` (null: at nothing), and only those. A target that has no id is
 * given one in the same change. A value equal to the type's ("", none) is not stored.
 */
export function pointAt(rooms: Rooms, types: readonly EntityType[], roomId: string, index: number, prop: string, target: { room: string; index: number } | null): Record<string, Room> {
  const out: Record<string, Room> = {}
  const get = (id: string) => out[id] ?? rooms[id]
  let value = ''
  if (target) {
    const room = get(target.room)
    const entity = room?.entities[target.index]
    if (!room || !entity) return {}
    value = entity.id ?? freeEntityId(rooms, entity.type)
    if (entity.id === undefined) out[target.room] = withEntity(room, target.index, { ...entity, id: value })
  }
  const room = get(roomId)
  const entity = room?.entities[index]
  if (!room || !entity) return {}
  const type = types.find((t) => t.id === entity.type)
  const props = type ? entityOverride(type, entity.props, prop, value) : { ...entity.props, [prop]: value }
  out[roomId] = withEntity(room, index, { ...entity, props })
  return out
}

/** An entity whose reference holds an id. */
export interface Pointer {
  room: string
  roomName: string
  index: number
  prop: string
}

/** The entities that point at `id`, in the game's order. */
export function pointersTo(rooms: Rooms, types: readonly EntityType[], id: string): Pointer[] {
  return roomOrder(rooms).flatMap((room) =>
    rooms[room]!.entities.flatMap((entity, index) => {
      const type = types.find((t) => t.id === entity.type)
      return type ? refProps(type).filter((def) => refValue(entity, def) === id).map((def) => ({ room, roomName: rooms[room]!.name, index, prop: def.name })) : []
    }),
  )
}

export interface Point {
  x: number
  y: number
}

/** A line the map draws for one reference. Points are an entity's position (its feet) in the room's pixels. */
export type RefLink =
  | { entity: number; prop: string; kind: 'here'; from: Point; to: Point; target: number }
  /** To another room: `to` is on this room's edge, towards where the target is on the world map. */
  | { entity: number; prop: string; kind: 'away'; from: Point; to: Point; room: string; roomName: string }
  /** It holds an id no entity has. */
  | { entity: number; prop: string; kind: 'missing'; from: Point; value: string }

/** How far a stub reaches when the direction to another room is not known: neither room is on the map, or both are in the same spot. */
const STUB = 24

/** The point where a ray from `from` along `d` leaves the rectangle 0..w by 0..h. */
function toEdge(from: Point, d: Point, w: number, h: number): Point {
  const along = (p: number, v: number, size: number) => (v > 0 ? (size - p) / v : v < 0 ? -p / v : Infinity)
  const t = Math.max(0, Math.min(along(from.x, d.x, w), along(from.y, d.y, h)))
  return { x: Math.round(from.x + d.x * t), y: Math.round(from.y + d.y * t) }
}

/**
 * The lines the map draws for the references of a room's entities. `moved` is an entity
 * being dragged, so its lines follow it before the move is saved.
 */
export function refLinks(rooms: Rooms, types: readonly EntityType[], world: World | undefined, roomId: string, moved?: { index: number; x: number; y: number } | null): RefLink[] {
  const room = rooms[roomId]
  if (!room) return []
  const byId = entitiesById(rooms)
  const at = (r: string, index: number, entity: Entity): Point => (r === roomId && moved?.index === index ? { x: moved.x, y: moved.y } : { x: entity.x, y: entity.y })
  const origin = (r: string): Point | null => {
    const placed = world?.rooms.find((p) => p.room === r)
    return placed ? { x: placed.x * SCREEN.width, y: placed.y * SCREEN.height } : null
  }
  const [w, h] = [room.width * SCREEN.width, room.height * SCREEN.height]
  return room.entities.flatMap((entity, index): RefLink[] => {
    const type = types.find((t) => t.id === entity.type)
    if (!type) return []
    const from = at(roomId, index, entity)
    return refProps(type).flatMap((def): RefLink[] => {
      const value = refValue(entity, def)
      if (!followable(value)) return []
      const target = byId.get(value)
      if (!target) return [{ entity: index, prop: def.name, kind: 'missing', from, value }]
      const to = at(target.room, target.index, target.entity)
      if (target.room === roomId) return [{ entity: index, prop: def.name, kind: 'here', from, to, target: target.index }]
      const [here, there] = [origin(roomId), origin(target.room)]
      const d = here && there ? { x: there.x + to.x - here.x - from.x, y: there.y + to.y - here.y - from.y } : { x: 0, y: 0 }
      const end = d.x !== 0 || d.y !== 0
        ? toEdge(from, d, w, h)
        : { x: Math.min(w, Math.max(0, from.x + STUB)), y: Math.min(h, Math.max(0, from.y - STUB)) }
      return [{ entity: index, prop: def.name, kind: 'away', from, to: end, room: target.room, roomName: rooms[target.room]!.name }]
    })
  })
}

/**
 * What is wrong with the project's references, as errors in the file they are in: a
 * reference to an id no entity has, to an entity of a type it may not point at, an id
 * two entities have, and a limit naming a type the project does not have. Codegen
 * reports the same, in the same words (codegen/fixture/bad-refs/expected.txt).
 */
export function refProblems(docs: { project?: { entityTypes: EntityType[] }; rooms: Rooms }): { file: string; message: string }[] {
  const problems: { file: string; message: string }[] = []
  const types = docs.project?.entityTypes ?? []
  const typeIds = new Set(types.map((t) => t.id))
  for (const type of types) {
    for (const def of refProps(type)) {
      for (const allowed of def.types ?? []) {
        if (!typeIds.has(allowed)) problems.push({ file: docPath('project'), message: `entity type "${type.id}": property "${def.name}" may point at type "${allowed}", which the project does not have` })
      }
    }
  }
  const byId = entitiesById(docs.rooms)
  for (const room of roomOrder(docs.rooms)) {
    const file = docPath('room', room)
    docs.rooms[room]!.entities.forEach((entity, index) => {
      const first = entity.id === undefined ? undefined : byId.get(entity.id)
      if (first && (first.room !== room || first.index !== index)) {
        problems.push({ file, message: `entity ${index} (${entity.type}) has id "${entity.id}", which entity ${first.index} of ${first.room} has too; an id names one entity, so change or remove one of them` })
      }
      const type = types.find((t) => t.id === entity.type)
      if (!type) return
      for (const def of refProps(type)) {
        const value = refValue(entity, def)
        if (!followable(value)) continue
        const target = byId.get(value)
        if (!target) {
          problems.push({ file, message: `entity ${index} (${entity.type}): ${def.name} points at "${value}", which no entity has. It was deleted, or its id changed: pick another target or set it to None` })
        } else if (def.types && !def.types.includes(target.entity.type)) {
          problems.push({ file, message: `entity ${index} (${entity.type}): ${def.name} points at "${value}", of type "${target.entity.type}"; it may point at type ${def.types.map((t) => `"${t}"`).join(' or ')}` })
        }
      }
    })
  }
  return problems
}
