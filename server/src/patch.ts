// Puts the project's current level data into a built ROM without compiling: see
// docs/reference/data-section.md. Only data changes can go in this way; anything the
// game compiled from the project needs a build, and the answer says what.
import { existsSync } from 'node:fs'
import { open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { needsBuild, readSection, validateProject, writeSection } from '@pecten-studio/core'
import type { Section } from '@pecten-studio/core'
import type { Builder, BuildMode, RomInfo } from './build.ts'
import { compiledChanges, hashInputs, readRecord, recordFits, writeRecord } from './freshness.ts'
import { HttpError } from './project.ts'
import type { ProjectFolder } from './project.ts'

export type PatchResult =
  /** The ROM now holds the project's data. */
  | { status: 'patched'; rom: string; used: number; capacity: number; ms: number }
  /** The ROM already held exactly this data; it was left alone. */
  | { status: 'unchanged'; rom: string; used: number; capacity: number; ms: number }
  /** Only a build can bring the ROM up to date, for these reasons. */
  | { status: 'needs-build'; rom: string | null; reasons: string[] }
  /** The project has errors a build would stop on too. */
  | { status: 'invalid'; rom: string | null; problems: string[] }

/** Width and height of a PNG, from its header. */
async function pngSize(file: string): Promise<{ width: number; height: number } | null> {
  const handle = await open(file).catch(() => null)
  if (!handle) return null
  try {
    const header = Buffer.alloc(24)
    await handle.read(header, 0, 24, 0)
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
  } finally {
    await handle.close()
  }
}

/** Whether a built ROM matches the project, for the top bar: see design/US-004.md. */
export type RomStatus =
  | { state: 'none' | 'building'; mode: BuildMode }
  /** As a build would make it now; `patched` when level data was put in since the build. */
  | { state: 'up-to-date' | 'patched'; mode: BuildMode; rom: string }
  /** Only level data changed: a patch brings it up to date. */
  | { state: 'can-patch'; mode: BuildMode; rom: string }
  | { state: 'needs-build'; mode: BuildMode; rom: string; reasons: string[] }

type Checked =
  | Extract<PatchResult, { status: 'needs-build' | 'invalid' }>
  /** Up to date with its build, and a game that does not read level data from its ROM. */
  | { status: 'no-section'; rom: RomInfo }
  | { status: 'ready'; rom: RomInfo; file: string; bytes: Uint8Array; section: Section; written: Uint8Array; used: number; same: boolean }

/** Everything a patch checks, without writing: what stops it, or the section it would write. */
async function check(project: ProjectFolder, builder: Builder, mode: BuildMode): Promise<Checked> {
  const rom = (await builder.status()).roms[mode]
  if (!rom) return { status: 'needs-build', rom: null, reasons: [`there is no ${mode} ROM yet`] }

  // A document that did not load would look deleted, so those stop a patch. The rest
  // of the studio's checks are stricter than a build in places (a room placed on the
  // map that does not exist is ignored by it); a patch takes what a build takes, as
  // writeSection makes the same checks as codegen.
  const bundle = await project.load()
  const exists = (rel: string) => existsSync(project.resolve(rel))
  const checked = new Set(validateProject(bundle.docs, exists).map((p) => `${p.file}\n${p.message}`))
  const unread = bundle.problems.filter((p) => p.severity === 'error' && !checked.has(`${p.file}\n${p.message}`))
  if (unread.length) return { status: 'invalid', rom: rom.path, problems: unread.map((p) => `${p.file}: ${p.message}`) }

  const file = project.resolve(rom.path)
  const bytes = new Uint8Array(await readFile(file))
  const section = readSection(bytes)
  if (!section) {
    // Built by this studio, yet no section: the game never reads its level data (nothing
    // calls data::world()), so the linker left it out. Only the build's inputs matter then.
    const record = await readRecord(project, rom.path)
    if (!recordFits(record, rom)) return { status: 'needs-build', rom: rom.path, reasons: ['the ROM has no level data section: it was built by an older studio, or the game does not read its level data (data::world())'] }
    const reasons = await compiledChanges(project, bundle.docs, rom)
    return reasons.length ? { status: 'needs-build', rom: rom.path, reasons } : { status: 'no-section', rom }
  }

  const tileCounts: Record<string, number> = {}
  for (const [id, tileset] of Object.entries(bundle.docs.tilesets)) {
    const size = await pngSize(project.resolve(tileset.image))
    if (size) tileCounts[id] = Math.floor(size.width / 8) * Math.floor(size.height / 8)
  }
  // Code and art first: those are what the author just did when they appear.
  const reasons = [...(await compiledChanges(project, bundle.docs, rom)), ...needsBuild(bundle.docs, section, tileCounts)]
  if (reasons.length) return { status: 'needs-build', rom: rom.path, reasons }

  const written = writeSection(bundle.docs, section.manifest, section.capacity)
  if ('problems' in written) return written.tooBig ? { status: 'needs-build', rom: rom.path, reasons: written.problems } : { status: 'invalid', rom: rom.path, problems: written.problems }
  const old = bytes.subarray(section.start, section.start + section.capacity)
  return { status: 'ready', rom, file, bytes, section, written: written.bytes, used: written.used, same: old.every((byte, i) => byte === written.bytes[i]) }
}

/** Writes the project's level data into its built ROM, if only data has changed since the build. */
export async function patchRom(project: ProjectFolder, builder: Builder, mode: BuildMode = 'dev'): Promise<PatchResult> {
  const started = performance.now()
  if (builder.running) throw new HttpError(409, 'a build is running; it will bring the ROM up to date')
  const checked = await check(project, builder, mode)
  if (checked.status === 'no-section') return { status: 'needs-build', rom: checked.rom.path, reasons: ['this game does not read its level data from the ROM (nothing calls data::world()), so a change reaches it only through a build'] }
  if (checked.status !== 'ready') return checked
  const { rom, file, bytes, section, written } = checked
  const sizes = { rom: rom.path, used: checked.used, capacity: section.capacity }
  if (checked.same) return { status: 'unchanged', ...sizes, ms: Math.round(performance.now() - started) }

  bytes.set(written, section.start)
  // Written beside it and renamed over it, so the game is never started from half a file.
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, file)
  // The ROM's time moves on; the record follows it, or it would look rebuilt elsewhere.
  // The inputs are the ones just checked as unchanged.
  const modified = (await stat(file)).mtimeMs
  await writeRecord(project, rom.path, { version: 1, modified, patched: true, inputs: await hashInputs(project, (await project.load()).docs) })
  await builder.romPatched()
  return { status: 'patched', ...sizes, ms: Math.round(performance.now() - started) }
}

/** Whether the `mode` ROM matches the project. Without a mode, the dev ROM, or the release one if there is only that. */
export async function romStatus(project: ProjectFolder, builder: Builder, mode?: BuildMode): Promise<RomStatus> {
  const roms = (await builder.status()).roms
  const which: BuildMode = mode ?? (!roms.dev && roms.release ? 'release' : 'dev')
  if (builder.running) return { state: 'building', mode: which }
  const rom = roms[which]
  if (!rom) return { state: 'none', mode: which }
  const checked = await check(project, builder, which)
  if (checked.status === 'invalid') return { state: 'needs-build', mode: which, rom: rom.path, reasons: ['the project has errors a build would stop on too; see Problems'] }
  if (checked.status === 'needs-build') return { state: 'needs-build', mode: which, rom: rom.path, reasons: checked.reasons }
  if (checked.status === 'no-section') return { state: 'up-to-date', mode: which, rom: rom.path }
  if (!checked.same) return { state: 'can-patch', mode: which, rom: rom.path }
  const record = await readRecord(project, rom.path)
  return { state: recordFits(record, rom) && record.patched ? 'patched' : 'up-to-date', mode: which, rom: rom.path }
}

/** One line for an agent about to look at a ROM that is not what the project would build. */
export function staleNote(status: RomStatus): string | null {
  if (status.state === 'needs-build') return `This ROM is out of date: ${status.reasons.join('; ')}. Run the build tool to see the change.`
  if (status.state === 'can-patch') return 'This ROM does not have the latest level data yet. Run patch_rom to put it in.'
  return null
}

/** One line per outcome, for the command line and agents. */
export function describePatch(result: PatchResult): string {
  switch (result.status) {
    case 'patched':
      return `Patched ${result.rom} in ${result.ms} ms: level data ${result.used} of ${result.capacity} bytes.`
    case 'unchanged':
      return `${result.rom} already holds this level data (${result.used} of ${result.capacity} bytes).`
    case 'needs-build':
      return `Needs a build: ${result.reasons.join('; ')}.`
    case 'invalid':
      return `The project has errors a build would stop on too:\n${result.problems.join('\n')}`
  }
}
