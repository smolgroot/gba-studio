// The live entity list beside the game screen (US-021a, US-021b): the player and the
// live entities of a running dev build, read from the emulator's memory once a frame,
// with their numbers open to change while the game runs.
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { rowKey } from '@pecten-studio/core'
import type { LiveRow, LiveView } from '@pecten-studio/core'
import { BAR } from '../theme.ts'

export type RowKey = ReturnType<typeof rowKey>

/** Writes one value into the running game; returns what stopped it, or null. */
export type LiveChange = (key: RowKey, field: string, value: number | boolean) => string | null

const SELECTED = '#4c9ffe'

/** A row's name: the player, or the entity's type and its number in the world. */
export function rowName(row: LiveRow): string {
  return row.kind === 'player' ? 'Player' : `${row.type} #${row.index}`
}

/** A speed in 1/256 pixel a frame, as pixels a frame with two decimals. */
const subpixels = (n: number) => (n / 256).toFixed(2)

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 64 }}>{label}</Typography>
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>{children}</Typography>
    </Box>
  )
}

const inputSx = {
  width: 80,
  height: 20,
  px: 1,
  fontSize: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  color: 'text.primary',
  bgcolor: '#1c1c1c',
  border: '1px solid #3a3a3a',
  borderRadius: 1,
  outline: 'none',
  '&:focus': { borderColor: 'primary.main' },
} as const

/**
 * A number of the running game. It shows the live value, which changes every frame,
 * until it has the focus; then it keeps what is typed. Enter or leaving it writes
 * the value, Escape puts back the live one.
 */
function LiveNumber({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    if (draft.trim() === '') return
    const next = Number(draft)
    if (next !== value) onCommit(next)
  }
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" component="label" sx={{ minWidth: 64 }}>{label}</Typography>
      <Box
        component="input"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            // Leave without writing: the draft is gone before the blur.
            requestAnimationFrame(() => (event.target as HTMLInputElement).blur())
          }
        }}
        sx={inputSx}
      />
    </Box>
  )
}

function LiveFlag({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 64 }}>{label}</Typography>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ margin: 0, accentColor: SELECTED }} />
    </Box>
  )
}

/** The rest of a selected row: its numbers to change, its box, flags and properties. */
function Details({ row, onChange }: { row: LiveRow; onChange: LiveChange }) {
  const [problem, setProblem] = useState<string | null>(null)
  const key = rowKey(row)
  const change = (field: string) => (value: number | boolean) => setProblem(onChange(key, field, value))
  const number = (label: string, field: string, value: number) => <LiveNumber label={label} value={value} onCommit={change(field)} />
  // Clicks inside the open row change values; they do not close it.
  const shell = (children: React.ReactNode) => (
    <Box sx={{ pl: 2, pt: 1, display: 'flex', flexDirection: 'column', gap: 0.5, cursor: 'default' }} onClick={(event) => event.stopPropagation()}>
      {children}
      {problem && <Typography variant="caption" color="error" role="alert">Not changed: {problem.replace(/\.$/, '')}.</Typography>}
    </Box>
  )
  if (row.kind === 'player') {
    const flags = [row.onGround && 'on the ground', row.hitWall && 'hit a wall', row.hitCeiling && 'hit a ceiling'].filter(Boolean).join(', ')
    return shell(
      <>
        {number('x', 'x', row.x)}
        {number('y', 'y', row.y)}
        {number('vx (1/256)', 'vx', row.vx)}
        {number('vy (1/256)', 'vy', row.vy)}
        <Line label="size">{row.w} × {row.h}</Line>
        <Line label="state">{flags || 'in the air'}</Line>
      </>,
    )
  }
  const { hitbox: h } = row
  const patrols = row.properties.some((p) => p.name === 'patrol')
  return shell(
    <>
      {number('x', 'x', row.x)}
      {number('y', 'y', row.y)}
      {number('vx', 'vx', row.vx)}
      {number('vy', 'vy', row.vy)}
      {row.home && number('home x', 'homeX', row.home.x)}
      {row.home && number('home y', 'homeY', row.home.y)}
      {patrols && row.home && <Typography variant="caption" color="text.secondary">A patrol walks around its home and sets its x every frame: change its home to move it.</Typography>}
      <LiveFlag label="faces left" checked={row.facesLeft} onChange={change('facesLeft')} />
      <LiveFlag label="alive" checked onChange={change('alive')} />
      <Line label="room">{row.room}</Line>
      <Line label="hitbox">{h.w === 0 || h.h === 0 ? 'none (no sprite)' : `${h.w} × ${h.h} at ${h.x}, ${h.y} from its feet`}</Line>
      {row.properties.length > 0 && <Typography variant="caption" color="text.secondary" component="div" sx={{ pt: 1 }}>Properties as placed: change them in the room, and Live apply puts them in</Typography>}
      {row.properties.map((p) => (
        <Line key={p.name} label={p.name}>{typeof p.value === 'string' ? `“${p.value}”` : String(p.value)}</Line>
      ))}
    </>,
  )
}

/**
 * The list: the player first, then the entities, each with its position and speed. A
 * click selects a row, as a click on the game screen does; the selected row opens,
 * with its numbers to change.
 */
export function EntityList({ view, selected, onSelect, onChange, message }: { view: LiveView | null; selected: RowKey | null; onSelect: (key: RowKey | null) => void; onChange: LiveChange; message: string | null }) {
  const list = useRef<HTMLDivElement>(null)
  // Bring a row picked on the game screen into view, once per pick.
  useEffect(() => {
    if (selected === null) return
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const body = (() => {
    if (message) return <Typography variant="body2" color="text.secondary">{message}</Typography>
    if (!view) return <Typography variant="body2" color="text.secondary">Press Play to see the game's entities.</Typography>
    if (view.state !== 'running') return <Typography variant="body2" color={view.state === 'problem' ? 'error' : 'text.secondary'}>{view.message}</Typography>
    const lost = selected !== null && !view.rows.some((row) => rowKey(row) === selected)
    return (
      <>
        <Typography variant="caption" color="text.secondary" component="div">
          Frame {view.frame} · room {view.room} · camera {view.camera.x}, {view.camera.y}
        </Typography>
        {view.note && <Typography variant="body2" color="text.secondary">{view.note}</Typography>}
        {view.playerEditWaiting && (
          <Typography variant="body2" color="warning.main" role="status">
            The game has not taken the change to the player: it takes one when it calls debug::apply_player_edit once a frame, before the player moves.
          </Typography>
        )}
        {lost && <Typography variant="body2" color="warning.main">#{selected} is no longer live: it was taken, or its room is no longer active.</Typography>}
        <Box role="listbox" aria-label="Live entities" sx={{ display: 'flex', flexDirection: 'column' }}>
          {view.rows.map((row) => {
            const key = rowKey(row)
            const on = key === selected
            const speed = row.kind === 'player' ? `${subpixels(row.vx)}, ${subpixels(row.vy)}` : `${row.vx}, ${row.vy}`
            return (
              <Box
                key={key}
                role="option"
                aria-selected={on}
                onClick={() => onSelect(on ? null : key)}
                sx={{ px: 1.5, py: 1, minHeight: BAR.row, cursor: 'pointer', borderRadius: 1, border: `1px solid ${on ? SELECTED : 'transparent'}`, bgcolor: on ? 'rgba(76, 159, 254, 0.12)' : 'transparent', '&:hover': { bgcolor: on ? 'rgba(76, 159, 254, 0.18)' : 'rgba(255, 255, 255, 0.05)' } }}
              >
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 96 }}>{rowName(row)}</Typography>
                  <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{row.x}, {row.y}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>speed {speed}</Typography>
                </Box>
                {on && <Details row={row} onChange={onChange} />}
              </Box>
            )
          })}
        </Box>
        <Typography variant="caption" color="text.secondary" component="div">
          Positions in world pixels: the player's top-left corner, an entity's feet. The player's speed is in pixels a frame to 1/256; an entity's in whole pixels a frame.
        </Typography>
      </>
    )
  })()

  return (
    <Box ref={list} sx={{ flex: '0 1 280px', minWidth: 240, maxHeight: 480, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid #333' }}>
      <Typography variant="body1" sx={{ fontWeight: 600 }}>Entities</Typography>
      {body}
    </Box>
  )
}
