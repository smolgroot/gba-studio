// What a ROM was compiled from that cannot be read back out of it: the game's Rust
// code, sprite and audio documents, and the pictures and sounds the documents name.
// A build records their hashes beside the ROM; comparing with them says when only a
// build can bring the ROM up to date. The level data side is the manifest's job
// (core/src/datasection.ts).
import { createHash } from 'node:crypto'
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import type { Documents } from '@pecten-studio/core'
import type { ProjectFolder } from './project.ts'

/** Written beside the ROM as `<rom>.build.json` by a build that succeeded, and kept up by patches. */
export interface BuildRecord {
  version: 1
  /** The ROM's modification time this record is about. Any other time means the ROM was rebuilt elsewhere. */
  modified: number
  /** Level data was patched in since the build. */
  patched: boolean
  /** SHA-1 of each input, by path in the game folder. */
  inputs: Record<string, string>
}

type Kind = 'rust' | 'sprite' | 'audio' | 'asset'

/** The crate's own files: what cargo compiles besides the studio's crates. */
const CRATE_FILES = ['Cargo.toml', 'Cargo.lock', 'build.rs', 'rust-toolchain.toml', 'rust-toolchain']
const CRATE_FOLDERS = ['src', '.cargo']

async function walk(project: ProjectFolder, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(project.resolve(rel), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) await walk(project, child, out)
    else if (entry.isFile()) out.push(child)
  }
}

/** Every input of a build that exists now, with what kind of thing it is. */
async function inputs(project: ProjectFolder, docs: Documents): Promise<Map<string, Kind>> {
  const found = new Map<string, Kind>()
  for (const name of CRATE_FILES) if (await isFile(project, name)) found.set(name, 'rust')
  for (const folder of CRATE_FOLDERS) {
    const files: string[] = []
    await walk(project, folder, files)
    for (const rel of files) found.set(rel, 'rust')
  }
  // Sprite documents by file, so one that does not load still counts.
  const sprites: string[] = []
  await walk(project, 'studio/sprites', sprites)
  for (const rel of sprites) if (rel.endsWith('.json')) found.set(rel, 'sprite')
  if (await isFile(project, 'studio/audio.json')) found.set('studio/audio.json', 'audio')

  const assets = new Set<string>()
  for (const tileset of Object.values(docs.tilesets)) assets.add(tileset.image)
  for (const sprite of Object.values(docs.sprites)) {
    assets.add(sprite.image)
    if (sprite.palette) assets.add(sprite.palette)
  }
  for (const room of Object.values(docs.rooms)) for (const background of room.backgrounds ?? []) assets.add(background.image)
  for (const track of docs.audio?.tracks ?? []) {
    assets.add(track.file)
    if (track.soundfont) assets.add(track.soundfont)
  }
  for (const sound of docs.audio?.sfx ?? []) assets.add(sound.file)
  for (const rel of assets) if (!found.has(rel) && (await isFile(project, rel))) found.set(rel, 'asset')
  return found
}

async function isFile(project: ProjectFolder, rel: string): Promise<boolean> {
  try {
    return (await stat(project.resolve(rel))).isFile()
  } catch {
    return false
  }
}

// A status check runs on every change: files whose size and time are the same are not read again.
const hashes = new Map<string, { size: number; modified: number; hash: string }>()
async function hash(abs: string): Promise<string | null> {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return null
  const known = hashes.get(abs)
  if (known && known.size === info.size && known.modified === info.mtimeMs) return known.hash
  const value = createHash('sha1').update(await readFile(abs)).digest('hex')
  hashes.set(abs, { size: info.size, modified: info.mtimeMs, hash: value })
  return value
}

/** Hashes of every input as it is now, for a record. */
export async function hashInputs(project: ProjectFolder, docs: Documents): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const rel of [...(await inputs(project, docs)).keys()].sort()) {
    const value = await hash(project.resolve(rel))
    if (value) out[rel] = value
  }
  return out
}

const recordPath = (rom: string) => `${rom}.build.json`

/**
 * Whether a record is about this ROM. Copies of a folder keep file times only to the
 * millisecond, or to two seconds on FAT drives; a ROM rebuilt elsewhere that close to
 * its record is not a case worth missing a copied folder for.
 */
export const recordFits = (record: BuildRecord | null, rom: { modified: number }): record is BuildRecord => !!record && Math.abs(record.modified - rom.modified) <= 2000

export async function readRecord(project: ProjectFolder, rom: string): Promise<BuildRecord | null> {
  try {
    const record = JSON.parse(await readFile(project.resolve(recordPath(rom)), 'utf8')) as BuildRecord
    return record.version === 1 && typeof record.modified === 'number' && record.inputs && typeof record.inputs === 'object' ? record : null
  } catch {
    return null
  }
}

export async function writeRecord(project: ProjectFolder, rom: string, record: BuildRecord): Promise<void> {
  const file = project.resolve(recordPath(rom))
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`)
  await rename(temporary, file)
}

const kindOf = (rel: string): Kind =>
  rel.startsWith('studio/sprites/') ? 'sprite' : rel === 'studio/audio.json' ? 'audio' : CRATE_FILES.includes(rel) || CRATE_FOLDERS.some((f) => rel.startsWith(`${f}/`)) ? 'rust' : 'asset'
const spriteId = (rel: string) => rel.slice('studio/sprites/'.length, -'.json'.length)

/**
 * Why the ROM differs from what a build would make now, on the compiled side the
 * manifest does not hold. With a record of the ROM's build, by hashes; without one
 * (built outside the studio), by files newer than the ROM.
 */
export async function compiledChanges(project: ProjectFolder, docs: Documents, rom: { path: string; modified: number }): Promise<string[]> {
  const record = await readRecord(project, rom.path)
  const now = await inputs(project, docs)
  const changes: Array<{ rel: string; how: 'changed' | 'new' | 'removed' }> = []
  if (recordFits(record, rom)) {
    const current = await hashInputs(project, docs)
    for (const [rel, value] of Object.entries(current)) {
      const before = record.inputs[rel]
      if (before === undefined) changes.push({ rel, how: 'new' })
      else if (before !== value) changes.push({ rel, how: 'changed' })
    }
    for (const rel of Object.keys(record.inputs)) if (!(rel in current)) changes.push({ rel, how: 'removed' })
  } else {
    for (const rel of [...now.keys()].sort()) {
      const info = await stat(project.resolve(rel)).catch(() => null)
      if (info && info.mtimeMs > rom.modified) changes.push({ rel, how: 'changed' })
    }
  }
  changes.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  const reasons: string[] = []
  const rust = changes.filter((c) => kindOf(c.rel) === 'rust').map((c) => c.rel)
  if (rust.length) reasons.push(`Rust source changed: ${rust.length > 3 ? `${rust.slice(0, 3).join(', ')} and ${rust.length - 3} more` : rust.join(', ')}`)
  for (const { rel, how } of changes) {
    const kind = kindOf(rel)
    if (kind === 'sprite') reasons.push(how === 'new' ? `new sprite "${spriteId(rel)}"` : how === 'removed' ? `sprite "${spriteId(rel)}" was removed` : `sprite "${spriteId(rel)}" changed`)
    else if (kind === 'audio') reasons.push('the audio list changed')
    else if (kind === 'asset') reasons.push(`${rel} ${how === 'new' ? 'is new' : how === 'removed' ? 'was removed' : 'changed'}`)
  }
  return reasons
}
