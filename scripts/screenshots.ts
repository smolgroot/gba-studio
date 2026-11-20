// Takes the documentation's screenshots from a running studio, as listed in
// docs/screenshots.json, and writes them to docs/public/screenshots/.
//
//   node scripts/screenshots.ts room-editor play       # just these
//   node scripts/screenshots.ts --all                  # every shot not marked manual
//   node scripts/screenshots.ts --all --project ../diamond-hands
//
// Needs the web app built (pnpm build) and Playwright with Chromium:
//   pnpm add -Dw playwright && pnpm exec playwright install chromium
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type Action =
  | { click: string } // an accessible name (aria-label or label) first, then visible text
  | { press: string } // a key, as Playwright names them: "Control+z", "g"
  | { wait: number } // milliseconds
  | { hover: string }

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
const outDir = new URL('../docs/public/screenshots/', import.meta.url)

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean', default: false },
    project: { type: 'string' },
    port: { type: 'string', default: '4599' },
    list: { type: 'boolean', default: false },
  },
})

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

const project = values.project ?? manifest.project
const url = `http://127.0.0.1:${values.port}/`
const server = spawn(process.execPath, ['server/src/cli.ts', project, '--port', values.port], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`the studio did not start at ${url}`)
}

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
let failed = 0
try {
  await waitForServer()
  for (const shot of wanted.filter((s) => !s.manual)) {
    const page = await browser.newPage({ viewport: shot.viewport ?? manifest.defaultViewport, deviceScaleFactor: 1 })
    try {
      await page.goto(`${url}#${shot.route}`, { waitUntil: 'networkidle' })
      if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 15000 })
      for (const action of shot.actions ?? []) {
        if ('click' in action) await target(page, action.click).click()
        else if ('hover' in action) await target(page, action.hover).hover()
        else if ('press' in action) await page.keyboard.press(action.press)
        else await page.waitForTimeout(action.wait)
      }
      await page.waitForTimeout(shot.delay ?? 300)
      const path = fileURLToPath(new URL(`${shot.name}.png`, outDir))
      if (shot.clip) await page.locator(shot.clip).first().screenshot({ path })
      else await page.screenshot({ path })
      console.log(`wrote docs/public/screenshots/${shot.name}.png`)
    } catch (error) {
      failed++
      console.error(`${shot.name}: ${(error as Error).message.split('\n')[0]}`)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
  server.kill()
}
process.exit(failed ? 1 : 0)

function target(page: import('playwright').Page, name: string) {
  const byLabel = page.getByLabel(name, { exact: true })
  return byLabel.or(page.getByRole('button', { name, exact: true })).or(page.getByText(name, { exact: true })).first()
}
