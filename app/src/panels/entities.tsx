// The Entities page (US-019): the project's entity types listed on the left, one shown on
// the right with its sprite, its own properties, its behaviours and the rooms that place
// it. It edits studio/project.json as Physics does, so undo acts on the project and the
// grouped steps of US-016 work unchanged. See design/US-019.md.
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { deleteTypeQuestion, pickType, placedCounts, typeAfterDelete, typeUsage, withNewType, withoutType } from '@pecten-studio/core'
import type { EntityType, Project, Sprite } from '@pecten-studio/core'
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { fileUrl } from '../api.ts'
import { Field, Fields, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import type { Selection } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { TypeBehaviours, behaviourNames } from './behaviours.tsx'
import { UndoButtons } from './common.tsx'
import { TypeProperties } from './properties.tsx'
import { Message, useImage } from './views.tsx'

/** A type in a line: its behaviours, and how many properties of its own it has. */
export function typeSummary(type: EntityType): string {
  const n = type.props.length
  return `${behaviourNames(type)}${n ? ` · ${n} ${n === 1 ? 'property' : 'properties'}` : ''}`
}

const LINE = '1px solid #111'
/** Below this width of the page the list goes above the type instead of beside it. */
const NARROW = '@container (max-width: 640px)'

/**
 * A type's look: its sprite's first frame at the largest whole scale that fits `size`
 * (pixels stay square), or a square in its colour when it has no sprite to draw, as the
 * map draws it.
 */
export function TypePicture({ type, sprite, size }: { type: EntityType; sprite: Sprite | undefined; size: number }) {
  const revision = useStudio((s) => s.revision)
  const sheet = useImage(sprite && sprite.image.toLowerCase().endsWith('.png') ? sprite.image : undefined)
  const frame = sprite && sheet && sheet !== 'error' ? sprite.frame : null
  const scale = frame ? Math.max(1, Math.floor(size / Math.max(frame.width, frame.height))) : 1
  return (
    <Box aria-hidden sx={{ width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center', bgcolor: '#191919', border: '1px solid #2a2a2a', borderRadius: '3px', overflow: 'hidden' }}>
      {frame && sheet && sheet !== 'error' ? (
        <Box
          className="pixelated"
          sx={{
            width: frame.width * scale,
            height: frame.height * scale,
            backgroundImage: `url("${fileUrl(sprite!.image, revision)}")`,
            backgroundSize: `${sheet.width * scale}px ${sheet.height * scale}px`,
            backgroundPosition: '0 0',
            backgroundRepeat: 'no-repeat',
          }}
        />
      ) : (
        <Box sx={{ width: size / 2, height: size / 2, bgcolor: type.colour, borderRadius: '2px' }} />
      )}
    </Box>
  )
}

function Heading({ children }: { children: string }) {
  return (
    <Typography variant="caption" component="h2" sx={{ display: 'block', px: 2, pt: 2, pb: 1, m: 0, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {children}
    </Typography>
  )
}

export function EntitiesPage({ selection }: { selection: Selection }) {
  const project = useStudio((s) => s.bundle?.docs.project)
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const sprites = useStudio((s) => s.bundle?.docs.sprites)
  const commit = useStudio((s) => s.commit)
  const select = useStudio((s) => s.select)
  const notice = useStudio((s) => s.notice)
  // The type just added, whose name takes focus.
  const [added, setAdded] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  if (!project) return <Message>The project file is missing or has errors. See Problems.</Message>

  const types = project.entityTypes
  const shown = pickType(types, selection.id)
  const counts = placedCounts(rooms ?? {})
  const open = (type: EntityType | undefined) => select(type ? { kind: 'entities', id: type.id } : { kind: 'entities' })
  const update = (next: Project) => commit('project', undefined, next)
  const add = () => {
    const { project: next, type } = withNewType(project)
    update(next)
    setAdded(type.id)
    open(type)
  }
  const onKey = (event: KeyboardEvent) => {
    const at = shown ? types.indexOf(shown) : -1
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: types.length - 1 }[event.key]
    if (to === undefined || !types.length) return
    event.preventDefault()
    open(types[Math.max(0, Math.min(types.length - 1, to))])
  }

  return (
    // Sized by its dock panel, not the window: the panel can be narrow on a wide screen.
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, containerType: 'inline-size' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, minHeight: BAR.tool, borderBottom: LINE, bgcolor: 'background.default', flexShrink: 0 }}><UndoButtons /></Box>
      {/* Why the last undo or redo did nothing, if it did not: a change here reached the rooms. */}
      {notice && <Typography variant="body2" color="warning.main" role="status" sx={{ px: 2, py: 0.75, bgcolor: 'background.default', borderBottom: LINE, flexShrink: 0 }}>{notice}</Typography>}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', [NARROW]: { flexDirection: 'column' } }}>
        <Box component="nav" aria-label="Entity types" sx={{ width: ui(230), flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: LINE, bgcolor: 'background.default', [NARROW]: { width: '100%', maxHeight: '35%', borderRight: 0, borderBottom: LINE } }}>
          <Box sx={{ p: 1.5, flexShrink: 0 }}>
            <Button variant="outlined" fullWidth startIcon={<AddIcon />} onClick={add}>Add entity type</Button>
          </Box>
          <Box
            ref={list}
            role="listbox"
            aria-label="Entity types"
            tabIndex={types.length ? 0 : -1}
            aria-activedescendant={shown ? `entity-type-${shown.id}` : undefined}
            onKeyDown={onKey}
            sx={{ flex: 1, minHeight: 0, overflow: 'auto', outline: 'none', '&:focus-visible [aria-selected=true]': { outline: '1px solid', outlineColor: 'primary.main', outlineOffset: -1 } }}
          >
            {types.map((type) => {
              const selected = type === shown
              const n = counts[type.id] ?? 0
              return (
                <Box
                  key={type.id}
                  id={`entity-type-${type.id}`}
                  role="option"
                  aria-selected={selected}
                  aria-label={`${type.name}: ${typeSummary(type)}; ${n ? `${n} placed` : 'not placed'}`}
                  onClick={() => { open(type); list.current?.focus() }}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, cursor: 'pointer',
                    borderLeft: '3px solid', borderLeftColor: selected ? type.colour : 'transparent',
                    bgcolor: selected ? 'rgba(76,159,254,0.18)' : 'transparent',
                    '&:hover': { bgcolor: selected ? 'rgba(76,159,254,0.24)' : 'rgba(255,255,255,0.05)' },
                  }}
                >
                  <TypePicture type={type} sprite={type.sprite ? sprites?.[type.sprite] : undefined} size={32} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap>{type.name}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap title={typeSummary(type)}>{typeSummary(type)}</Typography>
                  </Box>
                  <Typography variant="body2" color={n ? 'text.primary' : 'text.secondary'} title={n ? `${n} placed in rooms` : 'Not placed in any room'} sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{n}</Typography>
                </Box>
              )
            })}
          </Box>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
          {shown ? (
            <TypeDetail
              key={shown.id}
              type={shown}
              index={types.indexOf(shown)}
              project={project}
              focusName={added === shown.id}
              onDeleted={(index) => open(typeAfterDelete(types, index))}
            />
          ) : (
            <Box sx={{ p: { xs: 3, md: 5 }, maxWidth: 640 }}>
              <Typography variant="h6" component="h1">No entity types yet</Typography>
              <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>{ABOUT}</Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={add}>Add entity type</Button>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

const ABOUT = 'An entity type is a kind of thing placed in rooms: an enemy, a pickup, a door. Give it properties of its own, which the game’s code reads by name, and behaviours, which the game runs in the order listed. A placed entity can set its own values for them in the room’s panel.'

function TypeDetail({ type, index, project, focusName, onDeleted }: { type: EntityType; index: number; project: Project; focusName: boolean; onDeleted: (index: number) => void }) {
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const sprites = useStudio((s) => s.bundle?.docs.sprites)
  const commit = useStudio((s) => s.commit)
  const select = useStudio((s) => s.select)
  const usage = typeUsage(rooms ?? {}, type.id)
  const placed = usage.reduce((sum, u) => sum + u.count, 0)
  const set = (patch: Partial<EntityType>) => commit('project', undefined, { ...project, entityTypes: project.entityTypes.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
  const remove = () => {
    const question = deleteTypeQuestion(type, usage)
    if (question && !window.confirm(question)) return
    commit('project', undefined, withoutType(project, type.id))
    onDeleted(index)
  }
  const sprite = type.sprite ? sprites?.[type.sprite] : undefined

  return (
    <Box component="article" aria-label={type.name} sx={{ pb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start', flexWrap: 'wrap', px: 2, pt: 2.5, pb: 1.5 }}>
        <TypePicture type={type} sprite={sprite} size={ui(96)} />
        <Box sx={{ flex: '1 1 280px', minWidth: 0, maxWidth: ui(560) }}>
          <Typography variant="h6" component="h1" noWrap>{type.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Id <Box component="code" sx={{ fontFamily: 'monospace' }}>{type.id}</Box> · {placed ? `${placed} placed in ${usage.length} ${usage.length === 1 ? 'room' : 'rooms'}` : 'not placed yet'}
          </Typography>
          <Fields>
            <Field label="Name"><TextInput label="Entity type name" value={type.name} autoFocus={focusName} onCommit={(name) => set({ name })} /></Field>
            <Field label="Colour">
              <input type="color" aria-label={`Colour of ${type.name}`} value={type.colour} onChange={(event) => set({ colour: event.target.value })} style={{ width: ui(28), height: ui(22), padding: 0, border: '1px solid #3a3a3a', background: 'none' }} />
              <Typography variant="body2" color="text.secondary">On the map when it has no sprite, and in lists</Typography>
            </Field>
            <Field label="Sprite">
              <SelectInput label={`Sprite of ${type.name}`} value={type.sprite ?? ''} onChange={(next) => set({ sprite: next || undefined })} options={[{ value: '', label: 'No sprite' }, ...Object.entries(sprites ?? {}).map(([value, s]) => ({ value, label: s.name }))]} />
            </Field>
          </Fields>
        </Box>
        <Button color="error" startIcon={<DeleteOutlinedIcon />} aria-label={`Delete entity type ${type.name}`} onClick={remove} sx={{ flexShrink: 0, ml: 'auto' }}>Delete</Button>
      </Box>
      {/* Side by side when there is room for both forms, one above the other when not. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${ui(340)}px), 1fr))`, alignItems: 'start', borderTop: LINE }}>
        <Box component="section" aria-label={`Properties of ${type.name}`} sx={{ minWidth: 0 }}>
          <Heading>Properties</Heading>
          <TypeProperties type={type} />
        </Box>
        <Box component="section" aria-label={`Behaviours of ${type.name}`} sx={{ minWidth: 0 }}>
          <Heading>Behaviours</Heading>
          <TypeBehaviours type={type} onChange={(next) => set(next)} />
        </Box>
      </Box>
      <Box component="section" aria-label={`Rooms that place ${type.name}`} sx={{ borderTop: LINE }}>
        <Heading>Placed in</Heading>
        {usage.length ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2 }}>
            {usage.map((u) => (
              <Button key={u.room} variant="outlined" size="small" startIcon={<MapOutlinedIcon />} onClick={() => select({ kind: 'room', id: u.room })} aria-label={`Open ${u.roomName}: ${u.count} ${type.name}`} sx={{ textTransform: 'none' }}>
                {u.roomName}
                <Box component="span" sx={{ ml: 1, color: 'text.secondary' }}>{u.count}</Box>
              </Button>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>Not placed in any room yet. Place one with the Entities layer in a room.</Typography>
        )}
      </Box>
    </Box>
  )
}
