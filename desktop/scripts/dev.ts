// Runs the desktop app from this checkout. The studio page is rebuilt as it is edited,
// and the open projects reload. Arguments are passed to the app.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { buildDesktop } from './build.ts'

const here = path.join(import.meta.dirname, '..')
const electron = createRequire(import.meta.url)('electron') as unknown as string

await buildDesktop()
const page = spawn('pnpm', ['--filter', '@pecten-studio/app', 'exec', 'vite', 'build', '--watch'], { stdio: 'inherit', detached: true })
const stopPage = () => {
  try {
    process.kill(-page.pid!, 'SIGTERM')
  } catch {
    // Already gone.
  }
}
// Terminals inside VS Code inherit ELECTRON_RUN_AS_NODE, which would make this plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
// XWayland, as the packaged app relaunches itself into (see relaunchUnderX11 in src/main.ts).
// Passed here so the app never relaunches, which would end this process's child.
const platform = process.platform === 'linux' && process.env.DISPLAY ? ['--ozone-platform=x11'] : []
const app = spawn(electron, [path.join(here, 'dist/main.cjs'), ...platform, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...env, PECTEN_DESKTOP_DEV: '1' } })
app.on('exit', (code) => {
  stopPage()
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.kill(signal))
