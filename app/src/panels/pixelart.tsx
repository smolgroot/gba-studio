// The pixel art converter: a picture in (opened, pasted, dropped or from the game folder),
// a small GBA-ready image out. The image work is in core's pixelart.ts.
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CompareOutlinedIcon from '@mui/icons-material/CompareOutlined'
import ContentPasteOutlinedIcon from '@mui/icons-material/ContentPasteOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import GridOnIcon from '@mui/icons-material/GridOn'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { DEFAULT_PIXELART, PIXELART_MAX_SIZE, PIXELART_SIZES, convertPixelArt, slugify } from '@pecten-studio/core'
import type { PixelArtOptions, PixelArtResult, PixelCanvasMode, PixelDither, PixelImage, PixelSampling } from '@pecten-studio/core'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { api, fileUrl } from '../api.ts'
import { Checkbox, Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { PixelCanvas, Range, Section, canvasPng, checkerboard, downloadBlob, rgbaCanvas } from './toolkit.tsx'
import { Divider, GridOverlay, ToolButton, Viewport } from './views.tsx'

// ---------------------------------------------------------------------------------------
// The picture being converted

interface Source {
  /** File name, or what it was pasted as. */
  name: string
  /** Size of the picture as it came in. */
  width: number
  height: number
  /** The pixels worked on, shrunk to at most MAX_SOURCE on a side so changes stay quick. */
  image: PixelImage
  /** For showing the original next to the result. */
  url: string
  /** Bumped per picture, so the view resets its zoom. */
  key: number
}

/** Larger pictures are shrunk on the way in: a result is at most 512 px, so this keeps 2× of detail. */
const MAX_SOURCE = 1024
let sources = 0
/** The last picture, kept while the studio is open so switching tabs does not lose it. */
let lastSource: Source | null = null

async function loadSource(from: Blob | string, name: string): Promise<Source> {
  const url = typeof from === 'string' ? from : URL.createObjectURL(from)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    throw new Error(`${name} is not a picture the browser can open.`)
  }
  const { naturalWidth: width, naturalHeight: height } = image
  const scale = Math.min(1, MAX_SOURCE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  return { name, width, height, url, key: ++sources, image: { width: data.width, height: data.height, rgba: data.data } }
}

const imageFile = (items: DataTransferItemList | null | undefined): File | null => {
  for (const item of items ?? []) if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  return null
}

// ---------------------------------------------------------------------------------------
// Options

const STORAGE_KEY = 'pecten-studio:pixelart'
function loadOptions(): PixelArtOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PixelArtOptions> | null
    if (saved) return { ...DEFAULT_PIXELART, ...saved }
  } catch { /* storage unavailable */ }
  return DEFAULT_PIXELART
}

const CANVASES: ReadonlyArray<{ value: PixelCanvasMode; label: string }> = [
  { value: 'square', label: 'Square (size × size)' },
  { value: 'tiles', label: 'Whole 8 × 8 tiles' },
  { value: 'fit', label: 'Fit the picture' },
]
const SAMPLINGS: ReadonlyArray<{ value: PixelSampling; label: string }> = [
  { value: 'sharp', label: 'Sharp (most common colour)' },
  { value: 'smooth', label: 'Smooth (average)' },
]
const DEPTHS = [
  { value: '4', label: '16 colours · 1 palette (4 bpp)' },
  { value: '8', label: '256 colours (8 bpp)' },
] as const
const DITHERS: ReadonlyArray<{ value: PixelDither; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'ordered', label: 'Ordered (pattern)' },
  { value: 'diffusion', label: 'Diffusion (Floyd–Steinberg)' },
]
const PLACEMENTS = [
  { value: 'outside', label: 'Outside the shape' },
  { value: 'inside', label: 'On the shape’s edge' },
] as const
const FOLDERS = [
  { value: 'assets/sprites', label: 'assets/sprites' },
  { value: 'assets/backgrounds', label: 'assets/backgrounds' },
  { value: 'assets/tilesets', label: 'assets/tilesets' },
  { value: 'assets', label: 'assets' },
] as const
type Folder = (typeof FOLDERS)[number]['value']

/** Sizes an object can have on the GBA, width × height. */
const SPRITE_SHAPES = new Set(['8x8', '16x16', '32x32', '64x64', '16x8', '32x8', '32x16', '64x32', '8x16', '8x32', '16x32', '32x64'])

function describe(result: PixelArtResult): string {
  const n = result.palette.length
  const colours = n <= 15 ? `${n} colours · fits one 16-colour palette` : n <= 255 ? `${n} colours · needs 256-colour mode` : `${n} colours · too many for the GBA, turn on the palette`
  const shape = SPRITE_SHAPES.has(`${result.width}x${result.height}`) ? ' · a GBA sprite size' : result.width % 8 || result.height % 8 ? ' · not whole 8 × 8 tiles' : ''
  return `${result.width} × ${result.height} px · ${colours}${shape}`
}

// ---------------------------------------------------------------------------------------
// The tool

export function PixelArtConverter() {
  const [options, setOptions] = useState<PixelArtOptions>(loadOptions)
  const [source, setSourceState] = useState<Source | null>(() => lastSource)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'result' | 'compare'>('result')
  const [grid, setGrid] = useState(false)
  const narrow = !useMediaQuery('(min-width:800px)')
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)) } catch { /* storage unavailable */ }
  }, [options])
  const set = (patch: Partial<PixelArtOptions>) => setOptions((o) => ({ ...o, ...patch }))

  const open = useCallback(async (from: Blob | string, name: string) => {
    try {
      const next = await loadSource(from, name)
      if (lastSource?.url.startsWith('blob:')) URL.revokeObjectURL(lastSource.url)
      lastSource = next
      setSourceState(next)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // Ctrl+V anywhere in the tool takes a picture from the clipboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = imageFile(event.clipboardData?.items)
      if (!file) return
      event.preventDefault()
      void open(file, 'pasted image')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  const paste = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) return void open(await item.getType(type), 'pasted image')
      }
      setError('There is no picture on the clipboard.')
    } catch {
      setError('The clipboard cannot be read from here: press Ctrl+V (⌘V) instead.')
    }
  }

  const onDrop = (event: DragEvent) => {
    const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void open(file, file.name)
  }

  // Sliders move the deferred copy, so dragging stays smooth on large pictures.
  const deferred = useDeferredValue(options)
  const result = useMemo(() => (source ? convertPixelArt(source.image, deferred) : null), [source, deferred])

  const tools = (
    <>
      <ToolButton title="The result" active={view === 'result'} disabled={!result} onClick={() => setView('result')}><ImageOutlinedIcon /></ToolButton>
      <ToolButton title="Next to the original" active={view === 'compare'} disabled={!result} onClick={() => setView('compare')}><CompareOutlinedIcon /></ToolButton>
      <Divider />
      <ToolButton title="Show 8 × 8 tile grid" active={grid} disabled={!result} onClick={() => setGrid(!grid)}><GridOnIcon /></ToolButton>
    </>
  )

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: 0 }}>
      <Box sx={{ width: narrow ? 'auto' : ui(300), flexShrink: 0, overflow: 'auto', borderRight: narrow ? 0 : 1, borderBottom: narrow ? 1 : 0, borderColor: 'divider', bgcolor: 'background.paper', maxHeight: narrow ? '45%' : 'none' }}>
        <SourceSection source={source} error={error} open={open} paste={() => void paste()} />
        <PixelateSection options={options} set={set} />
        <PaletteSection options={options} set={set} palette={result?.palette ?? []} />
        <StrokeSection options={options} set={set} />
        <SaveSection source={source} result={result} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        {source && result ? (
          <Viewport key={`${source.key}:${options.size}`} initialZoom={Math.max(1, Math.min(16, Math.floor(256 / Math.max(result.width, result.height))))} maxZoom={24} tools={tools} info={describe(result)}>
            {(zoom) => <Result source={source} result={result} zoom={zoom} compare={view === 'compare'} grid={grid} />}
          </Viewport>
        ) : (
          <DropZone open={open} paste={() => void paste()} error={error} />
        )}
      </Box>
    </Box>
  )
}

function Result({ source, result, zoom, compare, grid }: { source: Source; result: PixelArtResult; zoom: number; compare: boolean; grid: boolean }) {
  const draw = useMemo(() => (canvas: HTMLCanvasElement) => {
    canvas.width = result.width
    canvas.height = result.height
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0)
  }, [result])
  const width = result.width * zoom
  const height = result.height * zoom
  const cell = Math.max(4, zoom * 2)
  return (
    <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {compare && (
        <Box sx={{ width, height, flexShrink: 0, ...checkerboard(cell) }}>
          <img src={source.url} alt="The original" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </Box>
      )}
      <Box sx={{ position: 'relative', width, height, flexShrink: 0, ...checkerboard(cell) }}>
        <PixelCanvas draw={draw} style={{ width, height }} />
        {grid && <GridOverlay stepX={8 * zoom} stepY={8 * zoom} colour="rgba(255,255,255,0.22)" />}
      </Box>
    </Box>
  )
}

function OpenButtons({ open, paste }: { open: (from: Blob, name: string) => void; paste: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) open(file, file.name)
        }}
      />
      <Button variant="outlined" startIcon={<FolderOpenOutlinedIcon />} onClick={() => input.current?.click()}>Open…</Button>
      <Button variant="outlined" startIcon={<ContentPasteOutlinedIcon />} onClick={paste}>Paste</Button>
    </>
  )
}

function DropZone({ open, paste, error }: { open: (from: Blob, name: string) => void; paste: () => void; error: string | null }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, bgcolor: '#161616' }}>
      <Box sx={{ border: '1px dashed #3a3a3a', borderRadius: 2, p: 5, maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <ImageOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
        <Typography sx={{ fontWeight: 600 }}>Drop a picture here</Typography>
        <Typography variant="body2" color="text.secondary">Or paste one with Ctrl+V (⌘V), open a file, or pick a PNG of the game on the left. PNG, JPEG, GIF and WebP work; transparency is kept.</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}><OpenButtons open={open} paste={paste} /></Box>
        {error && <Typography variant="body2" color="error">{error}</Typography>}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------------------
// Side panel

function SourceSection({ source, error, open, paste }: { source: Source | null; error: string | null; open: (from: Blob | string, name: string) => void; paste: () => void }) {
  const assets = useStudio((s) => s.bundle?.assets ?? [])
  const revision = useStudio((s) => s.revision)
  const pngs = useMemo(() => assets.filter((a) => a.path.toLowerCase().endsWith('.png')).map((a) => ({ value: a.path, label: a.path.replace(/^assets\//, '') })), [assets])
  const [picked, setPicked] = useState('')
  return (
    <Section title="Picture">
      <Fields>
        <Field label="">
          <OpenButtons open={open} paste={paste} />
        </Field>
        {pngs.length > 0 && (
          <Field label="From game">
            <SelectInput label="A PNG of the game" value={picked} options={pngs} onChange={(path) => { setPicked(path); open(fileUrl(path, revision), path.split('/').pop()!) }} />
          </Field>
        )}
        {source && (
          <Field label="Original">
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{source.name} · {source.width} × {source.height} px</Typography>
          </Field>
        )}
        {error && <Field label=""><Typography variant="body2" color="error">{error}</Typography></Field>}
      </Fields>
    </Section>
  )
}

type Setter = (patch: Partial<PixelArtOptions>) => void

function PixelateSection({ options, set }: { options: PixelArtOptions; set: Setter }) {
  return (
    <Section title="Pixelate">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2, pt: 1.5 }}>
        {PIXELART_SIZES.map((size) => (
          <Chip key={size} label={`${size} px`} size="small" clickable color={options.size === size ? 'primary' : 'default'} variant={options.size === size ? 'filled' : 'outlined'} onClick={() => set({ size })} />
        ))}
      </Box>
      <Fields>
        <Field label="Size">
          <NumberInput label="Longest side in pixels" value={options.size} min={4} max={PIXELART_MAX_SIZE} onCommit={(size) => set({ size })} />
          <Typography variant="body2" color="text.secondary" noWrap>px, longest side</Typography>
        </Field>
        <Field label="Canvas"><SelectInput label="Canvas" value={options.canvas} options={CANVASES} onChange={(canvas) => set({ canvas })} /></Field>
        <Field label="Sampling"><SelectInput label="Sampling" value={options.sampling} options={SAMPLINGS} onChange={(sampling) => set({ sampling })} /></Field>
        <Field label=""><Checkbox checked={options.removeBackground} onChange={(removeBackground) => set({ removeBackground })}>Remove the background</Checkbox></Field>
        <Range label="Tolerance" value={options.tolerance} min={0} max={60} disabled={!options.removeBackground} onChange={(tolerance) => set({ tolerance })} />
      </Fields>
    </Section>
  )
}

function PaletteSection({ options, set, palette }: { options: PixelArtOptions; set: Setter; palette: string[] }) {
  const max = options.depth === 4 ? 15 : 255
  return (
    <Section title="GBA palette">
      <Fields>
        <Field label=""><Checkbox checked={options.palette} onChange={(palette) => set({ palette })}>Fit the colours to a GBA palette</Checkbox></Field>
        <Field label="Mode">
          <SelectInput label="Colour mode" value={String(options.depth) as '4' | '8'} options={DEPTHS} disabled={!options.palette} onChange={(v) => set({ depth: Number(v) as 4 | 8, colours: Math.min(Number(v) === 4 ? 15 : 255, options.colours) })} />
        </Field>
        <Range label="Colours" value={Math.min(max, options.colours)} min={2} max={max} disabled={!options.palette} onChange={(colours) => set({ colours })} />
        <Field label="Dither"><SelectInput label="Dither" value={options.dither} options={DITHERS} disabled={!options.palette} onChange={(dither) => set({ dither })} /></Field>
        <Field label="Result">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }} title="The colours of the result, as the GBA shows them">
            {palette.slice(0, 64).map((c) => <Box key={c} title={c} sx={{ width: ui(12), height: ui(12), bgcolor: c, border: '1px solid rgba(255,255,255,0.15)' }} />)}
            {palette.length > 64 && <Typography variant="body2" color="text.secondary">+{palette.length - 64}</Typography>}
          </Box>
        </Field>
      </Fields>
    </Section>
  )
}

function StrokeSection({ options, set }: { options: PixelArtOptions; set: Setter }) {
  const off = !options.outline
  return (
    <Section title="Strokes">
      <Fields>
        <Field label=""><Checkbox checked={options.outline} onChange={(outline) => set({ outline })}>Dark strokes around shapes</Checkbox></Field>
        <Field label="Where"><SelectInput label="Where the stroke goes" value={options.outlinePlacement} options={PLACEMENTS} disabled={off} onChange={(outlinePlacement) => set({ outlinePlacement })} /></Field>
        <Field label=""><Checkbox checked={options.outlineCorners} onChange={(outlineCorners) => set({ outlineCorners })}>Round the corners too (8 neighbours)</Checkbox></Field>
        <Field label="Colour">
          <Checkbox checked={options.outlineAuto} onChange={(outlineAuto) => set({ outlineAuto })}>Shade of the shape</Checkbox>
          <input type="color" aria-label="Stroke colour" value={options.outlineColour} disabled={off || options.outlineAuto} onChange={(event) => set({ outlineColour: event.target.value })} style={{ width: ui(22), height: ui(22), padding: 0, border: '1px solid #3a3a3a', background: 'none', flexShrink: 0, opacity: off || options.outlineAuto ? 0.4 : 1 }} />
        </Field>
        <Range label="Inner lines" value={options.inner} min={0} max={100} step={5} disabled={off} onChange={(inner) => set({ inner })} />
        <Field label=""><Typography variant="body2" color="text.secondary">Strokes go where shapes meet transparency, so a picture on a plain background needs “Remove the background”. Inner lines darken strong colour edges inside shapes.</Typography></Field>
      </Fields>
    </Section>
  )
}

function SaveSection({ source, result }: { source: Source | null; result: PixelArtResult | null }) {
  const bundle = useStudio((s) => s.bundle)
  const load = useStudio((s) => s.load)
  const select = useStudio((s) => s.select)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<Folder>('assets/sprites')
  const [status, setStatus] = useState<{ ok: boolean; text: string; path?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const base = source ? source.name.replace(/\.[^.]+$/, '') : 'pixel art'
  const title = name || `${base} ${result ? result.width : ''}`.trim()
  const path = `${folder}/${slugify(title) || 'pixel-art'}.png`
  const exists = !!bundle?.assets.some((a) => a.path === path)
  const blob = () => canvasPng(rgbaCanvas(result!.width, result!.height, result!.rgba))

  const save = async () => {
    if (!bundle || !result) return
    if (exists && !window.confirm(`${path} already exists. Replace it?`)) return
    setBusy(true)
    try {
      await api.upload(path, await blob(), exists)
      await load()
      setStatus({ ok: true, text: `Saved ${path}.`, path })
    } catch (error) {
      setStatus({ ok: false, text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Save">
      <Fields>
        <Field label="Name"><TextInput label="File name" value={name} placeholder={title} onCommit={setName} /></Field>
        <Field label="Folder"><SelectInput label="Folder" value={folder} options={FOLDERS} onChange={setFolder} /></Field>
        <Field label="File"><Typography variant="body2" color={exists ? 'warning.main' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>{path}{exists ? ' (exists, will be replaced)' : ''}</Typography></Field>
        <Field label="">
          <Button variant="contained" startIcon={<SaveOutlinedIcon />} disabled={busy || !result || !bundle?.initialised} onClick={() => void save()}>Save to project</Button>
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} disabled={!result} onClick={() => void blob().then((b) => downloadBlob(b, path.split('/').pop()!))}>PNG</Button>
        </Field>
        {status && (
          <Field label="">
            <Typography variant="body2" color={status.ok ? 'success.main' : 'error'} sx={{ overflowWrap: 'anywhere' }}>{status.text}</Typography>
            {status.path && <Button size="small" onClick={() => select({ kind: 'asset', id: status.path })}>Open</Button>}
          </Field>
        )}
      </Fields>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 3, minHeight: BAR.row }}>
        The PNG holds only GBA colours and fully transparent pixels. Open it to touch it up in the pixel editor, or use it as a sprite sheet or background.
      </Typography>
    </Section>
  )
}

// ---------------------------------------------------------------------------------------
// Gallery card

/** A smooth shaded fruit with a leaf, drawn in code, to show the conversion on the card. */
function demoPicture(): PixelImage {
  const w = 96, h = 96
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const d = Math.hypot(x - 48, y - 54) / 36
      const leaf = Math.hypot((x - 58) / 14, (y - 18) / 6) < 1
      if (d < 1) {
        const light = Math.max(0, 1 - Math.hypot(x - 36, y - 42) / 52)
        rgba.set([Math.round(110 + 140 * light), Math.round(20 + 90 * light ** 2), Math.round(40 + 40 * light), 255], i)
      } else if (leaf) {
        rgba.set([Math.round(60 + (x - 44) * 2), 170 - (y - 12) * 4, 70, 255], i)
      }
    }
  }
  return { width: w, height: h, rgba }
}

export function PixelArtPreview() {
  const [before, after] = useMemo(() => {
    const picture = demoPicture()
    return [picture, convertPixelArt(picture, { ...DEFAULT_PIXELART, size: 20, colours: 6, outline: true })]
  }, [])
  const drawBefore = useMemo(() => (canvas: HTMLCanvasElement) => {
    canvas.width = before.width
    canvas.height = before.height
    canvas.getContext('2d')!.drawImage(rgbaCanvas(before.width, before.height, before.rgba), 0, 0)
  }, [before])
  const drawAfter = useMemo(() => (canvas: HTMLCanvasElement) => {
    canvas.width = after.width
    canvas.height = after.height
    canvas.getContext('2d')!.drawImage(rgbaCanvas(after.width, after.height, after.rgba), 0, 0)
  }, [after])
  return (
    <Box sx={{ height: 120, bgcolor: '#26304a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <PixelCanvas draw={drawBefore} style={{ height: 88, width: 88, imageRendering: 'auto' }} />
      <ArrowForwardIcon sx={{ color: 'text.secondary' }} />
      <PixelCanvas draw={drawAfter} style={{ height: 88, width: 88 }} />
    </Box>
  )
}
