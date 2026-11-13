// The project format: plain JSON files under `<game>/studio/`, validated here.
// Nothing in these schemas knows what a game does with its tiles or entities.
import { z } from 'zod'

export const FORMAT_VERSION = 1
/** GBA background tiles are 8x8 pixels. */
export const TILE = 8
/** One GBA screen, in pixels and in tiles. Rooms are whole numbers of screens. */
export const SCREEN = { width: 240, height: 160, cols: 30, rows: 20 } as const
/** Sprite (OBJ) sizes the hardware supports, width x height in pixels. */
export const SPRITE_SIZES: ReadonlyArray<readonly [number, number]> = [
  [8, 8], [16, 16], [32, 32], [64, 64],
  [16, 8], [32, 8], [32, 16], [64, 32],
  [8, 16], [8, 32], [16, 32], [32, 64],
]

/** File-name safe identifier: documents are stored as `<id>.json`. */
export const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, 'lowercase letters, digits, - and _ (max 48)')
const Version = z.literal(FORMAT_VERSION)
const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a #rrggbb colour')
/** A path inside the game folder, forward slashes, never climbing out of it. */
export const AssetPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..'), 'a relative path inside the game folder')

export const CollisionKind = z.enum(['empty', 'solid', 'oneway', 'slope', 'hazard', 'custom'])

export const CollisionClass = z
  .object({
    id: Id,
    name: z.string().min(1),
    /** Overlay colour in the editor. */
    colour: Colour,
    kind: CollisionKind,
    /** For slopes: floor height over the tile's bottom edge at its left and right side, 0 to 8 pixels. */
    slope: z.object({ left: z.number().int().min(0).max(TILE), right: z.number().int().min(0).max(TILE) }).optional(),
  })
  .refine((c) => (c.kind === 'slope') === (c.slope !== undefined), { message: 'slope heights go with kind "slope", and only with it', path: ['slope'] })

export const PropertyDef = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'snake_case, it becomes a Rust field'),
    type: z.enum(['int', 'bool', 'string', 'enum']),
    default: z.union([z.number().int(), z.boolean(), z.string()]),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((p, ctx) => {
    const kind = typeof p.default
    const ok =
      (p.type === 'int' && kind === 'number') ||
      (p.type === 'bool' && kind === 'boolean') ||
      (p.type === 'string' && kind === 'string') ||
      (p.type === 'enum' && kind === 'string' && (p.options?.includes(p.default as string) ?? false))
    if (!ok) ctx.addIssue({ code: 'custom', message: `default does not fit type "${p.type}"`, path: ['default'] })
    if ((p.type === 'enum') !== (p.options !== undefined)) ctx.addIssue({ code: 'custom', message: 'options go with type "enum", and only with it', path: ['options'] })
  })

export const EntityType = z.object({
  id: Id,
  name: z.string().min(1),
  colour: Colour,
  /** Sprite document shown for it in the map editor. */
  sprite: Id.optional(),
  props: z.array(PropertyDef).default([]),
})

export const Project = z.object({
  version: Version,
  name: z.string().min(1),
  build: z.object({
    /** Shell commands run in the game folder. */
    dev: z.string().min(1),
    release: z.string().min(1),
    /** Where each build leaves its ROM. */
    devRom: AssetPath,
    releaseRom: AssetPath,
  }),
  collisionClasses: z.array(CollisionClass).min(1),
  entityTypes: z.array(EntityType).default([]),
})

export const Tileset = z.object({
  version: Version,
  name: z.string().min(1),
  /** PNG whose width and height are multiples of 8; tiles are numbered row by row. */
  image: AssetPath,
  /** Collision class per tile index; tiles left out use the project's first class. */
  collision: z.record(z.string().regex(/^\d+$/), Id).default({}),
})

export const Animation = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'snake_case, it becomes a Rust name'),
  /** Frame index in the sheet, and how many 60 Hz frames it shows for. */
  frames: z.array(z.object({ index: z.number().int().min(0), duration: z.number().int().min(1).max(255) })).min(1),
  loop: z.boolean().default(true),
})

export const Sprite = z.object({
  version: Version,
  name: z.string().min(1),
  /** PNG sheet cut in a grid of `frame`, or an .aseprite file. */
  image: AssetPath,
  frame: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  /** The point of the frame placed at an entity's position. */
  anchor: z.object({ x: z.number().int(), y: z.number().int() }),
  hitbox: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  animations: z.array(Animation).default([]),
})

export const TileLayer = z.object({
  name: z.string().min(1),
  /** Run-length pairs `[count, cell, ...]` row by row; cell 0 is empty, n is tile n-1. See `rle.ts`. */
  data: z.array(z.number().int().min(0)),
})

export const Entity = z.object({
  type: Id,
  /** Position in pixels from the room's top-left. */
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  props: z.record(z.string(), z.union([z.number().int(), z.boolean(), z.string()])).default({}),
})

export const Room = z.object({
  version: Version,
  name: z.string().min(1),
  /** Size in screens. */
  width: z.number().int().min(1).max(32),
  height: z.number().int().min(1).max(32),
  tileset: Id,
  /** Back to front. */
  layers: z.array(TileLayer).min(1).max(3),
  /** Collision painted over what the tiles give, run-length like a layer: 0 keeps the tile's class, n is collision class n-1. */
  collision: z.array(z.number().int().min(0)).optional(),
  entities: z.array(Entity).default([]),
  /** Audio track that plays here. */
  music: Id.optional(),
})

export const World = z.object({
  version: Version,
  /** Where each room's top-left sits on the world grid, in screens. */
  rooms: z.array(z.object({ room: Id, x: z.number().int(), y: z.number().int() })).default([]),
  /** The room a new game starts in. */
  start: Id.optional(),
  /** The map's size in screens, from screen (0, 0). Left out, the map is as big as its rooms make it. */
  size: z.object({ width: z.number().int().min(1).max(256), height: z.number().int().min(1).max(256) }).optional(),
})

export const Track = z
  .object({
    id: Id,
    name: z.string().min(1),
    file: AssetPath,
    format: z.enum(['midi', 'xm', 'mod']),
    /** MIDI carries no instruments: the SF2 they are taken from. */
    soundfont: AssetPath.optional(),
  })
  .refine((t) => (t.format === 'midi') === (t.soundfont !== undefined), { message: 'a soundfont goes with format "midi", and only with it', path: ['soundfont'] })

export const Audio = z.object({
  version: Version,
  tracks: z.array(Track).default([]),
  sfx: z.array(z.object({ id: Id, name: z.string().min(1), file: AssetPath })).default([]),
})

export type CollisionClass = z.infer<typeof CollisionClass>
export type EntityType = z.infer<typeof EntityType>
export type Project = z.infer<typeof Project>
export type Tileset = z.infer<typeof Tileset>
export type Sprite = z.infer<typeof Sprite>
export type Room = z.infer<typeof Room>
export type World = z.infer<typeof World>
export type Audio = z.infer<typeof Audio>

/** Documents that are one file each, and those kept one file per id in a folder. */
export const SINGLE_DOCS = { project: Project, world: World, audio: Audio } as const
export const MULTI_DOCS = { tileset: Tileset, sprite: Sprite, room: Room } as const
export type SingleKind = keyof typeof SINGLE_DOCS
export type MultiKind = keyof typeof MULTI_DOCS
export type DocKind = SingleKind | MultiKind

export const STUDIO_DIR = 'studio'
/** Path of a document inside the game folder. */
export function docPath(kind: DocKind, id?: string): string {
  if (kind in SINGLE_DOCS) return `${STUDIO_DIR}/${kind}.json`
  if (!id || !Id.safeParse(id).success) throw new Error(`a ${kind} needs a valid id`)
  return `${STUDIO_DIR}/${kind}s/${id}.json`
}
export function schemaFor(kind: DocKind): z.ZodType {
  return kind in SINGLE_DOCS ? SINGLE_DOCS[kind as SingleKind] : MULTI_DOCS[kind as MultiKind]
}
