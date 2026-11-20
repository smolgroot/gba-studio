// Pieces the tools share: side panel sections, sliders, pixel canvases and file helpers.
import Box from '@mui/material/Box'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Field } from '../fields.tsx'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="caption" component="h2" sx={{ display: 'block', px: 2, py: 1, m: 0, color: 'text.secondary', bgcolor: 'background.default', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

export function Range({ label, value, min, max, step = 1, disabled, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <Field label={label}>
      <Slider size="small" aria-label={label} value={Math.min(max, value)} min={min} max={max} step={step} disabled={disabled} onChange={(_event, v) => onChange(v as number)} sx={{ flex: 1, mx: 1 }} />
      <Typography variant="body2" sx={{ width: '2.4em', textAlign: 'right', flexShrink: 0 }}>{Math.min(max, value)}</Typography>
    </Field>
  )
}

/** A canvas that draws itself once per `draw` and scales without smoothing. */
export function PixelCanvas({ draw, style }: { draw: (canvas: HTMLCanvasElement) => void; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) draw(ref.current)
  }, [draw])
  return <canvas ref={ref} style={{ imageRendering: 'pixelated', display: 'block', ...style }} />
}

/** A canvas holding RGBA pixels. */
export function rgbaCanvas(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  return canvas
}

export const canvasPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the image'))), 'image/png'))

/** Hands the viewer a file to save. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The checkerboard that shows transparency, `cell` pixels a square. */
export const checkerboard = (cell: number) => ({
  backgroundColor: '#2a2a2a',
  backgroundImage: 'conic-gradient(#333 25%, #2a2a2a 0 50%, #333 0 75%, #2a2a2a 0)',
  backgroundSize: `${cell * 2}px ${cell * 2}px`,
})
