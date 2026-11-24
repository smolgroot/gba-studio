// The level data section of a built ROM (docs/reference/data-section.md): reading it,
// and writing a new one from the project so a ROM can be patched without a build.
//
// This is a port of what the build helper does in codegen/src/lib.rs, with the byte
// layout of runtime/src/data/layout.rs and the writer of runtime/src/data/write.rs.
// The two must give the same bytes: core/test/datasection.test.ts checks this one
// against codegen/fixture/expected/studio_data.bin, which codegen's tests check too.
import { behaviourPositions, behaviourValues } from './behaviours.ts'
import { dimFlags } from './dim.ts'
import { rleDecode, rleLength } from './rle.ts'
import { roomSize } from './room.ts'
import type { Documents } from './validate.ts'

const MAGIC = [0x50, 0x45, 0x43, 0x54, 0x44, 0x41, 0x54, 0x41] // "PECTDATA"
export const SECTION_VERSION = 1
const HEADER = 20
const SECTIONS = 9
/** A section from before behaviours had theirs has 8, and is read as having none. */
const MIN_SECTIONS = 8
const [S_STRINGS, S_CLASSES, S_ROOMS, S_ENTITIES, S_PROPS, S_CELLS, S_GLOBALS, S_MANIFEST, S_BEHAVIOURS] = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const
const CLASS = 12
const ROOM = 64
const ENTITY = 12
const PROP = 20
/** A screen in pixels: rooms are placed on the world map by screens. */
const [SCREEN_W, SCREEN_H] = [240, 160]
const NO_ROOM = 0xffff
const KINDS: Record<string, number> = { empty: 0, solid: 1, oneway: 2, slope: 3, hazard: 4, custom: 5 }

/** What a picture or tileset cost when the game was built. */
export interface Art {
  /** A tileset's id, or a picture's file path. */
  id: string
  tiles: number
  palettes: number
}

/** What the game compiled from the project, as the ROM's section records it. */
export interface Manifest {
  entityTypes: { id: string; sprite: string | null }[]
  tilesets: Art[]
  pictures: Art[]
  tracks: string[]
  /** How many entities the game keeps live at most; null for a ROM built before this was recorded. */
  liveEntities?: number | null
}

/** A data section found in a ROM. */
export interface Section {
  /** Where it starts in the ROM. */
  start: number
  version: number
  used: number
  capacity: number
  manifest: Manifest
  /** Collision class and room ids, in order: they are code in the game too. */
  classes: string[]
  rooms: string[]
}

const padded = (n: number) => (n + 3) & ~3

/** UTF-8, here because core runs where `TextEncoder` may not be declared. */
function utf8(text: string): number[] {
  const out: number[] = []
  for (const char of text) {
    const c = char.codePointAt(0)!
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

function fromUtf8(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!
    const extra = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0
    let c = extra ? b & (0x3f >> extra) : b
    for (let k = 1; k <= extra; k++) c = (c << 6) | (bytes[i + k]! & 63)
    text += String.fromCodePoint(c)
    i += extra + 1
  }
  return text
}

/** Finds and reads the data section of a ROM; null if it has none. */
export function readSection(rom: Uint8Array): Section | null {
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength)
  let start = -1
  for (let at = 0; at + HEADER <= rom.length; at += 4) {
    if (MAGIC.every((byte, i) => rom[at + i] === byte)) {
      start = at
      break
    }
  }
  if (start < 0) return null
  const u16 = (at: number) => view.getUint16(start + at, true)
  const u32 = (at: number) => view.getUint32(start + at, true)
  const version = u16(8)
  const used = u32(12)
  const capacity = u32(16)
  const empty: Manifest = { entityTypes: [], tilesets: [], pictures: [], tracks: [] }
  if (version !== SECTION_VERSION || u16(10) < MIN_SECTIONS || start + capacity > rom.length) return { start, version, used, capacity, manifest: empty, classes: [], rooms: [] }
  const part = (n: number) => u32(HEADER + n * 8)
  const strings = part(S_STRINGS)
  const str = (at: number) => fromUtf8(rom.subarray(start + strings + u32(at), start + strings + u32(at) + u32(at + 4)))
  const records = (n: number, size: number) => Array.from({ length: u32(HEADER + n * 8 + 4) / size }, (_, i) => part(n) + i * size)

  let at = part(S_MANIFEST)
  const [types, tilesets, pictures, tracks] = [u32(at), u32(at + 4), u32(at + 8), u32(at + 12)]
  at += 16
  const take = <T>(count: number, size: number, read: (at: number) => T) =>
    Array.from({ length: count }, () => {
      const value = read(at)
      at += size
      return value
    })
  const art = (a: number): Art => ({ id: str(a), tiles: u32(a + 8), palettes: u32(a + 12) })
  const manifest: Manifest = {
    entityTypes: take(types, 16, (a) => ({ id: str(a), sprite: str(a + 8) || null })),
    tilesets: take(tilesets, 16, art),
    pictures: take(pictures, 16, art),
    tracks: take(tracks, 8, str),
    // Recorded after the tracks since US-013: an older manifest ends there.
    liveEntities: at + 4 <= part(S_MANIFEST) + u32(HEADER + S_MANIFEST * 8 + 4) ? u32(at) : null,
  }
  return { start, version, used, capacity, manifest, classes: records(S_CLASSES, CLASS).map(str), rooms: records(S_ROOMS, ROOM).map(str) }
}

/** A room of a section: where it is on the world map, in world pixels. */
export interface PlacedRoom {
  id: string
  /** Rooms not on the map have no place; `left` and `top` are then 0. */
  onMap: boolean
  left: number
  top: number
  width: number
  height: number
}

/** A placed entity's property, as the game was given it. */
export interface PlacedProperty {
  name: string
  value: number | boolean | string
}

/**
 * The rooms of a section with their places on the world map, and each entity's
 * properties, numbered as the game numbers them: what a tool reading a running game
 * needs to name what it finds. Empty for a section this studio cannot read.
 */
export function readPlacements(rom: Uint8Array, section: Section): { rooms: PlacedRoom[]; entities: { properties: PlacedProperty[] }[] } {
  if (section.version !== SECTION_VERSION) return { rooms: [], entities: [] }
  const view = new DataView(rom.buffer, rom.byteOffset + section.start, section.capacity)
  const u32 = (at: number) => view.getUint32(at, true)
  const part = (n: number) => ({ at: u32(HEADER + n * 8), length: u32(HEADER + n * 8 + 4) })
  const strings = part(S_STRINGS).at
  const bytesOf = (at: number) => rom.subarray(section.start + strings + u32(at), section.start + strings + u32(at) + u32(at + 4))
  const rooms: PlacedRoom[] = []
  const roomPart = part(S_ROOMS)
  for (let at = roomPart.at; at < roomPart.at + roomPart.length; at += ROOM) {
    const onMap = (view.getUint16(at + 24, true) & 1) !== 0
    rooms.push({
      id: fromUtf8(bytesOf(at)),
      onMap,
      left: onMap ? view.getInt16(at + 20, true) * SCREEN_W : 0,
      top: onMap ? view.getInt16(at + 22, true) * SCREEN_H : 0,
      width: view.getUint16(at + 16, true) * 8,
      height: view.getUint16(at + 18, true) * 8,
    })
  }
  const props = part(S_PROPS).at
  const entityPart = part(S_ENTITIES)
  const entities = Array.from({ length: entityPart.length / ENTITY }, (_, n) => {
    const at = entityPart.at + n * ENTITY
    const properties = Array.from({ length: view.getUint16(at + 6, true) }, (_, p): PlacedProperty => {
      const prop = props + (u32(at + 8) + p) * PROP
      const type = view.getUint8(prop + 8)
      const value = type === 2 ? fromUtf8(bytesOf(prop + 12)) : type === 1 ? view.getInt32(prop + 12, true) !== 0 : view.getInt32(prop + 12, true)
      return { name: fromUtf8(bytesOf(prop)), value }
    })
    return { properties }
  })
  return { rooms, entities }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Room ids in the order the game numbers them: by id, as codegen sorts them. */
const sortedIds = (record: Record<string, unknown>) => Object.keys(record).sort()

/** The background pictures in the order the game numbers them. */
function pictureList(docs: Documents): string[] {
  return [...new Set(Object.values(docs.rooms).flatMap((room) => (room.backgrounds ?? []).map((b) => b.image)))].sort()
}

/**
 * Why the project no longer matches what the ROM's game was compiled with, in the
 * project's terms; empty if a new section can be patched in. `tileCounts` is how many
 * tiles each tileset's image holds now.
 */
export function needsBuild(docs: Documents, section: Section, tileCounts: Record<string, number>): string[] {
  if (section.version !== SECTION_VERSION) return [`the ROM's level data is version ${section.version}; this studio writes version ${SECTION_VERSION}`]
  const reasons: string[] = []
  const compiled = section.manifest
  const changed = (what: string, before: readonly string[], now: readonly string[]) => {
    if (sameList(before, now)) return
    const added = now.filter((id) => !before.includes(id))
    const removed = before.filter((id) => !now.includes(id))
    if (added.length) reasons.push(`${what} ${added.map((id) => `"${id}"`).join(', ')} ${added.length > 1 ? 'are' : 'is'} new`)
    if (removed.length) reasons.push(`${what} ${removed.map((id) => `"${id}"`).join(', ')} ${removed.length > 1 ? 'were' : 'was'} removed`)
    if (!added.length && !removed.length) reasons.push(`the ${what}s are in another order`)
  }
  const types = docs.project?.entityTypes ?? []
  changed('entity type', compiled.entityTypes.map((t) => t.id), types.map((t) => t.id))
  for (const type of types) {
    const before = compiled.entityTypes.find((t) => t.id === type.id)
    if (before && before.sprite !== (type.sprite ?? null)) reasons.push(`entity type "${type.id}" has another sprite`)
  }
  changed('collision class', section.classes, (docs.project?.collisionClasses ?? []).map((c) => c.id))
  changed('room', section.rooms, sortedIds(docs.rooms))
  changed('tileset', compiled.tilesets.map((t) => t.id), sortedIds(docs.tilesets))
  for (const tileset of compiled.tilesets) {
    const now = tileCounts[tileset.id]
    if (now !== undefined && now !== tileset.tiles) reasons.push(`tileset "${tileset.id}" now has ${now} tiles, the game has ${tileset.tiles}`)
  }
  changed('background picture', compiled.pictures.map((p) => p.id), pictureList(docs))
  changed('music track', compiled.tracks, (docs.audio?.tracks ?? []).map((t) => t.id))
  // The game's table of live entities is sized at its build (data::LIVE_ENTITIES).
  const entities = Object.values(docs.rooms).reduce((count, room) => count + room.entities.length, 0)
  if (compiled.liveEntities != null && entities > compiled.liveEntities) reasons.push(`the game has room for ${compiled.liveEntities} entities; the project now has ${entities}`)
  return reasons
}

/** Strings, each kept once, at the offset of its first use, as the Rust writer does. */
class Strings {
  bytes: number[] = []
  private seen = new Map<string, number>()
  put(out: Bytes, text: string): void {
    const encoded = utf8(text)
    let offset = this.seen.get(text)
    if (offset === undefined) {
      offset = this.bytes.length
      this.seen.set(text, offset)
      for (const byte of encoded) this.bytes.push(byte)
    }
    out.u32(offset)
    out.u32(encoded.length)
  }
}

class Bytes {
  bytes: number[] = []
  u8(...values: number[]) {
    for (const v of values) this.bytes.push(v & 0xff)
  }
  u16(...values: number[]) {
    for (const v of values) this.bytes.push(v & 0xff, (v >>> 8) & 0xff)
  }
  u32(...values: number[]) {
    for (const v of values) this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
  }
  /** Many values at once: rooms have too many cells to pass as arguments. */
  u8s(values: ArrayLike<number>) {
    for (let i = 0; i < values.length; i++) this.bytes.push(values[i]! & 0xff)
  }
  u16s(values: ArrayLike<number>) {
    for (let i = 0; i < values.length; i++) this.bytes.push(values[i]! & 0xff, (values[i]! >>> 8) & 0xff)
  }
  pad() {
    while (this.bytes.length % 4) this.bytes.push(0)
  }
}

const SCREEN_LAYERS = 4
const PALETTES = 16
const MAX_TILES = 1024

/**
 * Writes the project's data section, `capacity` bytes long, with the compiled half
 * taken from `compiled` (what the ROM's game was built with). Gives the problems
 * that would fail a build instead, in codegen's words, or says the data no longer fits.
 */
export function writeSection(docs: Documents, compiled: Manifest, capacity: number): { bytes: Uint8Array; used: number } | { problems: string[]; tooBig?: true } {
  const project = docs.project
  if (!project) return { problems: ['studio/project.json is missing'] }
  const problems: string[] = []
  const classes = project.collisionClasses
  const types = project.entityTypes
  const roomIds = sortedIds(docs.rooms)
  const tilesetIds = sortedIds(docs.tilesets)
  const pictures = pictureList(docs)
  const tilesetArt = (index: number) => compiled.tilesets.find((t) => t.id === tilesetIds[index])

  // Each tile's collision class, for each tileset.
  const tileClasses = tilesetIds.map((id) => {
    const count = tilesetArt(tilesetIds.indexOf(id))?.tiles ?? 0
    const byTile = new Array<number>(count).fill(0)
    for (const [tile, cls] of Object.entries(docs.tilesets[id]!.collision)) {
      const index = classes.findIndex((c) => c.id === cls)
      if (Number(tile) < count && index >= 0) byTile[Number(tile)] = index
    }
    return byTile
  })

  const strings = new Strings()
  const parts = Array.from({ length: SECTIONS }, () => new Bytes())
  for (const c of classes) {
    strings.put(parts[S_CLASSES]!, c.id)
    parts[S_CLASSES]!.u8(KINDS[c.kind] ?? 0, c.slope?.left ?? 0, c.slope?.right ?? 0, 0)
  }

  const usedTiles = tilesetIds.map(() => new Set<number>())
  const mostLayers = tilesetIds.map(() => 0)
  let entityCount = 0
  let propCount = 0
  for (const id of roomIds) {
    const room = docs.rooms[id]!
    const file = `studio/rooms/${id}.json`
    const { cols, rows } = roomSize(room)
    const cells = cols * rows
    const tileset = tilesetIds.indexOf(room.tileset)
    if (tileset < 0) {
      problems.push(`${file}: unknown tileset "${room.tileset}"`)
      continue
    }
    const tileCount = tilesetArt(tileset)?.tiles ?? 0
    const layers: Uint16Array[] = []
    for (const layer of room.layers) {
      if (rleLength(layer.data) !== cells) {
        problems.push(`${file}: layer "${layer.name}" does not hold ${cells} cells`)
        continue
      }
      const decoded = rleDecode(layer.data)
      const bad = decoded.find((cell) => cell > tileCount)
      if (bad !== undefined) problems.push(`${file}: layer "${layer.name}" uses tile ${bad - 1}, which tileset "${room.tileset}" does not have`)
      layers.push(decoded)
    }
    let overrides: Uint16Array = new Uint16Array(cells)
    if (room.collision) {
      if (rleLength(room.collision) === cells) overrides = rleDecode(room.collision)
      else problems.push(`${file}: collision does not hold ${cells} cells`)
    }
    if (layers.length !== room.layers.length) continue
    for (const layer of layers) for (const cell of layer) if (cell > 0) usedTiles[tileset]!.add(cell)
    mostLayers[tileset] = Math.max(mostLayers[tileset]!, layers.length)

    const collision = new Uint8Array(cells)
    const classOf = (tile: number) => tileClasses[tileset]![tile - 1] ?? 0
    for (let i = 0; i < cells; i++) {
      if (overrides[i]! > 0) {
        collision[i] = Math.min(overrides[i]! - 1, classes.length - 1)
        continue
      }
      for (let l = layers.length - 1; l >= 0; l--) {
        const tile = layers[l]![i]!
        if (tile === 0) continue
        const cls = classOf(tile)
        if (classes[cls] && classes[cls].kind !== 'empty') {
          collision[i] = cls
          break
        }
      }
    }

    const cellsPart = parts[S_CELLS]!
    const collisionAt = cellsPart.bytes.length
    cellsPart.u8s(collision)
    cellsPart.pad()
    const layersAt = cellsPart.bytes.length
    for (const layer of layers) cellsPart.u16s(layer)
    cellsPart.pad()

    const placed = docs.world?.rooms.find((p) => p.room === id)
    let music: number | null = null
    if (room.music !== undefined) {
      const index = (docs.audio?.tracks ?? []).findIndex((t) => t.id === room.music)
      if (index < 0) problems.push(`${file}: unknown music track "${room.music}"`)
      else music = index
    }
    const backgrounds = room.backgrounds ?? []
    const speed = (percent: number) => Math.floor((Math.min(percent, 100) * 256 + 50) / 100)

    const out = parts[S_ROOMS]!
    strings.put(out, id)
    strings.put(out, room.name)
    const flags = (placed ? 1 : 0) | (music !== null ? 2 : 0) | dimFlags(room)
    out.u16(cols, rows, placed?.x ?? 0, placed?.y ?? 0, flags, music ?? 0, tileset)
    out.u8(layers.length, backgrounds.length)
    out.u32(collisionAt, layersAt, entityCount, room.entities.length)
    for (let n = 0; n < 2; n++) {
      const b = backgrounds[n]
      out.u16(b ? pictures.indexOf(b.image) : 0, b ? speed(b.parallax.x) : 0, b ? speed(b.parallax.y) : 0, 0)
    }

    room.entities.forEach((entity, n) => {
      const kind = types.findIndex((t) => t.id === entity.type)
      if (kind < 0) {
        problems.push(`${file}: entity ${n} has unknown type "${entity.type}"`)
        return
      }
      if (entity.x > 32767 || entity.y > 32767) {
        problems.push(`${file}: entity ${n} is at (${entity.x}, ${entity.y}); positions run from -32768 to 32767`)
        return
      }
      const defs = types[kind]!.props
      // Its behaviours' properties come after the type's own, as codegen writes them.
      const behaviourProps = behaviourValues(types[kind]!, entity.props)
      if (!behaviourProps) {
        problems.push(`${file}: entity ${n} (${entity.type}) has a behaviour property with no value or a value that does not fit; see the Problems panel`)
        return
      }
      const written = [...defs.map((def) => ({ name: def.name, value: entity.props[def.name] ?? def.default })), ...behaviourProps]
      parts[S_ENTITIES]!.u16(kind, entity.x, entity.y, written.length)
      parts[S_ENTITIES]!.u32(propCount)
      for (const { name, value } of written) {
        const out = parts[S_PROPS]!
        strings.put(out, name)
        if (typeof value === 'boolean') out.u8(1, 0, 0, 0, value ? 1 : 0, 0, 0, 0, 0, 0, 0, 0)
        else if (typeof value === 'number') {
          out.u8(0, 0, 0, 0)
          out.u32(value | 0, 0)
        } else {
          out.u8(2, 0, 0, 0)
          strings.put(out, value)
        }
        propCount++
      }
      entityCount++
    })
  }

  // What a room's pictures share with the rooms beside it, as codegen checks it.
  for (const id of roomIds) {
    const room = docs.rooms[id]!
    const tileset = tilesetIds.indexOf(room.tileset)
    const backgrounds = room.backgrounds ?? []
    if (tileset < 0 || backgrounds.length === 0) continue
    const file = `studio/rooms/${id}.json`
    const name = tilesetIds[tileset]
    const layers = mostLayers[tileset]! + backgrounds.length
    if (layers > SCREEN_LAYERS)
      problems.push(`${file}: ${backgrounds.length} backgrounds and the ${mostLayers[tileset]} tile layers of rooms drawn with tileset "${name}" are ${layers} layers; the GBA draws ${SCREEN_LAYERS} at once`)
    const costs = [...new Set(backgrounds.map((b) => b.image))].map((image) => compiled.pictures.find((p) => p.id === image)).filter((p) => p !== undefined)
    const own = tilesetArt(tileset)?.palettes ?? 0
    const palettes = own + costs.reduce((sum, c) => sum + c.palettes, 0)
    if (palettes > PALETTES)
      problems.push(`${file}: its backgrounds need ${palettes - own} palettes and tileset "${name}" ${own}, which is ${palettes}; the GBA has ${PALETTES} for backgrounds. Use fewer colour combinations in the pictures`)
    const used = usedTiles[tileset]!.size
    const tiles = used + costs.reduce((sum, c) => sum + c.tiles, 0)
    if (tiles > MAX_TILES)
      problems.push(`${file}: its backgrounds have ${tiles - used} distinct tiles and the rooms drawn with tileset "${name}" use ${used}, which is ${tiles}; video memory holds ${MAX_TILES}. Make the pictures smaller or more repetitive`)
  }

  let start: number | null = null
  if (docs.world?.start !== undefined) {
    start = roomIds.indexOf(docs.world.start)
    if (start < 0) problems.push(`studio/world.json: start room "${docs.world.start}" does not exist`)
  }
  if (problems.length) return { problems }

  const globals = parts[S_GLOBALS]!
  globals.u16(start ?? NO_ROOM, 0)
  globals.u32(entityCount)
  const p = project.physics.platformer
  const t = project.physics.topDown
  globals.u32(
    project.physics.mode === 'topdown' ? 1 : 0,
    p.gravity,
    p.fallGravity,
    p.maxFallSpeed,
    p.runSpeed,
    p.groundAcceleration,
    p.groundFriction,
    p.airAcceleration,
    p.jumpSpeed,
    p.jumpCut,
    p.airJumps,
    p.coyoteFrames,
    p.jumpBufferFrames,
    t.movement === 'grid' ? 1 : 0,
    t.speed,
    t.acceleration,
    t.friction,
    t.directions,
    t.normalizeDiagonal ? 1 : 0,
    t.cornerSlide,
    t.gridSize,
  )

  const manifest = parts[S_MANIFEST]!
  manifest.u32(compiled.entityTypes.length, compiled.tilesets.length, compiled.pictures.length, compiled.tracks.length)
  for (const type of compiled.entityTypes) {
    strings.put(manifest, type.id)
    strings.put(manifest, type.sprite ?? '')
  }
  for (const art of [...compiled.tilesets, ...compiled.pictures]) {
    strings.put(manifest, art.id)
    manifest.u32(art.tiles, art.palettes)
  }
  for (const track of compiled.tracks) strings.put(manifest, track)
  if (compiled.liveEntities != null) manifest.u32(compiled.liveEntities)
  parts[S_STRINGS]!.bytes = strings.bytes

  // Each type's behaviours, and where their properties start among its entities'.
  const positions = types.map(behaviourPositions)
  const behaviours = parts[S_BEHAVIOURS]!
  behaviours.u16(types.length & 0xffff, types.length >>> 16)
  let first = 0
  for (const kind of positions) {
    behaviours.u16(first, kind.length)
    first += kind.length
  }
  for (const kind of positions) for (const { number, at } of kind) behaviours.u16(number, at)

  const out = new Bytes()
  out.bytes = new Array<number>(padded(HEADER + SECTIONS * 8)).fill(0)
  parts.forEach((part, n) => {
    out.pad()
    const entry = new Bytes()
    entry.u32(out.bytes.length, part.bytes.length)
    out.bytes.splice(HEADER + n * 8, 8, ...entry.bytes)
    for (const byte of part.bytes) out.bytes.push(byte)
  })
  out.pad()
  const used = out.bytes.length
  if (used > capacity) return { problems: [`the level data is now ${used} bytes and this build of the game has room for ${capacity}; build the game to make room`], tooBig: true }
  const bytes = new Uint8Array(capacity)
  bytes.set(out.bytes)
  bytes.set(MAGIC, 0)
  const view = new DataView(bytes.buffer)
  view.setUint16(8, SECTION_VERSION, true)
  view.setUint16(10, SECTIONS, true)
  view.setUint32(12, used, true)
  view.setUint32(16, capacity, true)
  return { bytes, used }
}
