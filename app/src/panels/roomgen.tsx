// The Metroidvania room generator: lays out a room with the blocks of a tileset made by the
// tileset generator, sized to the project's jump, and saves it as a room of the project.
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined'
import GridOnIcon from '@mui/icons-material/GridOn'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import {
  DEFAULT_ROOMGEN, DEFAULT_TILEGEN, PlatformerPhysics, ROOMGEN_STYLES, ROOM_CELL, SCREEN, TILEGEN_BLOCKS, TILEGEN_COLS, TILEGEN_PRESETS,
  generateRoom, generateTileset, isSlopeCell, platformerFigures, presetOptions, roomgenDocument, slugify, tilegenLayout, uniqueId,
} from '@pecten-studio/core'
import type { BackWall, GeneratedRoom, RoomLayout, RoomgenOptions, TilegenOptions } from '@pecten-studio/core'
import { useEffect, useMemo, useState } from 'react'
import { Checkbox, Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { PixelCanvas, Range, Section, rgbaCanvas } from './toolkit.tsx'
import { Divider, GridOverlay, ToolButton, Viewport, useImage } from './views.tsx'

const SKY = '#26304a'
const STORAGE_KEY = 'pecten-studio:roomgen'
/** The tileset generator's last settings: the preview uses them while the project has no tileset. */
const TILEGEN_KEY = 'pecten-studio:tilegen'

interface Saved {
  options: RoomgenOptions
  tileset?: string
}

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null
    if (saved?.options) return { ...saved, options: { ...DEFAULT_ROOMGEN, ...saved.options, exits: { ...DEFAULT_ROOMGEN.exits, ...saved.options.exits } } }
  } catch { /* storage unavailable */ }
  return { options: DEFAULT_ROOMGEN }
}

function tilegenOptions(): TilegenOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(TILEGEN_KEY) ?? 'null') as Partial<TilegenOptions> | null
    if (saved) return { ...DEFAULT_TILEGEN, ...saved, colours: { ...DEFAULT_TILEGEN.colours, ...saved.colours } }
  } catch { /* storage unavailable */ }
  return DEFAULT_TILEGEN
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000)

const LAYOUTS: ReadonlyArray<{ value: RoomLayout; label: string }> = [
  { value: 'levels', label: 'Levels (linear floors)' },
  { value: 'caverns', label: 'Caverns (organic)' },
  { value: 'shaft', label: 'Shaft (vertical climb)' },
]
const BACK_WALLS: ReadonlyArray<{ value: BackWall; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'patches', label: 'Patches (ruins)' },
  { value: 'full', label: 'Everywhere (indoors)' },
]
const EXITS = [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']] as const

/** A sheet to draw blocks from: the tileset's image, or a sheet drawn from generator settings. */
interface Sheet {
  image: CanvasImageSource
  width: number
  height: number
}

const BLOCK_INDEX = new Map(TILEGEN_BLOCKS.map((name, i) => [name, i]))

function drawRoom(canvas: HTMLCanvasElement, room: GeneratedRoom, sheet: Sheet, back: boolean) {
  const T = room.blockSize
  canvas.width = room.tileCols * 8
  canvas.height = room.tileRows * 8
  const context = canvas.getContext('2d')!
  context.imageSmoothingEnabled = false
  context.fillStyle = SKY
  context.fillRect(0, 0, canvas.width, canvas.height)
  const layer = (names: ReadonlyArray<string | null>) => {
    for (let y = 0; y < room.rows; y++) {
      for (let x = 0; x < room.cols; x++) {
        const i = BLOCK_INDEX.get(names[y * room.cols + x] ?? '')
        if (i === undefined) continue
        context.drawImage(sheet.image, (i % TILEGEN_COLS) * T, Math.floor(i / TILEGEN_COLS) * T, T, T, x * T, y * T, T, T)
      }
    }
  }
  if (back && room.back) layer(room.back)
  layer(room.ground)
}

/** The room's shape alone, a pixel a block: for the style buttons. */
function drawCells(canvas: HTMLCanvasElement, room: GeneratedRoom) {
  canvas.width = room.cols
  canvas.height = room.rows
  const context = canvas.getContext('2d')!
  const image = context.createImageData(room.cols, room.rows)
  const colour = (c: number): [number, number, number] =>
    c === ROOM_CELL.rock ? [120, 110, 100] : c === ROOM_CELL.platform ? [230, 200, 90] : c === ROOM_CELL.spikes ? [214, 64, 159] : isSlopeCell(c) ? [70, 167, 88] : [38, 48, 74]
  room.cells.forEach((c, i) => {
    const [r, g, b] = colour(c)
    image.data.set([r, g, b, 255], i * 4)
  })
  context.putImageData(image, 0, 0)
}

const PREVIEW_ENV = { blockSize: 16, jumpHeight: 49, jumpDistance: 69, blocks: TILEGEN_BLOCKS }

/** The gallery card: a cavern in the crystal cave colours. */
export function RoomPreview() {
  const draw = useMemo(() => {
    const sheet = generateTileset(presetOptions(TILEGEN_PRESETS.find((p) => p.id === 'crystal') ?? TILEGEN_PRESETS[0]!, 8, 2))
    const room = generateRoom({ ...DEFAULT_ROOMGEN, ...ROOMGEN_STYLES.find((s) => s.id === 'caverns')!.options, seed: 9, width: 2, height: 1, decoration: 60 }, { ...PREVIEW_ENV, blockSize: 8 })
    const image = rgbaCanvas(sheet.width, sheet.height, sheet.rgba)
    return (canvas: HTMLCanvasElement) => drawRoom(canvas, room, { image, width: sheet.width, height: sheet.height }, true)
  }, [])
  return (
    <Box sx={{ height: 120, bgcolor: SKY, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <PixelCanvas draw={draw} style={{ height: '100%', width: 'auto' }} />
    </Box>
  )
}

export function RoomGenerator() {
  const bundle = useStudio((s) => s.bundle)
  const [saved, setSaved] = useState<Saved>(load)
  const [grid, setGrid] = useState(true)
  const [showBack, setShowBack] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const narrow = !useMediaQuery('(min-width:800px)')
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)) } catch { /* storage unavailable */ }
  }, [saved])
  const options = saved.options
  const set = (patch: Partial<RoomgenOptions>) => setSaved((s) => ({ ...s, options: { ...s.options, ...patch } }))

  const tilesets = bundle?.docs.tilesets ?? {}
  const tilesetId = saved.tileset && tilesets[saved.tileset] ? saved.tileset : Object.keys(tilesets)[0]
  const tileset = tilesetId ? tilesets[tilesetId] : undefined
  const image = useImage(tileset?.image)
  // Without a tileset in the project, preview with the tileset generator's current settings.
  const fallback = useMemo(() => {
    if (tileset) return null
    const sheet = generateTileset(tilegenOptions())
    return { image: rgbaCanvas(sheet.width, sheet.height, sheet.rgba), width: sheet.width, height: sheet.height }
  }, [tileset])
  const sheet: Sheet | null = image instanceof HTMLImageElement ? { image, width: image.naturalWidth, height: image.naturalHeight } : fallback
  const layout = sheet ? tilegenLayout(sheet.width, sheet.height) : null
  const slopes = !!layout && layout.rows >= 5

  const physics = bundle?.docs.project?.physics
  const figures = useMemo(() => platformerFigures(physics?.platformer ?? PlatformerPhysics.parse({})), [physics])
  const room = useMemo(
    () => (layout ? generateRoom(options, { blockSize: layout.blockSize, jumpHeight: figures.jumpHeight, jumpDistance: figures.jumpDistance, blocks: layout.blocks }) : null),
    // The layout is the same while the sheet's size is.
    [options, layout?.blockSize, layout?.rows, figures],
  )
  const draw = useMemo(() => (room && sheet ? (canvas: HTMLCanvasElement) => drawRoom(canvas, room, sheet, showBack) : null), [room, sheet?.image, showBack])

  const tools = (
    <>
      <ToolButton title="Show screen edges" active={grid} onClick={() => setGrid(!grid)}><GridOnIcon /></ToolButton>
      <Divider />
      <ToolButton title="Show the back wall layer" active={showBack} disabled={options.backWall === 'none'} onClick={() => setShowBack(!showBack)}><LayersOutlinedIcon /></ToolButton>
    </>
  )
  const T = room?.blockSize ?? 16
  const info = hover ?? (room ? `${options.width} × ${options.height} screens · ${room.cols} × ${room.rows} blocks of ${T} px · steps up to ${room.metrics.jump}, gaps up to ${room.metrics.gap} blocks` : '')

  let message: string | null = null
  if (image === 'error') message = `Could not load ${tileset?.image}.`
  else if (sheet && !layout) message = `“${tileset?.name}” is not laid out like the tileset generator's sheet (8 blocks wide, 4 or 5 tall), so its blocks cannot be placed.`

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: 0 }}>
      <Box sx={{ width: narrow ? 'auto' : ui(300), flexShrink: 0, overflow: 'auto', borderRight: narrow ? 0 : 1, borderBottom: narrow ? 1 : 0, borderColor: 'divider', bgcolor: 'background.paper', maxHeight: narrow ? '45%' : 'none' }}>
        <Section title="Style">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 1, p: 2 }}>
            {ROOMGEN_STYLES.map((style) => <StyleButton key={style.id} style={style} options={options} onClick={() => set(style.options)} />)}
          </Box>
        </Section>
        <Section title="Tileset">
          <Fields>
            {Object.keys(tilesets).length > 0 ? (
              <Field label="Tileset">
                <SelectInput label="Tileset" value={tilesetId ?? ''} options={Object.entries(tilesets).map(([id, t]) => ({ value: id, label: t.name }))} onChange={(id) => setSaved((s) => ({ ...s, tileset: id }))} />
              </Field>
            ) : (
              <Field label="">
                <Typography variant="body2" color="text.secondary">No tileset in the project yet. The preview uses the tileset generator's current settings; save a tileset there to save rooms.</Typography>
              </Field>
            )}
            {layout && (
              <Field label="">
                <Typography variant="body2" color={slopes ? 'text.secondary' : 'warning.main'}>
                  {layout.blockSize} px blocks{slopes ? ', with slopes.' : '. Made before slopes: save it again from the tileset generator to add them.'}
                </Typography>
              </Field>
            )}
          </Fields>
        </Section>
        <Section title="Room">
          <Fields>
            <Field label="Width"><NumberInput label="Width in screens" value={options.width} min={1} max={16} onCommit={(width) => set({ width })} /><Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>screens</Typography></Field>
            <Field label="Height"><NumberInput label="Height in screens" value={options.height} min={1} max={16} onCommit={(height) => set({ height })} /><Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>screens</Typography></Field>
            <Field label="Seed">
              <NumberInput label="Seed" value={options.seed} min={0} max={999_999_999} onCommit={(seed) => set({ seed })} />
              <ToolButton title="New seed" onClick={() => set({ seed: randomSeed() })}><CasinoOutlinedIcon /></ToolButton>
            </Field>
            <Field label="Layout"><SelectInput label="Layout" value={options.layout} options={LAYOUTS} onChange={(layout) => set({ layout })} /></Field>
            <Field label="Exits">
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2 }}>
                {EXITS.map(([side, label]) => (
                  <Checkbox key={side} checked={options.exits[side]} onChange={(on) => set({ exits: { ...options.exits, [side]: on } })}>{label}</Checkbox>
                ))}
              </Box>
            </Field>
          </Fields>
        </Section>
        <Section title="Shape">
          <Fields>
            <Range label="Variation" value={options.variation} min={0} max={100} step={5} onChange={(variation) => set({ variation })} />
            <Range label="Slopes" value={options.slopes} min={0} max={100} step={5} disabled={!slopes} onChange={(s) => set({ slopes: s })} />
            <Range label="Platforms" value={options.platforms} min={0} max={100} step={5} onChange={(platforms) => set({ platforms })} />
            <Range label="Small places" value={options.nooks} min={0} max={100} step={5} onChange={(nooks) => set({ nooks })} />
            <Range label="Spike pits" value={options.hazards} min={0} max={100} step={5} onChange={(hazards) => set({ hazards })} />
          </Fields>
        </Section>
        <Section title="Dressing">
          <Fields>
            <Field label="Back wall"><SelectInput label="Back wall" value={options.backWall} options={BACK_WALLS} onChange={(backWall) => set({ backWall })} /></Field>
            <Range label="Decoration" value={options.decoration} min={0} max={100} step={5} onChange={(decoration) => set({ decoration })} />
          </Fields>
        </Section>
        <SaveSection room={room} options={options} tilesetId={tileset && layout ? tilesetId : undefined} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {message ? (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, textAlign: 'center' }}><Typography color="text.secondary">{message}</Typography></Box>
        ) : (
          <Viewport initialZoom={options.width > 2 ? 1 : 2} maxZoom={8} tools={tools} info={info}>
            {(zoom) =>
              room && draw && (
                <Box
                  sx={{ position: 'relative', width: room.tileCols * 8 * zoom, height: room.tileRows * 8 * zoom }}
                  onMouseMove={(event) => {
                    const box = event.currentTarget.getBoundingClientRect()
                    const x = Math.floor((event.clientX - box.left) / (T * zoom))
                    const y = Math.floor((event.clientY - box.top) / (T * zoom))
                    const i = y * room.cols + x
                    const names = [room.ground[i], room.back?.[i]].filter(Boolean)
                    setHover(x >= 0 && y >= 0 && x < room.cols && y < room.rows ? `Block ${x}, ${y} · ${names.length ? names.join(' over ') : 'air'}` : null)
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <PixelCanvas draw={draw} style={{ width: room.tileCols * 8 * zoom, height: room.tileRows * 8 * zoom }} />
                  {grid && <GridOverlay stepX={SCREEN.width * zoom} stepY={SCREEN.height * zoom} colour="rgba(255,255,255,0.35)" />}
                </Box>
              )
            }
          </Viewport>
        )}
      </Box>
    </Box>
  )
}

function StyleButton({ style, options, onClick }: { style: (typeof ROOMGEN_STYLES)[number]; options: RoomgenOptions; onClick: () => void }) {
  const active = (Object.keys(style.options) as Array<keyof typeof style.options>).every((k) => options[k] === style.options[k])
  const draw = useMemo(() => {
    const room = generateRoom({ ...DEFAULT_ROOMGEN, ...style.options, seed: 4, width: style.id === 'shaft' ? 1 : 2, height: style.id === 'shaft' ? 2 : 1, exits: { left: true, right: true, top: false, bottom: false } }, PREVIEW_ENV)
    return (canvas: HTMLCanvasElement) => drawCells(canvas, room)
  }, [style])
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={style.description}
      sx={{ font: 'inherit', color: 'text.primary', cursor: 'pointer', p: 0, overflow: 'hidden', textAlign: 'left', bgcolor: '#191919', border: '1px solid', borderColor: active ? 'primary.main' : '#3a3a3a', borderRadius: 1, '&:hover': { borderColor: 'primary.main' } }}
    >
      <Box sx={{ height: 40, bgcolor: SKY, display: 'flex', justifyContent: 'center' }}>
        <PixelCanvas draw={draw} style={{ height: '100%', width: 'auto' }} />
      </Box>
      <Typography variant="body2" noWrap sx={{ px: 1, py: 0.5 }}>{style.name}</Typography>
    </Box>
  )
}

function SaveSection({ room, options, tilesetId }: { room: GeneratedRoom | null; options: RoomgenOptions; tilesetId: string | undefined }) {
  const bundle = useStudio((s) => s.bundle)
  const commit = useStudio((s) => s.commit)
  const select = useStudio((s) => s.select)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<{ text: string; room: string } | null>(null)
  const style = ROOMGEN_STYLES.find((s) => (Object.keys(s.options) as Array<keyof typeof s.options>).every((k) => options[k] === s.options[k]))
  const title = name || `${style?.name ?? 'Room'} ${options.seed}`
  const id = uniqueId(slugify(title), Object.keys(bundle?.docs.rooms ?? {}))

  const save = () => {
    if (!room || !tilesetId) return
    commit('room', id, roomgenDocument(room, title, tilesetId))
    setStatus({ text: `Saved room “${title}”. Place it on the world map to play it.`, room: id })
  }

  return (
    <Section title="Save">
      <Fields>
        <Field label="Name"><TextInput label="Room name" value={name} placeholder={title} onCommit={setName} /></Field>
        <Field label="File"><Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>studio/rooms/{id}.json</Typography></Field>
        <Field label="">
          <Button variant="contained" startIcon={<SaveOutlinedIcon />} disabled={!room || !tilesetId || !bundle?.initialised} onClick={save}>Save to project</Button>
        </Field>
        {status && (
          <Field label="">
            <Typography variant="body2" color="success.main" sx={{ overflowWrap: 'anywhere' }}>{status.text}</Typography>
            <Button size="small" onClick={() => select({ kind: 'room', id: status.room })}>Open</Button>
          </Field>
        )}
      </Fields>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 3, minHeight: BAR.row }}>
        A new room each time, on the chosen tileset: a back wall layer (if any) and a ground layer. Steps, gaps and ladders follow the project's jump, so each exit can be reached from the others. Left exits are low and right exits high when the room has several levels.
      </Typography>
    </Section>
  )
}
