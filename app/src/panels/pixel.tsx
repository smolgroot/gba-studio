// The pixel editor: draws on a PNG of the game folder, like a small drawing app.
// Pencil, eraser, line, rectangle, ellipse, fill, eyedropper and pan; a colour picker
// and palettes; undo; the file is saved by itself a moment after a stroke.
import AspectRatioOutlinedIcon from '@mui/icons-material/AspectRatioOutlined'
import BrushIcon from '@mui/icons-material/Brush'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import ColorizeIcon from '@mui/icons-material/Colorize'
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill'
import Grid4x4Icon from '@mui/icons-material/Grid4x4'
import GridOnIcon from '@mui/icons-material/GridOn'
import PanToolOutlinedIcon from '@mui/icons-material/PanToolOutlined'
import RectangleIcon from '@mui/icons-material/Rectangle'
import RectangleOutlinedIcon from '@mui/icons-material/RectangleOutlined'
import RedoIcon from '@mui/icons-material/Redo'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import UndoIcon from '@mui/icons-material/Undo'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import SvgIcon from '@mui/material/SvgIcon'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { TILE, fromBgr555, toBgr555 } from '@pecten-studio/core'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { api, fileUrl } from '../api.ts'
import { Checkbox, Field, Fields, NumberInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { Divider, Message, ToolButton, Viewport } from './views.tsx'

type Tool = 'pencil' | 'eraser' | 'line' | 'rect' | 'rectFill' | 'ellipse' | 'fill' | 'pick' | 'pan'
type Rgba = readonly [number, number, number, number]
const CLEAR: Rgba = [0, 0, 0, 0]
const HISTORY_LIMIT = 100
const MAX_ZOOM = 32
/** How long after the last stroke the file is written. */
const SAVE_DELAY = 700

/** DawnBringer's 16 colours: a starter palette that suits the GBA well. */
const STARTER = ['#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161', '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6']

function EraserIcon() {
  return (
    <SvgIcon>
      <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z" />
    </SvgIcon>
  )
}

// Colour helpers.
const hex = (c: Rgba): string => `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`
const rgba = (h: string): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]
/** The colour as the GBA shows it: 5 bits a channel. */
const snapHex = (h: string): string => hex([...fromBgr555(toBgr555(...(rgba(h).slice(0, 3) as [number, number, number]))), 255])
const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s)

// Pixel maths on an ImageData. Transparent means alpha 0.
function clone(img: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height)
}
function getPixel(img: ImageData, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}
function setPixel(img: ImageData, x: number, y: number, c: Rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  img.data.set(c, (y * img.width + x) * 4)
}
function sameColour(a: Rgba, b: Rgba): boolean {
  return (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3])
}
/** A square of `size` pixels with its top-left a little up and left of the point, so odd sizes are centred. */
function dot(img: ImageData, x: number, y: number, size: number, c: Rgba) {
  const off = Math.floor((size - 1) / 2)
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setPixel(img, x - off + dx, y - off + dy, c)
}
function line(img: ImageData, x0: number, y0: number, x1: number, y1: number, size: number, c: Rgba) {
  // Bresenham.
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    dot(img, x0, y0, size, c)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}
function rect(img: ImageData, x0: number, y0: number, x1: number, y1: number, size: number, c: Rgba, filled: boolean) {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)]
  const [t, b] = [Math.min(y0, y1), Math.max(y0, y1)]
  if (filled) {
    for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) setPixel(img, x, y, c)
    return
  }
  line(img, l, t, r, t, size, c)
  line(img, l, b, r, b, size, c)
  line(img, l, t, l, b, size, c)
  line(img, r, t, r, b, size, c)
}
function ellipse(img: ImageData, x0: number, y0: number, x1: number, y1: number, c: Rgba, filled: boolean) {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)]
  const [t, b] = [Math.min(y0, y1), Math.max(y0, y1)]
  const cx = (l + r) / 2
  const cy = (t + b) / 2
  const rx = (r - l + 1) / 2
  const ry = (b - t + 1) / 2
  const inside = (x: number, y: number) => {
    if (x < l || x > r || y < t || y > b) return false
    const nx = (x + 0.5 - cx) / rx
    const ny = (y + 0.5 - cy) / ry
    return nx * nx + ny * ny <= 1
  }
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= r; x++) {
      if (!inside(x, y)) continue
      if (filled || !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1))) setPixel(img, x, y, c)
    }
  }
}
function fill(img: ImageData, x: number, y: number, c: Rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const from = getPixel(img, x, y)
  if (sameColour(from, c)) return
  const stack = [[x, y]]
  const seen = new Uint8Array(img.width * img.height)
  while (stack.length) {
    const [px, py] = stack.pop()!
    if (px! < 0 || py! < 0 || px! >= img.width || py! >= img.height) continue
    const at = py! * img.width + px!
    if (seen[at] || !sameColour(getPixel(img, px!, py!), from)) continue
    seen[at] = 1
    setPixel(img, px!, py!, c)
    stack.push([px! + 1, py!], [px! - 1, py!], [px!, py! + 1], [px!, py! - 1])
  }
}
/** The image's opaque colours, most used first. */
function coloursOf(img: ImageData): string[] {
  const counts = new Map<string, number>()
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3]! < 128) continue
    const key = hex([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, 255])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)
}
/** The image at another size, keeping its top-left corner. */
function resized(img: ImageData, width: number, height: number): ImageData {
  const out = new ImageData(width, height)
  const cols = Math.min(width, img.width)
  for (let y = 0; y < Math.min(height, img.height); y++) out.data.set(img.data.subarray(y * img.width * 4, (y * img.width + cols) * 4), y * width * 4)
  return out
}
function toBlob(img: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.putImageData(img, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the PNG'))), 'image/png'))
}
async function fromFile(path: string, revision: number): Promise<ImageData> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`cannot load ${path}`))
    image.src = fileUrl(path, revision)
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

const TOOLS: ReadonlyArray<{ id: Tool; title: string; key: string; icon: React.ReactNode }> = [
  { id: 'pencil', title: 'Pencil (B)', key: 'b', icon: <BrushIcon /> },
  { id: 'eraser', title: 'Eraser (E)', key: 'e', icon: <EraserIcon /> },
  { id: 'line', title: 'Line (L)', key: 'l', icon: <ShowChartIcon /> },
  { id: 'rect', title: 'Rectangle (R)', key: 'r', icon: <RectangleOutlinedIcon /> },
  { id: 'rectFill', title: 'Filled rectangle (U)', key: 'u', icon: <RectangleIcon /> },
  { id: 'ellipse', title: 'Ellipse (O)', key: 'o', icon: <CircleOutlinedIcon /> },
  { id: 'fill', title: 'Fill (G)', key: 'g', icon: <FormatColorFillIcon /> },
  { id: 'pick', title: 'Pick a colour (I, or Alt + click)', key: 'i', icon: <ColorizeIcon /> },
  { id: 'pan', title: 'Pan (H, or hold Space)', key: 'h', icon: <PanToolOutlinedIcon /> },
]

/** A row of colour swatches. */
const Swatches = memo(function Swatches({ title, colours, chosen, onPick }: { title: string; colours: string[]; chosen: string; onPick: (hex: string) => void }) {
  if (colours.length === 0) return null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, minWidth: ui(44) }}>{title}</Typography>
      {colours.map((c) => (
        <Box
          key={c}
          component="button"
          type="button"
          title={c}
          aria-label={`Colour ${c}`}
          aria-pressed={c === chosen}
          onClick={() => onPick(c)}
          sx={{ width: ui(14), height: ui(14), p: 0, bgcolor: c, border: '1px solid', borderColor: c === chosen ? '#fff' : 'rgba(255,255,255,0.25)', outline: c === chosen ? '1px solid #000' : 'none', cursor: 'pointer', borderRadius: 0 }}
        />
      ))}
    </Box>
  )
})

/** The colour being painted with: a native picker, a hex field, and the GBA's view of it. */
function ColourPicker({ colour, snap, onChange }: { colour: string; snap: boolean; onChange: (hex: string) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <input type="color" aria-label="Colour" value={colour} onChange={(event) => onChange(event.target.value)} style={{ width: ui(26), height: ui(22), padding: 0, border: '1px solid #3a3a3a', background: 'none', cursor: 'pointer' }} />
      <Box sx={{ width: ui(64) }}>
        <TextInput label="Colour as hex" value={colour} onCommit={(value) => isHex(value.startsWith('#') ? value : `#${value}`) && onChange((value.startsWith('#') ? value : `#${value}`).toLowerCase())} />
      </Box>
      {snap && snapHex(colour) !== colour && (
        <Tooltip title={`On the GBA this colour shows as ${snapHex(colour)} (5 bits a channel). Snapping is on, so that is what is painted.`}>
          <Box sx={{ width: ui(14), height: ui(14), bgcolor: snapHex(colour), border: '1px dashed rgba(255,255,255,0.5)' }} />
        </Tooltip>
      )}
    </Box>
  )
}

function ResizeDialog({ width, height, onClose, onResize }: { width: number; height: number; onClose: () => void; onResize: (w: number, h: number) => void }) {
  const [w, setW] = useState(width)
  const [h, setH] = useState(height)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(event) => { event.preventDefault(); onResize(w, h); onClose() }}>
        <DialogTitle>Resize image</DialogTitle>
        <DialogContent sx={{ px: 2, py: 0 }}>
          <Fields>
            <Field label="Pixels">
              <NumberInput label="Width in pixels" value={w} min={1} max={2048} onCommit={setW} />
              <Typography color="text.secondary">×</Typography>
              <NumberInput label="Height in pixels" value={h} min={1} max={2048} onCommit={setH} />
            </Field>
            <Field label=""><Typography color="text.secondary">The top-left corner is kept; what no longer fits is cut off, new space is transparent.</Typography></Field>
            {(w % TILE || h % TILE) ? <Field label=""><Typography color="warning.main">Tilesets and backgrounds need a multiple of 8.</Typography></Field> : null}
          </Fields>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={w === width && h === height}>Resize</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

export function PixelEditor({ path }: { path: string }) {
  const revision = useStudio((s) => s.revision)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const hover = useRef<HTMLDivElement>(null)
  const coords = useRef<HTMLSpanElement>(null)
  // The pixels live outside React state: strokes mutate them and draw straight to the canvas.
  const pixels = useRef<ImageData | null>(null)
  const past = useRef<ImageData[]>([])
  const future = useRef<ImageData[]>([])
  /** Bumped when the pixels change in a way the interface should notice (size, palette, history). */
  const [version, setVersion] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('pencil')
  const [colour, setColour] = useState(STARTER[6]!)
  const [recent, setRecent] = useState<string[]>([])
  const [size, setSize] = useState(1)
  const [snap, setSnap] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [showTiles, setShowTiles] = useState(true)
  const [resizing, setResizing] = useState(false)
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | string>('saved')
  const [space, setSpace] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(false)
  const lastSave = useRef(0)
  const stroke = useRef<{ tool: Tool; x: number; y: number; base: ImageData; colour: Rgba; pan?: { left: number; top: number; clientX: number; clientY: number } } | null>(null)

  const paint = useCallback(() => {
    const img = pixels.current
    const context = canvas.current?.getContext('2d')
    if (img && context) context.putImageData(img, 0, 0)
  }, [])

  // Saving: a moment after the last change, the PNG is written back where it came from.
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current)
    const img = pixels.current
    if (!img || !dirty.current) return
    dirty.current = false
    setStatus('saving')
    try {
      await api.upload(path, await toBlob(img), true)
      lastSave.current = Date.now()
      setStatus((s) => (s === 'saving' ? 'saved' : s))
    } catch (error) {
      dirty.current = true
      setStatus(`Not saved: ${(error as Error).message}`)
    }
  }, [path])
  const changed = useCallback(() => {
    dirty.current = true
    setStatus('unsaved')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY)
    setVersion((v) => v + 1)
  }, [save])
  // Leaving the editor writes what is pending at once.
  useEffect(() => () => { clearTimeout(saveTimer.current); void save() }, [save])

  // Load the file; follow changes made on disk by something else while nothing is unsaved here.
  const loadedRevision = useRef(-1)
  useEffect(() => {
    if (loadedRevision.current !== -1 && (dirty.current || Date.now() - lastSave.current < 2500)) return
    let live = true
    fromFile(path, revision)
      .then((img) => {
        if (!live) return
        loadedRevision.current = revision
        if (pixels.current) {
          // Another program changed the file: keep the old picture as an undo step.
          past.current = [...past.current, pixels.current].slice(-HISTORY_LIMIT)
          future.current = []
        }
        pixels.current = img
        setLoadError(null)
        setVersion((v) => v + 1)
      })
      .catch((error: Error) => live && setLoadError(error.message))
    return () => {
      live = false
    }
  }, [path, revision])
  useEffect(paint, [paint, version])

  const snapshot = () => {
    if (!pixels.current) return
    past.current = [...past.current, clone(pixels.current)].slice(-HISTORY_LIMIT)
    future.current = []
  }
  const undo = useCallback(() => {
    const img = pixels.current
    const previous = past.current.pop()
    if (!img || !previous) return
    future.current.push(img)
    pixels.current = previous
    changed()
  }, [changed])
  const redo = useCallback(() => {
    const img = pixels.current
    const next = future.current.pop()
    if (!img || !next) return
    past.current.push(img)
    pixels.current = next
    changed()
  }, [changed])

  const pick = useCallback((h: string) => {
    setColour(h)
    setRecent((r) => [h, ...r.filter((c) => c !== h)].slice(0, 12))
  }, [])
  const paintColour = (): Rgba => rgba(snap ? snapHex(colour) : colour)

  // Keys act on the editor in front.
  useEffect(() => {
    const mine = () => {
      const { selection } = useStudio.getState()
      return selection.kind === 'asset' && selection.id === path
    }
    const onKey = (event: KeyboardEvent) => {
      if (!mine() || (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) undo()
        else if ((key === 'z' && event.shiftKey) || key === 'y') redo()
        else if (key === 's') void save()
        else return
        event.preventDefault()
        return
      }
      if (event.key === ' ') {
        setSpace(true)
        event.preventDefault()
        return
      }
      const found = TOOLS.find((t) => t.key === event.key.toLowerCase())
      if (found) setTool(found.id)
      else if (event.key === '[') setSize((s) => Math.max(1, s - 1))
      else if (event.key === ']') setSize((s) => Math.min(16, s + 1))
      else if (event.key === 'x') setColour((c) => recent.find((r) => r !== c) ?? c)
    }
    const onUp = (event: KeyboardEvent) => event.key === ' ' && setSpace(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [path, undo, redo, save, recent])

  const img = pixels.current
  const colours = useMemo(() => (img ? coloursOf(img) : []), [img, version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (loadError) return <Message>{loadError}. The file may be missing or not a PNG.</Message>
  if (!img) return null

  const cellOf = (event: ReactPointerEvent<HTMLElement>, zoom: number) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: Math.floor((event.clientX - box.left) / zoom), y: Math.floor((event.clientY - box.top) / zoom) }
  }
  const effectiveTool = (event: ReactPointerEvent<HTMLElement>): Tool => (space || event.button === 1 ? 'pan' : event.altKey ? 'pick' : tool)

  /** Applies the stroke in progress from its start to `(x, y)`, on a fresh copy of the picture before it. */
  const shape = (s: NonNullable<typeof stroke.current>, x: number, y: number) => {
    const target = pixels.current!
    target.data.set(s.base.data)
    if (s.tool === 'line') line(target, s.x, s.y, x, y, size, s.colour)
    else if (s.tool === 'rect' || s.tool === 'rectFill') rect(target, s.x, s.y, x, y, size, s.colour, s.tool === 'rectFill')
    else if (s.tool === 'ellipse') ellipse(target, s.x, s.y, x, y, s.colour, false)
  }

  const onDown = (event: ReactPointerEvent<HTMLElement>, zoom: number) => {
    const t = effectiveTool(event)
    const { x, y } = cellOf(event, zoom)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (t === 'pan') {
      const area = scroller.current!
      stroke.current = { tool: t, x, y, base: img, colour: CLEAR, pan: { left: area.scrollLeft, top: area.scrollTop, clientX: event.clientX, clientY: event.clientY } }
      return
    }
    if (t === 'pick') {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
        const c = getPixel(img, x, y)
        if (c[3] === 0) setTool('eraser')
        else {
          pick(hex(c))
          if (tool === 'eraser') setTool('pencil')
        }
      }
      return
    }
    // The right button erases, as in the map editor.
    const c = t === 'eraser' || event.button === 2 ? CLEAR : paintColour()
    if (c[3]) setRecent((r) => [hex(c), ...r.filter((v) => v !== hex(c))].slice(0, 12))
    snapshot()
    if (t === 'fill') {
      fill(img, x, y, c)
      changed()
      return
    }
    stroke.current = { tool: t, x, y, base: clone(img), colour: c }
    if (t === 'pencil' || t === 'eraser') dot(img, x, y, size, c)
    else shape(stroke.current, x, y)
    paint()
  }
  const onMove = (event: ReactPointerEvent<HTMLElement>, zoom: number) => {
    const { x, y } = cellOf(event, zoom)
    if (hover.current) {
      const inside = x >= 0 && y >= 0 && x < img.width && y < img.height
      const off = Math.floor((size - 1) / 2)
      const brush = tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rect' ? size : 1
      hover.current.style.display = inside ? 'block' : 'none'
      hover.current.style.left = `${(x - (brush === size ? off : 0)) * zoom}px`
      hover.current.style.top = `${(y - (brush === size ? off : 0)) * zoom}px`
      hover.current.style.width = `${brush * zoom}px`
      hover.current.style.height = `${brush * zoom}px`
    }
    if (coords.current) coords.current.textContent = x >= 0 && y >= 0 && x < img.width && y < img.height ? `${x}, ${y} · tile ${Math.floor(x / TILE)}, ${Math.floor(y / TILE)}` : ''
    const s = stroke.current
    if (!s) return
    if (s.tool === 'pan' && s.pan) {
      const area = scroller.current!
      area.scrollLeft = s.pan.left - (event.clientX - s.pan.clientX)
      area.scrollTop = s.pan.top - (event.clientY - s.pan.clientY)
      return
    }
    if (s.tool === 'pencil' || s.tool === 'eraser') {
      line(img, s.x, s.y, x, y, size, s.colour)
      s.x = x
      s.y = y
    } else shape(s, x, y)
    paint()
  }
  const onUp = () => {
    const s = stroke.current
    stroke.current = null
    if (!s || s.tool === 'pan') return
    changed()
  }
  const onLeave = () => {
    if (hover.current) hover.current.style.display = 'none'
    if (coords.current) coords.current.textContent = ''
  }

  const resize = (w: number, h: number) => {
    snapshot()
    pixels.current = resized(img, w, h)
    changed()
  }

  const tools = (
    <>
      {TOOLS.map((t) => (
        <ToolButton key={t.id} title={t.title} active={tool === t.id} onClick={() => setTool(t.id)}>{t.icon}</ToolButton>
      ))}
      <Divider />
      <Typography variant="body2" color="text.secondary">Size</Typography>
      <Box sx={{ width: ui(34) }}><NumberInput label="Brush size in pixels" value={size} min={1} max={16} onCommit={setSize} /></Box>
      <Divider />
      <ColourPicker colour={colour} snap={snap} onChange={pick} />
      <Divider />
      <ToolButton title="Pixel grid" active={showGrid} onClick={() => setShowGrid(!showGrid)}><Grid4x4Icon /></ToolButton>
      <ToolButton title="8×8 tile grid" active={showTiles} onClick={() => setShowTiles(!showTiles)}><GridOnIcon /></ToolButton>
      <ToolButton title="Resize the image" onClick={() => setResizing(true)}><AspectRatioOutlinedIcon /></ToolButton>
      <Divider />
      <ToolButton title="Undo (Ctrl+Z)" disabled={past.current.length === 0} onClick={undo}><UndoIcon /></ToolButton>
      <ToolButton title="Redo (Ctrl+Shift+Z)" disabled={future.current.length === 0} onClick={redo}><RedoIcon /></ToolButton>
    </>
  )
  const statusText = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved' : status
  const info = `${img.width}×${img.height} px · ${colours.length} colours`

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Viewport initialZoom={Math.max(2, Math.min(16, Math.floor(ui(320) / Math.max(img.width, img.height))))} maxZoom={MAX_ZOOM} tools={tools} info={info} scroller={scroller} touchAction="none">
          {(zoom) => (
            <Box
              className="checker"
              onPointerDown={(event) => onDown(event, zoom)}
              onPointerMove={(event) => onMove(event, zoom)}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={onLeave}
              onContextMenu={(event) => event.preventDefault()}
              sx={{ position: 'relative', width: img.width * zoom, height: img.height * zoom, cursor: space || tool === 'pan' ? 'grab' : 'crosshair', touchAction: 'none', boxShadow: '0 0 0 1px #000' }}
            >
              <canvas ref={canvas} width={img.width} height={img.height} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
              {showGrid && zoom >= 4 && <Grid step={zoom} colour="rgba(255,255,255,0.12)" />}
              {showTiles && <Grid step={TILE * zoom} colour="rgba(76,159,254,0.35)" />}
              <Box ref={hover} sx={{ position: 'absolute', display: 'none', pointerEvents: 'none', outline: '1px solid #fff', boxShadow: '0 0 0 1px #000', mixBlendMode: 'difference' }} />
            </Box>
          )}
        </Viewport>
      </Box>
      <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.75, px: 2, py: 1, minHeight: BAR.tool, borderTop: '1px solid #111', bgcolor: 'background.default', maxHeight: ui(120), overflow: 'auto' }}>
        <Swatches title="Recent" colours={recent} chosen={colour} onPick={pick} />
        <Swatches title="In image" colours={colours.slice(0, 64)} chosen={colour} onPick={pick} />
        <Swatches title="Starter" colours={STARTER} chosen={colour} onPick={pick} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <Checkbox checked={snap} onChange={setSnap}>Snap colours to the GBA's 15-bit palette</Checkbox>
          <Typography variant="caption" color="text.secondary">Right button erases · Alt + click picks a colour · [ ] brush size · X last colour</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
            <Typography component="span" ref={coords} variant="body2" color="text.secondary" sx={{ minWidth: ui(100), textAlign: 'right' }} />
            <Typography component="span" variant="body2" role="status" sx={{ color: status === 'saved' ? 'text.secondary' : status === 'saving' || status === 'unsaved' ? 'primary.main' : 'error.main' }}>{statusText}</Typography>
          </Box>
        </Box>
      </Box>
      {resizing && <ResizeDialog width={img.width} height={img.height} onClose={() => setResizing(false)} onResize={resize} />}
    </Box>
  )
}

/** Lines every `step` pixels; the last line sits on the edge rather than one step past it. */
function Grid({ step, colour }: { step: number; colour: string }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(to right, ${colour} 1px, transparent 1px), linear-gradient(to bottom, ${colour} 1px, transparent 1px)`,
        backgroundSize: `${step}px ${step}px`,
      }}
    />
  )
}
