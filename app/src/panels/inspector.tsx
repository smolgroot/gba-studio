// The live entity list beside the game screen (US-021a): the player and the live
// entities of a running dev build, read from the emulator's memory once a frame.
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useRef } from 'react'
import { rowKey } from '@pecten-studio/core'
import type { LiveRow, LiveView } from '@pecten-studio/core'
import { BAR } from '../theme.ts'

export type RowKey = ReturnType<typeof rowKey>

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

/** The rest of a selected row: its box, flags and properties. */
function Details({ row }: { row: LiveRow }) {
  if (row.kind === 'player') {
    const flags = [row.onGround && 'on the ground', row.hitWall && 'hit a wall', row.hitCeiling && 'hit a ceiling'].filter(Boolean).join(', ')
    return (
      <Box sx={{ pl: 2, pt: 1 }}>
        <Line label="size">{row.w} × {row.h}</Line>
        <Line label="state">{flags || 'in the air'}</Line>
      </Box>
    )
  }
  const { hitbox: h } = row
  return (
    <Box sx={{ pl: 2, pt: 1 }}>
      <Line label="room">{row.room}</Line>
      <Line label="hitbox">{h.w === 0 || h.h === 0 ? 'none (no sprite)' : `${h.w} × ${h.h} at ${h.x}, ${h.y} from its feet`}</Line>
      <Line label="facing">{row.facesLeft ? 'left' : 'right'}</Line>
      {row.properties.length > 0 && <Typography variant="caption" color="text.secondary" component="div" sx={{ pt: 1 }}>Properties as placed</Typography>}
      {row.properties.map((p) => (
        <Line key={p.name} label={p.name}>{typeof p.value === 'string' ? `“${p.value}”` : String(p.value)}</Line>
      ))}
    </Box>
  )
}

/**
 * The list: the player first, then the entities, each with its position and speed. A
 * click selects a row, as a click on the game screen does; the selected row opens.
 */
export function EntityList({ view, selected, onSelect, message }: { view: LiveView | null; selected: RowKey | null; onSelect: (key: RowKey | null) => void; message: string | null }) {
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
                {on && <Details row={row} />}
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
