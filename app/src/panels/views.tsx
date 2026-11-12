// Read-only views of each kind of document. The editors of later milestones grow from these.
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { SCREEN, TILE, countColours, rleDecode, rleLength } from '@gba-studio/core'
import type { Room, Tileset } from '@gba-studio/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fileUrl } from '../api.ts'
import { useStudio } from '../store.ts'

/** A file of the game folder as an image; null while loading, 'error' if it cannot be shown. */
function useImage(path: string | undefined): HTMLImageElement | null | 'error' {
  const revision = useStudio((s) => s.revision)
  const [state, setState] = useState<{ url: string; image: HTMLImageElement | 'error' } | null>(null)
  const url = path ? fileUrl(path, revision) : null
  useEffect(() => {
    if (!url) return
    let live = true
    const image = new Image()
    image.onload = () => live && setState({ url, image })
    image.onerror = () => live && setState({ url, image: 'error' })
    image.src = url
    return () => {
      live = false
    }
  }, [url])
  // Keep showing the last image while a changed file loads, so previews do not flash.
  return url && state ? state.image : null
}

function Message({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  )
}

/** A scrollable canvas area with zoom buttons; `children` gets the zoom factor. */
function Viewport({ initialZoom, info, children }: { initialZoom: number; info?: ReactNode; children: (zoom: number) => ReactNode }) {
  const [zoom, setZoom] = useState(initialZoom)
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, height: 26, flexShrink: 0, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        <IconButton aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(zoom - 1)} sx={{ p: 0.5 }}>
          <RemoveIcon sx={{ fontSize: 14 }} />
        </IconButton>
        <Typography variant="body2" sx={{ width: 36, textAlign: 'center' }}>{zoom * 100}%</Typography>
        <IconButton aria-label="Zoom in" disabled={zoom >= 8} onClick={() => setZoom(zoom + 1)} sx={{ p: 0.5 }}>
          <AddIcon sx={{ fontSize: 14 }} />
        </IconButton>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ ml: 2 }}>{info}</Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 4, bgcolor: '#161616', touchAction: 'pan-x pan-y' }}>{children(zoom)}</Box>
    </Box>
  )
}

/** Lines every `stepX` by `stepY` pixels over the element it sits in. */
function GridOverlay({ stepX, stepY, colour }: { stepX: number; stepY: number; colour: string }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(to right, ${colour} 1px, transparent 1px), linear-gradient(to bottom, ${colour} 1px, transparent 1px)`,
        backgroundSize: `${stepX}px ${stepY}px`,
        borderRight: `1px solid ${colour}`,
        borderBottom: `1px solid ${colour}`,
      }}
    />
  )
}

/** Paints a room's tile layers at one pixel per pixel. */
function paintRoom(canvas: HTMLCanvasElement, room: Room, image: HTMLImageElement): void {
  const cols = room.width * SCREEN.cols
  const rows = room.height * SCREEN.rows
  canvas.width = cols * TILE
  canvas.height = rows * TILE
  const context = canvas.getContext('2d')!
  const sheetCols = Math.floor(image.width / TILE)
  const sheetTiles = sheetCols * Math.floor(image.height / TILE)
  for (const layer of room.layers) {
    if (rleLength(layer.data) !== cols * rows) continue // reported in Problems
    const cells = rleDecode(layer.data)
    for (let i = 0; i < cells.length; i++) {
      const tile = cells[i]! - 1
      if (tile < 0 || tile >= sheetTiles) continue
      context.drawImage(
        image,
        (tile % sheetCols) * TILE, Math.floor(tile / sheetCols) * TILE, TILE, TILE,
        (i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE,
      )
    }
  }
}

export function RoomView({ id }: { id: string }) {
  const room = useStudio((s) => s.bundle?.docs.rooms[id])
  const tileset = useStudio((s) => (room ? s.bundle?.docs.tilesets[room.tileset] : undefined))
  const entityTypes = useStudio((s) => s.bundle?.docs.project?.entityTypes)
  const image = useImage(tileset?.image)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvas.current && room && image && image !== 'error') paintRoom(canvas.current, room, image)
  }, [room, image])

  if (!room) return <Message>This room is missing or its file has errors. See Problems.</Message>
  if (!tileset) return <Message>Tileset "{room.tileset}" is missing or has errors. See Problems.</Message>
  if (image === 'error') return <Message>Cannot load {tileset.image}.</Message>
  const width = room.width * SCREEN.width
  const height = room.height * SCREEN.height
  return (
    <Viewport initialZoom={2} info={`${room.width}×${room.height} screens · ${width}×${height} px · ${room.layers.length} layers · ${room.entities.length} entities`}>
      {(zoom) => (
        <Box className="checker" sx={{ position: 'relative', width: width * zoom, height: height * zoom }}>
          <canvas ref={canvas} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
          {/* Screen boundaries: the units a room is sized in. */}
          <GridOverlay stepX={SCREEN.width * zoom} stepY={SCREEN.height * zoom} colour="rgba(76,159,254,0.55)" />
          {room.entities.map((entity, i) => (
            <Box
              key={i}
              title={entity.type}
              sx={{
                position: 'absolute',
                left: entity.x * zoom,
                top: entity.y * zoom,
                width: TILE * zoom,
                height: TILE * zoom,
                transform: 'translate(-50%, -100%)',
                border: '1px solid #fff',
                bgcolor: entityTypes?.find((t) => t.id === entity.type)?.colour ?? '#888',
              }}
            />
          ))}
        </Box>
      )}
    </Viewport>
  )
}

function TilesetInfo({ tileset, image }: { tileset: Tileset; image: HTMLImageElement }) {
  const colours = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return countColours(context.getImageData(0, 0, image.width, image.height).data)
  }, [image])
  const tiles = Math.floor(image.width / TILE) * Math.floor(image.height / TILE)
  const misfit = image.width % TILE !== 0 || image.height % TILE !== 0
  return (
    <>
      {tileset.image} · {image.width}×{image.height} px · {tiles} tiles · {colours} colours
      {misfit && ' · size is not a multiple of 8'}
    </>
  )
}

export function TilesetView({ id }: { id: string }) {
  const tileset = useStudio((s) => s.bundle?.docs.tilesets[id])
  const classes = useStudio((s) => s.bundle?.docs.project?.collisionClasses)
  const image = useImage(tileset?.image)
  if (!tileset) return <Message>This tileset is missing or its file has errors. See Problems.</Message>
  if (image === 'error') return <Message>Cannot load {tileset.image}.</Message>
  if (!image) return null
  const cols = Math.floor(image.width / TILE)
  return (
    <Viewport initialZoom={6} info={<TilesetInfo tileset={tileset} image={image} />}>
      {(zoom) => (
        <Box className="checker" sx={{ position: 'relative', width: image.width * zoom, height: image.height * zoom }}>
          <img src={image.src} alt={tileset.name} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
          {/* Each tile's collision class, tinted in the class's colour. */}
          {Object.entries(tileset.collision).map(([tile, classId]) => {
            const cls = classes?.find((c) => c.id === classId)
            if (!cls || cls.kind === 'empty') return null
            const index = Number(tile)
            return (
              <Box
                key={tile}
                title={`Tile ${tile}: ${cls.name}`}
                sx={{
                  position: 'absolute',
                  left: (index % cols) * TILE * zoom,
                  top: Math.floor(index / cols) * TILE * zoom,
                  width: TILE * zoom,
                  height: TILE * zoom,
                  // An outline and a faint tint, so the drawing underneath stays readable.
                  boxShadow: `inset 0 0 0 2px ${cls.colour}`,
                  bgcolor: `${cls.colour}26`,
                }}
              />
            )
          })}
          <GridOverlay stepX={TILE * zoom} stepY={TILE * zoom} colour="rgba(255,255,255,0.18)" />
        </Box>
      )}
    </Viewport>
  )
}

/** The world map: every placed room on the grid of screens. */
export function WorldView() {
  const world = useStudio((s) => s.bundle?.docs.world)
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const select = useStudio((s) => s.select)
  if (!world || !rooms) return <Message>The world file is missing or has errors. See Problems.</Message>
  const placed = world.rooms.flatMap((p) => (rooms[p.room] ? [{ ...p, doc: rooms[p.room]! }] : []))
  if (placed.length === 0) return <Message>No rooms are placed in the world yet.</Message>
  const left = Math.min(...placed.map((p) => p.x))
  const top = Math.min(...placed.map((p) => p.y))
  const right = Math.max(...placed.map((p) => p.x + p.doc.width))
  const bottom = Math.max(...placed.map((p) => p.y + p.doc.height))
  // A screen on the map keeps the GBA's 3:2 shape.
  const cellW = 24
  const cellH = 16
  return (
    <Viewport initialZoom={3} info={`${placed.length} rooms · ${right - left}×${bottom - top} screens`}>
      {(zoom) => (
        <Box sx={{ position: 'relative', width: (right - left) * cellW * zoom, height: (bottom - top) * cellH * zoom, bgcolor: '#1c1c1c' }}>
          <GridOverlay stepX={cellW * zoom} stepY={cellH * zoom} colour="rgba(255,255,255,0.08)" />
          {placed.map((p) => (
            <Box
              key={p.room}
              component="button"
              onClick={() => select({ kind: 'room', id: p.room })}
              sx={{
                position: 'absolute',
                left: (p.x - left) * cellW * zoom,
                top: (p.y - top) * cellH * zoom,
                width: p.doc.width * cellW * zoom,
                height: p.doc.height * cellH * zoom,
                border: '1px solid',
                borderColor: world.start === p.room ? 'primary.main' : '#6a6a6a',
                bgcolor: world.start === p.room ? 'rgba(76,159,254,0.18)' : '#333',
                color: 'text.primary',
                font: 'inherit',
                fontSize: 11,
                overflow: 'hidden',
                cursor: 'pointer',
                '&:hover, &:focus-visible': { bgcolor: 'rgba(76,159,254,0.3)', outline: 'none' },
              }}
            >
              {p.doc.name}
            </Box>
          ))}
        </Box>
      )}
    </Viewport>
  )
}

export function AssetView({ path }: { path: string }) {
  const revision = useStudio((s) => s.revision)
  const url = fileUrl(path, revision)
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'png') {
    return (
      <Viewport initialZoom={4} info={path}>
        {(zoom) => <ZoomedImage url={url} alt={path} zoom={zoom} />}
      </Viewport>
    )
  }
  if (extension === 'wav') {
    return (
      <Box sx={{ p: 4 }}>
        <Typography sx={{ mb: 2 }}>{path}</Typography>
        <audio controls src={url} />
      </Box>
    )
  }
  return <Message>{path}: no preview for .{extension} files yet.</Message>
}

function ZoomedImage({ url, alt, zoom }: { url: string; alt: string; zoom: number }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  return (
    <Box className="checker" sx={{ width: size ? size.width * zoom : 'auto', height: size ? size.height * zoom : 'auto', display: 'inline-block' }}>
      <img
        src={url}
        alt={alt}
        className="pixelated"
        onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={{ width: size ? '100%' : undefined, height: size ? '100%' : undefined, display: 'block' }}
      />
    </Box>
  )
}

export { Message }
