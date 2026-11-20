// Pixel art converter: turns any picture into a small GBA-ready image. Each step is its
// own function on plain RGBA so the studio, tests and tools can use them one by one:
// remove the background, pixelate, stroke the shapes, then fit a GBA palette.
import { fromBgr555, toBgr555 } from './gba.ts'

/** Straight RGBA, 4 bytes a pixel, rows top to bottom. */
export interface PixelImage {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** How the result is sized: kept to the picture's shape, a square, or padded out to whole 8 × 8 tiles. */
export type PixelCanvasMode = 'fit' | 'square' | 'tiles'
/** `sharp` keeps the most common colour of each cell, `smooth` averages it. */
export type PixelSampling = 'sharp' | 'smooth'
export type PixelDither = 'none' | 'ordered' | 'diffusion'

export interface PixelArtOptions {
  /** Longest side of the result in pixels. */
  size: number
  sampling: PixelSampling
  canvas: PixelCanvasMode
  /** Clears the colour that touches the picture's border (flood fill from the edges). */
  removeBackground: boolean
  /** 0–100: how far from the background colour a pixel may be and still be cleared. */
  tolerance: number

  /** Fits the colours to a GBA palette. */
  palette: boolean
  /** 4: one palette of 15 colours and transparent, as sprites and tiles use. 8: up to 255. */
  depth: 4 | 8
  colours: number
  dither: PixelDither

  /** Dark strokes around shapes. */
  outline: boolean
  /** Outside: on the transparent pixels next to the shape. Inside: on the shape's own edge pixels. */
  outlinePlacement: 'outside' | 'inside'
  /** Strokes touch diagonally as well, for a closed line around corners. */
  outlineCorners: boolean
  /** A darker shade of the colour next to the stroke, or `outlineColour` everywhere. */
  outlineAuto: boolean
  outlineColour: string
  /** 0–100: darkens the darker side of strong colour edges inside shapes. 0 is off. */
  inner: number
}

export const DEFAULT_PIXELART: PixelArtOptions = {
  size: 32,
  sampling: 'sharp',
  canvas: 'square',
  removeBackground: false,
  tolerance: 12,
  palette: true,
  depth: 4,
  colours: 15,
  dither: 'none',
  outline: false,
  outlinePlacement: 'outside',
  outlineCorners: false,
  outlineAuto: true,
  outlineColour: '#181020',
  inner: 0,
}

export const PIXELART_SIZES: readonly number[] = [16, 24, 32, 48, 64, 96, 128]

/** The largest a result may be: the GBA screen is 240 × 160, a background 512 × 512 at most. */
export const PIXELART_MAX_SIZE = 512

export interface PixelArtResult extends PixelImage {
  /** The distinct colours, `#rrggbb`, dark to light; transparent is not one of them. */
  palette: string[]
}

type Rgb = [number, number, number]

const blank = (width: number, height: number): PixelImage => ({ width, height, rgba: new Uint8ClampedArray(width * height * 4) })
const copy = (image: PixelImage): PixelImage => ({ width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.rgba) })
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const toHex = ([r, g, b]: Rgb) => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1]!, 16) : 0
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const onGrid = (r: number, g: number, b: number): Rgb => fromBgr555(toBgr555(r, g, b))

// ---------------------------------------------------------------------------------------
// Background

/**
 * Clears the background: the colour most of the four corners share, flood filled from the
 * border, so the same colour inside the shape stays. Pixels already transparent count as
 * background too.
 */
export function removeBackground(image: PixelImage, tolerance: number): PixelImage {
  const { width: w, height: h } = image
  const out = copy(image)
  const px = out.rgba
  if (!w || !h) return out
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].filter((i) => px[i * 4 + 3]! >= 128)
  if (!corners.length) return out
  // The corner colour that the most corners come close to.
  const near = (a: number, b: number, limit: number) =>
    Math.abs(px[a * 4]! - px[b * 4]!) <= limit && Math.abs(px[a * 4 + 1]! - px[b * 4 + 1]!) <= limit && Math.abs(px[a * 4 + 2]! - px[b * 4 + 2]!) <= limit
  const limit = Math.round(Math.max(0, Math.min(100, tolerance)) * 2.55)
  const key = corners.reduce((best, c) => (corners.filter((o) => near(c, o, limit)).length > corners.filter((o) => near(best, o, limit)).length ? c : best), corners[0]!)
  const [kr, kg, kb] = [px[key * 4]!, px[key * 4 + 1]!, px[key * 4 + 2]!]
  const isBackground = (i: number) =>
    px[i * 4 + 3]! < 128 || (Math.abs(px[i * 4]! - kr) <= limit && Math.abs(px[i * 4 + 1]! - kg) <= limit && Math.abs(px[i * 4 + 2]! - kb) <= limit)

  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let top = 0
  const push = (i: number) => {
    if (!seen[i] && isBackground(i)) {
      seen[i] = 1
      stack[top++] = i
    }
  }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (top) {
    const i = stack[--top]!
    px[i * 4 + 3] = 0
    const x = i % w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w)
    if (i < (h - 1) * w) push(i + w)
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Pixelate

/** The size a picture comes out at with its longest side at `size`, at least 1 × 1. */
export function fitSize(width: number, height: number, size: number): { width: number; height: number } {
  const scale = size / Math.max(1, width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Shrinks (or grows) the picture so its longest side is `size`. Each result pixel covers a
 * cell of the source; it is transparent when most of the cell is, and otherwise takes the
 * cell's most common colour (`sharp`, which keeps edges crisp) or its average (`smooth`).
 */
export function pixelate(image: PixelImage, size: number, sampling: PixelSampling = 'sharp'): PixelImage {
  const { width: sw, height: sh, rgba: src } = image
  const { width: w, height: h } = fitSize(sw, sh, size)
  const out = blank(w, h)
  const dst = out.rgba
  // Bins of 4 bits a channel for `sharp`: count and channel sums.
  const binCount = new Int32Array(4096)
  const binSum = new Float64Array(4096 * 3)
  const touched: number[] = []
  for (let oy = 0; oy < h; oy++) {
    const y0 = Math.floor((oy * sh) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * sh) / h))
    for (let ox = 0; ox < w; ox++) {
      const x0 = Math.floor((ox * sw) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * sw) / w))
      let opaque = 0
      let r = 0, g = 0, b = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4
          if (src[i + 3]! < 128) continue
          opaque++
          if (sampling === 'smooth') {
            r += src[i]!; g += src[i + 1]!; b += src[i + 2]!
          } else {
            const bin = ((src[i]! >> 4) << 8) | ((src[i + 1]! >> 4) << 4) | (src[i + 2]! >> 4)
            if (!binCount[bin]) touched.push(bin)
            binCount[bin]!++
            binSum[bin * 3]! += src[i]!
            binSum[bin * 3 + 1]! += src[i + 1]!
            binSum[bin * 3 + 2]! += src[i + 2]!
          }
        }
      }
      const o = (oy * w + ox) * 4
      if (opaque * 2 >= (x1 - x0) * (y1 - y0)) {
        if (sampling === 'smooth') {
          dst[o] = r / opaque; dst[o + 1] = g / opaque; dst[o + 2] = b / opaque
        } else {
          let best = touched[0]!
          for (const bin of touched) if (binCount[bin]! > binCount[best]!) best = bin
          const n = binCount[best]!
          dst[o] = binSum[best * 3]! / n; dst[o + 1] = binSum[best * 3 + 1]! / n; dst[o + 2] = binSum[best * 3 + 2]! / n
        }
        dst[o + 3] = 255
      }
      for (const bin of touched) {
        binCount[bin] = 0
        binSum[bin * 3] = binSum[bin * 3 + 1] = binSum[bin * 3 + 2] = 0
      }
      touched.length = 0
    }
  }
  return out
}

/** Centres the picture on a transparent canvas of the given size. */
export function padTo(image: PixelImage, width: number, height: number): PixelImage {
  if (width === image.width && height === image.height) return image
  const out = blank(width, height)
  const left = Math.floor((width - image.width) / 2)
  const top = Math.floor((height - image.height) / 2)
  for (let y = 0; y < image.height; y++) {
    const ty = y + top
    if (ty < 0 || ty >= height) continue
    for (let x = 0; x < image.width; x++) {
      const tx = x + left
      if (tx < 0 || tx >= width) continue
      const s = (y * image.width + x) * 4
      out.rgba.set(image.rgba.subarray(s, s + 4), (ty * width + tx) * 4)
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Strokes

export interface OutlineOptions {
  placement: 'outside' | 'inside'
  corners: boolean
  /** `#rrggbb`, or null for a darker shade of the colour next to each stroke pixel. */
  colour: string | null
  /** 0–100, see {@link PixelArtOptions.inner}. */
  inner: number
}

/** A dark, slightly cool shade of a colour, the way pixel artists shade outlines. */
export function darken([r, g, b]: Rgb, amount = 0.65): Rgb {
  const ink: Rgb = [16, 10, 28]
  return [r + (ink[0] - r) * amount, g + (ink[1] - g) * amount, b + (ink[2] - b) * amount].map(Math.round) as Rgb
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const AROUND = [...SIDES, [1, 1], [-1, 1], [1, -1], [-1, -1]] as const

/**
 * Draws dark strokes where shapes meet transparency, outside the shape or on its own edge,
 * and optionally inside along strong colour edges. Strokes are read from the picture as it
 * was, so they never stack.
 */
export function outline(image: PixelImage, options: OutlineOptions): PixelImage {
  const { width: w, height: h, rgba: src } = image
  const out = copy(image)
  const dst = out.rgba
  const fixed = options.colour ? parseHex(options.colour) : null
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3]! >= 128
  const rgbAt = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 4
    return [src[i]!, src[i + 1]!, src[i + 2]!]
  }
  const put = (x: number, y: number, rgb: Rgb) => {
    const i = (y * w + x) * 4
    dst[i] = rgb[0]; dst[i + 1] = rgb[1]; dst[i + 2] = rgb[2]; dst[i + 3] = 255
  }
  const near = options.corners ? AROUND : SIDES
  const stroked = new Uint8Array(w * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (options.placement === 'outside') {
        if (opaque(x, y)) continue
        // Next to the shape: take the darkest neighbour's colour as the base.
        let base: Rgb | null = null
        for (const [dx, dy] of near) {
          if (!opaque(x + dx, y + dy)) continue
          const c = rgbAt(x + dx, y + dy)
          if (!base || luma(...c) < luma(...base)) base = c
        }
        if (base) { put(x, y, fixed ?? darken(base)); stroked[y * w + x] = 1 }
      } else {
        if (!opaque(x, y)) continue
        // On the edge: a side (or corner) that is transparent inside the picture.
        const edge = near.some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy
          return nx >= 0 && ny >= 0 && nx < w && ny < h && !opaque(nx, ny)
        })
        if (edge) { put(x, y, fixed ?? darken(rgbAt(x, y))); stroked[y * w + x] = 1 }
      }
    }
  }

  if (options.inner > 0) {
    // The darker pixel of a strong edge gets the line; the higher `inner`, the weaker the edges that count.
    const threshold = 24 + (100 - Math.min(100, options.inner)) * 1.6
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!opaque(x, y) || stroked[y * w + x]) continue
        const c = rgbAt(x, y)
        const l = luma(...c)
        const line = SIDES.some(([dx, dy]) => {
          if (!opaque(x + dx, y + dy)) return false
          const n = rgbAt(x + dx, y + dy)
          const distance = Math.hypot(n[0] - c[0], n[1] - c[1], n[2] - c[2])
          return distance > threshold && luma(...n) > l
        })
        if (line) put(x, y, fixed ?? darken(c, 0.45))
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Palette

export interface QuantizeOptions {
  /** Most colours in the result, transparent not counted. */
  colours: number
  dither: PixelDither
  /** `#rrggbb` colours that must be in the palette as they are, such as a stroke colour. */
  required?: string[]
}

// Channel weights for colour distance: the eye is most sensitive to green.
const WR = 2, WG = 4, WB = 3
const distance = (a: Rgb, r: number, g: number, b: number) => WR * (a[0] - r) ** 2 + WG * (a[1] - g) ** 2 + WB * (a[2] - b) ** 2

interface Swatch { rgb: Rgb; count: number }

/** Median cut over weighted colours, then a few rounds of k-means to settle the centres. */
function buildPalette(swatches: Swatch[], n: number): Rgb[] {
  if (n <= 0 || !swatches.length) return []
  if (swatches.length <= n) return swatches.map((s) => s.rgb)
  let boxes: Swatch[][] = [swatches]
  while (boxes.length < n) {
    // Split the box with the most spread, weighted by how many pixels it holds.
    let pick = -1, pickScore = -1, pickChannel = 0
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      let total = 0
      const ranges = [0, 1, 2].map((c) => {
        let lo = 255, hi = 0
        for (const s of box) { lo = Math.min(lo, s.rgb[c]!); hi = Math.max(hi, s.rgb[c]!) }
        return hi - lo
      })
      for (const s of box) total += s.count
      const channel = ranges.indexOf(Math.max(...ranges))
      const score = ranges[channel]! * Math.sqrt(total)
      if (score > pickScore) { pick = i; pickScore = score; pickChannel = channel }
    })
    if (pick < 0) break
    const box = boxes[pick]!.slice().sort((a, b) => a.rgb[pickChannel]! - b.rgb[pickChannel]!)
    const half = box.reduce((t, s) => t + s.count, 0) / 2
    let acc = 0, cut = 1
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i]!.count
      if (acc >= half) { cut = i + 1; break }
      cut = i + 1
    }
    boxes = [...boxes.slice(0, pick), box.slice(0, cut), box.slice(cut), ...boxes.slice(pick + 1)]
  }
  let centres = boxes.map((box) => {
    let r = 0, g = 0, b = 0, t = 0
    for (const s of box) { r += s.rgb[0] * s.count; g += s.rgb[1] * s.count; b += s.rgb[2] * s.count; t += s.count }
    return [r / t, g / t, b / t] as Rgb
  })
  for (let round = 0; round < 6; round++) {
    const sums = centres.map(() => [0, 0, 0, 0])
    for (const s of swatches) {
      let best = 0, bestD = Infinity
      centres.forEach((c, i) => {
        const d = distance(c, ...s.rgb)
        if (d < bestD) { bestD = d; best = i }
      })
      const sum = sums[best]!
      sum[0]! += s.rgb[0] * s.count; sum[1]! += s.rgb[1] * s.count; sum[2]! += s.rgb[2] * s.count; sum[3]! += s.count
    }
    centres = centres.map((c, i) => (sums[i]![3] ? [sums[i]![0]! / sums[i]![3]!, sums[i]![1]! / sums[i]![3]!, sums[i]![2]! / sums[i]![3]!] as Rgb : c))
  }
  return centres
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * Fits the picture to at most `colours` GBA colours (5 bits a channel) plus transparent.
 * Pixels are either fully opaque or fully transparent afterwards, as the GBA draws them.
 */
export function quantize(image: PixelImage, options: QuantizeOptions): PixelArtResult {
  const { width: w, height: h, rgba: src } = image
  const required = [...new Set((options.required ?? []).map((hex) => toBgr555(...parseHex(hex))))].map((word) => fromBgr555(word))
  const requiredWords = new Set(required.map((c) => toBgr555(...c)))
  // Every distinct GBA colour and how often it appears, leaving out the required ones.
  const counts = new Map<number, number>()
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3]! < 128) continue
    const word = toBgr555(src[i]!, src[i + 1]!, src[i + 2]!)
    if (!requiredWords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  const n = Math.max(1, Math.min(255, Math.round(options.colours)))
  const swatches = [...counts].map(([word, count]) => ({ rgb: fromBgr555(word), count }))
  const free = Math.max(0, n - required.length)
  const words = new Set<number>(required.map((c) => toBgr555(...c)))
  for (const c of buildPalette(swatches, free)) words.add(toBgr555(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])))
  const palette = [...words].map((word) => fromBgr555(word))
  if (!palette.length) palette.push([0, 0, 0])

  const nearestCache = new Map<number, number>()
  const nearest = (r: number, g: number, b: number): number => {
    const key = toBgr555(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)))
    const hit = nearestCache.get(key)
    if (hit !== undefined) return hit
    const [qr, qg, qb] = fromBgr555(key)
    let best = 0, bestD = Infinity
    palette.forEach((c, i) => {
      const d = distance(c, qr, qg, qb)
      if (d < bestD) { bestD = d; best = i }
    })
    nearestCache.set(key, best)
    return best
  }

  const out = blank(w, h)
  const dst = out.rgba
  // Error carried forward for diffusion: this row and the next.
  const errors = options.dither === 'diffusion' ? [new Float32Array((w + 2) * 3), new Float32Array((w + 2) * 3)] : null
  // How far ordered dithering nudges a pixel: about half the gap between palette colours.
  const spread = options.dither === 'ordered' ? Math.min(48, 160 / Math.cbrt(palette.length)) : 0
  for (let y = 0; y < h; y++) {
    if (errors) { errors[0]!.set(errors[1]!); errors[1]!.fill(0) }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (src[i + 3]! < 128) continue
      let r = src[i]!, g = src[i + 1]!, b = src[i + 2]!
      const word = toBgr555(r, g, b)
      let index: number
      if (requiredWords.has(word)) {
        index = palette.findIndex((c) => toBgr555(...c) === word)
      } else {
        if (errors) {
          const e = errors[0]!, k = (x + 1) * 3
          r += e[k]!; g += e[k + 1]!; b += e[k + 2]!
        } else if (spread) {
          const t = (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.47) * spread
          r += t; g += t; b += t
        }
        index = nearest(r, g, b)
        if (errors) {
          const c = palette[index]!
          const er = r - c[0], eg = g - c[1], eb = b - c[2]
          const spreadTo = (row: Float32Array, at: number, f: number) => {
            const k = (at + 1) * 3
            row[k]! += er * f; row[k + 1]! += eg * f; row[k + 2]! += eb * f
          }
          spreadTo(errors[0]!, x + 1, 7 / 16)
          spreadTo(errors[1]!, x - 1, 3 / 16)
          spreadTo(errors[1]!, x, 5 / 16)
          spreadTo(errors[1]!, x + 1, 1 / 16)
        }
      }
      const c = palette[index]!
      dst[i] = c[0]; dst[i + 1] = c[1]; dst[i + 2] = c[2]; dst[i + 3] = 255
    }
  }
  return { ...out, palette: paletteOf(out) }
}

/** The distinct colours of a picture, `#rrggbb`, dark to light. */
export function paletteOf(image: PixelImage): string[] {
  const seen = new Map<number, Rgb>()
  const px = image.rgba
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 128) continue
    const key = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!
    if (!seen.has(key)) seen.set(key, [px[i]!, px[i + 1]!, px[i + 2]!])
  }
  return [...seen.values()].sort((a, b) => luma(...a) - luma(...b)).map(toHex)
}

/** Snaps every opaque pixel to the GBA's colours and makes alpha all or nothing. */
export function snapToGba(image: PixelImage): PixelImage {
  const out = copy(image)
  const px = out.rgba
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 128) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue }
    const [r, g, b] = onGrid(px[i]!, px[i + 1]!, px[i + 2]!)
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
  }
  return out
}

// ---------------------------------------------------------------------------------------
// The whole conversion

/** The result's size for these options, before the picture is drawn into it. */
export function pixelArtSize(width: number, height: number, options: Pick<PixelArtOptions, 'size' | 'canvas'>): { width: number; height: number } {
  const size = Math.max(1, Math.min(PIXELART_MAX_SIZE, Math.round(options.size)))
  if (options.canvas === 'square') return { width: size, height: size }
  const fit = fitSize(width, height, size)
  if (options.canvas === 'tiles') return { width: Math.ceil(fit.width / 8) * 8, height: Math.ceil(fit.height / 8) * 8 }
  return fit
}

/** Background, pixelate, strokes, palette: the converter's whole pipeline. */
export function convertPixelArt(source: PixelImage, options: PixelArtOptions): PixelArtResult {
  const cleared = options.removeBackground ? removeBackground(source, options.tolerance) : source
  const size = Math.max(1, Math.min(PIXELART_MAX_SIZE, Math.round(options.size)))
  const canvas = pixelArtSize(source.width, source.height, options)
  // An outside stroke needs a pixel of room on every side, inside the chosen size.
  const room = options.outline && options.outlinePlacement === 'outside' && size > 4 ? 2 : 0
  let image = pixelate(cleared, size - room, options.sampling)
  image = padTo(image, Math.max(canvas.width, image.width + room), Math.max(canvas.height, image.height + room))
  if (options.outline) {
    image = outline(image, {
      placement: options.outlinePlacement,
      corners: options.outlineCorners,
      colour: options.outlineAuto ? null : options.outlineColour,
      inner: options.inner,
    })
  }
  if (options.palette) {
    const max = options.depth === 4 ? 15 : 255
    return quantize(image, {
      colours: Math.min(max, options.colours),
      dither: options.dither,
      required: options.outline && !options.outlineAuto ? [options.outlineColour] : [],
    })
  }
  const snapped = snapToGba(image)
  return { ...snapped, palette: paletteOf(snapped) }
}
