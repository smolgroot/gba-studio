// Readouts of background tiles and palettes against the GBA's 1024 and 16, as the build
// counts them, so an author sees a limit coming while painting rather than at the build.
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import { BG_PALETTES, MAX_BG_TILES, artKey, artLookup, budgetState, imageBudget, roomBudget } from '@pecten-studio/core'
import type { RoomBudget } from '@pecten-studio/core'
import { useMemo } from 'react'
import { useStudio } from '../store.ts'

const STATE_COLOUR = { ok: 'text.secondary', near: 'warning.main', over: 'error.main' } as const

/** "tiles 83 / 1024", amber from 90% and red over the limit. */
function Count({ label, used, limit }: { label: string; used: number; limit: number }) {
  const state = budgetState(used, limit)
  return (
    <Box component="span" data-budget={state} sx={{ color: STATE_COLOUR[state], fontWeight: state === 'over' ? 600 : undefined, whiteSpace: 'nowrap' }}>
      {used}/{limit} {label}
    </Box>
  )
}

/** Tiles and palettes against the hardware's, with what they are made of in a tooltip. */
export function BudgetReadout({ tiles, palettes, detail }: { tiles: number; palettes: number; detail: string }) {
  return (
    <Tooltip title={detail}>
      <Box component="span" role="status" aria-label={`Background budget: ${tiles} of ${MAX_BG_TILES} tiles, ${palettes} of ${BG_PALETTES} palettes`} sx={{ display: 'inline-flex', gap: 0.75 }}>
        <Count label="tiles" used={tiles} limit={MAX_BG_TILES} />
        <Box component="span" sx={{ color: 'text.secondary' }}>·</Box>
        <Count label="palettes" used={palettes} limit={BG_PALETTES} />
      </Box>
    </Tooltip>
  )
}

/** Why an image cannot be converted, in the build's words. */
function Unconvertible({ error }: { error: string }) {
  return (
    <Box component="span" role="status" sx={{ color: 'error.main' }}>
      not convertible: {error}
    </Box>
  )
}

function roomDetail(name: string, b: RoomBudget): string {
  return (
    `On screen in ${name}: the ${b.tilesetTiles} tiles that the rooms drawn with its tileset use, ` +
    `and ${b.pictureTiles} distinct tiles of its backgrounds. Palettes: ${b.tilesetPalettes} for the tileset, ${b.picturePalettes} for the backgrounds. ` +
    `Video memory holds ${MAX_BG_TILES} background tiles and ${BG_PALETTES} palettes.`
  )
}

/** A room's budget, following its layers as they are painted. */
export function RoomBudgetReadout({ id }: { id: string }) {
  const docs = useStudio((s) => s.bundle?.docs)
  const art = useStudio((s) => s.bundle?.art)
  const budget = useMemo(() => (docs && art ? roomBudget(docs, id, artLookup(art)) : null), [docs, art, id])
  if (!budget || !docs) return null
  return <BudgetReadout tiles={budget.tiles} palettes={budget.palettes} detail={roomDetail(docs.rooms[id]!.name, budget)} />
}

/** A tileset's own tiles and palettes, as the build converts its image. */
export function TilesetBudgetReadout({ id }: { id: string }) {
  const image = useStudio((s) => s.bundle?.docs.tilesets[id]?.image)
  const cost = useStudio((s) => (image ? s.bundle?.art[artKey(image, 'tileset')] : undefined))
  if (!cost) return null
  if ('error' in cost) return <Unconvertible error={cost.error} />
  return <BudgetReadout tiles={cost.tiles} palettes={cost.palettes} detail={`The image cut into ${cost.tiles} tiles, whose colours fit ${cost.palettes} palettes of 15. Rooms add their backgrounds' tiles and palettes to these.`} />
}

/** The pixel editor's readout: the image's own cost, and the fullest room that uses it. */
export function ImageBudgetReadout({ path, pixels, version }: { path: string; pixels: ImageData; version: number }) {
  const docs = useStudio((s) => s.bundle?.docs)
  const art = useStudio((s) => s.bundle?.art)
  // `version` moves when a stroke ends: the pixels are changed in place.
  const result = useMemo(() => (docs && art ? imageBudget(docs, art, path, pixels) : null), [docs, art, path, pixels, version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!result) return null
  const { own, as, worst } = result
  if ('error' in own) return <Unconvertible error={own.error} />
  const ownText = as === 'background' ? `As a background: ${own.tiles} distinct tiles in ${own.palettes} palettes.` : `As a tileset: ${own.tiles} tiles in ${own.palettes} palettes.`
  if (!worst) return <BudgetReadout tiles={own.tiles} palettes={own.palettes} detail={`${ownText} No room uses this image yet.`} />
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 1 }}>
      <Box component="span" sx={{ color: 'text.secondary' }}>{worst.name}:</Box>
      <BudgetReadout tiles={worst.budget.tiles} palettes={worst.budget.palettes} detail={`${ownText} ${roomDetail(worst.name, worst.budget)} This is the fullest room that uses the image.`} />
    </Box>
  )
}
