// What an agent can do to a project. Every tool goes through the same code as the
// studio: documents are checked against the schemas before they are written, and
// nothing is read or written outside the game folder.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { FORMAT_VERSION, Id, MULTI_DOCS, SCREEN, SINGLE_DOCS, TILE, docPath, emptyRoom, resizeRoom, rleEncode, slugify, uniqueId } from '@gba-studio/core'
import type { DocKind, Documents, Problem, Room } from '@gba-studio/core'
import type { Builder } from './build.ts'
import { KEY_BITS, runRom } from './emulator.ts'
import { HttpError } from './project.ts'
import type { ProjectFolder } from './project.ts'
import { effectiveCollision, encodePng, loadPng, renderRoom, renderTileset, roomCells, scale } from './render.ts'

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

export interface ToolContext {
  project: ProjectFolder
  builder: Builder
}

const Kind = z.enum(['project', 'world', 'audio', 'room', 'tileset', 'sprite'])
const LayerRef = z.union([z.number().int().min(0), z.string()]).describe('A tile layer by index (0 is the back layer) or by name, or "collision" for the collision overrides')
const CellValue = z
  .union([z.number().int().min(-1), z.string(), z.null()])
  .describe('On a tile layer: a tile number of the room\'s tileset (0 is its top-left tile), or -1 for empty. On "collision": a collision class id, or null to give the cell back to its tile\'s own class')

function tool<S extends z.ZodType>(name: string, description: string, input: S, run: (args: z.infer<S>, context: ToolContext) => Promise<ToolResult>): Tool {
  return { name, description, input, run: run as Tool['run'] }
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)

function problemLines(problems: Problem[], file?: string): string {
  const shown = file ? problems.filter((p) => p.file === file) : problems
  if (shown.length === 0) return file ? `No problems in ${file}.` : 'No problems in the project.'
  return shown.map((p) => `${p.severity}: ${p.file}: ${p.message}`).join('\n')
}

async function documents(context: ToolContext): Promise<{ docs: Documents; problems: Problem[] }> {
  const bundle = await context.project.load()
  if (!bundle.initialised) throw new HttpError(409, 'this folder has no studio project (no studio/project.json)')
  return bundle
}

function roomOf(docs: Documents, id: string): Room {
  const room = docs.rooms[id]
  if (!room) throw new HttpError(404, `no room "${id}"; rooms are: ${Object.keys(docs.rooms).join(', ') || 'none'}`)
  return room
}

/** Saves a document and says what the project's checks make of it. */
async function saveAndReport(context: ToolContext, kind: DocKind, id: string | undefined, doc: unknown, done: string): Promise<ToolResult> {
  await context.project.save(kind, id, doc)
  const { problems } = await context.project.load()
  return { text: `${done}\n${problemLines(problems, docPath(kind, id))}` }
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
                layers: room.layers.map((l) => l.name),
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
    'Draws a room, or a rectangle of it given in tiles, as an image, so you can look at what is there. Blue lines are screen boundaries; entities are small squares in their type\'s colour.',
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
      return { text: `Ran ${rom.path}. One picture per step, enlarged 2x:\n${lines.join('\n')}`, images: screens.map((screen) => encodePng(scale(screen, 2))) }
    },
  ),
]

/** JSON Schema of every document kind, for editors and agents that want the format itself. */
export function documentSchemas(): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ ...SINGLE_DOCS, ...MULTI_DOCS }).map(([kind, schema]) => [kind, z.toJSONSchema(schema, { io: 'input' })]))
}
