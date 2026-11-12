// Writes the sample project's documents under sample/studio/: two rooms on the world
// grid, built from the placeholder tileset. Run after changing the format.
import { mkdirSync, writeFileSync } from 'node:fs'
import { FORMAT_VERSION, SCREEN, docPath, newProject, rleEncode } from '../core/src/index.ts'
import type { DocKind, Room, Tileset } from '../core/src/index.ts'

const root = new URL('../sample/', import.meta.url)
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
shaft.fill(0, 0, 2, 37, ROCK)
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

write('project', undefined, project)
write('audio', undefined, audio)
write('tileset', 'tiles', tiles)
for (const [id, room] of Object.entries(rooms)) write('room', id, room)
write('world', undefined, { ...world, rooms: [{ room: 'entry', x: 0, y: 1 }, { room: 'shaft', x: 2, y: 0 }], start: 'entry' })
console.log('wrote sample/studio/')
