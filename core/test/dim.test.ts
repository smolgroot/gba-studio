import { describe, expect, it } from 'vitest'
import { Room, dimBgr555, dimFlags, dimRgba, dimmedLayers, validateProject, MAX_DIM } from '../src/index.ts'
import { fromBgr555, toBgr555 } from '../src/index.ts'

const room = (extra: object = {}) =>
  Room.parse({ version: 1, name: 'R', width: 1, height: 1, tileset: 't', layers: [{ name: 'a', data: [600, 0] }, { name: 'b', data: [600, 0] }], ...extra })

describe('dim schema', () => {
  it('loads a room from before dimming unchanged, with nothing dimmed', () => {
    const r = room()
    expect(r.dimLevel).toBeUndefined()
    expect(r.layers.every((l) => l.dim === undefined)).toBe(true)
    expect(dimmedLayers(r)).toEqual({ tiles: [false, false], backgrounds: [] })
  })
  it('accepts levels 0 to 16 and rejects others', () => {
    for (const dimLevel of [0, 1, 16]) expect(() => room({ dimLevel })).not.toThrow()
    for (const dimLevel of [-1, 17, 1.5]) expect(() => room({ dimLevel })).toThrow()
    expect(MAX_DIM).toBe(16)
  })
  it('keeps dim on layers and backgrounds', () => {
    const r = room({ layers: [{ name: 'a', data: [600, 0], dim: true }, { name: 'b', data: [600, 0] }], backgrounds: [{ image: 'assets/a.png', parallax: { x: 0, y: 0 }, dim: true }], dimLevel: 8 })
    expect(dimmedLayers(r)).toEqual({ tiles: [true, false], backgrounds: [true] })
  })
})

describe('dim preview rounding', () => {
  it('level 0 changes nothing and 16 is black', () => {
    expect(dimBgr555(0x7fff, 0)).toBe(0x7fff)
    expect(dimBgr555(0x7fff, 16)).toBe(0)
  })
  it('darkens RGBA pixels on the GBA colour grid, keeping alpha', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 10, 20, 30, 0])
    dimRgba(px, 8)
    const [r, g, b] = fromBgr555(dimBgr555(toBgr555(255, 255, 255), 8))
    expect([...px.slice(0, 4)]).toEqual([r, g, b, 255])
    expect(px[7]).toBe(0)
  })
})

describe('dim flags', () => {
  it('packs layers, backgrounds and level into the room flag bits', () => {
    const r = room({ layers: [{ name: 'a', data: [600, 0], dim: true }, { name: 'b', data: [600, 0] }, { name: 'c', data: [600, 0], dim: true }], dimLevel: 12 })
    expect(dimFlags(r)).toBe((0b101 << 2) | (12 << 8))
    const withBg = room({ backgrounds: [{ image: 'assets/a.png', parallax: { x: 0, y: 0 } }, { image: 'assets/b.png', parallax: { x: 0, y: 0 }, dim: true }], dimLevel: 16 })
    expect(dimFlags(withBg)).toBe((0b10 << 5) | (16 << 8))
  })
})

describe('dim problems', () => {
  const messages = (r: ReturnType<typeof room>) => validateProject({ tilesets: {}, sprites: {}, rooms: { r } }, () => true).map((p) => p.message)
  it('says a level with no dimmed layer does nothing', () => {
    expect(messages(room({ dimLevel: 8 }))).toContain('no layer is dimmed, so the dim level 8 does nothing: turn dim on for a layer or set the level to 0')
  })
  it('says a dimmed layer with level 0 does nothing', () => {
    const r = room({ layers: [{ name: 'Sky', data: [600, 0], dim: true }] })
    expect(messages(r)).toContain('layer "Sky" is set to dim, but the dim level is 0, so nothing is darkened: raise the level or turn dim off')
  })
  it('is quiet when they agree', () => {
    const r = room({ layers: [{ name: 'Sky', data: [600, 0], dim: true }], dimLevel: 4 })
    expect(messages(r).filter((m) => /dim/.test(m))).toEqual([])
  })
})
