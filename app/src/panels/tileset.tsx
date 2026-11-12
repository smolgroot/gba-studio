// The tileset editor: says which collision class each tile carries into a room.
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { TILE, countColours } from '@gba-studio/core'
import type { Tileset } from '@gba-studio/core'
import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Field, Fields, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { UndoButtons } from './common.tsx'
import { Divider, GridOverlay, Message, Viewport, useImage } from './views.tsx'

function useColourCount(image: HTMLImageElement | null | 'error'): number | null {
  return useMemo(() => {
    if (!image || image === 'error') return null
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return countColours(context.getImageData(0, 0, image.width, image.height).data)
  }, [image])
}

export function TilesetEditor({ id }: { id: string }) {
  const tileset = useStudio((s) => s.bundle?.docs.tilesets[id])
  const classes = useStudio((s) => s.bundle?.docs.project?.collisionClasses)
  const commit = useStudio((s) => s.commit)
  const image = useImage(tileset?.image)
  const colours = useColourCount(image)
  const [classId, setClassId] = useState<string | null>(null)
  // While dragging, the classes being painted, before they are saved as one step.
  const [draft, setDraft] = useState<Tileset['collision'] | null>(null)
  const painting = useRef(false)
  if (!tileset) return <Message>This tileset is missing or its file has errors. See Problems.</Message>
  if (image === 'error') return <Message>Cannot load {tileset.image}. Choose another image in Properties.</Message>
  if (!image || !classes) return null
  const cols = Math.floor(image.width / TILE)
  const rows = Math.floor(image.height / TILE)
  const chosen = classes.find((c) => c.id === classId) ?? classes[1] ?? classes[0]!
  const collision = draft ?? tileset.collision
  const misfit = image.width % TILE !== 0 || image.height % TILE !== 0

  const paint = (event: ReactPointerEvent<HTMLDivElement>, zoom: number) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = Math.floor((event.clientX - box.left) / (TILE * zoom))
    const y = Math.floor((event.clientY - box.top) / (TILE * zoom))
    if (x < 0 || y < 0 || x >= cols || y >= rows) return
    const tile = String(y * cols + x)
    // The first class is what a tile has when nothing is said, so it is not stored.
    const next = chosen.id === classes[0]!.id ? undefined : chosen.id
    if (collision[tile] === next) return
    const updated = { ...collision }
    if (next) updated[tile] = next
    else delete updated[tile]
    setDraft(updated)
  }
  const finish = () => {
    painting.current = false
    if (draft) commit('tileset', id, { ...tileset, collision: draft })
    setDraft(null)
  }

  const tools = (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>Paint collision:</Typography>
      <Box sx={{ width: ui(150) }}>
        <SelectInput label="Collision class to paint" value={chosen.id} onChange={setClassId} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
      </Box>
      <Box sx={{ width: ui(12), height: ui(12), ml: 1, bgcolor: chosen.colour, border: '1px solid rgba(255,255,255,0.4)' }} />
      <Divider />
      <UndoButtons />
    </>
  )
  return (
    <Viewport initialZoom={5} tools={tools} touchAction="none" info={`${image.width}×${image.height} px · ${cols * rows} tiles · ${colours} colours${misfit ? ' · size is not a multiple of 8' : ''}`}>
      {(zoom) => (
        <Box
          className="checker"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            painting.current = true
            paint(event, zoom)
          }}
          onPointerMove={(event) => painting.current && paint(event, zoom)}
          onPointerUp={finish}
          onPointerCancel={finish}
          sx={{ position: 'relative', width: image.width * zoom, height: image.height * zoom, cursor: 'crosshair' }}
        >
          <img src={image.src} alt={tileset.name} draggable={false} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
          {Object.entries(collision).map(([tile, classOfTile]) => {
            const cls = classes.find((c) => c.id === classOfTile)
            if (!cls || cls.kind === 'empty') return null
            const index = Number(tile)
            return (
              <Box
                key={tile}
                title={`Tile ${tile}: ${cls.name}`}
                sx={{
                  position: 'absolute',
                  pointerEvents: 'none',
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

export function TilesetProperties({ id }: { id: string }) {
  const tileset = useStudio((s) => s.bundle?.docs.tilesets[id])
  const assets = useStudio((s) => s.bundle?.assets)
  const commit = useStudio((s) => s.commit)
  if (!tileset) return null
  const images = (assets ?? []).filter((a) => a.path.toLowerCase().endsWith('.png'))
  return (
    <Fields>
      <Field label="Name"><TextInput label="Name" value={tileset.name} onCommit={(name) => commit('tileset', id, { ...tileset, name })} /></Field>
      <Field label="Image">
        <SelectInput label="Image" value={tileset.image} onChange={(image) => commit('tileset', id, { ...tileset, image })} options={images.map((a) => ({ value: a.path, label: a.path }))} />
      </Field>
      <Field label="Collision tiles"><Typography>{Object.keys(tileset.collision).length}</Typography></Field>
    </Fields>
  )
}
