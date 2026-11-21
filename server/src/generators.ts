// The studio's generators as tools: a tileset, a room laid out on it, and a converted
// picture. They run the same core code as the Tools panels. What they draw goes under
// `generated/`, never `assets/`, and never over an existing file.
import { z } from 'zod'
import {
  DEFAULT_ROOMGEN, FORMAT_VERSION, Id, PIXELART_MAX_SIZE, PlatformerPhysics, ROOMGEN_STYLES, TILEGEN_PRESETS, convertPixelArt, DEFAULT_PIXELART,
  generateRoom, generateTileset, platformerFigures, presetOptions, roomgenDocument, scaleOptions, slugify, tilegenCollisionClasses, tilegenLayout, uniqueId,
} from '@pecten-studio/core'
import type { PixelArtOptions, RoomgenOptions, TilegenOptions } from '@pecten-studio/core'
import { GENERATED_DIR, HttpError } from './project.ts'
import { encodePng, loadPng, renderRoom, renderTileset, scale } from './render.ts'
import { documents, problemLines, tool } from './toolkit.ts'
import type { Tool } from './tools.ts'

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a #rrggbb colour')
const Percent = z.number().int().min(0).max(100)
const presetIds = TILEGEN_PRESETS.map((p) => p.id) as [string, ...string[]]
const styleIds = ROOMGEN_STYLES.map((s) => s.id) as [string, ...string[]]

/** Whole-number enlargement that keeps a picture near 512 px wide. */
const factorFor = (width: number) => Math.max(1, Math.min(8, Math.floor(512 / width)))

const TilesetInput = z.object({
  name: z.string().min(1).describe('The tileset\'s name; its file and id come from it'),
  preset: z.enum(presetIds).default('meadow').describe(`A look to start from: ${TILEGEN_PRESETS.map((p) => `${p.id} (${p.name})`).join(', ')}`),
  block_size: z.union([z.literal(8), z.literal(16), z.literal(32)]).default(16).describe('Pixels a side of one block: 8 is one GBA tile, 16 is 2x2 tiles, 32 is 4x4'),
  seed: z.number().int().min(0).max(1_000_000).default(1).describe('The same options and seed always give the same pixels'),
  pattern: z.enum(['earth', 'bricks', 'stone', 'cobble', 'wood', 'panels']).optional(),
  top: z.enum(['smooth', 'rough', 'battlements']).optional(),
  surface: z.boolean().optional().describe('A layer of grass, snow or moss over open tops'),
  outline: z.boolean().optional(),
  dither: z.boolean().optional(),
  colours: z.object({ surface: Hex, surface_dark: Hex, body: Hex, body_dark: Hex, accent: Hex, accent_dark: Hex }).partial().optional().describe('Overrides of the preset\'s colours. The whole sheet uses at most 15 colours'),
})

const RoomInput = z.object({
  name: z.string().min(1),
  tileset: Id.describe('A tileset made by tileset_generate (or saved from the studio\'s tileset generator)'),
  style: z.enum(styleIds).default('corridor').describe(`The room's shape: ${ROOMGEN_STYLES.map((s) => `${s.id} (${s.description})`).join('; ')}`),
  seed: z.number().int().min(0).max(1_000_000).default(1),
  width: z.number().int().min(1).max(8).default(2).describe('Size in screens'),
  height: z.number().int().min(1).max(8).default(1).describe('Size in screens'),
  slopes: Percent.optional().describe('How many one-block steps become slopes; needs a tileset with slope blocks, which tileset_generate makes'),
  platforms: Percent.optional(),
  hazards: Percent.optional().describe('Spike pits in long floors'),
  decoration: Percent.optional(),
  back_wall: z.enum(['none', 'patches', 'full']).optional(),
  exits: z.array(z.enum(['left', 'right', 'top', 'bottom'])).optional().describe(`Which sides have a way out. Default: ${Object.entries(DEFAULT_ROOMGEN.exits).filter(([, on]) => on).map(([side]) => side).join(' and ')}`),
})

const PixelInput = z.object({
  source: z.string().min(1).describe('A PNG already in the game folder (see list_assets). It is only read'),
  name: z.string().min(1).describe('The result is saved as generated/pixelart/<name>.png'),
  size: z.number().int().min(1).max(PIXELART_MAX_SIZE).default(DEFAULT_PIXELART.size).describe('Longest side of the result in pixels'),
  canvas: z.enum(['fit', 'square', 'tiles']).optional().describe('fit keeps the picture\'s shape, square makes a square, tiles pads to whole 8x8 tiles'),
  sampling: z.enum(['sharp', 'smooth']).optional(),
  remove_background: z.boolean().optional().describe('Clears the colour that touches the border'),
  tolerance: Percent.optional(),
  colours: z.number().int().min(2).max(255).optional().describe('At most 15 for a 4-bit picture (sprites and tiles), 255 for 8-bit'),
  depth: z.union([z.literal(4), z.literal(8)]).optional(),
  dither: z.enum(['none', 'ordered', 'diffusion']).optional(),
  outline: z.boolean().optional(),
})

function tilegenOptions(a: z.infer<typeof TilesetInput>): TilegenOptions {
  const preset = TILEGEN_PRESETS.find((p) => p.id === a.preset)!
  const base = presetOptions(preset, 16, a.seed)
  const c = a.colours
  const merged: TilegenOptions = {
    ...base,
    ...(a.pattern ? { pattern: a.pattern } : {}),
    ...(a.top ? { top: a.top } : {}),
    ...(a.surface !== undefined ? { surface: a.surface } : {}),
    ...(a.outline !== undefined ? { outline: a.outline } : {}),
    ...(a.dither !== undefined ? { dither: a.dither } : {}),
    colours: {
      ...base.colours,
      ...(c?.surface ? { surface: c.surface } : {}),
      ...(c?.surface_dark ? { surfaceDark: c.surface_dark } : {}),
      ...(c?.body ? { body: c.body } : {}),
      ...(c?.body_dark ? { bodyDark: c.body_dark } : {}),
      ...(c?.accent ? { accent: c.accent } : {}),
      ...(c?.accent_dark ? { accentDark: c.accent_dark } : {}),
    },
  }
  return scaleOptions(merged, a.block_size)
}

export const GENERATOR_TOOLS: Tool[] = [
  tool(
    'tileset_generate',
    'Makes a tileset from nothing: a ground material under a surface layer, cut into the blocks a platformer level needs (ground edges and corners, platforms, slopes, back walls, decorations, spikes). Writes the picture to generated/tilesets/, saves the tileset with its collision set (solid, one-way, slopes, hazard), and returns a picture of the sheet. Then make rooms on it with room_generate or paint them with room_paint. It never replaces a file: a taken name gets a number.',
    TilesetInput,
    async (args, context) => {
      const { docs } = await documents(context)
      const sheet = generateTileset(tilegenOptions(args))
      const png = encodePng({ width: sheet.width, height: sheet.height, data: new Uint8Array(sheet.rgba.buffer, sheet.rgba.byteOffset, sheet.rgba.byteLength) })
      const image = await context.project.writeGenerated(`${GENERATED_DIR}/tilesets/${slugify(args.name)}.png`, png)
      // Slope classes the project lacks are added to it; the first class is the default and is not stored.
      const project = docs.project
      const { collision, classes, added } = tilegenCollisionClasses(sheet, project?.collisionClasses ?? [])
      if (project && added) await context.project.save('project', undefined, { ...project, collisionClasses: classes })
      const id = uniqueId(slugify(args.name), Object.keys(docs.tilesets))
      await context.project.save('tileset', id, { version: FORMAT_VERSION, name: args.name, image, collision })
      const after = await context.project.load()
      const { picture, cols, rows } = await renderTileset(context.project, after.docs, id, factorFor(sheet.width))
      const text = [
        `Made tileset "${id}" from ${image}: ${sheet.width}x${sheet.height} px, ${cols * rows} tiles in ${cols} columns, ${sheet.palette.length} of 15 colours, one palette.`,
        `Blocks of ${sheet.blockSize} px, 8 per row. Block names, row by row: ${sheet.blocks.map((b) => b.name).join(', ')}.`,
        added ? 'Added the slope collision classes it needs to the project.' : '',
        `Next: room_generate with tileset "${id}".`,
        problemLines(after.problems, `studio/tilesets/${id}.json`),
      ]
      return { text: text.filter(Boolean).join('\n'), images: [encodePng(picture)] }
    },
  ),

  tool(
    'room_generate',
    'Lays out a whole room on a tileset made by tileset_generate: floors, steps, slopes, platforms, spike pits and decorations, sized to the project\'s jump so every exit can be reached from every other. Saves it as a room and returns a picture. The room is not on the world map yet: use world_place. Change it afterwards with room_paint and room_fill, or generate again with another seed.',
    RoomInput,
    async (args, context) => {
      const { docs } = await documents(context)
      const tileset = docs.tilesets[args.tileset]
      if (!tileset) throw new HttpError(404, `no tileset "${args.tileset}"; tilesets are: ${Object.keys(docs.tilesets).join(', ') || 'none'}. Make one with tileset_generate`)
      const sheet = await loadPng(context.project, tileset.image)
      const layout = tilegenLayout(sheet.width, sheet.height)
      if (!layout) {
        throw new HttpError(400, `tileset "${args.tileset}" (${tileset.image}, ${sheet.width}x${sheet.height} px) is not laid out like a generated sheet (8 blocks wide, 4 or 5 tall), so its blocks cannot be placed. Make one with tileset_generate, or build the room by hand with room_create and room_paint`)
      }
      const style = ROOMGEN_STYLES.find((s) => s.id === args.style)!
      const options: RoomgenOptions = {
        ...DEFAULT_ROOMGEN,
        ...style.options,
        seed: args.seed,
        width: args.width,
        height: args.height,
        ...(args.slopes !== undefined ? { slopes: args.slopes } : {}),
        ...(args.platforms !== undefined ? { platforms: args.platforms } : {}),
        ...(args.hazards !== undefined ? { hazards: args.hazards } : {}),
        ...(args.decoration !== undefined ? { decoration: args.decoration } : {}),
        ...(args.back_wall ? { backWall: args.back_wall } : {}),
        ...(args.exits ? { exits: { left: args.exits.includes('left'), right: args.exits.includes('right'), top: args.exits.includes('top'), bottom: args.exits.includes('bottom') } } : {}),
      }
      const figures = platformerFigures(docs.project?.physics?.platformer ?? PlatformerPhysics.parse({}))
      const room = generateRoom(options, { blockSize: layout.blockSize, jumpHeight: figures.jumpHeight, jumpDistance: figures.jumpDistance, blocks: layout.blocks })
      const id = uniqueId(slugify(args.name), Object.keys(docs.rooms))
      await context.project.save('room', id, roomgenDocument(room, args.name, args.tileset))
      const after = await context.project.load()
      const picture = await renderRoom(context.project, after.docs, id, {})
      const text = [
        `Made room "${id}" on tileset "${args.tileset}": ${args.width}x${args.height} screens, ${room.cols}x${room.rows} blocks of ${room.blockSize} px (${room.tileCols}x${room.tileRows} tiles). Steps up to ${room.metrics.jump} blocks and gaps up to ${room.metrics.gap} blocks are climbable with the project's jump.`,
        layout.rows < 5 && options.slopes > 0 ? 'This tileset has no slope blocks, so no slopes were used.' : '',
        'Layers: ' + after.docs.rooms[id]!.layers.map((l, i) => `${i} "${l.name}"`).join(', ') + '.',
        problemLines(after.problems, `studio/rooms/${id}.json`),
      ]
      return { text: text.filter(Boolean).join('\n'), images: [encodePng(picture)] }
    },
  ),

  tool(
    'pixel_art_convert',
    'Turns a picture from the game folder into small GBA-ready pixel art: shrinks it, fits it to a 15-colour palette (or up to 255), optionally clears the background. The source is only read. The result goes to generated/pixelart/<name>.png (never over a file); use it with sprite_create or tileset_create.',
    PixelInput,
    async (args, context) => {
      if (!args.source.toLowerCase().endsWith('.png')) throw new HttpError(400, `${args.source} is not a PNG`)
      const source = await loadPng(context.project, args.source)
      const options: PixelArtOptions = {
        ...DEFAULT_PIXELART,
        size: args.size,
        ...(args.canvas ? { canvas: args.canvas } : {}),
        ...(args.sampling ? { sampling: args.sampling } : {}),
        ...(args.remove_background !== undefined ? { removeBackground: args.remove_background } : {}),
        ...(args.tolerance !== undefined ? { tolerance: args.tolerance } : {}),
        ...(args.depth ? { depth: args.depth } : {}),
        ...(args.dither ? { dither: args.dither } : {}),
        ...(args.outline !== undefined ? { outline: args.outline } : {}),
        ...(args.colours !== undefined ? { colours: args.colours } : {}),
      }
      if (options.depth === 4 && options.colours > 15) throw new HttpError(400, `a 4-bit picture has at most 15 colours, not ${options.colours}; lower colours, or set depth to 8`)
      const result = convertPixelArt({ width: source.width, height: source.height, rgba: new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.byteLength) }, options)
      const png = encodePng({ width: result.width, height: result.height, data: new Uint8Array(result.rgba.buffer, result.rgba.byteOffset, result.rgba.byteLength) })
      const file = await context.project.writeGenerated(`${GENERATED_DIR}/pixelart/${slugify(args.name)}.png`, png)
      const multiple = result.width % 8 === 0 && result.height % 8 === 0
      const text = `Saved ${file}: ${result.width}x${result.height} px, ${result.palette.length} colours (${options.depth}-bit). ${multiple ? 'Its size is a multiple of 8, so it can be a tileset or background.' : 'Its size is not a multiple of 8; use canvas "tiles" for a tileset or background.'}`
      return { text, images: [encodePng(scale({ width: result.width, height: result.height, data: new Uint8Array(result.rgba.buffer, result.rgba.byteOffset, result.rgba.byteLength) }, factorFor(result.width)))] }
    },
  ),
]
