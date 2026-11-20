// The Tools gallery, and the tools it opens in the document area.
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import GridOnIcon from '@mui/icons-material/GridOn'
import LandscapeOutlinedIcon from '@mui/icons-material/LandscapeOutlined'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import {
  DEFAULT_TILEGEN, FORMAT_VERSION, TILEGEN_PRESETS, autotile, countColours, generateTileset, presetOptions, scaleOptions, slugify, tilegenCollision, uniqueId,
} from '@pecten-studio/core'
import type { BodyPattern, CollisionClass, GeneratedTileset, TilegenColours, TilegenOptions, TopStyle } from '@pecten-studio/core'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.ts'
import { Checkbox, Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { TOOLS } from '../tools.ts'
import { BAR, ui } from '../theme.ts'
import { PixelArtConverter, PixelArtPreview } from './pixelart.tsx'
import { RoomGenerator, RoomPreview } from './roomgen.tsx'
import { PixelCanvas, Range, Section, canvasPng, checkerboard, downloadBlob, rgbaCanvas } from './toolkit.tsx'
import { Divider, GridOverlay, Message, ToolButton, Viewport } from './views.tsx'

export function ToolView({ id }: { id?: string }) {
  if (!id) return <ToolsGallery />
  if (id === 'tileset-generator') return <TilesetGenerator />
  if (id === 'pixel-art') return <PixelArtConverter />
  if (id === 'room-generator') return <RoomGenerator />
  return <Message>There is no tool called “{id}”.</Message>
}

// ---------------------------------------------------------------------------------------
// Gallery

function ToolsGallery() {
  const select = useStudio((s) => s.select)
  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: { xs: 3, md: 5 } }}>
      <Typography variant="h6" component="h1">Tools</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 4, maxWidth: 640 }}>
        Helpers that make assets for the game. What they save goes into the game folder like any other file.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 3 }}>
        {TOOLS.map((tool) => (
          <Card key={tool.id} variant="outlined" sx={{ bgcolor: 'background.paper', borderColor: '#3a3a3a', '&:hover': { borderColor: 'primary.main' } }}>
            <CardActionArea onClick={() => select({ kind: 'tools', id: tool.id })} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
              <ToolPreview id={tool.id} />
              <CardContent sx={{ flex: 1, p: 3 }}>
                <Typography sx={{ fontWeight: 600 }}>{tool.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{tool.description}</Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                  {tool.tags.map((tag) => <Chip key={tag} label={tag} size="small" variant="outlined" />)}
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
        <Box sx={{ border: '1px dashed #3a3a3a', borderRadius: 1.5, display: 'grid', placeItems: 'center', minHeight: 160, p: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>More tools to come.</Typography>
        </Box>
      </Box>
    </Box>
  )
}

function ToolPreview({ id }: { id: string }) {
  if (id === 'pixel-art') return <PixelArtPreview />
  if (id === 'room-generator') return <RoomPreview />
  return <TilesetPreview id={id} />
}

function TilesetPreview({ id }: { id: string }) {
  const sheet = useMemo(() => (id === 'tileset-generator' ? generateTileset(presetOptions(TILEGEN_PRESETS[0]!, 8, 3)) : null), [id])
  if (!sheet) return null
  return (
    <Box sx={{ height: 120, bgcolor: SKY, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <PixelCanvas draw={(canvas) => drawScene(canvas, sheet)} style={{ height: '100%', width: 'auto' }} />
    </Box>
  )
}

// ---------------------------------------------------------------------------------------
// Drawing helpers

const SKY = '#26304a'

const sheetCanvas = (sheet: GeneratedTileset): HTMLCanvasElement => rgbaCanvas(sheet.width, sheet.height, sheet.rgba)

// A small level to see the blocks working together. # ground, = platform, ^ spikes,
// b back wall, w window, i torch on a back wall, s back wall in shadow, T F R tuft, flower, rock.
const SCENE = [
  '........................',
  '..............sssssss...',
  '..====........bwbbbwb...',
  '..............bbibibb...',
  '.......#......bbbbbbb...',
  '.......#....F.#######...',
  '....T..#...########.....',
  '#########..########R..T#',
  '#########^^#########====',
  '####################....',
  '####################..##',
  '########################',
]

/** `interior`: a wall behind everything instead of sky, for ships and buildings. */
function drawScene(canvas: HTMLCanvasElement, sheet: GeneratedTileset, interior = false) {
  const T = sheet.blockSize
  const rows = SCENE.length
  const cols = SCENE[0]!.length
  canvas.width = cols * T
  canvas.height = rows * T
  const context = canvas.getContext('2d')!
  context.fillStyle = SKY
  context.fillRect(0, 0, canvas.width, canvas.height)
  const source = sheetCanvas(sheet)
  const where = new Map(sheet.blocks.map((b) => [b.name, b]))
  const put = (name: string, x: number, y: number) => {
    const b = where.get(name)
    if (b) context.drawImage(source, b.col * T, b.row * T, T, T, x * T, y * T, T, T)
  }
  const cell = (x: number, y: number) => SCENE[y]?.[x] ?? '.'
  const ground = autotile(cols, rows, (x, y) => cell(x, y) === '#', 5)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cell(x, y)
      if (interior && !'bwis'.includes(c)) put(hashCell(x, y) ? 'back-alt' : 'back', x, y)
      if ('bwis'.includes(c)) put(c === 'w' ? 'window' : c === 's' ? 'back-shadow' : 'back', x, y)
      if (c === 'i') put('torch', x, y)
      if (c === '=') put(cell(x - 1, y) !== '=' && cell(x - 1, y) !== '#' ? 'platform-l' : cell(x + 1, y) !== '=' ? 'platform-r' : 'platform', x, y)
      if (c === '^') put('spikes', x, y)
      if (c === 'T') put('tuft', x, y)
      if (c === 'F') put('flower', x, y)
      if (c === 'R') put('rock', x, y)
      const name = ground[y]![x]
      if (name) put(name, x, y)
    }
  }
}

const hashCell = (x: number, y: number) => ((x * 7 + y * 13) % 5) === 0

// ---------------------------------------------------------------------------------------
// Tileset generator

const STORAGE_KEY = 'pecten-studio:tilegen'
function loadOptions(): TilegenOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<TilegenOptions> | null
    if (saved) return { ...DEFAULT_TILEGEN, ...saved, colours: { ...DEFAULT_TILEGEN.colours, ...saved.colours } }
  } catch { /* storage unavailable */ }
  return DEFAULT_TILEGEN
}

const PATTERNS: ReadonlyArray<{ value: BodyPattern; label: string }> = [
  { value: 'earth', label: 'Earth' },
  { value: 'bricks', label: 'Bricks' },
  { value: 'stone', label: 'Cut stone' },
  { value: 'cobble', label: 'Cobblestone' },
  { value: 'wood', label: 'Wood planks' },
  { value: 'panels', label: 'Metal panels (sci-fi)' },
]
const TOPS: ReadonlyArray<{ value: TopStyle; label: string }> = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'rough', label: 'Rough' },
  { value: 'battlements', label: 'Battlements' },
]
const SIZES = [
  { value: '8', label: '8 px · 1 tile' },
  { value: '16', label: '16 px · 2 × 2 tiles' },
  { value: '32', label: '32 px · 4 × 4 tiles' },
] as const
const COLOUR_FIELDS: ReadonlyArray<[keyof TilegenColours, string]> = [
  ['surface', 'Surface'],
  ['surfaceDark', 'Surface dark'],
  ['body', 'Body'],
  ['bodyDark', 'Body dark'],
  ['accent', 'Accent'],
  ['accentDark', 'Accent dark'],
]
const randomSeed = () => Math.floor(Math.random() * 1_000_000)

function TilesetGenerator() {
  const [options, setOptions] = useState<TilegenOptions>(loadOptions)
  const [view, setView] = useState<'sheet' | 'scene'>('sheet')
  const [grid, setGrid] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const narrow = !useMediaQuery('(min-width:800px)')
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)) } catch { /* storage unavailable */ }
  }, [options])

  const sheet = useMemo(() => generateTileset(options), [options])
  const colours = useMemo(() => countColours(sheet.rgba), [sheet])
  const tiles = (sheet.width / 8) * (sheet.height / 8)
  const set = (patch: Partial<TilegenOptions>) => setOptions((o) => ({ ...o, ...patch }))
  const T = options.blockSize
  const drawSheet = useMemo(() => (canvas: HTMLCanvasElement) => {
    canvas.width = sheet.width
    canvas.height = sheet.height
    canvas.getContext('2d')!.drawImage(sheetCanvas(sheet), 0, 0)
  }, [sheet])
  const interior = options.pattern === 'panels' || options.pattern === 'wood'
  const drawPreview = useMemo(() => (canvas: HTMLCanvasElement) => drawScene(canvas, sheet, interior), [sheet, interior])

  const tools = (
    <>
      <ToolButton title="The tileset as it is saved" active={view === 'sheet'} onClick={() => setView('sheet')}><ViewModuleOutlinedIcon /></ToolButton>
      <ToolButton title="The blocks in a small level" active={view === 'scene'} onClick={() => setView('scene')}><LandscapeOutlinedIcon /></ToolButton>
      <Divider />
      <ToolButton title="Show block grid" active={grid} disabled={view !== 'sheet'} onClick={() => setGrid(!grid)}><GridOnIcon /></ToolButton>
    </>
  )
  const info = hover ?? `${sheet.width} × ${sheet.height} px · ${tiles} tiles of 8 × 8 · ${colours} of 15 colours · 1 palette`

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: 0 }}>
      <Box sx={{ width: narrow ? 'auto' : ui(300), flexShrink: 0, overflow: 'auto', borderRight: narrow ? 0 : 1, borderBottom: narrow ? 1 : 0, borderColor: 'divider', bgcolor: 'background.paper', maxHeight: narrow ? '45%' : 'none' }}>
        <Controls options={options} set={set} setOptions={setOptions} palette={sheet.palette} />
        <SaveSection sheet={sheet} options={options} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Viewport initialZoom={T === 32 ? 2 : T === 16 ? 3 : 5} maxZoom={16} tools={tools} info={info}>
          {(zoom) =>
            view === 'sheet' ? (
              <Box
                sx={{ position: 'relative', width: sheet.width * zoom, height: sheet.height * zoom, ...checkerboard(4 * zoom) }}
                onMouseMove={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  const col = Math.floor((event.clientX - box.left) / (T * zoom))
                  const row = Math.floor((event.clientY - box.top) / (T * zoom))
                  const block = sheet.blocks.find((b) => b.col === col && b.row === row)
                  const per = T / 8
                  setHover(block ? `${block.label} · first tile ${row * per * (sheet.width / 8) + col * per} · ${block.collision === 'empty' ? 'no collision' : block.collision === 'oneway' ? 'one-way on top' : block.collision}` : null)
                }}
                onMouseLeave={() => setHover(null)}
              >
                <PixelCanvas draw={drawSheet} style={{ width: sheet.width * zoom, height: sheet.height * zoom }} />
                {grid && <GridOverlay stepX={T * zoom} stepY={T * zoom} colour="rgba(255,255,255,0.18)" />}
              </Box>
            ) : (
              <PixelCanvas key={`${sheet.width}`} draw={drawPreview} style={{ width: 24 * T * zoom, height: SCENE.length * T * zoom }} />
            )
          }
        </Viewport>
      </Box>
    </Box>
  )
}

function Controls({ options, set, setOptions, palette }: {
  options: TilegenOptions
  set: (patch: Partial<TilegenOptions>) => void
  setOptions: (options: TilegenOptions) => void
  palette: string[]
}) {
  const T = options.blockSize
  const masonry = options.pattern !== 'earth'
  return (
    <>
      <Section title="Template">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1, p: 2 }}>
          {TILEGEN_PRESETS.map((preset) => {
            const c = preset.options.colours
            const active = (Object.keys(c) as Array<keyof TilegenColours>).every((k) => options.colours[k] === c[k])
            return (
              <Box
                key={preset.id}
                component="button"
                type="button"
                onClick={() => setOptions(presetOptions(preset, T, options.seed))}
                aria-pressed={active}
                sx={{ font: 'inherit', color: 'text.primary', cursor: 'pointer', p: 0, overflow: 'hidden', textAlign: 'left', bgcolor: '#191919', border: '1px solid', borderColor: active ? 'primary.main' : '#3a3a3a', borderRadius: 1, '&:hover': { borderColor: 'primary.main' } }}
              >
                <Box sx={{ height: 6, bgcolor: c.surface }} />
                <Box sx={{ height: 14, background: `linear-gradient(${c.body}, ${c.bodyDark})` }} />
                <Typography variant="body2" noWrap sx={{ px: 1, py: 0.5 }}>{preset.name}</Typography>
              </Box>
            )
          })}
        </Box>
      </Section>
      <Section title="Generation">
        <Fields>
          <Field label="Seed">
            <NumberInput label="Seed" value={options.seed} min={0} max={999_999_999} onCommit={(seed) => set({ seed })} />
            <ToolButton title="New seed" onClick={() => set({ seed: randomSeed() })}><CasinoOutlinedIcon /></ToolButton>
          </Field>
          <Field label="Block size">
            <SelectInput label="Block size" value={String(T) as '8' | '16' | '32'} options={SIZES} onChange={(v) => setOptions(scaleOptions(options, Number(v) as 8 | 16 | 32))} />
          </Field>
        </Fields>
      </Section>
      <Section title="Colours">
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, px: 2, py: 1.5 }}>
          {COLOUR_FIELDS.map(([key, label]) => (
            <Box key={key} component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <input type="color" aria-label={label} value={options.colours[key]} onChange={(event) => set({ colours: { ...options.colours, [key]: event.target.value } })} style={{ width: ui(22), height: ui(22), padding: 0, border: '1px solid #3a3a3a', background: 'none', flexShrink: 0 }} />
              <Typography variant="body2" noWrap>{label}</Typography>
            </Box>
          ))}
        </Box>
        <Fields>
          <Range label="Shades" value={options.shades} min={2} max={6} onChange={(shades) => set({ shades })} />
          <Field label="Palette">
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }} title="The colours as the GBA shows them">
              {palette.map((c, i) => <Box key={i} sx={{ width: ui(12), height: ui(12), bgcolor: c, border: '1px solid rgba(255,255,255,0.15)' }} />)}
            </Box>
          </Field>
        </Fields>
      </Section>
      <Section title="Material">
        <Fields>
          <Field label="Body"><SelectInput label="Body pattern" value={options.pattern} options={PATTERNS} onChange={(pattern) => set({ pattern })} /></Field>
          <Field label="Top edge"><SelectInput label="Top edge" value={options.top} options={TOPS} onChange={(top) => set({ top })} /></Field>
          <Field label=""><Checkbox checked={options.surface} onChange={(surface) => set({ surface })}>Surface layer (grass, snow, moss)</Checkbox></Field>
          <Range label="Surface depth" value={options.surfaceDepth} min={1} max={Math.max(2, T / 2)} disabled={!options.surface} onChange={(surfaceDepth) => set({ surfaceDepth })} />
          <Range label="Overhang" value={options.overhang} min={0} max={T / 2} disabled={!options.surface} onChange={(overhang) => set({ overhang })} />
          <Range label="Drips" value={options.roughness} min={0} max={4} disabled={!options.surface} onChange={(roughness) => set({ roughness })} />
          <Range label="Edge noise" value={options.edgeNoise} min={0} max={3} onChange={(edgeNoise) => set({ edgeNoise })} />
          <Range label="Corner radius" value={options.cornerRadius} min={0} max={T / 2} disabled={options.top === 'battlements'} onChange={(cornerRadius) => set({ cornerRadius })} />
        </Fields>
      </Section>
      <Section title="Texture">
        <Fields>
          <Range label="Contrast" value={options.texture} min={0} max={100} step={5} onChange={(texture) => set({ texture })} />
          <Range label="Strata" value={options.strata} min={0} max={100} step={5} disabled={options.pattern !== 'earth'} onChange={(strata) => set({ strata })} />
          <Range label={options.pattern === 'wood' ? 'Knots' : 'Stones'} value={options.pebbles} min={0} max={100} step={5} disabled={options.pattern !== 'earth' && options.pattern !== 'wood'} onChange={(pebbles) => set({ pebbles })} />
          <Field label=""><Checkbox checked={options.outline} onChange={(outline) => set({ outline })}>Dark outline on open edges</Checkbox></Field>
          <Field label=""><Checkbox checked={options.dither} onChange={(dither) => set({ dither })}>Dither between shades</Checkbox></Field>
          {masonry && <Field label=""><Typography variant="body2" color="text.secondary">{options.pattern === 'panels' ? 'Plates line up across blocks; variants move the vents and light strips, the window becomes a porthole and the decorations become machinery.' : 'Joints line up across blocks; the variants change stones, cracks or knots without moving them.'}</Typography></Field>}
        </Fields>
      </Section>
    </>
  )
}

function SaveSection({ sheet, options }: { sheet: GeneratedTileset; options: TilegenOptions }) {
  const bundle = useStudio((s) => s.bundle)
  const load = useStudio((s) => s.load)
  const commit = useStudio((s) => s.commit)
  const select = useStudio((s) => s.select)
  const preset = TILEGEN_PRESETS.find((p) => p.options.colours.surface === options.colours.surface && p.options.colours.body === options.colours.body)
  const [name, setName] = useState('')
  const [makeTileset, setMakeTileset] = useState(true)
  const [status, setStatus] = useState<{ ok: boolean; text: string; tileset?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const title = name || `${preset?.name ?? 'Generated'} tiles`
  const path = `assets/tilesets/${slugify(title)}.png`
  const exists = !!bundle?.assets.some((a) => a.path === path)

  const blob = () => canvasPng(sheetCanvas(sheet))

  const save = async () => {
    if (!bundle) return
    const users = Object.values(bundle.docs.tilesets).filter((t) => t.image === path)
    if (exists && !window.confirm(`${path} already exists${users.length ? ` and tileset “${users[0]!.name}” uses it` : ''}. Replace it? Rooms keep their tile numbers, so they show the new blocks in the same places.`)) return
    setBusy(true)
    try {
      await api.upload(path, await blob(), exists)
      await load()
      let tileset: string | undefined
      if (makeTileset) {
        const docs = useStudio.getState().bundle!.docs
        const project = docs.project
        const classes: CollisionClass[] = [...(project?.collisionClasses ?? [])]
        const fallback = classes[0]?.id
        let added = false
        // A tile with the project's first class needs nothing stored. Slopes need a class for
        // each pair of floor heights; those the project lacks are added to it.
        const collision = tilegenCollision(sheet, (kind, slope) => {
          let found = slope
            ? classes.find((c) => c.kind === 'slope' && c.slope?.left === slope.left && c.slope.right === slope.right)
            : classes.find((c) => c.kind === kind)
          if (!found && slope && project) {
            const steep = Math.abs(slope.right - slope.left) === 8
            found = {
              id: uniqueId(`slope-${slope.left}-${slope.right}`, classes.map((c) => c.id)),
              name: `${steep ? 'Slope' : 'Gentle slope'} ${slope.right > slope.left ? 'up' : 'down'} ${slope.left}→${slope.right}`,
              colour: '#46a758',
              kind: 'slope',
              slope,
            }
            classes.push(found)
            added = true
          }
          return found?.id === fallback ? undefined : found?.id
        })
        if (project && added) commit('project', undefined, { ...project, collisionClasses: classes })
        const existing = Object.entries(docs.tilesets).find(([, t]) => t.image === path)
        tileset = existing?.[0] ?? uniqueId(slugify(title), Object.keys(docs.tilesets))
        commit('tileset', tileset, { version: FORMAT_VERSION, name: existing?.[1].name ?? title, image: path, collision })
      }
      setStatus({ ok: true, text: `Saved ${path}${tileset ? ' and its tileset' : ''}.`, tileset })
    } catch (error) {
      setStatus({ ok: false, text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const download = async () => downloadBlob(await blob(), path.split('/').pop()!)

  return (
    <Section title="Save">
      <Fields>
        <Field label="Name"><TextInput label="Tileset name" value={name} placeholder={title} onCommit={setName} /></Field>
        <Field label="File"><Typography variant="body2" color={exists ? 'warning.main' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>{path}{exists ? ' (exists, will be replaced)' : ''}</Typography></Field>
        <Field label=""><Checkbox checked={makeTileset} onChange={setMakeTileset}>Make a tileset with collision set</Checkbox></Field>
        <Field label="">
          <Button variant="contained" startIcon={<SaveOutlinedIcon />} disabled={busy || !bundle?.initialised} onClick={() => void save()}>Save to project</Button>
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={() => void download()}>PNG</Button>
        </Field>
        {status && (
          <Field label="">
            <Typography variant="body2" color={status.ok ? 'success.main' : 'error'} sx={{ overflowWrap: 'anywhere' }}>{status.text}</Typography>
            {status.tileset && <Button size="small" onClick={() => select({ kind: 'tileset', id: status.tileset })}>Open</Button>}
          </Field>
        )}
      </Fields>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 3, minHeight: BAR.row }}>
        Blocks sit edge to edge with no padding, at multiples of 8 pixels, in one 15-colour palette: the build takes the PNG as it is. Ground is solid, platforms are one-way along their top, spikes are hazards.
      </Typography>
    </Section>
  )
}
