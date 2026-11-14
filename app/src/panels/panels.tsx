// The docked panels: project tree, the open document, its properties, and problems.
import AddIcon from '@mui/icons-material/Add'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import AudiotrackIcon from '@mui/icons-material/Audiotrack'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import GridOnIcon from '@mui/icons-material/GridOn'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import ViewListIcon from '@mui/icons-material/ViewList'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined'
import PublicIcon from '@mui/icons-material/Public'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { SCREEN, uniqueId } from '@pecten-studio/core'
import type { MultiKind, Project } from '@pecten-studio/core'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Checkbox, Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { selectionKey, useStudio } from '../store.ts'
import type { Selection } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { AudioEditor } from './audio.tsx'
import { PixelEditor } from './pixel.tsx'
import { PlayView } from './play.tsx'
import { UndoButtons } from './common.tsx'
import { CreateDialog, NewImageDialog } from './create.tsx'
import { Heading, RoomEditor, RoomProperties } from './room.tsx'
import { SpriteEditor, SpriteProperties } from './sprite.tsx'
import { TilesetEditor, TilesetProperties } from './tileset.tsx'
import { AssetView, Message, useImage } from './views.tsx'
import { WorldEditor } from './world.tsx'

const iconSx = { mr: 1.5, color: 'text.secondary', flexShrink: 0 } as const
const tint = (color: string) => ({ ...iconSx, color }) as const
const roomSx = tint('#4caf50')
const tilesetSx = tint('#00bcd4')
const spriteSx = tint('#2196f3')
const audioFileSx = tint('#f44336')
const imageFileSx = tint('#fdd835')
const AUDIO_EXT = /\.(wav|mid|midi|sf2|xm|mod|mp3|ogg)$/i
const IMAGE_EXT = /\.(png|aseprite|ase|gif|jpe?g|bmp)$/i

const COLLAPSED_KEY = 'pecten-studio:collapsed-sections'
function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') } catch { return {} }
}

const HEIGHTS_KEY = 'pecten-studio:section-heights'
/** Sizes the user dragged each section to, in px by title. A section with none grows with its list up to [`DEFAULT_MAX`]. */
function loadHeights(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(HEIGHTS_KEY) ?? '{}') } catch { return {} }
}
function saveHeight(title: string, height: number | null) {
  const heights = loadHeights()
  if (height === null) delete heights[title]
  else heights[title] = height
  try { localStorage.setItem(HEIGHTS_KEY, JSON.stringify(heights)) } catch { /* storage unavailable */ }
}
const DEFAULT_MAX = 280
const MIN_HEIGHT = 56
const MAX_HEIGHT = 1200
const KEY_STEP = 24

/** A collapsible group of the sidebar. Its list scrolls inside the section, and the bar under it drags (or, focused, arrow-keys) to resize it; double-click puts it back. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => !!loadCollapsed()[title])
  const [height, setHeight] = useState<number | null>(() => loadHeights()[title] ?? null)
  const body = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; height: number } | null>(null)
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...loadCollapsed(), [title]: next })) } catch { /* storage unavailable */ }
  }
  const resize = (next: number | null, keep = true) => {
    const clamped = next === null ? null : Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(next)))
    setHeight(clamped)
    if (keep) saveHeight(title, clamped)
  }
  const current = () => body.current?.offsetHeight ?? DEFAULT_MAX
  return (
    <Box component="section">
      <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'background.default', pr: 1 }}>
        <ButtonBase
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
          sx={{ flex: 1, justifyContent: 'flex-start', px: 1, py: 1, minWidth: 0 }}
        >
          {collapsed ? <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} /> : <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
          <Typography variant="caption" component="h2" sx={{ pl: 0.5, m: 0, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {title}
          </Typography>
        </ButtonBase>
        {action}
      </Box>
      {!collapsed && (
        <>
          <Box
            ref={body}
            tabIndex={-1}
            sx={{ overflowY: 'auto', overflowX: 'hidden', ...(height === null ? { maxHeight: DEFAULT_MAX } : { height }) }}
          >
            {children}
          </Box>
          <Tooltip title="Drag to resize, double-click to reset" placement="left" enterDelay={600}>
            <Box
              role="separator"
              aria-orientation="horizontal"
              aria-label={`Resize ${title}`}
              aria-valuenow={height ?? undefined}
              aria-valuemin={MIN_HEIGHT}
              aria-valuemax={MAX_HEIGHT}
              tabIndex={0}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                drag.current = { y: e.clientY, height: current() }
              }}
              onPointerMove={(e) => {
                if (drag.current) resize(drag.current.height + e.clientY - drag.current.y, false)
              }}
              onPointerUp={(e) => {
                if (!drag.current) return
                e.currentTarget.releasePointerCapture(e.pointerId)
                drag.current = null
                saveHeight(title, height)
              }}
              onPointerCancel={() => { drag.current = null }}
              onDoubleClick={() => resize(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  resize(current() + (e.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP))
                } else if (e.key === 'Home' || e.key === 'Escape') {
                  resize(null)
                }
              }}
              sx={{
                height: 8,
                cursor: 'row-resize',
                touchAction: 'none',
                borderBottom: 1,
                borderColor: 'divider',
                position: 'relative',
                '&::after': { content: '""', position: 'absolute', left: '50%', top: 3, width: 28, height: 2, ml: '-14px', borderRadius: 1, bgcolor: 'text.disabled' },
                '&:hover, &:focus-visible': { bgcolor: 'action.hover', outline: 'none' },
                '&:hover::after, &:focus-visible::after': { bgcolor: 'primary.main' },
              }}
            />
          </Tooltip>
        </>
      )}
    </Box>
  )
}

function Row({ selection, icon, label, detail, indent = 0 }: { selection: Selection; icon: ReactNode; label: string; detail?: string; indent?: number }) {
  const selected = useStudio((s) => selectionKey(s.selection) === selectionKey(selection))
  const select = useStudio((s) => s.select)
  return (
    <ListItemButton selected={selected} onClick={() => select(selection)} sx={{ px: 2, pl: 2 + indent * 1.5, minHeight: { xs: BAR.touchRow, md: BAR.row } }}>
      {icon}
      <Typography noWrap sx={{ flex: 1 }}>{label}</Typography>
      {detail && <Typography variant="body2" color="text.secondary" noWrap sx={{ ml: 2 }}>{detail}</Typography>}
    </ListItemButton>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>{children}</Typography>
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function AddButton({ title, onClick, disabled }: { title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton aria-label={title} disabled={disabled} onClick={onClick} sx={{ p: 0.5 }}><AddIcon /></IconButton>
      </span>
    </Tooltip>
  )
}

type Asset = { path: string; size: number }
type Dir = { dirs: Map<string, Dir>; files: Asset[] }

function AssetRow({ asset, label, indent }: { asset: Asset; label: string; indent?: number }) {
  return (
    <Row
      selection={{ kind: 'asset', id: asset.path }}
      icon={AUDIO_EXT.test(asset.path) ? <AudiotrackIcon sx={audioFileSx} /> : IMAGE_EXT.test(asset.path) ? <ImageOutlinedIcon sx={imageFileSx} /> : <InsertDriveFileOutlinedIcon sx={iconSx} />}
      label={label}
      detail={formatSize(asset.size)}
      indent={indent}
    />
  )
}

function AssetTree({ assets }: { assets: Asset[] }) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const root: Dir = { dirs: new Map(), files: [] }
  for (const asset of assets) {
    const parts = asset.path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), files: [] })
      dir = dir.dirs.get(part)!
    }
    dir.files.push(asset)
  }
  const toggle = (path: string) => setClosed((c) => {
    const next = new Set(c)
    if (!next.delete(path)) next.add(path)
    return next
  })
  const render = (dir: Dir, prefix: string, depth: number): ReactNode[] => [
    ...[...dir.dirs].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, child]) => {
      const path = prefix + name
      const open = !closed.has(path)
      return [
        <ListItemButton key={`dir:${path}`} onClick={() => toggle(path)} aria-expanded={open} sx={{ px: 2, pl: 2 + depth * 1.5, minHeight: { xs: BAR.touchRow, md: BAR.row } }}>
          {open ? <ExpandMoreIcon sx={iconSx} /> : <ChevronRightIcon sx={iconSx} />}
          <FolderOutlinedIcon sx={iconSx} />
          <Typography noWrap sx={{ flex: 1 }}>{name}</Typography>
        </ListItemButton>,
        ...(open ? render(child, `${path}/`, depth + 1) : []),
      ]
    }),
    ...dir.files.map((asset) => <AssetRow key={asset.path} asset={asset} label={asset.path.split('/').pop()!} indent={depth} />),
  ]
  return <>{render(root, '', 0)}</>
}

export function ProjectPanel() {
  const bundle = useStudio((s) => s.bundle)
  const [creating, setCreating] = useState<MultiKind | 'image' | null>(null)
  const [tree, setTree] = useState(() => {
    try { return localStorage.getItem('assetTree') === '1' } catch { return false }
  })
  const toggleTree = (value: boolean) => {
    setTree(value)
    try { localStorage.setItem('assetTree', value ? '1' : '0') } catch { /* ignore */ }
  }
  if (!bundle) return null
  const { docs, assets } = bundle
  const rooms = Object.entries(docs.rooms)
  const tilesets = Object.entries(docs.tilesets)
  const sprites = Object.entries(docs.sprites)
  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <List>
        <Row selection={{ kind: 'world' }} icon={<PublicIcon sx={iconSx} />} label="World" detail={`${docs.world?.rooms.length ?? 0} rooms`} />
        <Row selection={{ kind: 'project' }} icon={<SettingsOutlinedIcon sx={iconSx} />} label="Project settings" />
        <Row selection={{ kind: 'play' }} icon={<PlayCircleOutlineIcon sx={iconSx} />} label="Play" />
        <Row selection={{ kind: 'audio' }} icon={<AudiotrackIcon sx={iconSx} />} label="Audio" detail={`${docs.audio?.tracks.length ?? 0} tracks · ${docs.audio?.sfx.length ?? 0} sounds`} />
      </List>
      <Section title="Rooms" action={<AddButton title={tilesets.length ? 'New room' : 'A room needs a tileset: create one first'} disabled={!tilesets.length} onClick={() => setCreating('room')} />}>
        <List>
          {rooms.map(([id, room]) => (
            <Row key={id} selection={{ kind: 'room', id }} icon={<MapOutlinedIcon sx={roomSx} />} label={room.name} detail={`${room.width}×${room.height}`} />
          ))}
        </List>
        {rooms.length === 0 && <Empty>No rooms yet.</Empty>}
      </Section>
      <Section title="Tilesets" action={<AddButton title="New tileset from a PNG" onClick={() => setCreating('tileset')} />}>
        <List>
          {tilesets.map(([id, tileset]) => (
            <Row key={id} selection={{ kind: 'tileset', id }} icon={<GridOnIcon sx={tilesetSx} />} label={tileset.name} />
          ))}
        </List>
        {tilesets.length === 0 && <Empty>No tilesets yet.</Empty>}
      </Section>
      <Section title="Sprites" action={<AddButton title="New sprite from a sheet" onClick={() => setCreating('sprite')} />}>
        <List>
          {sprites.map(([id, sprite]) => (
            <Row key={id} selection={{ kind: 'sprite', id }} icon={<DirectionsRunIcon sx={spriteSx} />} label={sprite.name} detail={`${sprite.frame.width}×${sprite.frame.height} · ${sprite.animations.length} anim`} />
          ))}
        </List>
        {sprites.length === 0 && <Empty>No sprites yet.</Empty>}
      </Section>
      <Section
        title="Asset files"
        action={
          <>
            <Tooltip title={tree ? 'Show as a plain list' : 'Show as a directory tree'}>
              <IconButton aria-label={tree ? 'Show assets as a plain list' : 'Show assets as a directory tree'} onClick={() => toggleTree(!tree)} sx={{ p: 0.5 }}>
                {tree ? <ViewListIcon /> : <AccountTreeOutlinedIcon />}
              </IconButton>
            </Tooltip>
            <AddButton title="New blank image to draw" onClick={() => setCreating('image')} />
          </>
        }
      >
        <List>{tree ? <AssetTree assets={assets} /> : assets.map((asset) => <AssetRow key={asset.path} asset={asset} label={asset.path} />)}</List>
        {assets.length === 0 && <Empty>No PNG, Aseprite, MIDI, SF2, XM, MOD or WAV files in this folder.</Empty>}
      </Section>
      {creating === 'image' && <NewImageDialog onClose={() => setCreating(null)} />}
      {creating && creating !== 'image' && <CreateDialog kind={creating} onClose={() => setCreating(null)} />}
    </Box>
  )
}

export function DocumentPanel({ selection }: { selection: Selection }) {
  const { kind, id } = selection
  switch (kind) {
    case 'world': return <WorldEditor />
    case 'room': return <RoomEditor id={id!} />
    case 'tileset': return <TilesetEditor id={id!} />
    case 'sprite': return <SpriteEditor id={id!} />
    case 'asset': return /\.png$/i.test(id!) ? <PixelEditor path={id!} /> : <AssetView path={id!} />
    case 'project': return <ProjectSettings />
    case 'audio': return <AudioEditor />
    case 'play': return <PlayView />
  }
}

function ProjectSettings() {
  const project = useStudio((s) => s.bundle?.docs.project)
  const sprites = useStudio((s) => s.bundle?.docs.sprites)
  const commit = useStudio((s) => s.commit)
  if (!project) return <Message>The project file is missing or has errors. See Problems.</Message>
  const update = (patch: Partial<Project>) => commit('project', undefined, { ...project, ...patch })
  const build = (key: keyof Project['build'], label: string) => (
    <Field label={label}><TextInput label={label} value={project.build[key]} onCommit={(value) => update({ build: { ...project.build, [key]: value } })} /></Field>
  )
  const setType = (index: number, patch: Partial<Project['entityTypes'][number]>) => update({ entityTypes: project.entityTypes.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
  const cell = { px: 2, py: 0.75, minWidth: 0 } as const
  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, minHeight: BAR.tool, borderBottom: '1px solid #111', bgcolor: 'background.default' }}><UndoButtons /></Box>
      <Heading>Project</Heading>
      <Fields>
        <Field label="Name"><TextInput label="Project name" value={project.name} onCommit={(name) => update({ name })} /></Field>
      </Fields>
      <Heading>Build</Heading>
      <Fields>
        {build('dev', 'Dev build command')}
        {build('devRom', 'Dev ROM')}
        {build('release', 'Release build command')}
        {build('releaseRom', 'Release ROM')}
      </Fields>
      <Heading>Entity types</Heading>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(100px, 1.5fr) minmax(100px, 1fr) max-content', alignItems: 'center' }}>
        {project.entityTypes.map((type, index) => (
          <Box key={type.id} sx={{ display: 'contents' }}>
            <Box sx={cell}>
              <input type="color" aria-label={`Colour of ${type.name}`} value={type.colour} onChange={(event) => setType(index, { colour: event.target.value })} style={{ width: ui(22), height: ui(22), padding: 0, border: '1px solid #3a3a3a', background: 'none' }} />
            </Box>
            <Box sx={cell}><TextInput label="Entity type name" value={type.name} onCommit={(name) => setType(index, { name })} /></Box>
            <Box sx={cell}>
              <SelectInput label={`Sprite of ${type.name}`} value={type.sprite ?? ''} onChange={(sprite) => setType(index, { sprite: sprite || undefined })} options={[{ value: '', label: 'No sprite' }, ...Object.entries(sprites ?? {}).map(([value, s]) => ({ value, label: s.name }))]} />
            </Box>
            <Box sx={cell}>
              <IconButton aria-label={`Delete entity type ${type.name}`} onClick={() => update({ entityTypes: project.entityTypes.filter((_, i) => i !== index) })}><DeleteOutlinedIcon /></IconButton>
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ px: 2, py: 1 }}>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => update({ entityTypes: [...project.entityTypes, { id: uniqueId('entity', project.entityTypes.map((t) => t.id)), name: 'New entity', colour: '#f5a524', props: [] }] })}
        >
          Add entity type
        </Button>
      </Box>
      <Empty>An entity type is a kind of thing placed in rooms: an enemy, a pickup, a door. What it does is written in the game's code. Typed properties are edited in studio/project.json for now.</Empty>
      <Heading>Collision classes</Heading>
      <Box component="dl" sx={{ m: 0, px: 2, py: 1, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 0.5 }}>
        {project.collisionClasses.map((c) => (
          <Box key={c.id} sx={{ display: 'contents' }}>
            <Box component="dt" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: ui(10), height: ui(10), bgcolor: c.colour, border: '1px solid rgba(255,255,255,0.3)', flexShrink: 0 }} />
              <Typography>{c.name}</Typography>
            </Box>
            <Typography component="dd" color="text.secondary" sx={{ m: 0 }}>{c.slope ? `${c.kind}, floor from ${c.slope.left} to ${c.slope.right} px` : c.kind}</Typography>
          </Box>
        ))}
      </Box>
      <Empty>Collision classes are edited in studio/project.json for now.</Empty>
    </Box>
  )
}

/** Deletes the open room, tileset or sprite after asking. */
function DeleteButton({ kind, id, name }: { kind: MultiKind; id: string; name: string }) {
  const remove = useStudio((s) => s.remove)
  const commit = useStudio((s) => s.commit)
  return (
    <Box sx={{ px: 2, py: 2 }}>
      <Button
        color="error"
        startIcon={<DeleteOutlinedIcon />}
        onClick={() => {
          if (!window.confirm(`Delete the ${kind} “${name}”? Its file is removed from the game folder and this cannot be undone here.`)) return
          const world = useStudio.getState().bundle?.docs.world
          if (kind === 'room' && world?.rooms.some((p) => p.room === id)) {
            commit('world', undefined, { ...world, rooms: world.rooms.filter((p) => p.room !== id), start: world.start === id ? undefined : world.start })
          }
          void remove(kind, id)
        }}
      >
        Delete {kind}
      </Button>
    </Box>
  )
}

export function PropertiesPanel() {
  const selection = useStudio((s) => s.selection)
  const bundle = useStudio((s) => s.bundle)
  const commit = useStudio((s) => s.commit)
  if (!bundle) return null
  const { docs } = bundle
  const { kind, id } = selection
  let body: ReactNode = null
  if (kind === 'room' && docs.rooms[id!]) {
    body = <><RoomProperties id={id!} /><DeleteButton kind="room" id={id!} name={docs.rooms[id!]!.name} /></>
  } else if (kind === 'tileset' && docs.tilesets[id!]) {
    body = <><TilesetProperties id={id!} /><DeleteButton kind="tileset" id={id!} name={docs.tilesets[id!]!.name} /></>
  } else if (kind === 'sprite' && docs.sprites[id!]) {
    body = <><SpriteProperties id={id!} /><DeleteButton kind="sprite" id={id!} name={docs.sprites[id!]!.name} /></>
  } else if (kind === 'world' && docs.world) {
    const world = docs.world
    body = (
      <Fields>
        <Field label="Rooms on the map"><Typography>{world.rooms.length}</Typography></Field>
        <Field label="Start room">
          <SelectInput label="Start room" value={world.start ?? ''} onChange={(start) => commit('world', undefined, { ...world, start: start || undefined })} options={[{ value: '', label: 'None' }, ...world.rooms.filter((p) => docs.rooms[p.room]).map((p) => ({ value: p.room, label: docs.rooms[p.room]!.name }))]} />
        </Field>
        <Field label="Map size">
          <Checkbox
            checked={!!world.size}
            onChange={(on) => {
              if (!on) return commit('world', undefined, { ...world, size: undefined })
              // Start from what the rooms cover now, moved so the map begins at screen 0, 0.
              const placed = world.rooms.filter((p) => docs.rooms[p.room])
              const minX = Math.min(0, ...placed.map((p) => p.x))
              const minY = Math.min(0, ...placed.map((p) => p.y))
              const width = Math.max(1, ...placed.map((p) => p.x - minX + docs.rooms[p.room]!.width))
              const height = Math.max(1, ...placed.map((p) => p.y - minY + docs.rooms[p.room]!.height))
              commit('world', undefined, { ...world, rooms: world.rooms.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY })), size: { width, height } })
            }}
          >
            Set a size
          </Checkbox>
        </Field>
        {world.size && (
          <Field label="Screens">
            <NumberInput label="Map width in screens" value={world.size.width} min={1} max={256} onCommit={(width) => commit('world', undefined, { ...world, size: { ...world.size!, width } })} />
            <Typography color="text.secondary">×</Typography>
            <NumberInput label="Map height in screens" value={world.size.height} min={1} max={256} onCommit={(height) => commit('world', undefined, { ...world, size: { ...world.size!, height } })} />
          </Field>
        )}
        {world.size && <Field label="In tiles"><Typography>{world.size.width * SCREEN.cols} × {world.size.height * SCREEN.rows}</Typography></Field>}
        <Field label="One screen"><Typography>{SCREEN.width} × {SCREEN.height} px, {SCREEN.cols} × {SCREEN.rows} tiles</Typography></Field>
      </Fields>
    )
  } else if (kind === 'asset') {
    body = <AssetProperties path={id!} />
  } else if (kind === 'project' && docs.project) {
    body = (
      <Fields>
        <Field label="Folder"><Typography>{bundle.folder}</Typography></Field>
        <Field label="Format version"><Typography>{docs.project.version}</Typography></Field>
      </Fields>
    )
  } else if (kind === 'play') {
    body = <Empty>Plays the ROM from the last build. Rebuilds restart it while “Restart on rebuild” is on.</Empty>
  } else if (kind === 'audio' && docs.audio) {
    body = (
      <Fields>
        <Field label="Tracks"><Typography>{docs.audio.tracks.length}</Typography></Field>
        <Field label="Sound effects"><Typography>{docs.audio.sfx.length}</Typography></Field>
      </Fields>
    )
  }
  if (!body) return <Empty>Nothing to show for this item.</Empty>
  return <Box sx={{ height: '100%', overflow: 'auto' }}>{body}</Box>
}

/** A file's path and size, its pixel size if it is a picture, and the items that use it. */
function AssetProperties({ path }: { path: string }) {
  const bundle = useStudio((s) => s.bundle!)
  const select = useStudio((s) => s.select)
  const png = /\.png$/i.test(path)
  const image = useImage(png ? path : undefined)
  const asset = bundle.assets.find((a) => a.path === path)
  const { docs } = bundle
  const users: Array<{ selection: Selection; label: string }> = [
    ...Object.entries(docs.tilesets).filter(([, t]) => t.image === path).map(([id, t]) => ({ selection: { kind: 'tileset', id } as Selection, label: `Tileset ${t.name}` })),
    ...Object.entries(docs.sprites).filter(([, s]) => s.image === path).map(([id, s]) => ({ selection: { kind: 'sprite', id } as Selection, label: `Sprite ${s.name}` })),
    ...Object.entries(docs.rooms).filter(([, r]) => r.backgrounds?.some((b) => b.image === path)).map(([id, r]) => ({ selection: { kind: 'room', id } as Selection, label: `Background of ${r.name}` })),
    ...(docs.audio?.tracks ?? []).filter((t) => t.file === path || t.soundfont === path).map((t) => ({ selection: { kind: 'audio' } as Selection, label: `Track ${t.name}` })),
    ...(docs.audio?.sfx ?? []).filter((s) => s.file === path).map((s) => ({ selection: { kind: 'audio' } as Selection, label: `Sound ${s.name}` })),
  ]
  return (
    <Fields>
      <Field label="Path"><Typography sx={{ overflowWrap: 'anywhere' }}>{path}</Typography></Field>
      <Field label="Size"><Typography>{asset ? formatSize(asset.size) : 'file is gone'}</Typography></Field>
      {image && image !== 'error' && <Field label="Pixels"><Typography>{image.width} × {image.height}{image.width % 8 || image.height % 8 ? ' (not a multiple of 8)' : ` · ${image.width / 8} × ${image.height / 8} tiles`}</Typography></Field>}
      <Field label="Used by">
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          {users.length === 0 && <Typography color="text.secondary">Nothing yet</Typography>}
          {users.map((u, i) => <Button key={i} variant="text" size="small" sx={{ px: 0.5, minWidth: 0 }} onClick={() => select(u.selection)}>{u.label}</Button>)}
        </Box>
      </Field>
      {png && <Field label=""><Typography color="text.secondary">Draw on this file in the pixel editor. It saves by itself.</Typography></Field>}
    </Fields>
  )
}

/** The item a problem's file belongs to, if it is one that opens. */
function selectionForFile(file: string): Selection | null {
  const match = /^studio\/(?:(room|tileset|sprite)s\/([^/]+)|(world|project|audio))\.json$/.exec(file)
  if (!match) return null
  return match[1] ? { kind: match[1] as 'room' | 'tileset' | 'sprite', id: match[2]! } : { kind: match[3] as 'world' | 'project' | 'audio' }
}

export function ProblemsPanel() {
  const problems = useStudio((s) => s.bundle?.problems)
  const select = useStudio((s) => s.select)
  if (!problems) return null
  if (problems.length === 0) return <Empty>No problems found.</Empty>
  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <List>
        {problems.map((problem, i) => {
          const target = selectionForFile(problem.file)
          return (
            <ListItemButton key={i} disabled={!target} onClick={() => target && select(target)} sx={{ px: 2, alignItems: 'flex-start', '&.Mui-disabled': { opacity: 1 } }}>
              {problem.severity === 'error' ? <ErrorOutlineIcon sx={{ ...iconSx, color: 'error.main', mt: 0.25 }} /> : <WarningAmberIcon sx={{ ...iconSx, color: 'warning.main', mt: 0.25 }} />}
              <Typography sx={{ flex: 1, overflowWrap: 'anywhere' }}>
                {problem.message}
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 2 }}>{problem.file}</Typography>
              </Typography>
            </ListItemButton>
          )
        })}
      </List>
    </Box>
  )
}
