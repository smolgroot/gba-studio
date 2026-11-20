// Whether the sample's built ROM matches its project: what the top bar shows, and
// what a patch refuses. Needs the sample's dev ROM, like patch.test.ts. The build
// command is swapped for a shell one-liner, so a "build" records its inputs without
// compiling.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSection, rleDecode, rleEncode } from '@pecten-studio/core'
import { Builder } from '../src/build.ts'
import { patchRom, romStatus } from '../src/patch.ts'
import { ProjectFolder } from '../src/project.ts'
import { startServer } from '../src/server.ts'
import { TOOLS } from '../src/tools.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const SAMPLE = path.join(REPO, 'sample')
const ROM = 'dist/sample-dev.gba'
const ready = existsSync(path.join(SAMPLE, ROM)) && readSection(new Uint8Array(readFileSync(path.join(SAMPLE, ROM)))) !== null
const core = existsSync(path.join(REPO, 'app/public/wasm/pecten.js'))

let folder: string
let project: ProjectFolder
let builder: Builder

const file = (rel: string) => path.join(folder, rel)
const doc = (rel: string) => JSON.parse(readFileSync(file(`studio/${rel}`), 'utf8')) as Record<string, any>
const save = (rel: string, json: unknown) => writeFileSync(file(`studio/${rel}`), JSON.stringify(json, null, 2))
const rom = () => readFileSync(file(ROM))
/** Sets the command `Build dev` runs. */
const buildCommand = (command: string) => {
  const settings = doc('project.json')
  settings.build.dev = command
  save('project.json', settings)
}
const editTiles = () => {
  const room = doc('rooms/entry.json')
  const front = room.layers.at(-1)
  const cells = rleDecode(front.data)
  cells[14 * 60] = cells[14 * 60] === 2 ? 3 : 2
  front.data = rleEncode(cells)
  save('rooms/entry.json', room)
}
/** Every file but the ROM an hour in the past, so the ROM is the newest file however the copy went. */
function age(dir: string): void {
  const past = new Date(Date.now() - 3_600_000)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) age(full)
    else if (full !== file(ROM)) utimesSync(full, past, past)
  }
}

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-fresh-'))
  for (const part of ['studio', 'assets', 'src', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'rust-toolchain.toml', ROM]) cpSync(path.join(SAMPLE, part), file(part), { recursive: true })
  project = new ProjectFolder(folder)
  builder = new Builder(project, () => undefined)
  buildCommand('true')
  age(folder)
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe.skipIf(!ready)('whether the built ROM is up to date', () => {
  it('is up to date after a build, and says so from the record it leaves', async () => {
    const status = await builder.run('dev')
    expect(status.exitCode).toBe(0)
    const record = JSON.parse(readFileSync(file(`${ROM}.build.json`), 'utf8'))
    expect(record).toMatchObject({ version: 1, patched: false, modified: statSync(file(ROM)).mtimeMs })
    expect(Object.keys(record.inputs)).toEqual(expect.arrayContaining(['src/main.rs', 'Cargo.toml', 'build.rs', 'studio/sprites/coin.json', 'studio/audio.json', 'assets/sprites/coin.png', 'assets/tiles.png', 'assets/audio/coin.wav']))
    expect(await romStatus(project, builder)).toEqual({ state: 'up-to-date', mode: 'dev', rom: ROM })
    // A copy of the folder keeps file times only to the millisecond or the second.
    const rounded = new Date(Math.floor(statSync(file(ROM)).mtimeMs / 1000) * 1000)
    utimesSync(file(ROM), rounded, rounded)
    expect(await romStatus(project, builder)).toEqual({ state: 'up-to-date', mode: 'dev', rom: ROM })
    writeFileSync(file('src/main.rs'), '')
    expect(await romStatus(project, builder)).toMatchObject({ reasons: ['Rust source changed: src/main.rs'] })
  })

  it('says level data can be patched in, and patched once it is', async () => {
    await builder.run('dev')
    editTiles()
    expect(await romStatus(project, builder)).toMatchObject({ state: 'can-patch' })
    expect(await patchRom(project, builder)).toMatchObject({ status: 'patched' })
    expect(await romStatus(project, builder)).toMatchObject({ state: 'patched' })
    // A build after it is a plain build again.
    await builder.run('dev')
    expect(await romStatus(project, builder)).toMatchObject({ state: 'up-to-date' })
  })

  it('needs a build when Rust source changes, is added or is removed', async () => {
    await builder.run('dev')
    writeFileSync(file('src/main.rs'), `${readFileSync(file('src/main.rs'), 'utf8')}\n// tuned\n`)
    expect(await romStatus(project, builder)).toEqual({ state: 'needs-build', mode: 'dev', rom: ROM, reasons: ['Rust source changed: src/main.rs'] })
    writeFileSync(file('src/extra.rs'), '')
    writeFileSync(file('src/more.rs'), '')
    writeFileSync(file('src/again.rs'), '')
    unlinkSync(file('build.rs'))
    expect(await romStatus(project, builder)).toMatchObject({ reasons: ['Rust source changed: build.rs, src/again.rs, src/extra.rs and 2 more'] })
  })

  it('needs a build when a sprite sheet or sprite changes, or a sprite is new', async () => {
    await builder.run('dev')
    const sheet = readFileSync(file('assets/sprites/coin.png'))
    writeFileSync(file('assets/sprites/coin.png'), Buffer.concat([sheet, Buffer.from([0])]))
    expect(await romStatus(project, builder)).toMatchObject({ state: 'needs-build', reasons: ['assets/sprites/coin.png changed'] })
    writeFileSync(file('assets/sprites/coin.png'), sheet)
    const coin = doc('sprites/coin.json')
    coin.animations[0].frames[0].duration = 4
    save('sprites/coin.json', coin)
    save('sprites/bat.json', { ...coin, name: 'Bat' })
    expect(await romStatus(project, builder)).toMatchObject({ reasons: ['new sprite "bat"', 'sprite "coin" changed'] })
  })

  it('keeps the reasons the ROM itself gives, after the ones about code and art', async () => {
    await builder.run('dev')
    writeFileSync(file('src/main.rs'), '')
    const settings = doc('project.json')
    settings.entityTypes.push({ id: 'bat', name: 'Bat', colour: '#000000', props: [] })
    save('project.json', settings)
    expect(await romStatus(project, builder)).toMatchObject({ reasons: ['Rust source changed: src/main.rs', 'entity type "bat" is new'] })
  })

  it('stops a patch for the same reasons, and leaves the ROM alone', async () => {
    await builder.run('dev')
    editTiles()
    writeFileSync(file('src/main.rs'), '')
    const before = rom()
    expect(await patchRom(project, builder)).toEqual({ status: 'needs-build', rom: ROM, reasons: ['Rust source changed: src/main.rs'] })
    expect(rom().equals(before)).toBe(true)
  })

  it('records the inputs as the build starts, so an edit during it still counts', async () => {
    buildCommand(`echo '// edited while building' >> src/main.rs`)
    await builder.run('dev')
    expect(await romStatus(project, builder)).toMatchObject({ state: 'needs-build', reasons: ['Rust source changed: src/main.rs'] })
  })

  it('keeps the last record when a build fails', async () => {
    await builder.run('dev')
    const record = readFileSync(file(`${ROM}.build.json`), 'utf8')
    buildCommand('false')
    expect((await builder.run('dev')).exitCode).toBe(1)
    expect(readFileSync(file(`${ROM}.build.json`), 'utf8')).toBe(record)
  })

  it('goes by file times for a ROM built outside the studio', async () => {
    expect(existsSync(file(`${ROM}.build.json`))).toBe(false)
    expect(await romStatus(project, builder)).toMatchObject({ state: 'up-to-date' })
    // Patching it adopts it: it is then followed as if the studio had built it.
    editTiles()
    expect(await patchRom(project, builder)).toMatchObject({ status: 'patched' })
    expect(await romStatus(project, builder)).toMatchObject({ state: 'patched' })
    rmSync(file(`${ROM}.build.json`))
    const later = new Date(statSync(file(ROM)).mtimeMs + 5000)
    utimesSync(file('src/main.rs'), later, later)
    expect(await romStatus(project, builder)).toMatchObject({ state: 'needs-build', reasons: ['Rust source changed: src/main.rs'] })
  })

  it('says when there is no ROM, and while a build runs', async () => {
    buildCommand('sleep 0.5')
    const running = builder.run('dev')
    expect(await romStatus(project, builder)).toEqual({ state: 'building', mode: 'dev' })
    await running
    rmSync(file(ROM))
    expect(await romStatus(project, builder)).toEqual({ state: 'none', mode: 'dev' })
  })

  it('follows a game that does not read the level data section by its inputs alone', async () => {
    // Such a game's ROM has no section: the linker drops it when nothing reads it.
    const bytes = rom()
    const at = bytes.indexOf('PECTDATA')
    bytes.write('XXXXXXXX', at)
    writeFileSync(file(ROM), bytes)
    expect(await romStatus(project, builder)).toMatchObject({ state: 'needs-build', reasons: [expect.stringContaining('no level data section')] })
    await builder.run('dev')
    expect(await romStatus(project, builder)).toEqual({ state: 'up-to-date', mode: 'dev', rom: ROM })
    // A copy of the folder keeps file times only to the millisecond or the second.
    const rounded = new Date(Math.floor(statSync(file(ROM)).mtimeMs / 1000) * 1000)
    utimesSync(file(ROM), rounded, rounded)
    expect(await romStatus(project, builder)).toEqual({ state: 'up-to-date', mode: 'dev', rom: ROM })
    editTiles()
    expect(await romStatus(project, builder)).toMatchObject({ state: 'up-to-date' })
    expect(await patchRom(project, builder)).toMatchObject({ status: 'needs-build', reasons: [expect.stringContaining('does not read its level data from the ROM')] })
    writeFileSync(file('src/main.rs'), '')
    expect(await romStatus(project, builder)).toMatchObject({ state: 'needs-build', reasons: ['Rust source changed: src/main.rs'] })
  })

  it('is answered by the server for the page', async () => {
    const server = await startServer({ folder, host: '127.0.0.1', port: 0 })
    try {
      const get = (url: string) => server.app.inject({ url, headers: { host: new URL(server.url).host } })
      expect((await get('/api/rom-status')).json()).toEqual({ state: 'up-to-date', mode: 'dev', rom: ROM })
      expect((await get('/api/rom-status?mode=release')).json()).toEqual({ state: 'none', mode: 'release' })
      expect((await get('/api/rom-status?mode=fast')).statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })

  it.skipIf(!core)('warns an agent that runs an out-of-date ROM', async () => {
    await builder.run('dev')
    const tool = TOOLS.find((t) => t.name === 'run_rom')!
    const fresh = await tool.run({ mode: 'dev', steps: [{ frames: 1, keys: [] }] } as never, { project, builder })
    expect(fresh.text).not.toContain('out of date')
    writeFileSync(file('src/main.rs'), '')
    const stale = await tool.run({ mode: 'dev', steps: [{ frames: 1, keys: [] }] } as never, { project, builder })
    expect(stale.text).toContain('This ROM is out of date: Rust source changed: src/main.rs. Run the build tool')
  })
})
