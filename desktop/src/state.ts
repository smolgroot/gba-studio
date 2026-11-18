// What the app remembers between launches: open tabs, recent folders, and each project's port.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface DesktopState {
  open: string[]
  active: string | null
  recent: string[]
  ports: Record<string, number>
}

export const FIRST_PORT = 4517
const PORT_TRIES = 200
const MAX_RECENT = 12

export const emptyState = (): DesktopState => ({ open: [], active: null, recent: [], ports: {} })

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** Reads the saved state. A missing or damaged file is an empty one: this is a convenience, not data. */
export function loadState(file: string): DesktopState {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Record<keyof DesktopState, unknown>>
    const ports: Record<string, number> = {}
    for (const [root, port] of Object.entries((raw.ports ?? {}) as Record<string, unknown>)) {
      if (Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536) ports[root] = port as number
    }
    return { open: strings(raw.open), active: typeof raw.active === 'string' ? raw.active : null, recent: strings(raw.recent), ports }
  } catch {
    return emptyState()
  }
}

export function saveState(file: string, state: DesktopState): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n')
  renameSync(temp, file)
}

export const withRecent = (recent: string[], root: string): string[] => [root, ...recent.filter((item) => item !== root)].slice(0, MAX_RECENT)

/**
 * The ports to try for a project, best first: the one it had, then free ones from the
 * studio's usual port up. Ports other projects own are left to them. `taken` is asked
 * as the list is walked, so projects starting together do not pick the same one.
 */
export function* portCandidates(root: string, state: DesktopState, taken: (port: number) => boolean): Generator<number> {
  const own = state.ports[root]
  if (own !== undefined && !taken(own)) yield own
  const others = new Set(Object.entries(state.ports).filter(([other]) => other !== root).map(([, port]) => port))
  for (let port = FIRST_PORT; port < FIRST_PORT + PORT_TRIES; port++) {
    if (port !== own && !others.has(port) && !taken(port)) yield port
  }
}
