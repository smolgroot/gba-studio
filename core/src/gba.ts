// Colour maths of the hardware: 15-bit BGR, 5 bits a channel.

/** `#rrggbb` or 8-bit channels to the GBA's BGR555 word. */
export function toBgr555(r: number, g: number, b: number): number {
  return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)
}

/** A BGR555 word back to 8-bit channels, the way the screen shows it (5 bits spread over 8). */
export function fromBgr555(word: number): [number, number, number] {
  const spread = (c: number) => (c << 3) | (c >> 2)
  return [spread(word & 31), spread((word >> 5) & 31), spread((word >> 10) & 31)]
}

/** The distinct GBA colours of RGBA pixels; transparent pixels (alpha under 128) are not counted. */
export function countColours(rgba: Uint8ClampedArray | Uint8Array): number {
  const seen = new Set<number>()
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! >= 128) seen.add(toBgr555(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!))
  }
  return seen.size
}
