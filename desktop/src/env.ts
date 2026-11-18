// The environment builds run in. An app started from the desktop menu does not have the
// PATH of the user's shell, where cargo lives, and an AppImage adds variables of its own.
import { spawn } from 'node:child_process'
import path from 'node:path'

const APP_ONLY = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'GSETTINGS_SCHEMA_DIR', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE', 'PECTEN_DESKTOP_DEV']
const MARK = '__PECTEN_PATH__'

export function buildEnvironment(base: NodeJS.ProcessEnv, loginPath: string | null, home: string): NodeJS.ProcessEnv {
  const env = { ...base }
  const mount = base.APPDIR
  for (const name of APP_ONLY) delete env[name]
  const entries = [...(loginPath ?? '').split(':'), ...(base.PATH ?? '').split(':'), path.join(home, '.cargo/bin')]
  env.PATH = [...new Set(entries.filter((entry) => entry && !(mount && entry.startsWith(mount))))].join(':')
  return env
}

export const parseLoginPath = (output: string): string | null => new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(output)?.[1] ?? null

/** Asks the user's login shell for its PATH. Slow or broken shell setups just give nothing. */
export function readLoginPath(shell = process.env.SHELL): Promise<string | null> {
  if (!shell) return Promise.resolve(null)
  return new Promise((resolve) => {
    const child = spawn(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parseLoginPath(output))
    })
  })
}
