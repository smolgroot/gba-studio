// Checks across documents: the references and sizes a single schema cannot see.
import { budgetProblems } from './budget.ts'
import type { ArtLookup } from './budget.ts'
import { behaviourEntityProblems, behaviourTypeProblems, isBehaviourProp } from './behaviours.ts'
import { propertyAllows, propertyMisfit } from './properties.ts'
import { refProblems } from './refs.ts'
import { rleLength } from './rle.ts'
import { MAX_SCREEN_LAYERS, SCREEN, SPRITE_SIZES, docPath } from './schema.ts'
import type { Audio, Project, Room, Sprite, Tileset, World } from './schema.ts'

export interface Problem {
  severity: 'error' | 'warning'
  /** File the problem is in, relative to the game folder. */
  file: string
  message: string
}

/** Every document of a project that parsed. A missing or broken one is absent and reported separately. */
export interface Documents {
  project?: Project
  world?: World
  audio?: Audio
  tilesets: Record<string, Tileset>
  sprites: Record<string, Sprite>
  rooms: Record<string, Room>
}

function duplicates(ids: string[]): string[] {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
}

/**
 * Every problem across the documents. With `art`, the cost of the tileset and
 * background images, the tile and palette budgets are checked too.
 */
export function validateProject(docs: Documents, assetExists: (path: string) => boolean, art?: ArtLookup): Problem[] {
  const problems: Problem[] = []
  const add = (severity: Problem['severity'], file: string, message: string) => problems.push({ severity, file, message })
  const needAsset = (file: string, path: string) => {
    if (!assetExists(path)) add('error', file, `file not found: ${path}`)
  }

  const { project, world, audio } = docs
  const classes = new Set(project?.collisionClasses.map((c) => c.id))
  const entityTypes = new Map(project?.entityTypes.map((e) => [e.id, e]))
  const tracks = new Set(audio?.tracks.map((t) => t.id))

  if (project) {
    const file = docPath('project')
    for (const id of duplicates(project.collisionClasses.map((c) => c.id))) add('error', file, `collision class "${id}" is defined twice`)
    for (const id of duplicates(project.entityTypes.map((e) => e.id))) add('error', file, `entity type "${id}" is defined twice`)
    for (const type of project.entityTypes) {
      if (type.sprite && !docs.sprites[type.sprite]) add('error', file, `entity type "${type.id}" uses unknown sprite "${type.sprite}"`)
      for (const name of duplicates(type.props.map((p) => p.name))) add('error', file, `entity type "${type.id}" has property "${name}" twice`)
      // The game keeps an int in 32 bits, so a default past that would wrap when the game is built.
      for (const def of type.props) {
        if (def.type === 'int' && propertyMisfit({ ...def, min: undefined, max: undefined }, def.default) !== null) {
          add('error', file, `entity type "${type.id}": property "${def.name}" has default ${def.default}; it is ${propertyAllows({ ...def, min: undefined, max: undefined })}`)
        }
      }
    }
    for (const message of behaviourTypeProblems(project.entityTypes)) add('error', file, message)
  }

  for (const [id, tileset] of Object.entries(docs.tilesets)) {
    const file = docPath('tileset', id)
    needAsset(file, tileset.image)
    if (project) {
      for (const [tile, cls] of Object.entries(tileset.collision)) {
        if (!classes.has(cls)) add('error', file, `tile ${tile} uses unknown collision class "${cls}"`)
      }
    }
  }

  for (const [id, sprite] of Object.entries(docs.sprites)) {
    const file = docPath('sprite', id)
    needAsset(file, sprite.image)
    if (sprite.palette) needAsset(file, sprite.palette)
    const { width, height } = sprite.frame
    if (!SPRITE_SIZES.some(([w, h]) => w === width && h === height)) {
      add('error', file, `frame ${width}x${height} is not a GBA sprite size (${SPRITE_SIZES.map(([w, h]) => `${w}x${h}`).join(', ')})`)
    }
    for (const name of duplicates(sprite.animations.map((a) => a.name))) add('error', file, `animation "${name}" is defined twice`)
  }

  for (const [id, room] of Object.entries(docs.rooms)) {
    const file = docPath('room', id)
    const cells = room.width * SCREEN.cols * room.height * SCREEN.rows
    if (!docs.tilesets[room.tileset]) add('error', file, `unknown tileset "${room.tileset}"`)
    for (const layer of room.layers) {
      const length = rleLength(layer.data)
      if (length === null) add('error', file, `layer "${layer.name}" has malformed tile data`)
      else if (length !== cells) add('error', file, `layer "${layer.name}" holds ${length} cells, the room has ${cells}`)
    }
    const backgrounds = room.backgrounds ?? []
    for (const background of backgrounds) {
      needAsset(file, background.image)
      if (!background.image.toLowerCase().endsWith('.png')) add('error', file, `background ${background.image} is not a PNG`)
    }
    if (room.layers.length + backgrounds.length > MAX_SCREEN_LAYERS) {
      add('error', file, `${room.layers.length} tile layers and ${backgrounds.length} backgrounds are ${room.layers.length + backgrounds.length} layers; the GBA draws ${MAX_SCREEN_LAYERS} at once`)
    }
    const level = room.dimLevel ?? 0
    const dimmed = [...room.layers, ...backgrounds].some((layer) => layer.dim === true)
    if (level > 0 && !dimmed) add('warning', file, `no layer is dimmed, so the dim level ${level} does nothing: turn dim on for a layer or set the level to 0`)
    if (level === 0) {
      for (const layer of room.layers) if (layer.dim) add('warning', file, `layer "${layer.name}" is set to dim, but the dim level is 0, so nothing is darkened: raise the level or turn dim off`)
      backgrounds.forEach((background, n) => {
        if (background.dim) add('warning', file, `background ${n + 1} (${background.image}) is set to dim, but the dim level is 0, so nothing is darkened: raise the level or turn dim off`)
      })
    }
    if (room.collision) {
      const length = rleLength(room.collision)
      if (length !== cells) add('error', file, `collision overrides hold ${length ?? 'malformed'} cells, the room has ${cells}`)
    }
    for (const [i, entity] of room.entities.entries()) {
      const type = entityTypes.get(entity.type)
      if (project && !type) add('error', file, `entity ${i} has unknown type "${entity.type}"`)
      if (entity.x >= room.width * SCREEN.width || entity.y >= room.height * SCREEN.height) add('error', file, `entity ${i} (${entity.type}) is outside the room`)
      for (const name of Object.keys(entity.props)) {
        if (type && !type.props.some((p) => p.name === name) && !isBehaviourProp(type, name)) {
          add('warning', file, `entity ${i} (${entity.type}) has a property "${name}" its type does not define`)
        }
      }
      // A stored value must still fit what its type says (US-016).
      if (type) {
        for (const def of type.props) {
          const value = entity.props[def.name]
          const problem = value === undefined ? null : propertyMisfit(def, value)
          if (problem) add('error', file, `entity ${i} (${entity.type}): ${problem}`)
        }
      }
      if (type) for (const message of behaviourEntityProblems(i, type, entity)) add('error', file, message)
    }
    if (room.music && audio && !tracks.has(room.music)) add('error', file, `unknown music track "${room.music}"`)
    if (world && !world.rooms.some((r) => r.room === id)) add('warning', file, 'not placed in the world')
  }

  if (world) {
    const file = docPath('world')
    for (const id of duplicates(world.rooms.map((r) => r.room))) add('error', file, `room "${id}" is placed twice`)
    const placed = world.rooms.flatMap((r) => {
      const room = docs.rooms[r.room]
      if (!room) add('error', file, `unknown room "${r.room}"`)
      return room ? [{ id: r.room, x: r.x, y: r.y, w: room.width, h: room.height }] : []
    })
    const size = world.size
    if (size) {
      for (const p of placed) {
        if (p.x < 0 || p.y < 0 || p.x + p.w > size.width || p.y + p.h > size.height) add('error', file, `room "${p.id}" is outside the ${size.width}×${size.height} map`)
      }
    }
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) add('error', file, `rooms "${a.id}" and "${b.id}" overlap`)
      }
    }
    if (world.start && !docs.rooms[world.start]) add('error', file, `start room "${world.start}" does not exist`)
    if (!world.start && placed.length > 0) add('warning', file, 'no start room chosen')
  }

  if (audio) {
    const file = docPath('audio')
    for (const id of duplicates(audio.tracks.map((t) => t.id))) add('error', file, `track "${id}" is defined twice`)
    for (const id of duplicates(audio.sfx.map((s) => s.id))) add('error', file, `sound effect "${id}" is defined twice`)
    for (const track of audio.tracks) {
      needAsset(file, track.file)
      if (track.soundfont) needAsset(file, track.soundfont)
    }
    for (const sfx of audio.sfx) needAsset(file, sfx.file)
  }

  // References between entities, and the ids they name (US-017).
  for (const { file, message } of refProblems(docs)) add('error', file, message)

  if (art) problems.push(...budgetProblems(docs, art))
  return problems
}
