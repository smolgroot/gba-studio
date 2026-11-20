// Puts the project's current level data into a built ROM without compiling: see
// docs/reference/data-section.md. Only data changes can go in this way; anything the
// game compiled from the project needs a build, and the answer says what.
import { existsSync } from 'node:fs'
import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { needsBuild, readSection, validateProject, writeSection } from '@pecten-studio/core'
import type { Builder, BuildMode } from './build.ts'
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

/** Writes the project's level data into its built ROM, if only data has changed since the build. */
export async function patchRom(project: ProjectFolder, builder: Builder, mode: BuildMode = 'dev'): Promise<PatchResult> {
  const started = performance.now()
  if (builder.running) throw new HttpError(409, 'a build is running; it will bring the ROM up to date')
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
  if (!section) return { status: 'needs-build', rom: rom.path, reasons: ['the ROM has no level data section: it was built by an older studio'] }

  const tileCounts: Record<string, number> = {}
  for (const [id, tileset] of Object.entries(bundle.docs.tilesets)) {
    const size = await pngSize(project.resolve(tileset.image))
    if (size) tileCounts[id] = Math.floor(size.width / 8) * Math.floor(size.height / 8)
  }
  const reasons = needsBuild(bundle.docs, section, tileCounts)
  if (reasons.length) return { status: 'needs-build', rom: rom.path, reasons }

  const written = writeSection(bundle.docs, section.manifest, section.capacity)
  if ('problems' in written) return written.tooBig ? { status: 'needs-build', rom: rom.path, reasons: written.problems } : { status: 'invalid', rom: rom.path, problems: written.problems }

  const sizes = { rom: rom.path, used: written.used, capacity: section.capacity }
  const old = bytes.subarray(section.start, section.start + section.capacity)
  if (old.every((byte, i) => byte === written.bytes[i])) return { status: 'unchanged', ...sizes, ms: Math.round(performance.now() - started) }

  bytes.set(written.bytes, section.start)
  // Written beside it and renamed over it, so the game is never started from half a file.
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, file)
  await builder.romPatched()
  return { status: 'patched', ...sizes, ms: Math.round(performance.now() - started) }
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
