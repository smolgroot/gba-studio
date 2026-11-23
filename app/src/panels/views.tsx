// Pieces every document view shares: the zoomable viewport, images from the game
// folder, grid lines, and the plain asset preview.
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { fileUrl } from '../api.ts'
import { useStudio } from '../store.ts'
import { BAR } from '../theme.ts'

/** A file of the game folder as an image; null while loading, 'error' if it cannot be shown. */
export function useImage(path: string | undefined): HTMLImageElement | null | 'error' {
  const revision = useStudio((s) => s.revision)
  const [state, setState] = useState<{ url: string; image: HTMLImageElement | 'error' } | null>(null)
  const url = path ? fileUrl(path, revision) : null
  useEffect(() => {
    if (!url) return
    let live = true
    const image = new Image()
    image.onload = () => live && setState({ url, image })
    image.onerror = () => live && setState({ url, image: 'error' })
    image.src = url
    return () => {
      live = false
    }
  }, [url])
  // Keep showing the last image while a changed file loads, so previews do not flash.
  return url && state ? state.image : null
}

export function Message({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  )
}

/** A toolbar button: an icon with a tooltip, lit while `active`. */
export function ToolButton({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip title={title}>
      {/* The span keeps the tooltip working while the button is disabled. */}
      <span>
        <IconButton
          aria-label={title}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          sx={{ color: active ? 'primary.main' : 'text.primary', bgcolor: active ? 'rgba(76,159,254,0.16)' : 'transparent' }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  )
}

export function Divider() {
  return <Box sx={{ width: '1px', alignSelf: 'stretch', my: 1, mx: 1, bgcolor: '#3a3a3a', flexShrink: 0 }} />
}

const MAX_ZOOM = 12

/**
 * A scrollable area with a toolbar and zoom. `children` gets the zoom factor.
 * Ctrl + wheel zooms; `scroller` gives the editors the scrolling element, to pan it.
 * Past 8x, zoom moves in steps of 4 so a high `maxZoom` is a few clicks away.
 */
export function Viewport({ initialZoom, maxZoom = MAX_ZOOM, tools, info, status, scroller, touchAction = 'pan-x pan-y', children }: {
  initialZoom: number
  maxZoom?: number
  tools?: ReactNode
  info?: ReactNode
  /** Shown whole at the end of the bar, where `info` may be cut short: the budgets. */
  status?: ReactNode
  scroller?: RefObject<HTMLDivElement | null>
  touchAction?: string
  children: (zoom: number) => ReactNode
}) {
  const [zoom, setZoom] = useState(initialZoom)
  const zoomIn = (z: number) => Math.min(maxZoom, z >= 8 && maxZoom > MAX_ZOOM ? z + 4 : z + 1)
  const zoomOut = (z: number) => Math.max(1, z > 8 && maxZoom > MAX_ZOOM ? z - 4 : z - 1)
  const own = useRef<HTMLDivElement>(null)
  const area = scroller ?? own
  useEffect(() => {
    const element = area.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom((z) => (event.deltaY < 0 ? zoomIn(z) : zoomOut(z)))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [area, maxZoom]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, minHeight: BAR.tool, flexShrink: 0, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        {tools}
        {tools && <Divider />}
        <ToolButton title="Zoom out (Ctrl + wheel)" disabled={zoom <= 1} onClick={() => setZoom(zoomOut(zoom))}><RemoveIcon /></ToolButton>
        <Typography variant="body2" sx={{ width: '3.2em', textAlign: 'center' }}>{zoom * 100}%</Typography>
        <ToolButton title="Zoom in (Ctrl + wheel)" disabled={zoom >= maxZoom} onClick={() => setZoom(zoomIn(zoom))}><AddIcon /></ToolButton>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ ml: 2, flex: 1, minWidth: 0 }}>{info}</Typography>
        {status && <Typography variant="body2" component="div" sx={{ flexShrink: 0, ml: 1 }}>{status}</Typography>}
      </Box>
      <Box ref={area} sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 4, bgcolor: '#161616', touchAction }}>{children(zoom)}</Box>
    </Box>
  )
}

/** Lines every `stepX` by `stepY` pixels over the element it sits in. */
export function GridOverlay({ stepX, stepY, colour }: { stepX: number; stepY: number; colour: string }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(to right, ${colour} 1px, transparent 1px), linear-gradient(to bottom, ${colour} 1px, transparent 1px)`,
        backgroundSize: `${stepX}px ${stepY}px`,
        borderRight: `1px solid ${colour}`,
        borderBottom: `1px solid ${colour}`,
      }}
    />
  )
}

export function AssetView({ path }: { path: string }) {
  const revision = useStudio((s) => s.revision)
  const url = fileUrl(path, revision)
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'png') {
    return (
      <Viewport initialZoom={4} info={path}>
        {(zoom) => <ZoomedImage url={url} alt={path} zoom={zoom} />}
      </Viewport>
    )
  }
  if (extension === 'wav') {
    return (
      <Box sx={{ p: 4 }}>
        <Typography sx={{ mb: 2 }}>{path}</Typography>
        <audio controls src={url} />
      </Box>
    )
  }
  return <Message>{path}: no preview for .{extension} files yet.</Message>
}

function ZoomedImage({ url, alt, zoom }: { url: string; alt: string; zoom: number }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  return (
    <Box className="checker" sx={{ width: size ? size.width * zoom : 'auto', height: size ? size.height * zoom : 'auto', display: 'inline-block' }}>
      <img
        src={url}
        alt={alt}
        className="pixelated"
        onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={{ width: size ? '100%' : undefined, height: size ? '100%' : undefined, display: 'block' }}
      />
    </Box>
  )
}
