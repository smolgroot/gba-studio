// Dialogs that make new things: rooms, tilesets, sprites, and blank PNG images.
// Used from the Project panel and from the World map.
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { FORMAT_VERSION, SCREEN, SPRITE_SIZES, emptyRoom, slugify, uniqueId } from '@gba-studio/core'
import type { MultiKind, World } from '@gba-studio/core'
import { useState } from 'react'
import { api } from '../api.ts'
import { Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ImportButton, nameFromPath } from './common.tsx'

/** A spot right of everything placed, level with the top. */
export function freeSpot(world: World, sizes: (room: string) => { width: number; height: number } | undefined): { x: number; y: number } {
  const placed = world.rooms.flatMap((p) => (sizes(p.room) ? [{ ...p, ...sizes(p.room)! }] : []))
  if (placed.length === 0) return { x: 0, y: 0 }
  return { x: Math.max(...placed.map((p) => p.x + p.width)), y: Math.min(...placed.map((p) => p.y)) }
}

/**
 * Asks for what a new room, tileset or sprite needs, then creates and opens it.
 * A room goes on the world map at `at` (in screens), or beside the other rooms.
 */
export function CreateDialog({ kind, at, onClose }: { kind: MultiKind; at?: { x: number; y: number }; onClose: () => void }) {
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

  // A room needs a tileset. A fresh project has none, so one can be made right here from a PNG.
  const makeTileset = (path: string) => {
    const id = uniqueId(slugify(nameFromPath(path)), Object.keys(docs.tilesets))
    commit('tileset', id, { version: FORMAT_VERSION, name: nameFromPath(path), image: path, collision: {} })
    setTileset(id)
  }

  const create = () => {
    const id = uniqueId(slugify(title), Object.keys(docs[`${kind}s`]))
    if (kind === 'room') {
      commit('room', id, emptyRoom(title, width, height, tileset))
      // A new room goes on the map: where asked, kept inside a sized map, or beside what is there.
      const world = docs.world
      if (world) {
        let spot = at ?? freeSpot(world, (r) => docs.rooms[r])
        if (world.size) spot = { x: Math.max(0, Math.min(world.size.width - width, spot.x)), y: Math.max(0, Math.min(world.size.height - height, spot.y)) }
        commit('world', undefined, { ...world, rooms: [...world.rooms, { room: id, ...spot }], start: world.start ?? id })
      }
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
                {at && <Field label="On the map"><Typography color="text.secondary">screen {at.x}, {at.y}</Typography></Field>}
                <Field label="Tileset">
                  {tilesets.length ? (
                    <SelectInput label="Tileset" value={tileset} onChange={setTileset} options={tilesets.map(([value, t]) => ({ value, label: t.name }))} />
                  ) : (
                    <Typography color="warning.main">A room needs a tileset.</Typography>
                  )}
                </Field>
                {!tilesets.length && (
                  <Field label="">
                    <ImportButton label="Import a tileset PNG" accept=".png" folder="assets/tilesets" onImported={(paths) => makeTileset(paths[0]!)} />
                  </Field>
                )}
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

const IMAGE_FOLDERS = [
  { value: 'assets/sprites', label: 'assets/sprites' },
  { value: 'assets/tilesets', label: 'assets/tilesets' },
  { value: 'assets/backgrounds', label: 'assets/backgrounds' },
  { value: 'assets', label: 'assets' },
] as const
type ImageFolder = (typeof IMAGE_FOLDERS)[number]['value']

/** A transparent PNG of the given size, as the bytes of a file. */
export function blankPng(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the image'))), 'image/png'))
}

/** Makes a blank PNG in the game folder and opens it in the pixel editor. */
export function NewImageDialog({ folder: initialFolder = 'assets/sprites', onClose }: { folder?: ImageFolder; onClose: () => void }) {
  const assets = useStudio((s) => s.bundle!.assets)
  const load = useStudio((s) => s.load)
  const select = useStudio((s) => s.select)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<ImageFolder>(initialFolder)
  const [width, setWidth] = useState(32)
  const [height, setHeight] = useState(32)
  const [error, setError] = useState<string | null>(null)
  const path = `${folder}/${name.trim() ? slugify(name) : ''}.png`
  const taken = assets.some((a) => a.path === path)
  const ready = !!name.trim() && !taken

  const create = async () => {
    try {
      await api.upload(path, await blankPng(width, height), false)
      await load()
      select({ kind: 'asset', id: path })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(event) => { event.preventDefault(); if (ready) void create() }}>
        <DialogTitle>New image</DialogTitle>
        <DialogContent sx={{ px: 2, py: 0 }}>
          <Fields>
            <Field label="Name"><TextInput label="Name" value={name} placeholder="hero" onCommit={setName} /></Field>
            <Field label="Folder"><SelectInput label="Folder" value={folder} onChange={setFolder} options={IMAGE_FOLDERS} /></Field>
            <Field label="Pixels">
              <NumberInput label="Width in pixels" value={width} min={1} max={1024} onCommit={setWidth} />
              <Typography color="text.secondary">×</Typography>
              <NumberInput label="Height in pixels" value={height} min={1} max={1024} onCommit={setHeight} />
            </Field>
            <Field label="File"><Typography color={taken ? 'warning.main' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>{name.trim() ? `${path}${taken ? ' already exists' : ''}` : '…'}</Typography></Field>
            {(width % 8 || height % 8) ? <Field label=""><Typography color="warning.main">Tiles and backgrounds need sizes that are multiples of 8.</Typography></Field> : null}
            {error && <Field label=""><Typography color="error">{error}</Typography></Field>}
          </Fields>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!ready}>Create and draw</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
