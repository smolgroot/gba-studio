// Checks that a new patrolling enemy can be made from a PNG with no change to the
// game's Rust, and plays (US-012). It works on a copy of the sample in a temporary
// folder and uses only the MCP tools an agent has:
//   1. draws a 16x16 PNG into the copy's assets/ (a throwaway folder, nobody's art);
//   2. sprite_create, entity_type_set, entity_type_add_behaviour (patrol, hazard),
//      entity_add, build;
//   3. run_rom, and reads the pictures: the enemy is drawn and moves, and the hero it
//      walks into is sent back to where it entered the room.
// The copy's src/ is the sample's, unchanged. Needs the sample's toolchain (its pinned
// nightly, agb-gbafix) and the emulator core; the build is a cold one, a few minutes.
//
//   node scripts/check-new-enemy.ts [--keep] [--out <dir>]
//
// --keep leaves the copy; --out writes the pictures there.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Builder } from '../server/src/build.ts'
import { ProjectFolder } from '../server/src/project.ts'
import { encodePng, loadPng } from '../server/src/render.ts'
import type { Picture } from '../server/src/render.ts'
import { TOOLS } from '../server/src/tools.ts'
import type { ToolContext } from '../server/src/tools.ts'

const { values } = parseArgs({ options: { keep: { type: 'boolean' }, out: { type: 'string' } } })
const REPO = fileURLToPath(new URL('..', import.meta.url))
const SAMPLE = path.join(REPO, 'sample')
const ORANGE = [255, 128, 0] as const

const folder = mkdtempSync(path.join(tmpdir(), 'pecten-new-enemy-'))
console.log(`copy of the sample: ${folder}`)
const fail = (message: string): never => {
  console.error(`FAILED: ${message}`)
  if (!values.keep) rmSync(folder, { recursive: true, force: true })
  process.exit(1)
}

// The sample without its build output, its crates pointed at this repository's.
for (const part of ['studio', 'assets', 'src', '.cargo', 'build.rs', 'Cargo.lock', 'rust-toolchain.toml']) cpSync(path.join(SAMPLE, part), path.join(folder, part), { recursive: true })
writeFileSync(path.join(folder, 'Cargo.toml'), readFileSync(path.join(SAMPLE, 'Cargo.toml'), 'utf8').replaceAll('path = "../', `path = "${REPO}`))

// A 16x16 crawler: an orange body with two dark eyes, on a transparent background.
const sheet: Picture = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) }
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const at = (y * 16 + x) * 4
    const body = y >= 6 && x >= 2 && x < 14
    const eye = y === 8 && (x === 5 || x === 10)
    const [r, g, b] = eye ? [20, 20, 20] : ORANGE
    sheet.data.set(body ? [r, g, b, 255] : [0, 0, 0, 0], at)
  }
}
mkdirSync(path.join(folder, 'assets/sprites'), { recursive: true })
writeFileSync(path.join(folder, 'assets/sprites/crawler.png'), encodePng(sheet))

const project = new ProjectFolder(folder)
const context: ToolContext = { project, builder: new Builder(project, () => {}) }
async function call(name: string, args: Record<string, unknown>) {
  const tool = TOOLS.find((t) => t.name === name)!
  const answer = await tool.run(tool.input.parse(args) as never, context)
  console.log(`> ${name} ${JSON.stringify(args)}\n${answer.text.split('\n').slice(0, 3).join('\n')}`)
  return answer
}
const clean = (text: string) => text.includes('No problems') || fail(`a tool left problems:\n${text}`)

// The hero starts at x 24 on the entry room's floor (y 136). The crawler walks 32 px
// each way around x 48, one pixel a frame: out to the right first, then back to x 16.
clean((await call('sprite_create', { name: 'Crawler', image: 'assets/sprites/crawler.png', frame_width: 16, frame_height: 16 })).text)
clean((await call('entity_type_set', { id: 'crawler', name: 'Crawler', sprite: 'crawler' })).text)
clean((await call('entity_type_add_behaviour', { type: 'crawler', behaviour: 'patrol', props: { patrol: 32, patrol_pace: 1 } })).text)
clean((await call('entity_type_add_behaviour', { type: 'crawler', behaviour: 'hazard' })).text)
clean((await call('entity_add', { room: 'entry', type: 'crawler', x: 48, y: 136 })).text)
if (readFileSync(path.join(folder, 'src/main.rs'), 'utf8') !== readFileSync(path.join(SAMPLE, 'src/main.rs'), 'utf8')) fail('the game\'s Rust changed')

const built = await call('build', { mode: 'dev' })
if (!built.text.startsWith('Build succeeded')) fail(built.text)

// Pictures (2x) after: 50 frames; 8 more; 12 frames walking left, to x ~14; 50 frames
// standing, while the crawler walks left over the hero.
const ran = await call('run_rom', { steps: [{ frames: 50 }, { frames: 8 }, { frames: 12, keys: ['Left'] }, { frames: 50 }] })
const images = ran.images ?? []
if (images.length !== 4) fail(`run_rom gave ${images.length} pictures`)
mkdirSync(path.join(folder, 'shots'), { recursive: true })
images.forEach((png, i) => writeFileSync(path.join(folder, `shots/${i + 1}.png`), png as Buffer))
const pictures = await Promise.all(images.map((_, i) => loadPng(project, `shots/${i + 1}.png`)))
if (values.out) {
  mkdirSync(values.out, { recursive: true })
  images.forEach((png, i) => writeFileSync(path.join(values.out!, `new-enemy-${i + 1}.png`), png as Buffer))
}

/** The middle x, in game pixels, of the pixels near a colour; null if none. */
function middle(picture: Picture, [r, g, b]: readonly number[]): number | null {
  const xs: number[] = []
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const at = (y * picture.width + x) * 4
      if (Math.abs(picture.data[at]! - r) < 24 && Math.abs(picture.data[at + 1]! - g) < 24 && Math.abs(picture.data[at + 2]! - b) < 24) xs.push(x)
    }
  }
  return xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 / 2 : null
}
const HERO = [74, 156, 255]
const crawler = pictures.map((p) => middle(p, ORANGE))
const hero = pictures.map((p) => middle(p, HERO))
console.log(`crawler x: ${crawler.join(', ')}\nhero x: ${hero.join(', ')}`)

if (crawler[0] === null || crawler[1] === null) fail('the crawler is not drawn')
if (Math.abs(crawler[1]! - crawler[0]!) < 4) fail('the crawler does not move')
if (hero[2] === null || hero[3] === null) fail('the hero is not drawn')
// Walking left took the hero away from the start; only being hurt brings it back.
if (!(hero[2]! < hero[0]! - 4 && Math.abs(hero[3]! - hero[0]!) < 3)) fail('the crawler did not send the hero back')
console.log('OK: a new patrolling enemy, made from a PNG with no Rust change, moves and hurts the hero.')
if (!values.keep) rmSync(folder, { recursive: true, force: true })
