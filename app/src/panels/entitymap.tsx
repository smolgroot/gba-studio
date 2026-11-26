// Entities on the map: their markers, and the references between them (US-017). A ref
// property points at another placed entity by its id; the map draws a line to it, or
// an arrow to the room's edge with the name of the room it is in, and Properties picks
// it from a list or by clicking its marker. See design/US-017.md.
import GpsFixedOutlinedIcon from '@mui/icons-material/GpsFixedOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { TILE, findEntity, pointAt, pointersTo, refTargets, refValue } from '@pecten-studio/core'
import type { Entity, EntityType, Point, PropertyDef, RefLink, Room, Sprite } from '@pecten-studio/core'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { fileUrl } from '../api.ts'
import { useEditor } from '../editor.ts'
import { Field, SelectInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { useImage } from './views.tsx'

/** Where a marker is drawn, in room pixels: the sprite's frame placed by its anchor, else a tile-sized square standing on the entity's position. */
export function markerBox(x: number, y: number, sprite: Sprite | undefined): { left: number; top: number; width: number; height: number } {
  return sprite
    ? { left: x - sprite.anchor.x, top: y - sprite.anchor.y, width: sprite.frame.width, height: sprite.frame.height }
    : { left: x - TILE / 2, top: y - TILE, width: TILE, height: TILE }
}

/** An entity on the map: its sprite's first frame if its type has one, else a square in the type's colour. */
export function EntityMarker({ x, y, type, sprite, zoom, selected, interactive, label, pick, broken, ...handlers }: {
  x: number
  y: number
  type: EntityType | undefined
  sprite: Sprite | undefined
  zoom: number
  selected: boolean
  interactive: boolean
  label: string
  /** While a target is picked: whether this one may be chosen. Undefined when nothing is being picked. */
  pick?: boolean
  /** Why one of its references points at nothing, if one does. */
  broken?: string
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: () => void
}) {
  const revision = useStudio((s) => s.revision)
  const sheet = useImage(sprite && sprite.image.toLowerCase().endsWith('.png') ? sprite.image : undefined)
  const drawn = sprite && sheet && sheet !== 'error'
  const box = markerBox(x, y, drawn ? sprite : undefined)
  const outline = selected ? '2px solid #fff' : pick ? '2px solid #4c9ffe' : broken ? '2px dashed #e5484d' : drawn ? 'none' : '1px solid rgba(255,255,255,0.8)'
  return (
    <Box
      title={broken ? `${label}: ${broken}` : label}
      {...handlers}
      onPointerCancel={handlers.onPointerUp}
      className="pixelated"
      sx={{
        position: 'absolute',
        left: box.left * zoom,
        top: box.top * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
        pointerEvents: interactive && pick !== false ? 'auto' : 'none',
        cursor: pick ? 'crosshair' : 'move',
        touchAction: 'none',
        opacity: pick === false ? 0.35 : 1,
        outline,
        outlineOffset: selected || pick || broken ? 1 : 0,
        ...(drawn
          ? { backgroundImage: `url("${fileUrl(sprite.image, revision)}")`, backgroundSize: `${sheet.width * zoom}px ${sheet.height * zoom}px`, backgroundPosition: '0 0', backgroundRepeat: 'no-repeat' }
          : { bgcolor: type?.colour ?? '#888' }),
      }}
    />
  )
}

/** The middle of an entity's marker, where its lines start and end. */
function middle(point: Point, sprite: Sprite | undefined): Point {
  const box = markerBox(point.x, point.y, sprite)
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/** An arrow's head at `to`, pointing away from `from`, `size` pixels long. */
function head(from: Point, to: Point, size: number): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const corner = (turn: number) => `${to.x - size * Math.cos(angle + turn)},${to.y - size * Math.sin(angle + turn)}`
  return `${to.x},${to.y} ${corner(0.45)} ${corner(-0.45)}`
}

/**
 * The lines of a room's references, over the tiles and under the markers. Lines that
 * touch the selected entity are drawn strongest. `pointer` is where the pointer is while
 * a target is picked, in room pixels: a line runs to it from the selected entity.
 */
export function RefLines({ room, links, types, sprites, zoom, selected, pointer, width, height }: {
  room: Room
  links: RefLink[]
  types: readonly EntityType[]
  sprites: Record<string, Sprite> | undefined
  zoom: number
  selected: number | null
  pointer: Point | null
  width: number
  height: number
}) {
  const typeOf = (entity: Entity | undefined) => types.find((t) => t.id === entity?.type)
  const spriteOf = (entity: Entity | undefined) => {
    const sprite = typeOf(entity)?.sprite
    const doc = sprite ? sprites?.[sprite] : undefined
    // Only a PNG sheet is drawn on the map; anything else is a square, as EntityMarker draws it.
    return doc?.image.toLowerCase().endsWith('.png') ? doc : undefined
  }
  const scaled = (p: Point) => ({ x: p.x * zoom, y: p.y * zoom })
  const drawn = links.flatMap((link) => {
    if (link.kind === 'missing') return []
    const source = room.entities[link.entity]
    const from = scaled(middle(link.from, spriteOf(source)))
    const to = scaled(link.kind === 'here' ? middle(link.to, spriteOf(room.entities[link.target])) : link.to)
    const strong = selected === link.entity || (link.kind === 'here' && selected === link.target)
    return [{ link, from, to, strong, colour: typeOf(source)?.colour ?? '#888' }]
  })
  const picking = selected !== null && pointer && room.entities[selected]
  return (
    <>
      <svg width={width * zoom} height={height * zoom} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-hidden>
        {drawn.map(({ link, from, to, strong, colour }) => (
          <g key={`${link.entity}:${link.prop}`} opacity={strong ? 1 : 0.6}>
            {/* A dark edge under the line keeps it visible over any tiles. */}
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(0,0,0,0.6)" strokeWidth={strong ? 4 : 3} />
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={colour} strokeWidth={strong ? 2 : 1.5} strokeDasharray={link.kind === 'away' ? '6 4' : undefined} />
            <polygon points={head(from, to, strong ? 10 : 8)} fill={colour} stroke="rgba(0,0,0,0.6)" strokeWidth={1} />
          </g>
        ))}
        {picking && (() => {
          const from = scaled(middle({ x: picking.x, y: picking.y }, spriteOf(picking)))
          const to = scaled(pointer)
          return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#4c9ffe" strokeWidth={2} strokeDasharray="4 3" />
        })()}
      </svg>
      {/* The name of the room another entity is in, at the end of its arrow: it opens that room. */}
      {drawn.flatMap(({ link, to }) =>
        link.kind === 'away'
          ? [
              <Box
                key={`label:${link.entity}:${link.prop}`}
                component="button"
                type="button"
                title={`${room.entities[link.entity]?.type ?? 'This entity'}'s ${link.prop} points into ${link.roomName}: open it`}
                onClick={() => useStudio.getState().select({ kind: 'room', id: link.room })}
                sx={{
                  position: 'absolute',
                  // Kept inside the room, on the side the arrow leaves by.
                  left: Math.min(Math.max(to.x - 40, 0), width * zoom - 80),
                  top: Math.min(Math.max(to.y - 22, 0), height * zoom - 20),
                  maxWidth: 80,
                  px: 0.75,
                  border: 0,
                  borderRadius: 0.5,
                  bgcolor: 'rgba(0,0,0,0.75)',
                  color: '#fff',
                  font: 'inherit',
                  fontSize: 11,
                  lineHeight: '18px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                }}
              >
                {link.roomName}
              </Box>,
            ]
          : [],
      )}
    </>
  )
}

/**
 * Writes the rooms a reference changed. One room is one undo step on it; when the
 * target in another room was given an id, both go in one grouped step.
 */
export function commitRooms(owner: string, changed: Record<string, Room>): void {
  const { commit, commitGroup } = useStudio.getState()
  const main = changed[owner]
  if (!main) return
  const others = Object.entries(changed).filter(([id]) => id !== owner).map(([id, doc]) => ({ kind: 'room' as const, id, label: doc.name, doc }))
  if (others.length === 0) commit('room', owner, main)
  else commitGroup('a reference was set', { kind: 'room', id: owner }, main, others)
}

/** The field of a ref property of the selected entity: a list of what it may point at, and a button to pick it on the map. */
export function RefInput({ roomId, index, entity, def }: { roomId: string; index: number; entity: Entity; def: PropertyDef }) {
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const types = useStudio((s) => s.bundle?.docs.project?.entityTypes)
  const picking = useEditor((s) => s.picking)
  const set = useEditor((s) => s.set)
  if (!rooms || !types) return null
  const targets = refTargets(rooms, types, roomId, index, def)
  const value = refValue(entity, def)
  const found = typeof value === 'string' && value !== '' ? findEntity(rooms, value) : null
  const current = found ? `${found.room}:${found.index}` : typeof value === 'string' ? value : JSON.stringify(value)
  const options = [{ value: '', label: 'None' }, ...targets.map((t) => ({ value: `${t.room}:${t.index}`, label: t.here ? t.label : `${t.roomName}: ${t.label}` }))]
  // What it holds and the list does not offer stays shown, saying why.
  if (!options.some((o) => o.value === current)) options.push({ value: current, label: found ? `${String(value)} (not a type it may point at)` : `${String(value)} (no entity has it)` })
  const choose = (next: string) => {
    const [room, at] = next.split(':')
    commitRooms(roomId, pointAt(rooms, types, roomId, index, def.name, next === '' ? null : { room: room!, index: Number(at) }))
  }
  const active = picking === def.name
  const canPick = targets.some((t) => t.here)
  return (
    <>
      <SelectInput label={def.name} value={current} onChange={choose} options={options} />
      <IconButton
        aria-label={`Pick what ${def.name} points at on the map`}
        aria-pressed={active}
        title={canPick ? (active ? 'Click an entity on the map, or press Esc to stop' : 'Pick on the map') : 'Nothing in this room that it may point at: choose from the list'}
        disabled={!canPick}
        onClick={() => set({ picking: active ? null : def.name })}
        sx={{ p: 0.5, color: active ? 'primary.main' : 'text.secondary' }}
      >
        <GpsFixedOutlinedIcon />
      </IconButton>
    </>
  )
}

/** The selected entity's id, if it has one, and how many entities point at it. */
export function EntityIdField({ entity }: { entity: Entity }) {
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const types = useStudio((s) => s.bundle?.docs.project?.entityTypes)
  if (entity.id === undefined || !rooms) return null
  const count = pointersTo(rooms, types ?? [], entity.id).length
  return (
    <Field label="Id">
      <Typography variant="body2">
        <Box component="code" sx={{ fontFamily: 'monospace' }}>{entity.id}</Box>
        <Box component="span" sx={{ color: 'text.secondary' }}> · {count === 0 ? 'nothing points at it' : count === 1 ? '1 entity points at it' : `${count} entities point at it`}</Box>
      </Typography>
    </Field>
  )
}
