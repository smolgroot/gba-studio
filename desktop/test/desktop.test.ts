import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildEnvironment, parseLoginPath } from '../src/env.ts'
import { FIRST_PORT, emptyState, loadState, portCandidates, saveState, withRecent } from '../src/state.ts'

const first = (iterator: Iterable<number>, count: number) => [...iterator].slice(0, count)

describe('ports', () => {
  it('starts at the usual port', () => {
    expect(first(portCandidates('/a', emptyState(), () => false), 2)).toEqual([FIRST_PORT, FIRST_PORT + 1])
  })
  it('prefers the port a project had and leaves others their own', () => {
    const state = { ...emptyState(), ports: { '/a': 5000, '/b': FIRST_PORT } }
    expect(first(portCandidates('/a', state, () => false), 2)).toEqual([5000, FIRST_PORT + 1])
  })
  it('skips ports in use by open projects', () => {
    expect(first(portCandidates('/a', { ...emptyState(), ports: { '/a': FIRST_PORT } }, (port) => port === FIRST_PORT), 1)).toEqual([FIRST_PORT + 1])
  })
})

describe('saved state', () => {
  it('survives a round trip, and damage reads as empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pecten-state-'))
    try {
      const file = path.join(dir, 'nested/projects.json')
      const state = { open: ['/a'], active: '/a', recent: ['/a'], ports: { '/a': 4520 } }
      saveState(file, state)
      expect(loadState(file)).toEqual(state)
      writeFileSync(file, '{ not json')
      expect(loadState(file)).toEqual(emptyState())
      writeFileSync(file, JSON.stringify({ open: ['/a', 3], ports: { '/a': 99999 } }))
      expect(loadState(file)).toEqual({ ...emptyState(), open: ['/a'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('keeps recent folders unique, newest first', () => {
    expect(withRecent(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
  })
})

describe('build environment', () => {
  it('uses the login PATH, adds cargo, and drops what the AppImage added', () => {
    const env = buildEnvironment({ PATH: '/tmp/.mount_x/usr/bin:/usr/bin', APPDIR: '/tmp/.mount_x', LD_LIBRARY_PATH: '/tmp/.mount_x/lib', HOME: '/h' }, '/opt/bin:/usr/bin', '/h')
    expect(env.PATH).toBe('/opt/bin:/usr/bin:/h/.cargo/bin')
    expect(env.APPDIR).toBeUndefined()
    expect(env.LD_LIBRARY_PATH).toBeUndefined()
    expect(env.HOME).toBe('/h')
  })
  it('finds the PATH among whatever a shell prints at startup', () => {
    expect(parseLoginPath('welcome!\n__PECTEN_PATH__/a:/b__PECTEN_PATH__')).toBe('/a:/b')
    expect(parseLoginPath('nothing')).toBeNull()
  })
})
