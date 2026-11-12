// Writes the sample project's documents under sample/studio/: two rooms on the world
// grid, built from the placeholder tileset. Run after changing the format.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { FORMAT_VERSION, SCREEN, docPath, newProject, rleEncode } from '../core/src/index.ts'
import type { DocKind, Room, Sprite, Tileset } from '../core/src/index.ts'

const root = new URL('../sample/', import.meta.url)
// The sample is also where people try the studio: never write over their work unasked.
if (existsSync(new URL('studio/project.json', root)) && !process.argv.includes('--force')) {
  console.error('sample/studio already exists. Pass --force to replace its documents with the generated ones.')
  process.exit(1)
}
function write(kind: DocKind, id: string | undefined, data: unknown): void {
  const file = new URL(docPath(kind, id), root)
  mkdirSync(new URL('.', file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

// Cells are tile index + 1; 0 is empty. Tile numbers follow make-sample-assets.ts.
const ROCK = 2, TOP = 3, GIRDER = 4, UP = 5, DOWN = 6, SPIKES = 7, WALL = 8

function grid(screensWide: number, screensTall: number) {
  const cols = screensWide * SCREEN.cols
  const rows = screensTall * SCREEN.rows
  const cells = new Uint16Array(cols * rows)
  return {
    cols,
    rows,
    cells,
    fill(x: number, y: number, w: number, h: number, cell: number) {
      for (let r = y; r < y + h; r++) cells.fill(cell, r * cols + x, r * cols + x + w)
    },
    /** A floor: a top-edge row over rock down to the bottom of the room. */
    ground(x: number, y: number, w: number) {
      this.fill(x, y, w, 1, TOP)
      this.fill(x, y + 1, w, rows - y - 1, ROCK)
    },
  }
}

const { project, world, audio } = newProject('Sample Metroidvania')

const tiles: Tileset = {
  version: FORMAT_VERSION,
  name: 'Placeholder tiles',
  image: 'assets/tiles.png',
  collision: { '1': 'solid', '2': 'solid', '3': 'oneway', '4': 'slope-up', '5': 'slope-down', '6': 'hazard' },
}

// Two screens wide: a floor with a ramp up to a ledge, a girder, and a spike pit.
const entry = grid(2, 1)
const entryBack = grid(2, 1)
entry.ground(0, 17, 60)
entry.fill(24, 16, 1, 1, UP)
entry.ground(25, 16, 12)
entry.fill(37, 16, 1, 1, DOWN)
entry.fill(12, 12, 6, 1, GIRDER)
entry.fill(44, 17, 4, 1, SPIKES)
entry.fill(0, 0, 1, 17, ROCK)
entryBack.fill(26, 8, 10, 8, WALL)

// One screen wide, two tall: a shaft with girders to climb.
const shaft = grid(1, 2)
shaft.ground(0, 37, 30)
// The left wall stops three tiles above the floor: the doorway from the entry room.
shaft.fill(0, 0, 2, 34, ROCK)
shaft.fill(28, 0, 2, 17, ROCK)
shaft.fill(28, 20, 2, 17, ROCK)
for (const [x, y] of [[4, 31], [16, 26], [6, 21], [18, 15], [8, 9]] as const) shaft.fill(x, y, 6, 1, GIRDER)

const rooms: Record<string, Room> = {
  entry: {
    version: FORMAT_VERSION,
    name: 'Entry',
    width: 2,
    height: 1,
    tileset: 'tiles',
    layers: [
      { name: 'Back wall', data: rleEncode(entryBack.cells) },
      { name: 'Ground', data: rleEncode(entry.cells) },
    ],
    entities: [{ type: 'player-start', x: 24, y: 136, props: {} }],
  },
  shaft: {
    version: FORMAT_VERSION,
    name: 'Shaft',
    width: 1,
    height: 2,
    tileset: 'tiles',
    layers: [{ name: 'Ground', data: rleEncode(shaft.cells) }],
    entities: [],
  },
}

// The hero: frames follow make-sample-assets.ts (idle, two run frames, jump).
const hero: Sprite = {
  version: FORMAT_VERSION,
  name: 'Hero',
  image: 'assets/hero.png',
  frame: { width: 16, height: 16 },
  anchor: { x: 6, y: 16 },
  hitbox: { x: 2, y: 2, width: 9, height: 14 },
  animations: [
    { name: 'idle', frames: [{ index: 0, duration: 60 }], loop: true },
    { name: 'run', frames: [{ index: 1, duration: 6 }, { index: 2, duration: 6 }], loop: true },
    { name: 'jump', frames: [{ index: 3, duration: 60 }], loop: true },
  ],
}
project.entityTypes = [{ id: 'player-start', name: 'Player start', colour: '#3e63dd', sprite: 'hero', props: [] }]
project.build = { dev: 'mkdir -p dist && cargo build && agb-gbafix target/thumbv4t-none-eabi/debug/sample -o dist/sample-dev.gba', devRom: 'dist/sample-dev.gba', release: 'mkdir -p dist && cargo build --release && agb-gbafix target/thumbv4t-none-eabi/release/sample -o dist/sample.gba', releaseRom: 'dist/sample.gba' }

write('sprite', 'hero', hero)
write('project', undefined, project)
write('audio', undefined, audio)
write('tileset', 'tiles', tiles)
for (const [id, room] of Object.entries(rooms)) write('room', id, room)
write('world', undefined, { ...world, rooms: [{ room: 'entry', x: 0, y: 1 }, { room: 'shaft', x: 2, y: 0 }], start: 'entry' })
console.log('wrote sample/studio/')
