// The map editor: paints a room's tile layers and collision, and places its entities.
import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import BrushIcon from '@mui/icons-material/Brush'
import ColorizeIcon from '@mui/icons-material/Colorize'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill'
import Grid4x4Icon from '@mui/icons-material/Grid4x4'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined'
import PanToolOutlinedIcon from '@mui/icons-material/PanToolOutlined'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import RectangleOutlinedIcon from '@mui/icons-material/RectangleOutlined'
import RedoIcon from '@mui/icons-material/Redo'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import UndoIcon from '@mui/icons-material/Undo'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import WallpaperOutlinedIcon from '@mui/icons-material/WallpaperOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import { I32_MAX, I32_MIN, MAX_BACKGROUNDS, MAX_SCREEN_LAYERS, SCREEN, TILE, entityOverride, resizeRoom, rleDecode, rleEncode, rleLength, roomSize, shownEntityValue, spotOfTile } from '@pecten-studio/core'
import type { Background, CollisionClass, EntityType, Room, Sprite, Tileset } from '@pecten-studio/core'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { fileUrl } from '../api.ts'
import { dimmedCopy } from '../dim.ts'
import { useEditor } from '../editor.ts'
import type { Stamp, Tool } from '../editor.ts'
import { Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useHistoryDepth, useStudio } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { BehaviourOverrides } from './behaviours.tsx'
import { ImportButton } from './common.tsx'
import { DimLevel, DimToggle } from './dim.tsx'
import { RoomBudgetReadout } from './budget.tsx'
import { Divider, GridOverlay, Message, ToolButton, Viewport, useImage } from './views.tsx'

function EraserIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="M16.24 3.56 21.19 8.5a1.5 1.5 0 0 1 0 2.12L12 19.8l-.2.2H21v2H7.5l-4.7-4.69a1.5 1.5 0 0 1 0-2.12L14.12 3.56a1.5 1.5 0 0 1 2.12 0ZM4.22 16.25 8.33 20h2.84l2.71-2.71-5.66-5.66-4 4.62Z" />
    </SvgIcon>
  )
}

const TOOLS: ReadonlyArray<{ tool: Tool; title: string; key: string; icon: React.ReactNode }> = [
  { tool: 'brush', title: 'Brush (B). Right button erases', key: 'b', icon: <BrushIcon /> },
  { tool: 'eraser', title: 'Eraser (E)', key: 'e', icon: <EraserIcon /> },
  { tool: 'rect', title: 'Rectangle (R). Right button erases', key: 'r', icon: <RectangleOutlinedIcon /> },
  { tool: 'fill', title: 'Fill (G)', key: 'g', icon: <FormatColorFillIcon /> },
  { tool: 'pick', title: 'Pick a tile from the map (I, or Alt + click)', key: 'i', icon: <ColorizeIcon /> },
  { tool: 'entity', title: 'Entities (N): click to place, drag to move, Delete to remove', key: 'n', icon: <PlaceOutlinedIcon /> },
  { tool: 'play', title: 'Play from here (P): click a tile to start the game there', key: 'p', icon: <PlayCircleOutlineIcon /> },
  { tool: 'pan', title: 'Pan (H, or hold Space, or middle button)', key: 'h', icon: <PanToolOutlinedIcon /> },
]

/** The room decoded for painting. `doc` is the document these cells came from or were last saved as. */
interface Work {
  doc: Room
  cols: number
  rows: number
  layers: Uint16Array[]
  collision: Uint16Array
}

export function decodeRoom(room: Room): Work {
  const { cols, rows } = roomSize(room)
  const cells = (data: readonly number[] | undefined) =>
    // Data of the wrong length is reported in Problems; it is shown empty here.
    data && rleLength(data) === cols * rows ? rleDecode(data) : new Uint16Array(cols * rows)
  return { doc: room, cols, rows, layers: room.layers.map((layer) => cells(layer.data)), collision: cells(room.collision) }
}

/** Collision class index for each tile of a tileset that has one. */
function useTileClasses(tileset: Tileset | undefined, classes: CollisionClass[] | undefined): Map<number, number> {
  return useMemo(() => {
    const map = new Map<number, number>()
    if (!tileset || !classes) return map
    for (const [tile, id] of Object.entries(tileset.collision)) {
      const index = classes.findIndex((c) => c.id === id)
      if (index >= 0) map.set(Number(tile), index)
    }
    return map
  }, [tileset, classes])
}

/** Where an entity's position lands when placed in a cell: the middle of the cell's bottom edge, its feet. */
const entityAt = (cx: number, cy: number) => ({ x: cx * TILE + TILE / 2, y: (cy + 1) * TILE })

export function RoomEditor({ id }: { id: string }) {
  const room = useStudio((s) => s.bundle?.docs.rooms[id])
  const tileset = useStudio((s) => (room ? s.bundle?.docs.tilesets[room.tileset] : undefined))
  const isOpen = useStudio((s) => s.selection.kind === 'room' && s.selection.id === id)
  const commit = useStudio((s) => s.commit)
  const undo = useStudio((s) => s.undo)
  const redo = useStudio((s) => s.redo)
  const depth = useHistoryDepth()
  const image = useImage(tileset?.image)
  const { tool, entity, showGrid, showCollision, showBackgrounds, set } = useEditor()
  const [hover, setHover] = useState<{ cx: number; cy: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Tool keys, while this room is the open document and no field has the keyboard.
  useEffect(() => {
    if (!isOpen || !room) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const match = TOOLS.find((t) => t.key === event.key.toLowerCase())
      if (match) set({ tool: match.tool })
      const selected = useEditor.getState().entity
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null && room.entities[selected]) {
        commit('room', id, { ...room, entities: room.entities.filter((_, i) => i !== selected) })
        set({ entity: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, room, id, commit, set])

  // A selection belongs to the room it was made in. A room opens on its front layer,
  // the one most painting happens on.
  const layerCount = room?.layers.length ?? 0
  const opened = useRef('')
  useEffect(() => {
    if (!isOpen || layerCount === 0 || opened.current === id) return
    opened.current = id
    set({ entity: null, layer: layerCount - 1, hidden: [] })
  }, [isOpen, id, layerCount, set])
  useEffect(() => {
    if (!isOpen) opened.current = ''
  }, [isOpen])

  if (!room) return <Message>This room is missing or its file has errors. See Problems.</Message>
  if (!tileset) return <Message>Tileset "{room.tileset}" is missing or has errors. Choose another in Properties.</Message>
  if (image === 'error') return <Message>Cannot load {tileset.image}.</Message>

  const tools = (
    <>
      {TOOLS.map((t) => (
        <ToolButton key={t.tool} title={t.title} active={tool === t.tool} onClick={() => set({ tool: t.tool })}>{t.icon}</ToolButton>
      ))}
      <Divider />
      <ToolButton title="Undo (Ctrl+Z)" disabled={depth.undo === 0} onClick={undo}><UndoIcon /></ToolButton>
      <ToolButton title="Redo (Ctrl+Shift+Z)" disabled={depth.redo === 0} onClick={redo}><RedoIcon /></ToolButton>
      <Divider />
      <ToolButton title="Tile grid" active={showGrid} onClick={() => set({ showGrid: !showGrid })}><Grid4x4Icon /></ToolButton>
      <ToolButton title="Show collision" active={showCollision} onClick={() => set({ showCollision: !showCollision })}><BlockOutlinedIcon /></ToolButton>
      <ToolButton title={room.backgrounds?.length ? 'Show backgrounds' : 'Show backgrounds (this room has none: add one in Properties)'} active={showBackgrounds} disabled={!room.backgrounds?.length} onClick={() => set({ showBackgrounds: !showBackgrounds })}><WallpaperOutlinedIcon /></ToolButton>
    </>
  )
  const info = hover
    ? `tile ${hover.cx}, ${hover.cy} · screen ${Math.floor(hover.cx / SCREEN.cols) + 1}, ${Math.floor(hover.cy / SCREEN.rows) + 1}`
    : `${room.width}×${room.height} screens · ${room.entities.length} entities${entity !== null ? ' · 1 selected' : ''}`

  return (
    <Viewport initialZoom={2} tools={tools} info={info} status={<RoomBudgetReadout id={id} />} scroller={scroller} touchAction={tool === 'pan' ? 'pan-x pan-y' : 'none'}>
      {(zoom) => image && <Surface id={id} room={room} tileset={tileset} image={image} zoom={zoom} scroller={scroller} hover={hover} setHover={setHover} />}
    </Viewport>
  )
}

interface Stroke {
  kind: 'paint' | 'rect' | 'pan' | 'entity'
  erase: boolean
  /** Cell the stroke began in; the stamp's pattern is laid out from it. */
  ox: number
  oy: number
  lastX: number
  lastY: number
  changed: boolean
  /** For a pan: pointer and scroll position at the start. */
  pan?: { x: number; y: number; left: number; top: number }
  /** For an entity drag: which one. */
  entity?: number
}

function Surface({ id, room, tileset, image, zoom, scroller, hover, setHover }: {
  id: string
  room: Room
  tileset: Tileset
  image: HTMLImageElement
  zoom: number
  scroller: React.RefObject<HTMLDivElement | null>
  hover: { cx: number; cy: number } | null
  setHover: (hover: { cx: number; cy: number } | null) => void
}) {
  const classes = useStudio((s) => s.bundle?.docs.project?.collisionClasses)
  const entityTypes = useStudio((s) => s.bundle?.docs.project?.entityTypes)
  const sprites = useStudio((s) => s.bundle?.docs.sprites)
  const commit = useStudio((s) => s.commit)
  const playFromHere = useStudio((s) => s.playFromHere)
  const editor = useEditor()
  const { tool, stamp, hidden, showGrid, showCollision, showBackgrounds, set } = editor
  const layer = editor.layer === 'collision' ? 'collision' : Math.min(editor.layer, room.layers.length - 1)
  const tileClasses = useTileClasses(tileset, classes)

  const surface = useRef<HTMLDivElement>(null)
  const tilesCanvas = useRef<HTMLCanvasElement>(null)
  const collisionCanvas = useRef<HTMLCanvasElement>(null)
  const work = useRef<Work | null>(null)
  const stroke = useRef<Stroke | null>(null)
  const spaceHeld = useRef(false)
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [dragged, setDragged] = useState<{ index: number; x: number; y: number } | null>(null)

  const sheetCols = Math.floor(image.width / TILE)
  const sheetTiles = sheetCols * Math.floor(image.height / TILE)
  const { cols, rows } = roomSize(room)
  // Layers set to dim are drawn from a darkened copy of the sheet, rounded as the console rounds.
  const dimLevel = room.dimLevel ?? 0
  const dimmedSheet = useMemo(() => (dimLevel > 0 ? dimmedCopy(image, dimLevel) : null), [image, dimLevel])

  /** The class that applies in a cell: a painted override, or else the frontmost tile that has one. -1 for none. */
  const classAt = (w: Work, i: number): number => {
    const override = w.collision[i]!
    if (override > 0) return override - 1
    for (let l = w.layers.length - 1; l >= 0; l--) {
      const tile = w.layers[l]![i]! - 1
      const index = tile >= 0 ? tileClasses.get(tile) : undefined
      if (index !== undefined && classes?.[index]?.kind !== 'empty') return index
    }
    return -1
  }

  const drawCell = (w: Work, i: number) => {
    const x = (i % w.cols) * TILE
    const y = Math.floor(i / w.cols) * TILE
    const context = tilesCanvas.current!.getContext('2d')!
    context.clearRect(x, y, TILE, TILE)
    for (let l = 0; l < w.layers.length; l++) {
      if (hidden.includes(l)) continue
      const tile = w.layers[l]![i]! - 1
      if (tile < 0 || tile >= sheetTiles) continue
      context.drawImage(w.doc.layers[l]?.dim && dimmedSheet ? dimmedSheet : image, (tile % sheetCols) * TILE, Math.floor(tile / sheetCols) * TILE, TILE, TILE, x, y, TILE, TILE)
    }
    if (!showCollision) return
    const overlay = collisionCanvas.current!.getContext('2d')!
    overlay.clearRect(x, y, TILE, TILE)
    const cls = classes?.[classAt(w, i)]
    const painted = w.collision[i]! > 0
    if (cls && cls.kind !== 'empty') {
      // Painted overrides are stronger than what the tiles give, to tell them apart.
      overlay.globalAlpha = painted ? 0.75 : 0.4
      overlay.fillStyle = cls.colour
      overlay.fillRect(x, y, TILE, TILE)
    } else if (painted) {
      // An override that empties a cell its tile would make solid.
      overlay.globalAlpha = 0.6
      overlay.fillStyle = '#000'
      overlay.fillRect(x, y, TILE, TILE)
      overlay.fillStyle = '#fff'
      overlay.fillRect(x + 3, y + 3, 2, 2)
    }
  }

  // Decode when the document is not the one on screen (first show, undo, a change on
  // disk), and repaint everything when it or what is shown changes.
  const paintedWith = useRef<unknown[]>([])
  useEffect(() => {
    const deps = [room, image, hidden, showCollision, classes, tileClasses, dimmedSheet]
    if (work.current?.doc === room && deps.every((dep, i) => dep === paintedWith.current[i])) return
    if (work.current?.doc !== room) work.current = decodeRoom(room)
    paintedWith.current = deps
    const w = work.current
    for (const canvas of [tilesCanvas.current!, collisionCanvas.current!]) {
      canvas.width = w.cols * TILE
      canvas.height = w.rows * TILE
    }
    for (let i = 0; i < w.cols * w.rows; i++) drawCell(w, i)
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName))) {
        spaceHeld.current = event.type === 'keydown'
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  const cellOf = (event: { clientX: number; clientY: number }) => {
    const box = surface.current!.getBoundingClientRect()
    return {
      cx: Math.min(cols - 1, Math.max(0, Math.floor((event.clientX - box.left) / (zoom * TILE)))),
      cy: Math.min(rows - 1, Math.max(0, Math.floor((event.clientY - box.top) / (zoom * TILE)))),
    }
  }
  const target = (w: Work) => (layer === 'collision' ? w.collision : w.layers[layer]!)
  /** What the brush puts in a cell: the stamp's tile for that place in its pattern, or the chosen class. */
  const valueAt = (cx: number, cy: number, s: Stroke): number => {
    if (s.erase) return 0
    if (layer === 'collision') return editor.collisionClass + 1
    const dx = (((cx - s.ox) % stamp.w) + stamp.w) % stamp.w
    const dy = (((cy - s.oy) % stamp.h) + stamp.h) % stamp.h
    return (stamp.y + dy) * sheetCols + stamp.x + dx + 1
  }
  const setCell = (w: Work, cx: number, cy: number, s: Stroke) => {
    if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows) return
    const i = cy * w.cols + cx
    const value = valueAt(cx, cy, s)
    const cells = target(w)
    if (cells[i] === value) return
    cells[i] = value
    s.changed = true
    drawCell(w, i)
  }
  /** The brush at a cell: the whole stamp, snapped to the pattern laid from where the stroke began. */
  const dab = (w: Work, cx: number, cy: number, s: Stroke) => {
    const bw = layer === 'collision' || s.erase ? 1 : stamp.w
    const bh = layer === 'collision' || s.erase ? 1 : stamp.h
    const bx = s.ox + Math.floor((cx - s.ox) / bw) * bw
    const by = s.oy + Math.floor((cy - s.oy) / bh) * bh
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) setCell(w, bx + x, by + y, s)
  }
  const line = (w: Work, x0: number, y0: number, x1: number, y1: number, s: Stroke) => {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let error = dx + dy
    for (;;) {
      dab(w, x0, y0, s)
      if (x0 === x1 && y0 === y1) return
      const twice = 2 * error
      if (twice >= dy) { error += dy; x0 += sx }
      if (twice <= dx) { error += dx; y0 += sy }
    }
  }
  const flood = (w: Work, cx: number, cy: number, s: Stroke) => {
    const cells = target(w)
    const from = cells[cy * w.cols + cx]!
    const seen = new Uint8Array(cells.length)
    const stack = [cy * w.cols + cx]
    const region: number[] = []
    while (stack.length) {
      const i = stack.pop()!
      if (seen[i] || cells[i] !== from) continue
      seen[i] = 1
      region.push(i)
      const x = i % w.cols
      if (x > 0) stack.push(i - 1)
      if (x < w.cols - 1) stack.push(i + 1)
      if (i >= w.cols) stack.push(i - w.cols)
      if (i < cells.length - w.cols) stack.push(i + w.cols)
    }
    for (const i of region) setCell(w, i % w.cols, Math.floor(i / w.cols), s)
  }
  /** Writes the painted cells back into the document. */
  const save = (w: Work) => {
    const next: Room =
      layer === 'collision'
        ? { ...room, collision: w.collision.some((v) => v > 0) ? rleEncode(w.collision) : undefined }
        : { ...room, layers: room.layers.map((l, i) => (i === layer ? { ...l, data: rleEncode(w.layers[i]!) } : l)) }
    // These cells are already on screen: no need to decode and repaint for this document.
    w.doc = next
    paintedWith.current[0] = next
    commit('room', id, next)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const w = work.current
    if (!w) return
    const panning = tool === 'pan' || event.button === 1 || spaceHeld.current
    // A finger on the pan tool scrolls natively.
    if (panning && event.pointerType === 'touch') return
    if (event.button > 2) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const { cx, cy } = cellOf(event)
    const s: Stroke = { kind: 'paint', erase: tool === 'eraser' || event.button === 2, ox: cx, oy: cy, lastX: cx, lastY: cy, changed: false }
    stroke.current = s
    if (panning) {
      const area = scroller.current!
      s.kind = 'pan'
      s.pan = { x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop }
    } else if (tool === 'entity') {
      // Clicking empty ground places an entity of the chosen type; markers handle their own clicks.
      stroke.current = null
      const type = editor.entityType ?? entityTypes?.[0]?.id
      if (!type) return
      commit('room', id, { ...room, entities: [...room.entities, { type, ...entityAt(cx, cy), props: {} }] })
      set({ entity: room.entities.length })
    } else if (tool === 'play') {
      // Starts the dev game in this room, standing on the clicked tile.
      stroke.current = null
      playFromHere(spotOfTile(id, cx, cy))
    } else if (tool === 'pick' || event.altKey) {
      stroke.current = null
      const value = target(w)[cy * w.cols + cx]!
      if (value === 0) return
      if (layer === 'collision') set({ collisionClass: value - 1, tool: 'brush' })
      else set({ stamp: { x: (value - 1) % sheetCols, y: Math.floor((value - 1) / sheetCols), w: 1, h: 1 }, tool: 'brush' })
    } else if (tool === 'fill') {
      flood(w, cx, cy, s)
    } else if (tool === 'rect') {
      s.kind = 'rect'
      setRect({ x0: cx, y0: cy, x1: cx, y1: cy })
    } else {
      dab(w, cx, cy, s)
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { cx, cy } = cellOf(event)
    if (hover?.cx !== cx || hover?.cy !== cy) setHover({ cx, cy })
    const s = stroke.current
    const w = work.current
    if (!s || !w) return
    if (s.kind === 'pan') {
      const area = scroller.current!
      area.scrollLeft = s.pan!.left - (event.clientX - s.pan!.x)
      area.scrollTop = s.pan!.top - (event.clientY - s.pan!.y)
    } else if (s.kind === 'rect') {
      setRect({ x0: s.ox, y0: s.oy, x1: cx, y1: cy })
    } else if (s.kind === 'paint' && tool !== 'fill' && (cx !== s.lastX || cy !== s.lastY)) {
      line(w, s.lastX, s.lastY, cx, cy, s)
    }
    s.lastX = cx
    s.lastY = cy
  }
  const onPointerUp = () => {
    const s = stroke.current
    const w = work.current
    stroke.current = null
    if (!s || !w) return
    if (s.kind === 'rect') {
      const left = Math.min(s.ox, s.lastX)
      const top = Math.min(s.oy, s.lastY)
      const corner: Stroke = { ...s, ox: left, oy: top }
      for (let y = top; y <= Math.max(s.oy, s.lastY); y++) for (let x = left; x <= Math.max(s.ox, s.lastX); x++) setCell(w, x, y, corner)
      s.changed = corner.changed
      setRect(null)
    }
    if (s.changed) save(w)
  }

  // Entities are moved by dragging their marker while the entity tool is on.
  const onEntityDown = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    if (tool !== 'entity' || event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    set({ entity: index })
    stroke.current = { kind: 'entity', erase: false, ox: 0, oy: 0, lastX: 0, lastY: 0, changed: false, entity: index }
  }
  const onEntityMove = (event: ReactPointerEvent<HTMLElement>) => {
    const s = stroke.current
    if (s?.kind !== 'entity') return
    const { cx, cy } = cellOf(event)
    const at = entityAt(cx, cy)
    const current = dragged ?? room.entities[s.entity!]!
    if (at.x !== current.x || at.y !== current.y) setDragged({ index: s.entity!, ...at })
  }
  const onEntityUp = () => {
    const s = stroke.current
    stroke.current = null
    if (s?.kind !== 'entity' || !dragged) return
    commit('room', id, { ...room, entities: room.entities.map((e, i) => (i === dragged.index ? { ...e, x: dragged.x, y: dragged.y } : e)) })
    setDragged(null)
  }

  const cell = TILE * zoom
  const paints = tool === 'brush' || tool === 'rect' || tool === 'fill'
  const brushW = paints && tool === 'brush' && layer !== 'collision' ? stamp.w : 1
  const brushH = paints && tool === 'brush' && layer !== 'collision' ? stamp.h : 1
  return (
    <Box
      ref={surface}
      className="checker"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(event) => event.preventDefault()}
      sx={{ position: 'relative', width: cols * cell, height: rows * cell, cursor: tool === 'pan' ? 'grab' : tool === 'entity' ? 'copy' : 'crosshair', userSelect: 'none' }}
    >
      {showBackgrounds && room.backgrounds?.map((background, index) => <BackgroundPicture key={index} image={background.image} zoom={zoom} dim={background.dim ? room.dimLevel ?? 0 : 0} />)}
      <canvas ref={tilesCanvas} className="pixelated" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas ref={collisionCanvas} className="pixelated" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: showCollision ? 'block' : 'none' }} />
      {showGrid && zoom >= 2 && <GridOverlay stepX={cell} stepY={cell} colour="rgba(255,255,255,0.07)" />}
      {/* Screen boundaries: the units a room is sized in. */}
      <GridOverlay stepX={SCREEN.width * zoom} stepY={SCREEN.height * zoom} colour="rgba(76,159,254,0.6)" />
      {room.entities.map((entity, index) => {
        const at = dragged?.index === index ? dragged : entity
        const type = entityTypes?.find((t) => t.id === entity.type)
        return (
          <EntityMarker
            key={index}
            x={at.x}
            y={at.y}
            type={type}
            sprite={type?.sprite ? sprites?.[type.sprite] : undefined}
            zoom={zoom}
            selected={editor.entity === index}
            interactive={tool === 'entity'}
            label={type?.name ?? `${entity.type} (unknown type)`}
            onPointerDown={(event) => onEntityDown(event, index)}
            onPointerMove={onEntityMove}
            onPointerUp={onEntityUp}
          />
        )
      })}
      {rect && (
        <Box sx={{ position: 'absolute', pointerEvents: 'none', left: Math.min(rect.x0, rect.x1) * cell, top: Math.min(rect.y0, rect.y1) * cell, width: (Math.abs(rect.x1 - rect.x0) + 1) * cell, height: (Math.abs(rect.y1 - rect.y0) + 1) * cell, border: '1px solid #fff', bgcolor: 'rgba(76,159,254,0.25)' }} />
      )}
      {hover && !rect && tool !== 'pan' && tool !== 'entity' && (
        <Box sx={{ position: 'absolute', pointerEvents: 'none', left: hover.cx * cell, top: hover.cy * cell, width: brushW * cell, height: brushH * cell, outline: '1px solid #fff', boxShadow: '0 0 0 2px rgba(0,0,0,0.6)' }} />
      )}
    </Box>
  )
}

/** A background behind the room's tiles, repeating from the room's top-left corner: where it lies when the camera is there. In the game it scrolls slower than the room. */
export function BackgroundPicture({ image, zoom, dim = 0 }: { image: string; zoom: number; dim?: number }) {
  const revision = useStudio((s) => s.revision)
  const picture = useImage(image)
  const dimmed = useMemo(() => (dim > 0 && picture && picture !== 'error' ? dimmedCopy(picture, dim).toDataURL() : null), [picture, dim])
  if (!picture || picture === 'error') return null
  return <Box className="pixelated" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `url("${dimmed ?? fileUrl(image, revision)}")`, backgroundSize: `${picture.width * zoom}px ${picture.height * zoom}px`, backgroundRepeat: 'repeat' }} />
}

/** An entity on the map: its sprite's first frame if its type has one, else a square in the type's colour. */
function EntityMarker({ x, y, type, sprite, zoom, selected, interactive, label, ...handlers }: {
  x: number
  y: number
  type: EntityType | undefined
  sprite: Sprite | undefined
  zoom: number
  selected: boolean
  interactive: boolean
  label: string
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: () => void
}) {
  const revision = useStudio((s) => s.revision)
  const sheet = useImage(sprite && sprite.image.toLowerCase().endsWith('.png') ? sprite.image : undefined)
  const drawn = sprite && sheet && sheet !== 'error'
  const box = drawn
    ? { left: x - sprite.anchor.x, top: y - sprite.anchor.y, width: sprite.frame.width, height: sprite.frame.height }
    : { left: x - TILE / 2, top: y - TILE, width: TILE, height: TILE }
  return (
    <Box
      title={label}
      {...handlers}
      onPointerCancel={handlers.onPointerUp}
      className="pixelated"
      sx={{
        position: 'absolute',
        left: box.left * zoom,
        top: box.top * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: 'move',
        touchAction: 'none',
        outline: selected ? '2px solid #fff' : drawn ? 'none' : '1px solid rgba(255,255,255,0.8)',
        outlineOffset: selected ? 1 : 0,
        ...(drawn
          ? { backgroundImage: `url("${fileUrl(sprite.image, revision)}")`, backgroundSize: `${sheet.width * zoom}px ${sheet.height * zoom}px`, backgroundPosition: '0 0', backgroundRepeat: 'no-repeat' }
          : { bgcolor: type?.colour ?? '#888' }),
      }}
    />
  )
}

const rowSx = (selected: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  px: 2,
  minHeight: { xs: BAR.touchRow, md: BAR.row },
  cursor: 'pointer',
  bgcolor: selected ? 'rgba(76,159,254,0.22)' : 'transparent',
  '&:hover': { bgcolor: selected ? 'rgba(76,159,254,0.28)' : 'rgba(255,255,255,0.05)' },
})

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" component="h2" sx={{ display: 'block', px: 2, py: 1, m: 0, color: 'text.secondary', bgcolor: 'background.default', textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {children}
    </Typography>
  )
}

/** Docked beside the map: the room's layers, and what the active tool paints with. */
export function PalettePanel() {
  const selection = useStudio((s) => s.selection)
  const room = useStudio((s) => (s.selection.kind === 'room' ? s.bundle?.docs.rooms[s.selection.id!] : undefined))
  const tileset = useStudio((s) => (room ? s.bundle?.docs.tilesets[room.tileset] : undefined))
  const project = useStudio((s) => s.bundle?.docs.project)
  const commit = useStudio((s) => s.commit)
  const editor = useEditor()
  const { tool, hidden, set } = editor
  if (!room || selection.kind !== 'room') {
    return <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>Open a room to paint it. Tiles, layers and entity types show here.</Typography>
  }
  const id = selection.id!
  const layer = editor.layer === 'collision' ? 'collision' : Math.min(editor.layer, room.layers.length - 1)
  const change = (layers: Room['layers'], active: number) => {
    commit('room', id, { ...room, layers })
    set({ layer: active, hidden: [] })
  }
  const move = (by: number) => {
    if (layer === 'collision') return
    const to = layer + by
    if (to < 0 || to >= room.layers.length) return
    const layers = [...room.layers]
    ;[layers[layer], layers[to]] = [layers[to]!, layers[layer]!]
    change(layers, to)
  }
  const { cols, rows } = roomSize(room)
  const layersFull = room.layers.length + (room.backgrounds?.length ?? 0) >= MAX_SCREEN_LAYERS
  // The panel itself never scrolls: Layers keeps its place and what is below scrolls on its own.
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0 }}>
        <Heading>Layers</Heading>
        <Box role="listbox" aria-label="Layers">
          <Box role="option" aria-selected={layer === 'collision'} sx={rowSx(layer === 'collision')} onClick={() => set({ layer: 'collision', showCollision: true, tool: tool === 'entity' ? 'brush' : tool })}>
            <BlockOutlinedIcon sx={{ color: 'text.secondary' }} />
            <Typography noWrap sx={{ flex: 1 }}>Collision</Typography>
          </Box>
          {/* Front layer first, as it is drawn. */}
          {room.layers.map((l, index) => ({ l, index })).reverse().map(({ l, index }) => (
            <Box key={index} role="option" aria-selected={layer === index} sx={rowSx(layer === index)} onClick={() => set({ layer: index, tool: tool === 'entity' ? 'brush' : tool })}>
              <IconButton
                aria-label={hidden.includes(index) ? `Show ${l.name}` : `Hide ${l.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  set({ hidden: hidden.includes(index) ? hidden.filter((h) => h !== index) : [...hidden, index] })
                }}
                sx={{ p: 0, color: 'text.secondary' }}
              >
                {hidden.includes(index) ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
              </IconButton>
              <Typography noWrap sx={{ flex: 1, opacity: hidden.includes(index) ? 0.5 : 1 }}>{l.name}</Typography>
              {l.dim && <Typography variant="caption" color="text.secondary">dimmed</Typography>}
              <DimToggle name={l.name} on={l.dim === true} onChange={(dim) => commit('room', id, { ...room, layers: room.layers.map((x, i) => (i === index ? { ...x, dim: dim || undefined } : x)) })} />
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1 }}>
          <ToolButton title={room.layers.length >= 3 ? 'A GBA room has at most 3 tile layers' : layersFull ? `Tile layers and backgrounds are at most ${MAX_SCREEN_LAYERS}, the layers the GBA draws: remove a background first` : 'Add a layer in front'} disabled={room.layers.length >= 3 || layersFull} onClick={() => change([...room.layers, { name: `Layer ${room.layers.length + 1}`, data: [cols * rows, 0] }], room.layers.length)}><AddIcon /></ToolButton>
          <ToolButton title="Bring forward" disabled={layer === 'collision' || layer >= room.layers.length - 1} onClick={() => move(1)}><ArrowUpwardIcon /></ToolButton>
          <ToolButton title="Send back" disabled={layer === 'collision' || layer <= 0} onClick={() => move(-1)}><ArrowDownwardIcon /></ToolButton>
          <ToolButton
            title="Delete layer"
            disabled={layer === 'collision' || room.layers.length <= 1}
            onClick={() => layer !== 'collision' && change(room.layers.filter((_, i) => i !== layer), Math.max(0, layer - 1))}
          >
            <DeleteOutlinedIcon />
          </ToolButton>
          {layer !== 'collision' && (
            <Box sx={{ flex: 1, ml: 1 }}>
              <TextInput label="Layer name" value={room.layers[layer]!.name} onCommit={(name) => commit('room', id, { ...room, layers: room.layers.map((l, i) => (i === layer ? { ...l, name } : l)) })} />
            </Box>
          )}
        </Box>
      </Box>

      {tool === 'entity' ? (
        <>
          <Heading>Entity to place</Heading>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {project?.entityTypes.length ? (
              <Box role="listbox" aria-label="Entity types">
                {project.entityTypes.map((type, index) => {
                  const selected = (editor.entityType ?? project.entityTypes[0]!.id) === type.id
                  return (
                    <Box key={type.id} role="option" aria-selected={selected} sx={rowSx(selected)} onClick={() => set({ entityType: type.id })}>
                      <Box sx={{ width: ui(10), height: ui(10), bgcolor: type.colour, border: '1px solid rgba(255,255,255,0.4)', flexShrink: 0 }} />
                      <Typography noWrap sx={{ flex: 1 }}>{type.name}</Typography>
                      <Typography variant="body2" color="text.secondary">{index + 1}</Typography>
                    </Box>
                  )
                })}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No entity types yet. Add some in Project settings.</Typography>
            )}
          </Box>
        </>
      ) : layer === 'collision' ? (
        <>
          <Heading>Collision to paint</Heading>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Box role="listbox" aria-label="Collision classes">
              {project?.collisionClasses.map((cls, index) => (
                <Box key={cls.id} role="option" aria-selected={editor.collisionClass === index} sx={rowSx(editor.collisionClass === index)} onClick={() => set({ collisionClass: index, tool: tool === 'eraser' || tool === 'pick' ? 'brush' : tool })}>
                  <Box sx={{ width: ui(10), height: ui(10), bgcolor: cls.colour, border: '1px solid rgba(255,255,255,0.4)', flexShrink: 0 }} />
                  <Typography noWrap sx={{ flex: 1 }}>{cls.name}</Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
              Tiles bring their own collision from the tileset. Paint here only where a cell should differ; the eraser gives a cell back to its tile.
            </Typography>
          </Box>
        </>
      ) : (
        <>
          <Heading>Tiles</Heading>
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            {tileset ? <TilePicker tileset={tileset} /> : <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>The room's tileset is missing.</Typography>}
          </Box>
        </>
      )}
    </Box>
  )
}

/** The tileset as a palette: click a tile, or drag across several to stamp them together. */
function TilePicker({ tileset }: { tileset: Tileset }) {
  const image = useImage(tileset.image)
  const { stamp, tool, set } = useEditor()
  const [zoom, setZoom] = useState(3)
  const from = useRef<{ x: number; y: number } | null>(null)
  if (image === 'error') return <Typography variant="body2" color="error" sx={{ px: 2, py: 1 }}>Cannot load {tileset.image}.</Typography>
  if (!image) return null
  const sheetCols = Math.floor(image.width / TILE)
  const sheetRows = Math.floor(image.height / TILE)
  const cell = TILE * zoom
  const tileOf = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(sheetCols - 1, Math.max(0, Math.floor((event.clientX - box.left) / cell))),
      y: Math.min(sheetRows - 1, Math.max(0, Math.floor((event.clientY - box.top) / cell))),
    }
  }
  const pick = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const next: Stamp = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 }
    if (next.x !== stamp.x || next.y !== stamp.y || next.w !== stamp.w || next.h !== stamp.h) set({ stamp: next })
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, flexShrink: 0 }}>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
          {tileset.name} · tile {stamp.y * sheetCols + stamp.x}{stamp.w * stamp.h > 1 ? ` · ${stamp.w}×${stamp.h} block` : ''}
        </Typography>
        <Button variant="text" onClick={() => setZoom(zoom >= 5 ? 2 : zoom + 1)} sx={{ minWidth: 0, py: 0 }}>{zoom}×</Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, pb: 2 }}>
        <Box
          className="checker"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            from.current = tileOf(event)
            pick(from.current, from.current)
            if (tool === 'eraser' || tool === 'pick' || tool === 'pan') set({ tool: 'brush' })
          }}
          onPointerMove={(event) => from.current && pick(from.current, tileOf(event))}
          onPointerUp={() => (from.current = null)}
          onPointerCancel={() => (from.current = null)}
          sx={{ position: 'relative', width: sheetCols * cell, height: sheetRows * cell, cursor: 'pointer', touchAction: 'none' }}
        >
          <img src={image.src} alt={tileset.name} draggable={false} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
          <GridOverlay stepX={cell} stepY={cell} colour="rgba(255,255,255,0.1)" />
          <Box sx={{ position: 'absolute', pointerEvents: 'none', left: stamp.x * cell, top: stamp.y * cell, width: stamp.w * cell, height: stamp.h * cell, outline: '2px solid #4c9ffe', boxShadow: '0 0 0 3px rgba(0,0,0,0.6)' }} />
        </Box>
      </Box>
    </Box>
  )
}

/** Properties of the open room, and of the entity selected in it. */
export function RoomProperties({ id }: { id: string }) {
  const room = useStudio((s) => s.bundle?.docs.rooms[id])
  const docs = useStudio((s) => s.bundle?.docs)
  const commit = useStudio((s) => s.commit)
  const selected = useEditor((s) => s.entity)
  const set = useEditor((s) => s.set)
  const assets = useStudio((s) => s.bundle?.assets)
  if (!room || !docs) return null
  const update = (patch: Partial<Room>) => commit('room', id, { ...room, ...patch })
  const backgrounds = room.backgrounds ?? []
  const pictures = (assets ?? []).filter((a) => /\.png$/i.test(a.path)).map((a) => ({ value: a.path, label: a.path }))
  const setBackgrounds = (next: Background[]) => {
    update({ backgrounds: next.length ? next : undefined })
    if (next.length > backgrounds.length) set({ showBackgrounds: true })
  }
  const setBackground = (index: number, patch: Partial<Background>) => setBackgrounds(backgrounds.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  // A new one goes in front of those there, moving faster than them: nearer things pass quicker.
  const addBackground = (image: string) => setBackgrounds([...backgrounds, { image, parallax: { x: backgrounds.length ? 50 : 25, y: 0 } }])
  const noRoom = backgrounds.length >= MAX_BACKGROUNDS
    ? `A room has at most ${MAX_BACKGROUNDS} backgrounds.`
    : room.layers.length + backgrounds.length >= MAX_SCREEN_LAYERS
      ? `The GBA draws ${MAX_SCREEN_LAYERS} layers: this room's ${room.layers.length} tile layers leave room for ${MAX_SCREEN_LAYERS - room.layers.length === 0 ? 'no' : MAX_SCREEN_LAYERS - room.layers.length} background${MAX_SCREEN_LAYERS - room.layers.length === 1 ? '' : 's'}.`
      : null
  const entity = selected !== null ? room.entities[selected] : undefined
  const type = entity && docs.project?.entityTypes.find((t) => t.id === entity.type)
  const updateEntity = (patch: Partial<Room['entities'][number]>) => update({ entities: room.entities.map((e, i) => (i === selected ? { ...e, ...patch } : e)) })
  const shrinks = (width: number, height: number) => width < room.width || height < room.height
  const resize = (width: number, height: number) => {
    if (shrinks(width, height) && !window.confirm('Making the room smaller cuts off the tiles and entities outside the new size. Undo brings them back. Continue?')) return
    commit('room', id, resizeRoom(room, width, height))
  }
  return (
    <>
      <Fields>
        <Field label="Name"><TextInput label="Name" value={room.name} onCommit={(name) => update({ name })} /></Field>
        <Field label="Screens">
          <NumberInput label="Width in screens" value={room.width} min={1} max={32} onCommit={(width) => resize(width, room.height)} />
          <Typography color="text.secondary">×</Typography>
          <NumberInput label="Height in screens" value={room.height} min={1} max={32} onCommit={(height) => resize(room.width, height)} />
        </Field>
        <Field label="Pixels"><Typography>{room.width * SCREEN.width} × {room.height * SCREEN.height}</Typography></Field>
        <Field label="Tileset">
          <SelectInput label="Tileset" value={room.tileset} onChange={(tileset) => update({ tileset })} options={Object.entries(docs.tilesets).map(([value, t]) => ({ value, label: t.name }))} />
        </Field>
        <Field label="Music">
          <SelectInput label="Music" value={room.music ?? ''} onChange={(music) => update({ music: music || undefined })} options={[{ value: '', label: 'None' }, ...(docs.audio?.tracks ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
        </Field>
      </Fields>
      <Heading>Backgrounds</Heading>
      {backgrounds.length > 0 && (
        <Fields>
          {backgrounds.map((background, index) => (
            <Fragment key={index}>
          <Field label={backgrounds.length === 1 ? 'Image' : index === 0 ? 'Back' : 'Front'}>
            <SelectInput label="Background image" value={background.image} onChange={(image) => setBackground(index, { image })} options={pictures} />
          </Field>
          <Field label="Speed %">
            <NumberInput label="Scroll speed across, in percent of the camera's" value={background.parallax.x} min={0} max={100} onCommit={(x) => setBackground(index, { parallax: { ...background.parallax, x } })} />
            <Typography color="text.secondary">↔</Typography>
            <NumberInput label="Scroll speed down, in percent of the camera's" value={background.parallax.y} min={0} max={100} onCommit={(y) => setBackground(index, { parallax: { ...background.parallax, y } })} />
            <Typography color="text.secondary">↕</Typography>
            <DimToggle name={`background ${index + 1}`} on={background.dim === true} onChange={(dim) => setBackground(index, { dim: dim || undefined })} />
            {backgrounds.length > 1 && index === 0 && (
              <IconButton aria-label="Swap the back and front backgrounds" title="Swap back and front" onClick={() => setBackgrounds([backgrounds[1]!, backgrounds[0]!])} sx={{ p: 0.5, color: 'text.secondary' }}><SwapVertIcon /></IconButton>
            )}
            <IconButton aria-label="Remove this background" title="Remove this background (the image stays in the folder)" onClick={() => setBackgrounds(backgrounds.filter((_, i) => i !== index))} sx={{ p: 0.5, color: 'text.secondary' }}><DeleteOutlinedIcon /></IconButton>
          </Field>
            </Fragment>
          ))}
        </Fields>
      )}
      <Box sx={{ px: 2, pb: 1.5, pt: backgrounds.length ? 0 : 1.5, display: 'grid', gap: 1 }}>
        {noRoom ? (
          <Typography variant="body2" color="text.secondary">{noRoom}</Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <ImportButton label="Import a background" accept=".png" folder="assets/backgrounds" onImported={(paths) => addBackground(paths[0]!)} />
            {pictures.length > 0 && (
              <Box sx={{ flex: 1, minWidth: 120 }}>
                <SelectInput label="Add an image already in the folder as a background" value="" onChange={(image) => image && addBackground(image)} options={[{ value: '', label: 'or use an image…' }, ...pictures]} />
              </Box>
            )}
          </Box>
        )}
        <Typography variant="body2" color="text.secondary">
          {backgrounds.length
            ? 'Pictures behind the tiles, repeating in both directions. Speed is how fast one scrolls compared with the room: 0 stands still, 100 moves with it. Give the back one less than the front one for depth. The map shows them as they lie at the room\'s top-left corner; Play shows them moving.'
            : 'A PNG behind the tiles, its size a multiple of 8, that repeats in both directions and scrolls slower than the room. Two of them at different speeds give parallax.'}
        </Typography>
      </Box>
      <Heading>Darkness</Heading>
      <DimLevel room={room} onChange={(dimLevel) => update({ dimLevel })} />
      {entity && (
        <>
          <Heading>Selected entity</Heading>
          <Fields>
            <Field label="Type">
              <SelectInput label="Entity type" value={entity.type} onChange={(next) => updateEntity({ type: next, props: {} })} options={(docs.project?.entityTypes ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
            <Field label="Position">
              <NumberInput label="X in pixels" value={entity.x} min={0} max={room.width * SCREEN.width - 1} onCommit={(x) => updateEntity({ x })} />
              <NumberInput label="Y in pixels" value={entity.y} min={0} max={room.height * SCREEN.height - 1} onCommit={(y) => updateEntity({ y })} />
            </Field>
            {type?.props.map((prop) => {
              // The type's value until this entity sets its own: see design/US-014.md.
              const shown = shownEntityValue(type, entity.props, prop.name)
              const value = shown.value ?? prop.default
              const setProp = (next: number | boolean | string) => updateEntity({ props: entityOverride(type, entity.props, prop.name, next) })
              return (
                <Field key={prop.name} label={prop.name} marked={shown.overridden} mark={`Set on this entity; ${type.name} has ${String(shown.inherited)}`}>
                  {prop.type === 'int' ? (
                    <NumberInput label={prop.name} value={Number(value)} min={prop.min ?? I32_MIN} max={prop.max ?? I32_MAX} onCommit={setProp} />
                  ) : prop.type === 'bool' ? (
                    <SelectInput label={prop.name} value={value ? 'yes' : 'no'} onChange={(next) => setProp(next === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                  ) : prop.type === 'enum' ? (
                    <SelectInput label={prop.name} value={String(value)} onChange={setProp} options={(prop.options ?? []).map((o) => ({ value: o, label: o }))} />
                  ) : (
                    <TextInput label={prop.name} value={String(value)} onCommit={setProp} />
                  )}
                  {shown.overridden && (
                    <IconButton
                      aria-label={`Reset ${prop.name} to the type's value`}
                      title={`Reset to ${type.name}'s value, ${String(shown.inherited)}`}
                      onClick={() => updateEntity({ props: entityOverride(type, entity.props, prop.name, undefined) })}
                      sx={{ p: 0.5, color: 'text.secondary' }}
                    >
                      <RestartAltIcon />
                    </IconButton>
                  )}
                </Field>
              )
            })}
          </Fields>
          {type && <BehaviourOverrides type={type} props={entity.props} onChange={(props) => updateEntity({ props })} />}
          <Box sx={{ px: 2, pb: 2 }}>
            <Button
              color="error"
              startIcon={<DeleteOutlinedIcon />}
              onClick={() => {
                update({ entities: room.entities.filter((_, i) => i !== selected) })
                set({ entity: null })
              }}
            >
              Delete entity
            </Button>
          </Box>
        </>
      )}
    </>
  )
}

export { Heading, rowSx, LayersOutlinedIcon }
