// The world map: every room on a grid of screens. Drag rooms to arrange them.
import AddIcon from '@mui/icons-material/Add'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { resizeRoom } from '@pecten-studio/core'
import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { NumberInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { UndoButtons } from './common.tsx'
import { CreateDialog, freeSpot } from './create.tsx'
import { Divider, GridOverlay, Message, Viewport } from './views.tsx'

// A screen on the map keeps the GBA's 3:2 shape.
const CELL_W = 24
const CELL_H = 16
/** Empty screens shown around the rooms, to drag into. */
const MARGIN = 2

export function WorldEditor() {
  const world = useStudio((s) => s.bundle?.docs.world)
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const select = useStudio((s) => s.select)
  const commit = useStudio((s) => s.commit)
  const [chosen, setChosen] = useState<string | null>(null)
  /** The new-room dialog, and the screen it was asked for by a double-click on the map. */
  const [creating, setCreating] = useState<{ at?: { x: number; y: number } } | null>(null)
  const [drag, setDrag] = useState<{ room: string; x: number; y: number } | null>(null)
  const grab = useRef<{ room: string; pointerX: number; pointerY: number; x: number; y: number; moved: boolean } | null>(null)
  if (!world || !rooms) return <Message>The world file is missing or has errors. See Problems.</Message>

  const placed = world.rooms.flatMap((p) => (rooms[p.room] ? [{ ...p, doc: rooms[p.room]! }] : []))
  const unplaced = Object.entries(rooms).filter(([id]) => !world.rooms.some((p) => p.room === id))
  const place = (id: string) => commit('world', undefined, { ...world, rooms: [...world.rooms, { room: id, ...freeSpot(world, (r) => rooms[r]) }], start: world.start ?? id })
  // A map of a set size shows exactly its screens; otherwise it grows with its rooms.
  const size = world.size
  const left = size ? 0 : Math.min(0, ...placed.map((p) => p.x)) - MARGIN
  const top = size ? 0 : Math.min(0, ...placed.map((p) => p.y)) - MARGIN
  const right = size ? size.width : Math.max(1, ...placed.map((p) => p.x + p.doc.width)) + MARGIN
  const bottom = size ? size.height : Math.max(1, ...placed.map((p) => p.y + p.doc.height)) + MARGIN
  const chosenRoom = chosen ? rooms[chosen] : undefined
  const resize = (width: number, height: number) => {
    if (!chosen || !chosenRoom) return
    const smaller = width < chosenRoom.width || height < chosenRoom.height
    if (smaller && !window.confirm('Making the room smaller cuts off the tiles and entities outside the new size. Undo in the room brings them back. Continue?')) return
    commit('room', chosen, resizeRoom(chosenRoom, width, height))
  }

  const tools = (
    <>
      <UndoButtons />
      <Divider />
      <Button variant="text" startIcon={<AddIcon />} onClick={() => setCreating({})}>New room</Button>
      <Divider />
      <Button variant="text" startIcon={<HomeOutlinedIcon />} disabled={!chosen || world.start === chosen} onClick={() => chosen && commit('world', undefined, { ...world, start: chosen })}>Start here</Button>
      <Button variant="text" disabled={!chosen} onClick={() => chosen && select({ kind: 'room', id: chosen })}>Open room</Button>
      <Button
        variant="text"
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return
          commit('world', undefined, { ...world, rooms: world.rooms.filter((p) => p.room !== chosen), start: world.start === chosen ? undefined : world.start })
          setChosen(null)
        }}
      >
        Take off the map
      </Button>
      {chosenRoom && (
        <>
          <Divider />
          <Typography variant="body2" color="text.secondary" noWrap>{chosenRoom.name}, screens:</Typography>
          <Box sx={{ width: ui(40) }}><NumberInput label="Room width in screens" value={chosenRoom.width} min={1} max={32} onCommit={(w) => resize(w, chosenRoom.height)} /></Box>
          <Typography color="text.secondary">×</Typography>
          <Box sx={{ width: ui(40) }}><NumberInput label="Room height in screens" value={chosenRoom.height} min={1} max={32} onCommit={(h) => resize(chosenRoom.width, h)} /></Box>
        </>
      )}
    </>
  )

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {unplaced.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, flexWrap: 'wrap', borderBottom: '1px solid #111' }}>
          <Typography variant="body2" color="text.secondary">Not on the map:</Typography>
          {unplaced.map(([id, room]) => (
            <Button key={id} variant="outlined" startIcon={<AddIcon />} onClick={() => place(id)}>{room.name}</Button>
          ))}
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Viewport initialZoom={3} tools={tools} touchAction="none" info={placed.length ? `${placed.length} rooms${size ? ` · map of ${size.width}×${size.height} screens` : ''} · drag to arrange, double-click a room to open it or an empty screen to add one` : 'No rooms yet. Press New room, or double-click a screen on the map.'}>
          {(zoom) => {
            const onDown = (event: ReactPointerEvent<HTMLElement>, room: string, x: number, y: number) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              grab.current = { room, pointerX: event.clientX, pointerY: event.clientY, x, y, moved: false }
              setChosen(room)
            }
            const onMove = (event: ReactPointerEvent<HTMLElement>) => {
              const g = grab.current
              if (!g) return
              const moved = rooms[g.room]!
              const fit = (value: number, span: number, limit: number | undefined) => (limit === undefined ? value : Math.max(0, Math.min(limit - span, value)))
              const x = fit(g.x + Math.round((event.clientX - g.pointerX) / (CELL_W * zoom)), moved.width, size?.width)
              const y = fit(g.y + Math.round((event.clientY - g.pointerY) / (CELL_H * zoom)), moved.height, size?.height)
              if (x !== (drag?.x ?? g.x) || y !== (drag?.y ?? g.y)) {
                g.moved = true
                setDrag({ room: g.room, x, y })
              }
            }
            const onUp = () => {
              const g = grab.current
              grab.current = null
              if (g?.moved && drag && (drag.x !== g.x || drag.y !== g.y)) {
                commit('world', undefined, { ...world, rooms: world.rooms.map((p) => (p.room === drag.room ? { ...p, x: drag.x, y: drag.y } : p)) })
              }
              setDrag(null)
            }
            return (
              <Box
                sx={{ position: 'relative', width: (right - left) * CELL_W * zoom, height: (bottom - top) * CELL_H * zoom, bgcolor: '#1c1c1c' }}
                onPointerDown={(event) => event.target === event.currentTarget && setChosen(null)}
                onDoubleClick={(event) => {
                  // An empty screen asks for a new room there.
                  if (event.target !== event.currentTarget) return
                  const box = event.currentTarget.getBoundingClientRect()
                  const x = Math.floor((event.clientX - box.left) / (CELL_W * zoom)) + left
                  const y = Math.floor((event.clientY - box.top) / (CELL_H * zoom)) + top
                  setCreating({ at: { x, y } })
                }}
              >
                <GridOverlay stepX={CELL_W * zoom} stepY={CELL_H * zoom} colour="rgba(255,255,255,0.08)" />
                {placed.map((p) => {
                  const at = drag?.room === p.room ? drag : p
                  const isStart = world.start === p.room
                  return (
                    <Box
                      key={p.room}
                      component="button"
                      onPointerDown={(event) => onDown(event, p.room, p.x, p.y)}
                      onPointerMove={onMove}
                      onPointerUp={onUp}
                      onPointerCancel={onUp}
                      onDoubleClick={() => select({ kind: 'room', id: p.room })}
                      onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'room', id: p.room })}
                      sx={{
                        position: 'absolute',
                        left: (at.x - left) * CELL_W * zoom,
                        top: (at.y - top) * CELL_H * zoom,
                        width: p.doc.width * CELL_W * zoom,
                        height: p.doc.height * CELL_H * zoom,
                        p: 0,
                        border: chosen === p.room ? '2px solid #fff' : '1px solid',
                        borderColor: chosen === p.room ? '#fff' : isStart ? 'primary.main' : '#6a6a6a',
                        bgcolor: isStart ? 'rgba(76,159,254,0.25)' : '#3a3a3a',
                        color: 'text.primary',
                        font: 'inherit',
                        overflow: 'hidden',
                        cursor: 'move',
                        touchAction: 'none',
                        zIndex: drag?.room === p.room ? 1 : 0,
                        opacity: drag?.room === p.room ? 0.85 : 1,
                        '&:focus-visible': { outline: '2px solid #4c9ffe' },
                      }}
                    >
                      {p.doc.name}
                      {isStart && <Typography variant="caption" component="span" sx={{ display: 'block', color: 'primary.main' }}>start</Typography>}
                    </Box>
                  )
                })}
              </Box>
            )
          }}
        </Viewport>
      </Box>
      {creating && <CreateDialog kind="room" at={creating.at} onClose={() => setCreating(null)} />}
    </Box>
  )
}
