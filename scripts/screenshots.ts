// Takes the documentation's screenshots from a running studio, as listed in
// docs/screenshots.json, and writes them to docs/public/screenshots/.
//
//   node scripts/screenshots.ts room-editor play       # just these
//   node scripts/screenshots.ts --all                  # every shot not marked manual
//   node scripts/screenshots.ts --all --project ../diamond-hands
//   node scripts/screenshots.ts --all --out /tmp/shots  # look without replacing
//
// The studio serves a copy of the project in a temporary folder, removed at the end:
// shots may edit files, patch the ROM or build, and the project itself is never
// touched. Its `target/` is linked, not copied, so a build reuses what is compiled.
//
// Needs the web app built (pnpm build) and Chromium for Playwright:
//   pnpm exec playwright install chromium
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type Action =
  /** An accessible name (aria-label or label) first, then a button's name, then visible text. `within` is a CSS selector to look in. */
  | { click: string; within?: string }
  /** A key, as Playwright names them: "Control+z", "g". */
  | { press: string }
  /** Milliseconds. */
  | { wait: number }
  | { hover: string; within?: string }
  /** Types `text` into the field with this accessible name, replacing what is there, and leaves the field. */
  | { fill: string; text: string }
  /** Picks `option` (its value or text) in the select with this accessible name. */
  | { select: string; option: string }
  /** Changes a file in the project's copy, as an author or agent would: adds `append` to its end, or sets dotted JSON paths ("entities.0.x"). */
  | { edit: string; append?: string; set?: Record<string, unknown> }
  /** Waits until this text is on the page; `timeout` in milliseconds, 15 s by default. */
  | { waitForText: string; timeout?: number }

interface Shot {
  /** File name in docs/public/screenshots/, without .png. */
  name: string
  /** What the page shows, in the words of its alt text. */
  description: string
  /** The page's hash, which says what is open: "room:entry", "world", "play". */
  route: string
  /** Viewport in CSS pixels; the default is a wide screen. */
  viewport?: { width: number; height: number }
  /** Steps after the page has loaded, such as turning on an overlay. */
  actions?: Action[]
  /** A selector to wait for before the picture, when loading is slow (the Play panel). */
  waitFor?: string
  /** Milliseconds to wait before the picture, for animations to settle. */
  delay?: number
  /** Only part of the page: a selector. */
  clip?: string
  /** Another game folder than the list's, relative to the repository, for a state its project cannot show. */
  project?: string
  /** Builds the copy first with the project's own command, for shots that need a ROM made by this studio. */
  build?: 'dev' | 'release'
  /** The shot cannot be scripted yet (a dialog mid-drag, say); it is listed but skipped. */
  manual?: boolean
}

interface Manifest {
  /** Game folder the shots are taken in, relative to the repository. */
  project: string
  defaultViewport: { width: number; height: number }
  shots: Shot[]
}

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest: Manifest = JSON.parse(readFileSync(new URL('../docs/screenshots.json', import.meta.url), 'utf8'))

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean', default: false },
    project: { type: 'string' },
    port: { type: 'string', default: '4599' },
    list: { type: 'boolean', default: false },
    /** Somewhere else than docs/public/screenshots/, to look at shots without replacing the published ones. */
    out: { type: 'string' },
  },
})
const outDir = values.out ? new URL(`file://${path.resolve(values.out)}/`) : new URL('../docs/public/screenshots/', import.meta.url)

if (values.list) {
  for (const s of manifest.shots) console.log(`${s.name.padEnd(20)} ${s.manual ? '(manual) ' : ''}${s.route.padEnd(20)} ${s.description}`)
  process.exit(0)
}

// Writing every picture by default would replace hand-taken ones without asking.
if (!values.all && positionals.length === 0) {
  console.error('Name the shots to take, or pass --all. --list shows them.')
  process.exit(2)
}
const unknown = positionals.filter((n) => !manifest.shots.some((s) => s.name === n))
if (unknown.length) {
  console.error(`No such shot in docs/screenshots.json: ${unknown.join(', ')}`)
  process.exit(2)
}
const wanted = manifest.shots.filter((s) => (values.all ? !s.manual : positionals.includes(s.name)))
const manual = wanted.filter((s) => s.manual)
if (manual.length) console.warn(`Skipping shots marked manual: ${manual.map((s) => s.name).join(', ')}`)

if (!existsSync(new URL('../app/dist/index.html', import.meta.url))) {
  console.error('The web app is not built. Run pnpm build first.')
  process.exit(2)
}

let chromium: typeof import('playwright').chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Playwright is not installed. Run: pnpm add -Dw playwright && pnpm exec playwright install chromium')
  process.exit(2)
}

// Each project is served from a copy in a folder of its own, under the same name.
// Everything beside the project is linked beside the copy, so paths that leave it
// (`../runtime` in Cargo.toml, `include_bytes!("../../game/…")`) find the same files.
// A copy next to the project would land inside the repository's Cargo workspace.
const scratch = mkdtempSync(path.join(tmpdir(), 'pecten-shots-'))
const cleanUp = () => rmSync(scratch, { recursive: true, force: true })
process.on('SIGINT', () => {
  cleanUp()
  process.exit(130)
})
let project = ''
let copy = ''
const url = `http://127.0.0.1:${values.port}/`

/** Fresh copy of everything but build output; `target/` is linked so builds are incremental. */
function makeCopy(): void {
  rmSync(copy, { recursive: true, force: true })
  // File times are kept: the studio compares them with the ROM's to say whether it is up to date.
  cpSync(project, copy, { recursive: true, preserveTimestamps: true, filter: (from) => !/[/\\](target|node_modules|\.git)$/.test(from) })
  if (existsSync(path.join(project, 'target'))) symlinkSync(path.join(project, 'target'), path.join(copy, 'target'), 'dir')
}

/** Copies `folder` and serves the copy; returns how to stop it. */
async function serve(folder: string): Promise<() => void> {
  project = folder
  const home = mkdtempSync(path.join(scratch, 'p-'))
  for (const entry of readdirSync(path.dirname(project), { withFileTypes: true })) {
    if (entry.name === path.basename(project)) continue
    symlinkSync(path.join(path.dirname(project), entry.name), path.join(home, entry.name), entry.isDirectory() ? 'dir' : 'file')
  }
  copy = path.join(home, path.basename(project))
  makeCopy()
  const server = spawn(process.execPath, ['server/src/cli.ts', copy, '--port', values.port], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return () => server.kill()
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  server.kill()
  throw new Error(`the studio did not start at ${url}`)
}

// A shot may name its own project, for a state the default one cannot show.
const projectOf = (shot: Shot) => path.resolve(root, shot.project ?? values.project ?? manifest.project)
const groups = new Map<string, Shot[]>()
for (const shot of wanted.filter((s) => !s.manual)) groups.set(projectOf(shot), [...(groups.get(projectOf(shot)) ?? []), shot])

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
let failed = 0
try {
  for (const [folder, shots] of groups) {
    const stop = await serve(folder)
    try {
      for (const shot of shots) await take(shot)
    } finally {
      stop()
      // The next project's server takes the same port.
      await new Promise((r) => setTimeout(r, 500))
    }
  }
} finally {
  await browser.close()
  cleanUp()
}
process.exit(failed ? 1 : 0)

async function take(shot: Shot): Promise<void> {
  const page = await browser.newPage({ viewport: shot.viewport ?? manifest.defaultViewport, deviceScaleFactor: 1 })
  try {
    if (shot.build) await buildCopy(shot.build)
    await page.goto(`${url}#${shot.route}`, { waitUntil: 'networkidle' })
    if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 15000 })
    for (const action of shot.actions ?? []) await act(page, action)
    await page.waitForTimeout(shot.delay ?? 300)
    const file = fileURLToPath(new URL(`${shot.name}.png`, outDir))
    if (shot.clip) await page.locator(shot.clip).first().screenshot({ path: file })
    else await page.screenshot({ path: file })
    console.log(`wrote ${file}`)
  } catch (error) {
    failed++
    // What the page showed when it went wrong, beside the pictures, to see why.
    const seen = fileURLToPath(new URL(`${shot.name}.failed.png`, outDir))
    await page.screenshot({ path: seen }).catch(() => undefined)
    console.error(`${shot.name}: ${(error as Error).message.split('\n')[0]} (the page as it was: ${seen})`)
  } finally {
    await page.close()
    // What one shot changed (an edit, a patch, a build) must not show in the next.
    if (changesFiles(shot)) {
      makeCopy()
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

type Page = import('playwright').Page

function target(page: Page, name: string, within?: string) {
  const scope = within ? page.locator(within).first() : page
  const byLabel = scope.getByLabel(name, { exact: true })
  return byLabel.or(scope.getByRole('button', { name, exact: true })).or(scope.getByText(name, { exact: true })).first()
}

async function act(page: Page, action: Action): Promise<void> {
  if ('click' in action) await target(page, action.click, action.within).click()
  else if ('hover' in action) await target(page, action.hover, action.within).hover()
  else if ('press' in action) await page.keyboard.press(action.press)
  else if ('fill' in action) {
    // The studio's fields commit when they lose focus, as when a person moves on.
    const field = page.getByLabel(action.fill, { exact: true }).first()
    await field.fill(action.text)
    await field.blur()
  }
  else if ('select' in action) await page.getByLabel(action.select, { exact: true }).first().selectOption(action.option)
  else if ('edit' in action) edit(action)
  // Case and all: a plain string would also match "patched into" for "Patched in".
  else if ('waitForText' in action) await page.getByText(new RegExp(action.waitForText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).first().waitFor({ timeout: action.timeout ?? 15000 })
  else await page.waitForTimeout(action.wait)
}

/** Runs the build through the studio, as its Build button would, and waits for the end. */
async function buildCopy(mode: 'dev' | 'release'): Promise<void> {
  const post = await fetch(`${url}api/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
  if (!post.ok) throw new Error(`the ${mode} build did not start: ${(await post.text()).slice(0, 200)}`)
  for (;;) {
    await new Promise((r) => setTimeout(r, 500))
    const status = (await (await fetch(`${url}api/build`)).json()) as { running: boolean; exitCode: number | null; log: string[] }
    if (status.running) continue
    if (status.exitCode !== 0) throw new Error(`the ${mode} build failed (exit ${status.exitCode}): ${status.log.slice(-5).join(' / ')}`)
    return
  }
}

/** Shots that may leave the copy changed: builds, edits, and buttons that patch or build. */
function changesFiles(shot: Shot): boolean {
  return !!shot.build || (shot.actions ?? []).some((a) => 'edit' in a || ('click' in a && /^(Build|Patch|Create)/.test(a.click)))
}

function edit(action: Extract<Action, { edit: string }>): void {
  const file = path.resolve(copy, action.edit)
  if (!file.startsWith(copy + path.sep)) throw new Error(`${action.edit} is outside the project`)
  if (action.append !== undefined) writeFileSync(file, readFileSync(file, 'utf8') + action.append)
  if (action.set) {
    const json = JSON.parse(readFileSync(file, 'utf8'))
    for (const [dotted, value] of Object.entries(action.set)) {
      const keys = dotted.split('.')
      const last = keys.pop()!
      let at = json
      for (const key of keys) {
        if (at[key] === undefined) throw new Error(`${action.edit} has no ${dotted}`)
        at = at[key]
      }
      at[last] = value
    }
    writeFileSync(file, JSON.stringify(json, null, 2))
  }
}
