// What an agent can do to a project. Every tool goes through the same code as the
// studio: documents are checked against the schemas before they are written, and
// nothing is read or written outside the game folder.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { BEHAVIOURS, Background, FORMAT_VERSION, Id, MAX_BACKGROUNDS, MAX_DIM, MULTI_DOCS, PropertyDef, SCREEN, SINGLE_DOCS, SPRITE_SIZES, TILE, docPath, emptyRoom, resizeRoom, rleEncode, slugify, uniqueId } from '@pecten-studio/core'
import type { Documents, Room } from '@pecten-studio/core'
import type { Builder } from './build.ts'
import { KEY_BITS, runRom } from './emulator.ts'
import { describePatch, patchRom, romStatus, staleNote } from './patch.ts'
import { HttpError } from './project.ts'
import { documents, problemLines, saveAndReport, tool } from './toolkit.ts'
import { GENERATOR_TOOLS } from './generators.ts'
import type { ProjectFolder } from './project.ts'
import { effectiveCollision, encodePng, loadPng, renderRoom, renderSheet, renderTileset, roomCells, scale } from './render.ts'

export interface ToolResult {
  text: string
  /** PNG files. */
  images?: Buffer[]
}

export interface Tool {
  name: string
  description: string
  input: z.ZodType
  run: (args: never, context: ToolContext) => Promise<ToolResult>
}

/** What is open in the studio, as its page last reported it. */
export interface StudioView {
  selection: { kind: string; id?: string }
  /** In a room: the tool, the layer being painted, and the selected entity's number. */
  editor?: { tool?: string; layer?: number | string; entity?: number | null }
}

export interface ToolContext {
  project: ProjectFolder
  builder: Builder
  /** Present when the tools run inside the studio's own server, with its page reachable. */
  studio?: {
    view: () => StudioView | null
    open: (selection: StudioView['selection']) => number
  }
}

const Kind = z.enum(['project', 'world', 'audio', 'room', 'tileset', 'sprite'])
const LayerRef = z.union([z.number().int().min(0), z.string()]).describe('A tile layer by index (0 is the back layer) or by name, or "collision" for the collision overrides')
const CellValue = z
  .union([z.number().int().min(-1), z.string(), z.null()])
  .describe('On a tile layer: a tile number of the room\'s tileset (0 is its top-left tile), or -1 for empty. On "collision": a collision class id, or null to give the cell back to its tile\'s own class')

const json = (value: unknown): string => JSON.stringify(value, null, 2)

function roomOf(docs: Documents, id: string): Room {
  const room = docs.rooms[id]
  if (!room) throw new HttpError(404, `no room "${id}"; rooms are: ${Object.keys(docs.rooms).join(', ') || 'none'}`)
  return room
}

/** The cells a layer reference means, a way to write a value into them, and a way to save them back. */
function layerOf(docs: Documents, room: Room, ref: number | string) {
  const cells = roomCells(room)
  if (ref === 'collision') {
    const classes = docs.project?.collisionClasses ?? []
    return {
      ...cells,
      target: cells.collision,
      encode: (value: number | string | null): number => {
        if (value === null) return 0
        const index = classes.findIndex((c) => c.id === value)
        if (index < 0) throw new HttpError(400, `"${value}" is not a collision class; classes are: ${classes.map((c) => c.id).join(', ')}`)
        return index + 1
      },
      apply: (): Room => ({ ...room, collision: cells.collision.some((v) => v > 0) ? rleEncode(cells.collision) : undefined }),
    }
  }
  const index = typeof ref === 'number' ? ref : room.layers.findIndex((l) => l.name === ref)
  if (index < 0 || index >= room.layers.length) {
    throw new HttpError(400, `no layer ${JSON.stringify(ref)}; layers are: ${room.layers.map((l, i) => `${i} "${l.name}"`).join(', ')}, or "collision"`)
  }
  return {
    ...cells,
    target: cells.layers[index]!,
    encode: (value: number | string | null): number => {
      if (typeof value !== 'number') throw new HttpError(400, 'a tile layer takes tile numbers, or -1 for empty')
      return value + 1
    },
    apply: (): Room => ({ ...room, layers: room.layers.map((l, i) => (i === index ? { ...l, data: rleEncode(cells.layers[index]!) } : l)) }),
  }
}

function checkRect(cols: number, rows: number, x: number, y: number, width: number, height: number): void {
  if (x < 0 || y < 0 || x + width > cols || y + height > rows) throw new HttpError(400, `the rectangle is outside the room, which is ${cols}x${rows} tiles`)
}

export const TOOLS: Tool[] = [
  tool(
    'project_overview',
    'Start here. Summarises the studio project in this game folder: rooms with their size and place on the world map, tilesets with their tile counts, sprites and animations, audio, collision classes, entity types, and how many problems the project has.',
    z.object({}),
    async (_args, context) => {
      const { docs, problems } = await documents(context)
      const tilesets: Record<string, unknown> = {}
      for (const [id, tileset] of Object.entries(docs.tilesets)) {
        const image = await loadPng(context.project, tileset.image).catch(() => null)
        tilesets[id] = {
          name: tileset.name,
          image: tileset.image,
          ...(image ? { columns: Math.floor(image.width / TILE), tiles: Math.floor(image.width / TILE) * Math.floor(image.height / TILE) } : { error: 'image cannot be read' }),
          tilesWithCollision: Object.keys(tileset.collision).length,
        }
      }
      return {
        text: json({
          name: docs.project?.name,
          screen: `${SCREEN.width}x${SCREEN.height} px, ${SCREEN.cols}x${SCREEN.rows} tiles of ${TILE} px`,
          world: { size: docs.world?.size ?? 'grows with its rooms', start: docs.world?.start ?? null },
          rooms: Object.fromEntries(
            Object.entries(docs.rooms).map(([id, room]) => [
              id,
              {
                name: room.name,
                screens: `${room.width}x${room.height}`,
                tiles: `${room.width * SCREEN.cols}x${room.height * SCREEN.rows}`,
                tileset: room.tileset,
                layers: room.layers.map((l) => (l.dim ? `${l.name} (dimmed)` : l.name)),
                backgrounds: (room.backgrounds ?? []).map((b) => `${b.image} at ${b.parallax.x}% x, ${b.parallax.y}% y${b.dim ? ', dimmed' : ''}`),
                dimLevel: room.dimLevel ?? 0,
                entities: room.entities.length,
                music: room.music ?? null,
                worldPosition: docs.world?.rooms.find((p) => p.room === id) ?? 'not on the map',
              },
            ]),
          ),
          tilesets,
          sprites: Object.fromEntries(Object.entries(docs.sprites).map(([id, s]) => [id, { name: s.name, image: s.image, frame: `${s.frame.width}x${s.frame.height}`, animations: s.animations.map((a) => a.name) }])),
          audio: { tracks: docs.audio?.tracks.map((t) => t.id) ?? [], soundEffects: docs.audio?.sfx.map((s) => s.id) ?? [] },
          collisionClasses: docs.project?.collisionClasses.map((c) => ({ id: c.id, kind: c.kind })),
          entityTypes: docs.project?.entityTypes.map((t) => ({ id: t.id, name: t.name, sprite: t.sprite ?? null, props: t.props.map((p) => `${p.name}: ${p.type}`) })),
          build: docs.project?.build,
          problems: { errors: problems.filter((p) => p.severity === 'error').length, warnings: problems.filter((p) => p.severity === 'warning').length },
        }),
      }
    },
  ),

  tool('validate', 'Checks the whole project: schema errors, missing files, unknown references, rooms that overlap or lie outside the world map. Run it after a set of changes.', z.object({}), async (_args, context) => {
    const { problems } = await documents(context)
    return { text: problemLines(problems) }
  }),

  tool(
    'read_document',
    'Returns one project document as JSON. Tile layers in a room are run-length pairs; use room_read_cells to see cells instead.',
    z.object({ kind: Kind, id: Id.optional().describe('Needed for room, tileset and sprite') }),
    async ({ kind, id }, context) => {
      const text = await readFile(context.project.resolve(docPath(kind, id)), 'utf8').catch(() => {
        throw new HttpError(404, `no ${kind}${id ? ` "${id}"` : ''} document`)
      })
      return { text }
    },
  ),

  tool(
    'write_document',
    'Creates or replaces a whole project document. It is refused if it does not match the schema. Prefer the room_ and entity_ tools for changes to rooms: they cannot corrupt tile data.',
    z.object({ kind: Kind, id: Id.optional().describe('Needed for room, tileset and sprite'), document: z.record(z.string(), z.unknown()) }),
    async ({ kind, id, document }, context) => saveAndReport(context, kind, id, document, `Saved ${docPath(kind, id)}.`),
  ),

  tool('delete_document', 'Deletes a room, tileset or sprite document. The image or sound files it used stay in the folder.', z.object({ kind: z.enum(['room', 'tileset', 'sprite']), id: Id }), async ({ kind, id }, context) => {
    await context.project.remove(kind, id)
    const { problems } = await context.project.load()
    return { text: `Deleted ${docPath(kind, id)}.\n${problemLines(problems)}` }
  }),

  tool('list_assets', 'Lists the image, music and sound files in the game folder. These are made by hand: read them, never regenerate or overwrite them.', z.object({}), async (_args, context) => {
    const { assets } = await context.project.load()
    return { text: assets.length ? assets.map((a) => `${a.path} (${a.size} bytes)`).join('\n') : 'No asset files.' }
  }),

  tool(
    'room_read_cells',
    'Reads a rectangle of a room as a grid of text, one row per line. Tile layers give tile numbers (-1 is empty). "collision" gives the class that applies in each cell after overrides and the tiles\' own classes.',
    z.object({ room: Id, layer: LayerRef, x: z.number().int().min(0).default(0), y: z.number().int().min(0).default(0), width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional() }),
    async ({ room: id, layer, x, y, width, height }, context) => {
      const { docs } = await documents(context)
      const room = roomOf(docs, id)
      const { cols, rows, target } = layerOf(docs, room, layer)
      const w = width ?? cols - x
      const h = height ?? rows - y
      checkRect(cols, rows, x, y, w, h)
      if (w * h > 6000) throw new HttpError(400, `that is ${w * h} cells; ask for at most 6000 at a time`)
      const classes = docs.project?.collisionClasses ?? []
      const effective = layer === 'collision' ? effectiveCollision(docs, room) : null
      const lines: string[] = []
      for (let row = y; row < y + h; row++) {
        const cells: string[] = []
        for (let col = x; col < x + w; col++) cells.push(effective ? (classes[effective[row * cols + col]!]?.id ?? '?') : String(target[row * cols + col]! - 1))
        lines.push(cells.join(' '))
      }
      return { text: `${id}, layer ${JSON.stringify(layer)}, columns ${x} to ${x + w - 1}, rows ${y} to ${y + h - 1}:\n${lines.join('\n')}` }
    },
  ),

  tool(
    'room_fill',
    'Fills a rectangle of a room layer with one value. A room is a grid of 8 px tiles, 30 by 20 per screen; x and y count tiles from its top-left.',
    z.object({ room: Id, layer: LayerRef, x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1), value: CellValue }),
    async ({ room: id, layer, x, y, width, height, value }, context) => {
      const { docs } = await documents(context)
      const edit = layerOf(docs, roomOf(docs, id), layer)
      checkRect(edit.cols, edit.rows, x, y, width, height)
      const cell = edit.encode(value)
      for (let row = y; row < y + height; row++) edit.target.fill(cell, row * edit.cols + x, row * edit.cols + x + width)
      return saveAndReport(context, 'room', id, edit.apply(), `Filled ${width}x${height} cells of ${id}.`)
    },
  ),

  tool(
    'room_paint',
    'Writes a block of cells into a room layer, given as rows from top to bottom. Use it for anything that is not one flat rectangle.',
    z.object({ room: Id, layer: LayerRef, x: z.number().int().min(0), y: z.number().int().min(0), rows: z.array(z.array(CellValue).min(1)).min(1) }),
    async ({ room: id, layer, x, y, rows }, context) => {
      const { docs } = await documents(context)
      const edit = layerOf(docs, roomOf(docs, id), layer)
      checkRect(edit.cols, edit.rows, x, y, Math.max(...rows.map((r) => r.length)), rows.length)
      let count = 0
      rows.forEach((cells, dy) =>
        cells.forEach((value, dx) => {
          edit.target[(y + dy) * edit.cols + x + dx] = edit.encode(value)
          count++
        }),
      )
      return saveAndReport(context, 'room', id, edit.apply(), `Painted ${count} cells of ${id}.`)
    },
  ),

  tool(
    'room_create',
    'Creates an empty room and puts it on the world map. Sizes are in screens of 240x160 px.',
    z.object({
      name: z.string().min(1),
      width: z.number().int().min(1).max(32),
      height: z.number().int().min(1).max(32),
      tileset: Id,
      world_x: z.number().int().optional().describe('Screen column on the world map; left out, the room goes right of the others'),
      world_y: z.number().int().optional(),
    }),
    async ({ name, width, height, tileset, world_x, world_y }, context) => {
      const { docs } = await documents(context)
      if (!docs.tilesets[tileset]) throw new HttpError(400, `no tileset "${tileset}"; tilesets are: ${Object.keys(docs.tilesets).join(', ') || 'none'}`)
      const id = uniqueId(slugify(name), Object.keys(docs.rooms))
      await context.project.save('room', id, emptyRoom(name, width, height, tileset))
      const world = docs.world ?? { version: FORMAT_VERSION, rooms: [] }
      const placed = world.rooms.flatMap((p) => (docs.rooms[p.room] ? [{ ...p, w: docs.rooms[p.room]!.width }] : []))
      const x = world_x ?? (placed.length ? Math.max(...placed.map((p) => p.x + p.w)) : 0)
      const y = world_y ?? (placed.length ? Math.min(...placed.map((p) => p.y)) : 0)
      return saveAndReport(context, 'world', undefined, { ...world, rooms: [...world.rooms, { room: id, x, y }], start: world.start ?? id }, `Created room "${id}" (${width}x${height} screens) at world screen ${x}, ${y}.`)
    },
  ),

  tool('room_resize', 'Changes a room\'s size in screens, keeping its top-left corner. Tiles and entities outside the new size are dropped.', z.object({ room: Id, width: z.number().int().min(1).max(32), height: z.number().int().min(1).max(32) }), async ({ room: id, width, height }, context) => {
    const { docs } = await documents(context)
    return saveAndReport(context, 'room', id, resizeRoom(roomOf(docs, id), width, height), `Resized ${id} to ${width}x${height} screens.`)
  }),

  tool(
    'world_place',
    'Moves a room on the world map, puts it on the map, or makes it the start room. Positions are in screens. Rooms that touch are connected: the player walks from one into the other.',
    z.object({ room: Id, x: z.number().int(), y: z.number().int(), start: z.boolean().optional().describe('Also make it the room a new game starts in') }),
    async ({ room: id, x, y, start }, context) => {
      const { docs } = await documents(context)
      roomOf(docs, id)
      const world = docs.world ?? { version: FORMAT_VERSION, rooms: [] }
      const rooms = [...world.rooms.filter((p) => p.room !== id), { room: id, x, y }]
      return saveAndReport(context, 'world', undefined, { ...world, rooms, start: start ? id : world.start }, `Placed ${id} at world screen ${x}, ${y}.`)
    },
  ),

  tool(
    'entity_add',
    'Places an entity in a room. x and y are pixels from the room\'s top-left and mark the entity\'s feet: the middle of its bottom edge. To stand on a floor whose top is tile row r, use y = r * 8.',
    z.object({ room: Id, type: Id, x: z.number().int().min(0), y: z.number().int().min(0), props: z.record(z.string(), z.union([z.number().int(), z.boolean(), z.string()])).default({}) }),
    async ({ room: id, type, x, y, props }, context) => {
      const { docs } = await documents(context)
      const room = roomOf(docs, id)
      if (!docs.project?.entityTypes.some((t) => t.id === type)) throw new HttpError(400, `no entity type "${type}"; types are: ${docs.project?.entityTypes.map((t) => t.id).join(', ') || 'none'}`)
      return saveAndReport(context, 'room', id, { ...room, entities: [...room.entities, { type, x, y, props }] }, `Added entity ${room.entities.length} (${type}) to ${id}.`)
    },
  ),

  tool(
    'entity_update',
    'Moves an entity or changes its type or properties. Entities are numbered from 0 in the order read_document lists them.',
    z.object({ room: Id, index: z.number().int().min(0), type: Id.optional(), x: z.number().int().min(0).optional(), y: z.number().int().min(0).optional(), props: z.record(z.string(), z.union([z.number().int(), z.boolean(), z.string()])).optional() }),
    async ({ room: id, index, ...patch }, context) => {
      const { docs } = await documents(context)
      const room = roomOf(docs, id)
      const entity = room.entities[index]
      if (!entity) throw new HttpError(404, `${id} has ${room.entities.length} entities; there is no entity ${index}`)
      const changed = { ...entity, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
      return saveAndReport(context, 'room', id, { ...room, entities: room.entities.map((e, i) => (i === index ? changed : e)) }, `Updated entity ${index} of ${id}.`)
    },
  ),

  tool('entity_remove', 'Removes an entity from a room. The entities after it move down one number.', z.object({ room: Id, index: z.number().int().min(0) }), async ({ room: id, index }, context) => {
    const { docs } = await documents(context)
    const room = roomOf(docs, id)
    if (!room.entities[index]) throw new HttpError(404, `${id} has ${room.entities.length} entities; there is no entity ${index}`)
    return saveAndReport(context, 'room', id, { ...room, entities: room.entities.filter((_, i) => i !== index) }, `Removed entity ${index} from ${id}.`)
  }),

  tool(
    'render_room',
    'Draws a room, or a rectangle of it given in tiles, as an image, so you can look at what is there. Blue lines are screen boundaries; entities are small squares in their type\'s colour. Its backgrounds are drawn repeating from the room\'s top-left corner; in the game they scroll slower than the room.',
    z.object({
      room: Id,
      x: z.number().int().min(0).optional(),
      y: z.number().int().min(0).optional(),
      width: z.number().int().min(1).optional().describe('In tiles'),
      height: z.number().int().min(1).optional(),
      collision: z.boolean().default(false).describe('Tint each cell with its collision class'),
      scale: z.number().int().min(1).max(4).default(2),
    }),
    async ({ room: id, x, y, width, height, collision, scale: factor }, context) => {
      const { docs } = await documents(context)
      const room = roomOf(docs, id)
      const cols = room.width * SCREEN.cols
      const rows = room.height * SCREEN.rows
      const region = { x: x ?? 0, y: y ?? 0, width: width ?? cols - (x ?? 0), height: height ?? rows - (y ?? 0) }
      let picture = await renderRoom(context.project, docs, id, { region, collision })
      // Keep the image a size a model can take in.
      const fit = Math.max(1, Math.min(factor, Math.floor(1600 / Math.max(picture.width, picture.height))))
      picture = scale(picture, fit)
      return { text: `${id}: tiles ${region.x},${region.y} to ${region.x + region.width - 1},${region.y + region.height - 1}, drawn at ${fit}x (${TILE * fit} px per tile).`, images: [encodePng(picture)] }
    },
  ),

  tool('render_tileset', 'Draws a tileset enlarged with a line between tiles. Tiles are numbered row by row from 0 at the top-left: tile n is at column n % columns, row floor(n / columns).', z.object({ tileset: Id, scale: z.number().int().min(1).max(8).default(4) }), async ({ tileset, scale: factor }, context) => {
    const { docs } = await documents(context)
    const { picture, cols, rows } = await renderTileset(context.project, docs, tileset, factor)
    const classes = Object.entries(docs.tilesets[tileset]!.collision).map(([tile, cls]) => `${tile}: ${cls}`)
    return { text: `${tileset}: ${cols} columns, ${rows} rows, ${cols * rows} tiles, drawn at ${factor}x.\nCollision by tile: ${classes.join(', ') || 'none set'}.`, images: [encodePng(picture)] }
  }),

  tool(
    'room_update',
    'Renames a room, or changes its tileset, its music track, its backgrounds or how its layers are darkened. Backgrounds are pictures behind the tile layers that repeat in both directions and scroll slower than the room, for parallax: up to 2, back to front, and with the tile layers at most 4 layers in all. Darkening (dimLevel, dimLayers, and `dim` on a background) shows what is in front, such as a dialogue box, against the scene: it never changes a picture file.',
    z.object({
      room: Id,
      name: z.string().min(1).optional(),
      tileset: Id.optional(),
      music: Id.nullable().optional().describe('A track id from the audio document, or null for none'),
      backgrounds: z
        .array(Background)
        .max(MAX_BACKGROUNDS)
        .optional()
        .describe('Replaces the room\'s backgrounds, back to front; [] removes them. Each is a PNG already in the game folder (see list_assets) whose size is a multiple of 8, and a parallax in percent of the camera\'s speed across (x) and down (y): 0 stands still, 100 moves with the room, and a farther layer gets less than a nearer one. Set dim: true on one to darken it by the room\'s dimLevel'),
      dimLevel: z.number().int().min(0).max(MAX_DIM).optional().describe('How dark the dimmed layers are: 0 is no change, 16 is black. One level for all dimmed layers; the game can change it while it runs'),
      dimLayers: z
        .array(z.union([z.number().int().min(0), z.string()]))
        .optional()
        .describe('The tile layers to darken, by number (0 is the back layer) or name; every other tile layer is set not to dim. [] turns dimming off for all tile layers'),
    }),
    async ({ room: id, name, tileset, music, backgrounds, dimLevel, dimLayers }, context) => {
      const { docs } = await documents(context)
      const room = roomOf(docs, id)
      for (const background of backgrounds ?? []) {
        if (!background.image.toLowerCase().endsWith('.png')) throw new HttpError(400, `${background.image} is not a PNG`)
        const picture = await loadPng(context.project, background.image)
        if (picture.width % TILE || picture.height % TILE) throw new HttpError(400, `${background.image} is ${picture.width}x${picture.height} px; a background's size must be a multiple of ${TILE}`)
      }
      const next: Room = { ...room, ...(name ? { name } : {}), ...(tileset ? { tileset } : {}), ...(music !== undefined ? { music: music ?? undefined } : {}), ...(backgrounds ? { backgrounds: backgrounds.length ? backgrounds : undefined } : {}) }
      if (dimLevel !== undefined) next.dimLevel = dimLevel || undefined
      if (dimLayers) {
        const named = dimLayers.map((ref) => {
          const index = typeof ref === 'number' ? ref : room.layers.findIndex((l) => l.name === ref)
          if (index < 0 || index >= room.layers.length) throw new HttpError(400, `no layer ${JSON.stringify(ref)}; layers are: ${room.layers.map((l, i) => `${i} "${l.name}"`).join(', ')}`)
          return index
        })
        next.layers = room.layers.map(({ dim: _was, ...layer }, i) => (named.includes(i) ? { ...layer, dim: true } : layer))
      }
      return saveAndReport(context, 'room', id, next, `Updated ${id}.`)
    },
  ),

  tool('tileset_create', 'Makes a tileset from a PNG that is already in the game folder (see list_assets). Its size must be a multiple of 8.', z.object({ name: z.string().min(1), image: z.string().min(1) }), async ({ name, image }, context) => {
    const { docs } = await documents(context)
    const picture = await loadPng(context.project, image)
    if (picture.width % TILE || picture.height % TILE) throw new HttpError(400, `${image} is ${picture.width}x${picture.height} px; a tileset's size must be a multiple of ${TILE}`)
    const id = uniqueId(slugify(name), Object.keys(docs.tilesets))
    return saveAndReport(context, 'tileset', id, { version: FORMAT_VERSION, name, image, collision: {} }, `Created tileset "${id}": ${(picture.width / TILE) * (picture.height / TILE)} tiles in ${picture.width / TILE} columns.`)
  }),

  tool(
    'tileset_set_collision',
    'Gives tiles of a tileset a collision class, which every room using the tile then has in that cell. Name the tiles as a list, or as a range from..to (inclusive). Look at the tiles with render_tileset first.',
    z.object({ tileset: Id, class: Id.describe('A collision class id from project_overview'), tiles: z.array(z.number().int().min(0)).optional(), from: z.number().int().min(0).optional(), to: z.number().int().min(0).optional() }),
    async ({ tileset: id, class: classId, tiles, from, to }, context) => {
      const { docs } = await documents(context)
      const tileset = docs.tilesets[id]
      if (!tileset) throw new HttpError(404, `no tileset "${id}"; tilesets are: ${Object.keys(docs.tilesets).join(', ') || 'none'}`)
      const classes = docs.project?.collisionClasses ?? []
      if (!classes.some((c) => c.id === classId)) throw new HttpError(400, `"${classId}" is not a collision class; classes are: ${classes.map((c) => c.id).join(', ')}`)
      const picture = await loadPng(context.project, tileset.image)
      const count = Math.floor(picture.width / TILE) * Math.floor(picture.height / TILE)
      const chosen = [...(tiles ?? []), ...(from !== undefined ? Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i) : [])]
      if (chosen.length === 0) throw new HttpError(400, 'name the tiles with "tiles", or with "from" and "to"')
      const bad = chosen.find((tile) => tile >= count)
      if (bad !== undefined) throw new HttpError(400, `the tileset has ${count} tiles, numbered 0 to ${count - 1}; there is no tile ${bad}`)
      const collision = { ...tileset.collision }
      // The project's first class is what a tile has when nothing is said: it is not stored.
      for (const tile of chosen) {
        if (classId === classes[0]!.id) delete collision[String(tile)]
        else collision[String(tile)] = classId
      }
      return saveAndReport(context, 'tileset', id, { ...tileset, collision }, `Set ${chosen.length} tiles of ${id} to ${classId}.`)
    },
  ),

  tool(
    'sprite_create',
    'Makes a sprite from a PNG sheet that is already in the game folder. The sheet is cut into frames of one size, numbered row by row from 0. The anchor is the point of a frame placed at an entity\'s position; left out, it is the feet (middle of the bottom edge).',
    z.object({ name: z.string().min(1), image: z.string().min(1), frame_width: z.number().int(), frame_height: z.number().int(), anchor_x: z.number().int().optional(), anchor_y: z.number().int().optional() }),
    async ({ name, image, frame_width: width, frame_height: height, anchor_x, anchor_y }, context) => {
      const { docs } = await documents(context)
      if (!SPRITE_SIZES.some(([w, h]) => w === width && h === height)) throw new HttpError(400, `${width}x${height} is not a GBA sprite size; sizes are: ${SPRITE_SIZES.map(([w, h]) => `${w}x${h}`).join(', ')}`)
      const picture = await loadPng(context.project, image)
      const frames = Math.floor(picture.width / width) * Math.floor(picture.height / height)
      if (frames === 0) throw new HttpError(400, `${image} is ${picture.width}x${picture.height} px, smaller than one ${width}x${height} frame`)
      const id = uniqueId(slugify(name), Object.keys(docs.sprites))
      const sprite = { version: FORMAT_VERSION, name, image, frame: { width, height }, anchor: { x: anchor_x ?? width / 2, y: anchor_y ?? height }, animations: [] }
      return saveAndReport(context, 'sprite', id, sprite, `Created sprite "${id}": ${frames} frames of ${width}x${height}.`)
    },
  ),

  tool(
    'sprite_set_animation',
    'Adds an animation to a sprite, or replaces the one of that name. Frames play in the order given; a duration is in ticks of 1/60 s. Look at the sheet with render_sprite to find frame numbers.',
    z.object({
      sprite: Id,
      name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'snake_case'),
      frames: z.array(z.object({ index: z.number().int().min(0), duration: z.number().int().min(1).max(255) })).min(1),
      loop: z.boolean().default(true),
    }),
    async ({ sprite: id, name, frames, loop }, context) => {
      const { docs } = await documents(context)
      const sprite = docs.sprites[id]
      if (!sprite) throw new HttpError(404, `no sprite "${id}"; sprites are: ${Object.keys(docs.sprites).join(', ') || 'none'}`)
      const picture = await loadPng(context.project, sprite.image).catch(() => null)
      if (picture) {
        const count = Math.floor(picture.width / sprite.frame.width) * Math.floor(picture.height / sprite.frame.height)
        const bad = frames.find((f) => f.index >= count)
        if (bad) throw new HttpError(400, `the sheet has ${count} frames, numbered 0 to ${count - 1}; there is no frame ${bad.index}`)
      }
      const animation = { name, frames, loop }
      const exists = sprite.animations.some((a) => a.name === name)
      const animations = exists ? sprite.animations.map((a) => (a.name === name ? animation : a)) : [...sprite.animations, animation]
      return saveAndReport(context, 'sprite', id, { ...sprite, animations }, `${exists ? 'Replaced' : 'Added'} animation "${name}" of ${id}: ${frames.length} steps, ${frames.reduce((sum, f) => sum + f.duration, 0)} ticks.`)
    },
  ),

  tool('sprite_remove_animation', 'Removes an animation from a sprite.', z.object({ sprite: Id, name: z.string() }), async ({ sprite: id, name }, context) => {
    const { docs } = await documents(context)
    const sprite = docs.sprites[id]
    if (!sprite) throw new HttpError(404, `no sprite "${id}"`)
    if (!sprite.animations.some((a) => a.name === name)) throw new HttpError(404, `${id} has no animation "${name}"; it has: ${sprite.animations.map((a) => a.name).join(', ') || 'none'}`)
    return saveAndReport(context, 'sprite', id, { ...sprite, animations: sprite.animations.filter((a) => a.name !== name) }, `Removed animation "${name}" from ${id}.`)
  }),

  tool(
    'sprite_set_geometry',
    'Sets a sprite\'s anchor and hitbox, in pixels within a frame. Pass hitbox null to remove it.',
    z.object({
      sprite: Id,
      anchor: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
      hitbox: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).nullable().optional(),
    }),
    async ({ sprite: id, anchor, hitbox }, context) => {
      const { docs } = await documents(context)
      const sprite = docs.sprites[id]
      if (!sprite) throw new HttpError(404, `no sprite "${id}"`)
      return saveAndReport(context, 'sprite', id, { ...sprite, ...(anchor ? { anchor } : {}), ...(hitbox !== undefined ? { hitbox: hitbox ?? undefined } : {}) }, `Updated ${id}.`)
    },
  ),

  tool('render_sprite', 'Draws a sprite\'s sheet enlarged with a line between frames. Frames are numbered row by row from 0 at the top-left.', z.object({ sprite: Id, scale: z.number().int().min(1).max(8).default(4) }), async ({ sprite: id, scale: factor }, context) => {
    const { docs } = await documents(context)
    const sprite = docs.sprites[id]
    if (!sprite) throw new HttpError(404, `no sprite "${id}"; sprites are: ${Object.keys(docs.sprites).join(', ') || 'none'}`)
    if (!sprite.image.toLowerCase().endsWith('.png')) throw new HttpError(409, `${sprite.image} is not a PNG and cannot be drawn here`)
    const { picture, cols, rows } = await renderSheet(context.project, sprite.image, sprite.frame.width, sprite.frame.height, factor)
    const animations = sprite.animations.map((a) => `${a.name}: frames ${a.frames.map((f) => `${f.index} (${f.duration})`).join(', ')}${a.loop ? ', loops' : ''}`)
    return {
      text: `${id}: ${cols * rows} frames of ${sprite.frame.width}x${sprite.frame.height} in ${cols} columns, drawn at ${factor}x. Anchor ${sprite.anchor.x}, ${sprite.anchor.y}.${sprite.hitbox ? ` Hitbox ${sprite.hitbox.width}x${sprite.hitbox.height} at ${sprite.hitbox.x}, ${sprite.hitbox.y}.` : ''}\nAnimations (frame and its ticks): ${animations.join('; ') || 'none'}.`,
      images: [encodePng(picture)],
    }
  }),

  tool(
    'entity_type_set',
    'Adds an entity type to the project, or changes the one with that id: its name, colour in the editor, sprite, and the typed properties each placed entity carries. What the type does in the game is Rust code matching on data::EntityKind.',
    z.object({
      id: Id,
      name: z.string().min(1).optional(),
      colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      sprite: Id.nullable().optional().describe('A sprite id, or null for none'),
      props: z.array(PropertyDef).optional().describe('Replaces the type\'s property definitions'),
    }),
    async ({ id, name, colour, sprite, props }, context) => {
      const { docs } = await documents(context)
      const project = docs.project
      if (!project) throw new HttpError(409, 'studio/project.json is missing or has errors')
      const existing = project.entityTypes.find((t) => t.id === id)
      const type = {
        ...(existing ?? { id, name: name ?? id, colour: '#f5a524', props: [] }),
        ...(name ? { name } : {}),
        ...(colour ? { colour } : {}),
        ...(sprite !== undefined ? { sprite: sprite ?? undefined } : {}),
        ...(props ? { props } : {}),
      }
      const entityTypes = existing ? project.entityTypes.map((t) => (t.id === id ? type : t)) : [...project.entityTypes, type]
      return saveAndReport(context, 'project', undefined, { ...project, entityTypes }, `${existing ? 'Updated' : 'Added'} entity type "${id}".`)
    },
  ),

  tool('entity_type_remove', 'Removes an entity type from the project. Entities of that type left in rooms are then reported as problems.', z.object({ id: Id }), async ({ id }, context) => {
    const { docs } = await documents(context)
    const project = docs.project
    if (!project?.entityTypes.some((t) => t.id === id)) throw new HttpError(404, `no entity type "${id}"`)
    await context.project.save('project', undefined, { ...project, entityTypes: project.entityTypes.filter((t) => t.id !== id) })
    const { problems } = await context.project.load()
    return { text: `Removed entity type "${id}".\n${problemLines(problems)}` }
  }),

  tool(
    'audio_add',
    'Adds a music or sound file that is already in the game folder to the project: WAV as a sound effect, XM and MOD as music tracks, MIDI as a track played through an SF2 soundfont (name it, or the first one in the folder is used).',
    z.object({ file: z.string().min(1), name: z.string().min(1).optional(), soundfont: z.string().optional() }),
    async ({ file, name, soundfont }, context) => {
      const { docs, assets } = await context.project.load()
      if (!assets.some((a) => a.path === file)) throw new HttpError(404, `${file} is not an asset file in the game folder; see list_assets`)
      const audio = docs.audio ?? { version: FORMAT_VERSION, tracks: [], sfx: [] }
      const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
      const title = name ?? file.split('/').pop()!.replace(/\.[^.]+$/, '')
      if (extension === 'wav') {
        const id = uniqueId(slugify(title), audio.sfx.map((s) => s.id))
        return saveAndReport(context, 'audio', undefined, { ...audio, sfx: [...audio.sfx, { id, name: title, file }] }, `Added sound effect "${id}".`)
      }
      const format = ({ mid: 'midi', midi: 'midi', xm: 'xm', mod: 'mod' } as const)[extension]
      if (!format) throw new HttpError(400, `.${extension} is not a music or sound format the studio handles (wav, xm, mod, mid)`)
      const font = format === 'midi' ? (soundfont ?? assets.find((a) => a.path.toLowerCase().endsWith('.sf2'))?.path) : undefined
      if (format === 'midi' && !font) throw new HttpError(409, 'a MIDI file needs an SF2 soundfont to make sound, and there is none in the game folder; ask the author for one')
      const id = uniqueId(slugify(title), audio.tracks.map((t) => t.id))
      return saveAndReport(context, 'audio', undefined, { ...audio, tracks: [...audio.tracks, { id, name: title, file, format, ...(font ? { soundfont: font } : {}) }] }, `Added track "${id}" (${format}).`)
    },
  ),

  tool('studio_view', 'Says what the author has open in the studio right now: the room, tileset or sprite on screen, and in a room the layer and entity selected. Use it to resolve "this room" or "the selected entity".', z.object({}), async (_args, context) => {
    if (!context.studio) return { text: 'No studio is attached to this server. This tool works through the running studio\'s own MCP endpoint (http://127.0.0.1:4517/mcp by default).' }
    const view = context.studio.view()
    return { text: view ? json(view) : 'The studio is running, but no page of it is open in a browser.' }
  }),

  tool(
    'studio_open',
    'Opens an item in the author\'s studio so they see it: a room, tileset or sprite by id, or the world map, audio list, project settings, Physics tab, Play panel, or the Tools gallery (kind tools; id tileset-generator opens the tileset generator, pixel-art the pixel art converter).',
    z.object({ kind: z.enum(['world', 'project', 'physics', 'audio', 'play', 'tools', 'room', 'tileset', 'sprite']), id: Id.optional() }),
    async ({ kind, id }, context) => {
      if (!context.studio) return { text: 'No studio is attached to this server. This tool works through the running studio\'s own MCP endpoint.' }
      if ((kind === 'room' || kind === 'tileset' || kind === 'sprite') && !id) throw new HttpError(400, `a ${kind} needs an id`)
      const pages = context.studio.open({ kind, ...(id ? { id } : {}) })
      return { text: pages ? `Opened ${kind}${id ? ` "${id}"` : ''} in the studio.` : 'The studio is running, but no page of it is open in a browser.' }
    },
  ),

  tool(
    'build',
    'Runs the project\'s build command and waits for it. Returns the exit code and the end of the output. A release build of a GBA game can take minutes.',
    z.object({ mode: z.enum(['dev', 'release']).default('dev') }),
    async ({ mode }, context) => {
      const status = await context.builder.run(mode)
      const rom = status.roms[mode]
      return {
        text: `${status.exitCode === 0 ? 'Build succeeded' : `Build failed with exit code ${status.exitCode}`} in ${status.seconds}s.\n${rom ? `ROM: ${rom.path} (${rom.size} bytes)` : 'No ROM was produced.'}\n\n$ ${status.command}\n${status.log.slice(-80).join('\n')}`,
      }
    },
  ),

  tool(
    'patch_rom',
    'Puts the project\'s current level data (tiles, collision, entities and their properties, room placement, physics) into the built ROM without compiling, in well under a second. Says when a build is needed instead: new entity types, rooms, sprites, tilesets, pictures or tracks, or more data than the ROM has room for. Then run the build tool.',
    z.object({ mode: z.enum(['dev', 'release']).default('dev') }),
    async ({ mode }, context) => {
      const result = await patchRom(context.project, context.builder, mode)
      return { text: describePatch(result) }
    },
  ),

  tool(
    'run_rom',
    'Runs the built ROM without a screen and returns pictures of the game. Give steps: how many frames to run (60 is about a second) and which buttons to hold meanwhile. One picture is returned at the end of each step. The game always starts from power-on. Build first.',
    z.object({
      mode: z.enum(['dev', 'release']).default('dev'),
      steps: z
        .array(z.object({ frames: z.number().int().min(1).max(3600), keys: z.array(z.enum(Object.keys(KEY_BITS) as [keyof typeof KEY_BITS, ...(keyof typeof KEY_BITS)[]])).default([]) }))
        .min(1)
        .max(12),
    }),
    async ({ mode, steps }, context) => {
      const status = await context.builder.status()
      const rom = status.roms[mode]
      if (!rom) throw new HttpError(409, `there is no ${mode} ROM yet; run the build tool first`)
      const screens = await runRom(await readFile(context.project.resolve(rom.path)), steps)
      const lines = steps.map((step, i) => `${i + 1}. ${step.frames} frames holding ${step.keys.join(' + ') || 'nothing'}`)
      // So a game that does not show the last edit is not taken for one that ignores it.
      const note = staleNote(await romStatus(context.project, context.builder, mode).catch(() => ({ state: 'none' as const, mode })))
      return { text: `Ran ${rom.path}. One picture per step, enlarged 2x:\n${lines.join('\n')}${note ? `\n\n${note}` : ''}`, images: screens.map((screen) => encodePng(scale(screen, 2))) }
    },
  ),
  ...GENERATOR_TOOLS,
]

/**
 * JSON Schema of every document kind, for editors and agents that want the format itself,
 * and under `behaviours` the properties of each behaviour an entity type can list.
 */
export function documentSchemas(): Record<string, unknown> {
  const documents = Object.entries({ ...SINGLE_DOCS, ...MULTI_DOCS }).map(([kind, schema]) => [kind, z.toJSONSchema(schema, { io: 'input' })])
  return { ...Object.fromEntries(documents), behaviours: BEHAVIOURS }
}
