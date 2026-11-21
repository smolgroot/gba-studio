// Darkening in the room panel: a toggle per layer and one level for the room.
import ContrastIcon from '@mui/icons-material/Contrast'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import { MAX_DIM } from '@pecten-studio/core'
import type { Room } from '@pecten-studio/core'
import { useEffect, useState } from 'react'

/** Turns a layer's darkening on or off. */
export function DimToggle({ name, on, onChange }: { name: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <IconButton
      aria-label={on ? `Stop darkening ${name}` : `Darken ${name}`}
      aria-pressed={on}
      title={on ? `${name} is darkened by the room's level. Click to stop` : `Darken ${name} by the room's level`}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!on)
      }}
      sx={{ p: 0, color: on ? 'primary.main' : 'text.disabled' }}
    >
      <ContrastIcon />
    </IconButton>
  )
}

/** What the room darkens, in words: the layers set to dim, or why the level does nothing. */
export function dimSummary(room: Room): string {
  const names = [...room.layers.filter((l) => l.dim).map((l) => l.name), ...(room.backgrounds ?? []).filter((b) => b.dim).map((b) => b.image.split('/').pop()!)]
  const level = room.dimLevel ?? 0
  if (names.length === 0) return level > 0 ? 'No layer is dimmed, so the level does nothing. Turn dim on for a layer.' : 'No layer is dimmed. Turn dim on for a layer, then raise the level.'
  if (level === 0) return `Dimmed: ${names.join(', ')}. The level is 0, so nothing is darkened yet.`
  return `Dimmed: ${names.join(', ')}.`
}

/** The room's one darkness level, 0 (no change) to 16 (black). */
export function DimLevel({ room, onChange }: { room: Room; onChange: (level: number | undefined) => void }) {
  const level = room.dimLevel ?? 0
  const [dragging, setDragging] = useState<number | null>(null)
  useEffect(() => setDragging(null), [level])
  return (
    <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography color="text.secondary" noWrap>Level</Typography>
        <Slider
          aria-label="Dim level: 0 is no change, 16 is black"
          size="small"
          min={0}
          max={MAX_DIM}
          step={1}
          marks
          value={dragging ?? level}
          valueLabelDisplay="auto"
          onChange={(_, value) => setDragging(value as number)}
          onChangeCommitted={(_, value) => onChange((value as number) || undefined)}
          sx={{ flex: 1 }}
        />
        <Typography sx={{ width: 24, textAlign: 'right' }}>{dragging ?? level}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">{dimSummary(room)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        The console has one level for all dimmed layers, and sprites are never dimmed. The game can change the level while it runs.
      </Typography>
    </Box>
  )
}
