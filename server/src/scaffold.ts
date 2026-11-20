// What a folder needs to become a game that builds: the Rust crate around its studio
// project, and the tools that compile it.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { docPath } from '@pecten-studio/core'
import { HttpError } from './project.ts'
import type { ProjectFolder } from './project.ts'

/** agb 0.25 breaks on later nightlies. Keep in step with sample/rust-toolchain.toml. */
export const PINNED_TOOLCHAIN = 'nightly-2026-09-20'

const VENDORED = [
  { from: 'runtime', to: 'vendor/pecten_studio_rt' },
  { from: 'codegen', to: 'vendor/pecten_studio_build' },
]

const CRATE_FILES: Record<string, string> = {
  'Cargo.toml': `[package]
name = "game"
version = "0.1.0"
edition = "2024"
publish = false

[dependencies]
agb = "0.25.0"
agb_tracker = "0.25.0"
pecten_studio_rt = { path = "vendor/pecten_studio_rt", features = ["agb"] }

[build-dependencies]
pecten_studio_build = { path = "vendor/pecten_studio_build" }

[profile.dev]
opt-level = 3
debug = true

[profile.dev.build-override]
opt-level = 3

[profile.release]
opt-level = 3
lto = "fat"
debug = true

# This game stands alone, even inside another Cargo workspace.
[workspace]
`,
  'build.rs': `// Turns studio/ and the assets it names into the data the game includes.
fn main() {
    pecten_studio_build::build();
}
`,
  'rust-toolchain.toml': `[toolchain]
channel = "${PINNED_TOOLCHAIN}"
components = ["rust-src", "clippy", "rustfmt"]
`,
  '.cargo/config.toml': `[unstable]
build-std = ["core", "alloc"]
build-std-features = ["compiler-builtins-mem"]

[build]
target = "thumbv4t-none-eabi"

[target.thumbv4t-none-eabi]
rustflags = ["-Clink-arg=-Tgba.ld", "-Ctarget-cpu=arm7tdmi", "-Cforce-frame-pointers=yes"]
runner = ["mgba-qt", "-C", "logToStdout=1", "-C", "logLevel.gba.debug=127"]
`,
  '.gitignore': `target
dist
`,
  'src/main.rs': `//! Shows the start room of the project painted in the studio. The game's rules go here.
#![no_std]
#![no_main]

use pecten_studio_rt::gfx::WorldView;

pecten_studio_rt::include_data!();
pecten_studio_rt::include_gfx!();

#[agb::entry]
fn main(mut gba: agb::Gba) -> ! {
    let mut graphics = gba.graphics.get();
    // Rooms, entities and physics, read from the ROM's data section.
    let world = data::world();
    let room = world.start().unwrap_or(0) as usize;

    // A project with no rooms yet has a blank screen.
    let view = (room < world.room_count()).then(|| {
        let mut view = WorldView::new(&world, gfx::ART, room, &mut graphics);
        let (x, y) = world.origin(room).unwrap_or((0, 0));
        let camera = world.camera_target(room, x, y, |other| view.shows(other));
        view.load(camera.0, camera.1);
        view
    });

    loop {
        let mut frame = graphics.frame();
        if let Some(view) = &view {
            view.show(&mut frame);
        }
        frame.commit();
    }
}
`,
}

const BUILD_COMMANDS = {
  dev: 'mkdir -p dist && cargo build && agb-gbafix target/thumbv4t-none-eabi/debug/game -o dist/game-dev.gba',
  devRom: 'dist/game-dev.gba',
  release: 'mkdir -p dist && cargo build --release && agb-gbafix target/thumbv4t-none-eabi/release/game -o dist/game.gba',
  releaseRom: 'dist/game.gba',
}

const cratesPresent = (crates: string) => VENDORED.every(({ from }) => existsSync(path.join(crates, from, 'Cargo.toml')))

/**
 * Makes the folder a Rust game crate with its own copy of the studio's crates, so it
 * builds wherever it is. Nothing that exists is replaced. Returns what it wrote.
 */
export async function setupGameCrate(project: ProjectFolder, crates: string): Promise<string[]> {
  if (!existsSync(project.resolve(docPath('project')))) throw new HttpError(409, 'this folder has no studio project')
  if (existsSync(project.resolve('Cargo.toml'))) throw new HttpError(409, 'this folder already has a Cargo.toml')
  if (!cratesPresent(crates)) throw new HttpError(503, 'the studio\'s Rust crates are not available')

  const written: string[] = []
  for (const [file, text] of Object.entries(CRATE_FILES)) {
    const abs = project.resolve(file)
    await mkdir(path.dirname(abs), { recursive: true })
    try {
      await writeFile(abs, text, { flag: 'wx' })
      written.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  for (const { from, to } of VENDORED) {
    const source = path.join(crates, from)
    await cp(source, project.resolve(to), {
      recursive: true,
      force: false,
      // Build output and test data are not part of the crate a game needs.
      filter: (file) => !['target', 'fixture'].includes(path.relative(source, file).split(path.sep)[0]!),
    })
    written.push(to)
  }
  // The build helper writes the runtime's data layout, so it depends on the runtime,
  // which sits beside it here under another folder name than in the studio.
  const helper = project.resolve('vendor/pecten_studio_build/Cargo.toml')
  const manifest = await readFile(helper, 'utf8')
  await writeFile(helper, manifest.replace('path = "../runtime"', 'path = "../pecten_studio_rt"'))

  // Only commands still at their first values are replaced: others are the author's.
  const { docs } = await project.load()
  const build = docs.project?.build
  if (docs.project && build?.dev === 'cargo build' && build.release === 'cargo build --release') {
    await project.save('project', undefined, { ...docs.project, build: { ...build, ...BUILD_COMMANDS } })
    written.push(docPath('project'))
  }
  return written
}

export interface ToolchainItem {
  name: string
  ok: boolean
  /** The command that provides it, when it is missing. */
  install?: string
}
export interface ToolchainReport {
  /** Whether the folder has a Cargo.toml. */
  hasCrate: boolean
  /** Whether "Set up game crate" can run here. */
  canSetUp: boolean
  items: ToolchainItem[]
}

/** Runs a tool; `found` is false only when it is not there at all. */
function probe(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ found: boolean; ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // Not from the game folder: rustup would start installing what its rust-toolchain.toml names.
    execFile(command, args, { env, cwd: tmpdir(), timeout: 10_000 }, (error, stdout) => {
      resolve({ found: (error as NodeJS.ErrnoException | null)?.code !== 'ENOENT', ok: !error, output: String(stdout) })
    })
  })
}

export async function checkToolchain(project: ProjectFolder, crates: string, buildEnv?: NodeJS.ProcessEnv): Promise<ToolchainReport> {
  const env = buildEnv ?? process.env
  const hasCrate = existsSync(project.resolve('Cargo.toml'))
  const pinned = await readFile(project.resolve('rust-toolchain.toml'), 'utf8').catch(() => '')
  const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(pinned)?.[1] ?? PINNED_TOOLCHAIN

  const [rustup, toolchains, components, gbafix] = await Promise.all([
    probe('rustup', ['--version'], env),
    probe('rustup', ['toolchain', 'list'], env),
    probe('rustup', ['component', 'list', '--installed', '--toolchain', channel], env),
    probe('agb-gbafix', ['--version'], env),
  ])
  const hasChannel = toolchains.output.split('\n').some((line) => line.startsWith(channel))
  const items: ToolchainItem[] = [
    { name: 'rustup', ok: rustup.found, install: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh' },
    { name: `Rust ${channel}`, ok: hasChannel, install: `rustup toolchain install ${channel} --component rust-src` },
    { name: 'rust-src', ok: hasChannel && /^rust-src/m.test(components.output), install: `rustup component add rust-src --toolchain ${channel}` },
    { name: 'agb-gbafix', ok: gbafix.found, install: 'cargo install agb-gbafix' },
  ]
  return { hasCrate, canSetUp: !hasCrate && cratesPresent(crates) && existsSync(project.resolve(docPath('project'))), items: items.map(({ install, ...item }) => (item.ok ? item : { ...item, install })) }
}
