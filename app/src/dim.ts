// Darkened copies of pictures for the map editor, made with the same rounding as the console's brightness effect.
import { dimRgba } from '@pecten-studio/core'

const copies = new WeakMap<HTMLImageElement, Map<number, HTMLCanvasElement>>()

/** The picture darkened by `level` (1 to 16), kept until the image object goes. */
export function dimmedCopy(image: HTMLImageElement, level: number): HTMLCanvasElement {
  const byLevel = copies.get(image) ?? new Map<number, HTMLCanvasElement>()
  copies.set(image, byLevel)
  const known = byLevel.get(level)
  if (known) return known
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  dimRgba(pixels.data, level)
  context.putImageData(pixels, 0, 0)
  byLevel.set(level, canvas)
  return canvas
}
