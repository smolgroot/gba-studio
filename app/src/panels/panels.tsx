// The docked panels: project tree, the open document, its properties, and problems.
import AudiotrackIcon from '@mui/icons-material/Audiotrack'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import GridOnIcon from '@mui/icons-material/GridOn'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PublicIcon from '@mui/icons-material/Public'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { SCREEN, STUDIO_DIR } from '@gba-studio/core'
import type { ReactNode } from 'react'
import { selectionKey, useStudio } from '../store.ts'
import type { Selection } from '../store.ts'
import { AssetView, Message, RoomView, TilesetView, WorldView } from './views.tsx'

const iconSx = { fontSize: 14, mr: 1.5, color: 'text.secondary', flexShrink: 0 } as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="caption" component="h2" sx={{ display: 'block', px: 2, py: 1, m: 0, color: 'text.secondary', bgcolor: 'background.default', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

function Row({ selection, icon, label, detail }: { selection: Selection; icon: ReactNode; label: string; detail?: string }) {
  const selected = useStudio((s) => selectionKey(s.selection) === selectionKey(selection))
  const select = useStudio((s) => s.select)
  return (
    <ListItemButton selected={selected} onClick={() => select(selection)} sx={{ px: 2, minHeight: { xs: 36, md: 22 } }}>
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

export function ProjectPanel() {
  const bundle = useStudio((s) => s.bundle)
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
        <Row selection={{ kind: 'audio' }} icon={<AudiotrackIcon sx={iconSx} />} label="Audio" detail={`${docs.audio?.tracks.length ?? 0} tracks`} />
      </List>
      <Section title="Rooms">
        <List>
          {rooms.map(([id, room]) => (
            <Row key={id} selection={{ kind: 'room', id }} icon={<MapOutlinedIcon sx={iconSx} />} label={room.name} detail={`${room.width}×${room.height}`} />
          ))}
        </List>
        {rooms.length === 0 && <Empty>No rooms yet.</Empty>}
      </Section>
      <Section title="Tilesets">
        <List>
          {tilesets.map(([id, tileset]) => (
            <Row key={id} selection={{ kind: 'tileset', id }} icon={<GridOnIcon sx={iconSx} />} label={tileset.name} />
          ))}
        </List>
        {tilesets.length === 0 && <Empty>No tilesets yet.</Empty>}
      </Section>
      <Section title="Sprites">
        <List>
          {sprites.map(([id, sprite]) => (
            <Row key={id} selection={{ kind: 'sprite', id }} icon={<DirectionsRunIcon sx={iconSx} />} label={sprite.name} detail={`${sprite.frame.width}×${sprite.frame.height}`} />
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
    </Box>
  )
}

export function DocumentPanel({ selection }: { selection: Selection }) {
  const { kind, id } = selection
  switch (kind) {
    case 'world': return <WorldView />
    case 'room': return <RoomView id={id!} />
    case 'tileset': return <TilesetView id={id!} />
    case 'asset': return <AssetView path={id!} />
    case 'project': return <ProjectSettings />
    case 'audio': return <AudioList />
    case 'sprite': return <Message>The sprite and animation editor arrives with the Assets milestone.</Message>
  }
}

function ProjectSettings() {
  const project = useStudio((s) => s.bundle?.docs.project)
  if (!project) return <Message>The project file is missing or has errors. See Problems.</Message>
  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Section title="Build">
        <Table rows={[['Dev build', project.build.dev], ['Dev ROM', project.build.devRom], ['Release build', project.build.release], ['Release ROM', project.build.releaseRom]]} />
      </Section>
      <Section title="Collision classes">
        <Table rows={project.collisionClasses.map((c) => [<Swatch key={c.id} colour={c.colour} label={c.name} />, c.slope ? `${c.kind}, ${c.slope.left} to ${c.slope.right} px` : c.kind])} />
      </Section>
      <Section title="Entity types">
        <Table rows={project.entityTypes.map((e) => [<Swatch key={e.id} colour={e.colour} label={e.name} />, e.props.length ? e.props.map((p) => `${p.name}: ${p.type}`).join(', ') : 'no properties'])} />
      </Section>
    </Box>
  )
}

function AudioList() {
  const audio = useStudio((s) => s.bundle?.docs.audio)
  if (!audio) return <Message>The audio file is missing or has errors. See Problems.</Message>
  if (audio.tracks.length + audio.sfx.length === 0) return <Message>No music tracks or sound effects yet.</Message>
  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Section title="Tracks">
        <Table rows={audio.tracks.map((t) => [t.name, `${t.format} · ${t.file}`])} />
      </Section>
      <Section title="Sound effects">
        <Table rows={audio.sfx.map((s) => [s.name, s.file])} />
      </Section>
    </Box>
  )
}

function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ width: 10, height: 10, bgcolor: colour, border: '1px solid rgba(255,255,255,0.3)', flexShrink: 0 }} />
      {label}
    </Box>
  )
}

function Table({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <Box component="dl" sx={{ m: 0, px: 2, py: 1, display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) 1fr', columnGap: 3, rowGap: 0.5 }}>
      {rows.map(([label, value], i) => (
        <Box key={i} sx={{ display: 'contents' }}>
          <Typography component="dt" color="text.secondary">{label}</Typography>
          <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
        </Box>
      ))}
    </Box>
  )
}

export function PropertiesPanel() {
  const selection = useStudio((s) => s.selection)
  const bundle = useStudio((s) => s.bundle)
  if (!bundle) return null
  const { docs } = bundle
  const { kind, id } = selection
  let rows: Array<[ReactNode, ReactNode]> = []
  if (kind === 'room' && docs.rooms[id!]) {
    const room = docs.rooms[id!]!
    rows = [
      ['Name', room.name],
      ['File', `${STUDIO_DIR}/rooms/${id}.json`],
      ['Screens', `${room.width} × ${room.height}`],
      ['Tiles', `${room.width * SCREEN.cols} × ${room.height * SCREEN.rows}`],
      ['Pixels', `${room.width * SCREEN.width} × ${room.height * SCREEN.height}`],
      ['Tileset', docs.tilesets[room.tileset]?.name ?? room.tileset],
      ['Layers', room.layers.map((l) => l.name).join(', ')],
      ['Entities', room.entities.length],
      ['Music', room.music ?? 'none'],
    ]
  } else if (kind === 'tileset' && docs.tilesets[id!]) {
    const tileset = docs.tilesets[id!]!
    rows = [
      ['Name', tileset.name],
      ['File', `${STUDIO_DIR}/tilesets/${id}.json`],
      ['Image', tileset.image],
      ['Collision tiles', Object.keys(tileset.collision).length],
    ]
  } else if (kind === 'sprite' && docs.sprites[id!]) {
    const sprite = docs.sprites[id!]!
    rows = [
      ['Name', sprite.name],
      ['File', `${STUDIO_DIR}/sprites/${id}.json`],
      ['Image', sprite.image],
      ['Frame', `${sprite.frame.width} × ${sprite.frame.height}`],
      ['Animations', sprite.animations.map((a) => a.name).join(', ') || 'none'],
    ]
  } else if (kind === 'world' && docs.world) {
    rows = [['Rooms placed', docs.world.rooms.length], ['Start room', docs.world.start ? (docs.rooms[docs.world.start]?.name ?? docs.world.start) : 'none'], ['Screen', `${SCREEN.width} × ${SCREEN.height} px`]]
  } else if (kind === 'asset') {
    const asset = bundle.assets.find((a) => a.path === id)
    rows = [['Path', id!], ['Size', asset ? formatSize(asset.size) : 'file is gone']]
  } else if (kind === 'project' && docs.project) {
    rows = [['Name', docs.project.name], ['Folder', bundle.folder], ['Format version', docs.project.version]]
  } else if (kind === 'audio' && docs.audio) {
    rows = [['Tracks', docs.audio.tracks.length], ['Sound effects', docs.audio.sfx.length]]
  }
  if (rows.length === 0) return <Empty>Nothing to show for this item.</Empty>
  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Table rows={rows} />
    </Box>
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
              {problem.severity === 'error' ? <ErrorOutlineIcon sx={{ ...iconSx, color: 'error.main', mt: 0.5 }} /> : <WarningAmberIcon sx={{ ...iconSx, color: 'warning.main', mt: 0.5 }} />}
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
