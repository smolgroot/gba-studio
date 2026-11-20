import { describe, expect, it } from 'vitest'
import { DEFAULT_PIXELART, convertPixelArt, countColours, outline, pixelArtSize, pixelate, quantize, removeBackground, toBgr555 } from '../src/index.ts'
import type { PixelImage } from '../src/index.ts'

/** A picture filled by `at(x, y)`, which gives RGBA. */
function picture(width: number, height: number, at: (x: number, y: number) => [number, number, number, number]): PixelImage {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(at(x, y), (y * width + x) * 4)
  return { width, height, rgba }
}
const pixel = (image: PixelImage, x: number, y: number) => Array.from(image.rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4))

/** A smooth shaded ball on a white background: many colours, soft edges. */
const ball = picture(200, 160, (x, y) => {
  const d = Math.hypot(x - 100, y - 80)
  if (d > 60) return [255, 255, 255, 255]
  const shade = 1 - d / 90
  return [Math.round(220 * shade + 20), Math.round(80 * shade + x / 4), Math.round(40 + y / 3), 255]
})

describe('pixel art converter', () => {
  it('pixelates to the longest side, keeping the shape', () => {
    const small = pixelate(ball, 32)
    expect([small.width, small.height]).toEqual([32, 26])
    // The middle is the ball, the corner the white background.
    expect(pixel(small, 16, 13)[0]).toBeGreaterThan(150)
    expect(pixel(small, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('sharp sampling keeps a colour of the cell, smooth averages it', () => {
    const stripes = picture(4, 4, (x) => (x % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]))
    const sharp = pixel(pixelate(stripes, 1, 'sharp'), 0, 0)
    expect([[255, 0, 0, 255], [0, 0, 255, 255]]).toContainEqual(sharp)
    expect(pixel(pixelate(stripes, 1, 'smooth'), 0, 0)).toEqual([128, 0, 128, 255])
  })

  it('a cell that is mostly transparent stays transparent', () => {
    const corner = picture(4, 4, (x, y) => (x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    expect(pixel(pixelate(corner, 1), 0, 0)[3]).toBe(0)
  })

  it('removes the background from the border, not the same colour inside', () => {
    // White around a black ring with white inside it.
    const ring = picture(9, 9, (x, y) => {
      const d = Math.max(Math.abs(x - 4), Math.abs(y - 4))
      return d === 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    })
    const out = removeBackground(ring, 5)
    expect(pixel(out, 0, 0)[3]).toBe(0)
    expect(pixel(out, 4, 4)).toEqual([255, 255, 255, 255])
    expect(pixel(out, 2, 2)[3]).toBe(255)
  })

  it('strokes outside or inside the shape', () => {
    const dot = picture(5, 5, (x, y) => (x === 2 && y === 2 ? [200, 100, 50, 255] : [0, 0, 0, 0]))
    const outside = outline(dot, { placement: 'outside', corners: false, colour: '#000000', inner: 0 })
    expect(pixel(outside, 2, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(outside, 1, 1)[3]).toBe(0)
    expect(pixel(outside, 2, 2)).toEqual([200, 100, 50, 255])
    const corners = outline(dot, { placement: 'outside', corners: true, colour: null, inner: 0 })
    expect(pixel(corners, 1, 1)[3]).toBe(255)
    // An automatic stroke is a darker shade of the shape.
    expect(pixel(corners, 1, 1)[0]).toBeLessThan(200)

    const block = picture(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? [200, 200, 200, 255] : [0, 0, 0, 0]))
    const inside = outline(block, { placement: 'inside', corners: false, colour: '#102030', inner: 0 })
    expect(pixel(inside, 1, 1)).toEqual([16, 32, 48, 255])
    expect(pixel(inside, 2, 2)).toEqual([200, 200, 200, 255])
    expect(pixel(inside, 0, 0)[3]).toBe(0)
  })

  it('fits the colours to a GBA palette of the size asked for', () => {
    for (const colours of [2, 4, 15]) {
      for (const dither of ['none', 'ordered', 'diffusion'] as const) {
        const out = quantize(ball, { colours, dither })
        expect(out.palette.length).toBeLessThanOrEqual(colours)
        expect(countColours(out.rgba)).toBe(out.palette.length)
        // Every colour sits on the GBA's 5-bit grid.
        for (let i = 0; i < out.rgba.length; i += 4) {
          const [r, g, b] = [out.rgba[i]!, out.rgba[i + 1]!, out.rgba[i + 2]!]
          const word = toBgr555(r, g, b)
          expect([r, g, b]).toEqual([(word & 31) << 3 | (word & 31) >> 2, ((word >> 5) & 31) << 3 | ((word >> 5) & 31) >> 2, ((word >> 10) & 31) << 3 | ((word >> 10) & 31) >> 2])
        }
      }
    }
  })

  it('keeps a required colour exactly', () => {
    const withStroke = outline(removeBackground(pixelate(ball, 40), 10), { placement: 'outside', corners: false, colour: '#181020', inner: 0 })
    const out = quantize(withStroke, { colours: 4, dither: 'none', required: ['#181020'] })
    expect(out.palette).toContain('#181021')
    expect(out.palette.length).toBeLessThanOrEqual(4)
  })

  it('converts in one go to a GBA-ready image', () => {
    const out = convertPixelArt(ball, { ...DEFAULT_PIXELART, size: 32, canvas: 'square', removeBackground: true, outline: true })
    expect([out.width, out.height]).toEqual([32, 32])
    expect(out.palette.length).toBeLessThanOrEqual(15)
    // The stroke fits inside the canvas: the border column stays clear.
    for (let y = 0; y < 32; y++) expect(pixel(out, 0, y)[3]).toBe(0)
    // Alpha is all or nothing.
    for (let i = 3; i < out.rgba.length; i += 4) expect([0, 255]).toContain(out.rgba[i])
  })

  it('sizes the canvas to fit, a square, or whole tiles', () => {
    expect(pixelArtSize(200, 160, { size: 30, canvas: 'fit' })).toEqual({ width: 30, height: 24 })
    expect(pixelArtSize(200, 160, { size: 30, canvas: 'square' })).toEqual({ width: 30, height: 30 })
    expect(pixelArtSize(200, 160, { size: 30, canvas: 'tiles' })).toEqual({ width: 32, height: 24 })
  })
})
