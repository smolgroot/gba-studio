// The docked panels: project tree, the open document, its properties, and problems.
import AddIcon from '@mui/icons-material/Add'
import AudiotrackIcon from '@mui/icons-material/Audiotrack'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import GridOnIcon from '@mui/icons-material/GridOn'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined'
import PublicIcon from '@mui/icons-material/Public'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { FORMAT_VERSION, SCREEN, SPRITE_SIZES, emptyRoom, slugify, uniqueId } from '@gba-studio/core'
import type { MultiKind, Project } from '@gba-studio/core'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { selectionKey, useStudio } from '../store.ts'
import type { Selection } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { AudioEditor } from './audio.tsx'
import { PlayView } from './play.tsx'
import { ImportButton, UndoButtons, nameFromPath } from './common.tsx'
import { Heading, RoomEditor, RoomProperties } from './room.tsx'
import { SpriteEditor, SpriteProperties } from './sprite.tsx'
import { TilesetEditor, TilesetProperties } from './tileset.tsx'
import { AssetView, Message } from './views.tsx'
import { WorldEditor, freeSpot } from './world.tsx'

const iconSx = { mr: 1.5, color: 'text.secondary', flexShrink: 0 } as const

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section">
      <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'background.default', pr: 1 }}>
        <Typography variant="caption" component="h2" sx={{ flex: 1, px: 2, py: 1, m: 0, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  )
}

function Row({ selection, icon, label, detail }: { selection: Selection; icon: ReactNode; label: string; detail?: string }) {
  const selected = useStudio((s) => selectionKey(s.selection) === selectionKey(selection))
  const select = useStudio((s) => s.select)
  return (
    <ListItemButton selected={selected} onClick={() => select(selection)} sx={{ px: 2, minHeight: { xs: BAR.touchRow, md: BAR.row } }}>
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

/** Asks for what a new room, tileset or sprite needs, then creates and opens it. */
function CreateDialog({ kind, onClose }: { kind: MultiKind; onClose: () => void }) {
  const docs = useStudio((s) => s.bundle!.docs)
  const assets = useStudio((s) => s.bundle!.assets)
  const commit = useStudio((s) => s.commit)
  const select = useStudio((s) => s.select)
  const images = assets.filter((a) => (kind === 'sprite' ? /\.(png|aseprite|ase)$/i : /\.png$/i).test(a.path))
  const tilesets = Object.entries(docs.tilesets)
  const [name, setName] = useState('')
  const [width, setWidth] = useState(1)
  const [height, setHeight] = useState(1)
  const [tileset, setTileset] = useState(tilesets[0]?.[0] ?? '')
  const [image, setImage] = useState(images[0]?.path ?? '')
  const [size, setSize] = useState('32x32')
  const title = name.trim() || (kind !== 'room' && image ? nameFromPath(image) : '')
  const ready = !!title && (kind === 'room' ? !!tileset : !!image)

  const create = () => {
    const id = uniqueId(slugify(title), Object.keys(docs[`${kind}s`]))
    if (kind === 'room') {
      commit('room', id, emptyRoom(title, width, height, tileset))
      // A new room goes on the map, beside what is there.
      const world = docs.world
      if (world) commit('world', undefined, { ...world, rooms: [...world.rooms, { room: id, ...freeSpot(world, (r) => docs.rooms[r]) }], start: world.start ?? id })
    } else if (kind === 'tileset') {
      commit('tileset', id, { version: FORMAT_VERSION, name: title, image, collision: {} })
    } else {
      const [w, h] = size.split('x').map(Number) as [number, number]
      // The anchor starts at the feet: the middle of the frame's bottom edge.
      commit('sprite', id, { version: FORMAT_VERSION, name: title, image, frame: { width: w, height: h }, anchor: { x: w / 2, y: h }, animations: [] })
    }
    select({ kind, id })
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(event) => { event.preventDefault(); if (ready) create() }}>
        <DialogTitle>New {kind}</DialogTitle>
        <DialogContent sx={{ px: 2, py: 0 }}>
          <Fields>
            <Field label="Name"><TextInput label="Name" value={name} placeholder={title || 'Name'} onCommit={setName} /></Field>
            {kind === 'room' ? (
              <>
                <Field label="Screens">
                  <NumberInput label="Width in screens" value={width} min={1} max={32} onCommit={setWidth} />
                  <Typography color="text.secondary">×</Typography>
                  <NumberInput label="Height in screens" value={height} min={1} max={32} onCommit={setHeight} />
                </Field>
                <Field label="Size"><Typography color="text.secondary">{width * SCREEN.width} × {height * SCREEN.height} px</Typography></Field>
                <Field label="Tileset">
                  {tilesets.length ? <SelectInput label="Tileset" value={tileset} onChange={setTileset} options={tilesets.map(([value, t]) => ({ value, label: t.name }))} /> : <Typography color="warning.main">Create a tileset first.</Typography>}
                </Field>
              </>
            ) : (
              <>
                <Field label="Image">
                  {images.length ? <SelectInput label="Image" value={image} onChange={setImage} options={images.map((a) => ({ value: a.path, label: a.path }))} /> : <Typography color="text.secondary">No images in the folder yet.</Typography>}
                </Field>
                <Field label="">
                  <ImportButton label="Import an image" accept={kind === 'sprite' ? '.png,.aseprite,.ase' : '.png'} folder={`assets/${kind}s`} onImported={(paths) => setImage(paths[0]!)} />
                </Field>
                {kind === 'sprite' && (
                  <Field label="Frame size"><SelectInput label="Frame size" value={size} onChange={setSize} options={SPRITE_SIZES.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h}` }))} /></Field>
                )}
              </>
            )}
          </Fields>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!ready}>Create</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

export function ProjectPanel() {
  const bundle = useStudio((s) => s.bundle)
  const [creating, setCreating] = useState<MultiKind | null>(null)
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
            <Row key={id} selection={{ kind: 'room', id }} icon={<MapOutlinedIcon sx={iconSx} />} label={room.name} detail={`${room.width}×${room.height}`} />
          ))}
        </List>
        {rooms.length === 0 && <Empty>No rooms yet.</Empty>}
      </Section>
      <Section title="Tilesets" action={<AddButton title="New tileset from a PNG" onClick={() => setCreating('tileset')} />}>
        <List>
          {tilesets.map(([id, tileset]) => (
            <Row key={id} selection={{ kind: 'tileset', id }} icon={<GridOnIcon sx={iconSx} />} label={tileset.name} />
          ))}
        </List>
        {tilesets.length === 0 && <Empty>No tilesets yet.</Empty>}
      </Section>
      <Section title="Sprites" action={<AddButton title="New sprite from a sheet" onClick={() => setCreating('sprite')} />}>
        <List>
          {sprites.map(([id, sprite]) => (
            <Row key={id} selection={{ kind: 'sprite', id }} icon={<DirectionsRunIcon sx={iconSx} />} label={sprite.name} detail={`${sprite.frame.width}×${sprite.frame.height} · ${sprite.animations.length} anim`} />
          ))}
        </List>
        {sprites.length === 0 && <Empty>No sprites yet.</Empty>}
      </Section>
      <Section title="Asset files">
        <List>
          {assets.map((asset) => (
            <Row
              key={asset.path}
              selection={{ kind: 'asset', id: asset.path }}
              icon={asset.path.endsWith('.png') ? <ImageOutlinedIcon sx={iconSx} /> : <InsertDriveFileOutlinedIcon sx={iconSx} />}
              label={asset.path}
              detail={formatSize(asset.size)}
            />
          ))}
        </List>
        {assets.length === 0 && <Empty>No PNG, Aseprite, MIDI, SF2, XM, MOD or WAV files in this folder.</Empty>}
      </Section>
      {creating && <CreateDialog kind={creating} onClose={() => setCreating(null)} />}
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
    case 'asset': return <AssetView path={id!} />
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
        <Field label="One screen"><Typography>{SCREEN.width} × {SCREEN.height} px, {SCREEN.cols} × {SCREEN.rows} tiles</Typography></Field>
      </Fields>
    )
  } else if (kind === 'asset') {
    const asset = bundle.assets.find((a) => a.path === id)
    body = (
      <Fields>
        <Field label="Path"><Typography sx={{ overflowWrap: 'anywhere' }}>{id}</Typography></Field>
        <Field label="Size"><Typography>{asset ? formatSize(asset.size) : 'file is gone'}</Typography></Field>
      </Fields>
    )
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
