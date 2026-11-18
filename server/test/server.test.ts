import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { ProjectFolder } from '../src/project.ts'
import { PINNED_TOOLCHAIN, setupGameCrate } from '../src/scaffold.ts'
import { startServer } from '../src/server.ts'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
let folder: string
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'pecten-test-'))
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

/** Whether the server accepts a websocket with these headers. */
function connects(url: string, headers: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${url.replace('http', 'ws')}/ws`, { headers })
    socket.on('open', () => {
      socket.close()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })
}

describe('who the server answers', () => {
  it('refuses other host names and cross-origin sockets on loopback', async () => {
    const server = await startServer({ folder, host: '127.0.0.1', port: 0 })
    try {
      const get = (host: string) => server.app.inject({ url: '/api/project', headers: { host } })
      expect((await get('127.0.0.1:4517')).statusCode).toBe(200)
      expect((await get('localhost:5173')).statusCode).toBe(200)
      expect((await get('evil.example:4517')).statusCode).toBe(403)
      const host = new URL(server.url).host
      expect(await connects(server.url, {})).toBe(true)
      expect(await connects(server.url, { origin: `http://${host}` })).toBe(true)
      expect(await connects(server.url, { origin: 'https://evil.example' })).toBe(false)
      expect(await connects(server.url, { host: 'evil.example' })).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('accepts any host name when listening on the network', async () => {
    const server = await startServer({ folder, host: '0.0.0.0', port: 0 })
    try {
      expect((await server.app.inject({ url: '/api/project', headers: { host: '192.168.1.20:4517' } })).statusCode).toBe(200)
    } finally {
      await server.close()
    }
  })
})

describe('setting up a game crate', () => {
  it('pins the same toolchain as the sample', () => {
    expect(readFileSync(path.join(REPO, 'sample/rust-toolchain.toml'), 'utf8')).toContain(`channel = "${PINNED_TOOLCHAIN}"`)
  })

  it('writes the crate, vendors the runtime and sets the build commands', async () => {
    const project = new ProjectFolder(folder)
    await project.init('Test')
    const written = await setupGameCrate(project, REPO)
    expect(written).toContain('Cargo.toml')
    expect(existsSync(path.join(folder, 'vendor/pecten_studio_rt/Cargo.toml'))).toBe(true)
    expect(existsSync(path.join(folder, 'vendor/pecten_studio_build/fixture'))).toBe(false)
    const { build } = JSON.parse(readFileSync(path.join(folder, 'studio/project.json'), 'utf8')) as { build: { dev: string } }
    expect(build.dev).toContain('agb-gbafix')
  })

  it('keeps files that exist and refuses a folder that has a crate', async () => {
    const project = new ProjectFolder(folder)
    await project.init('Test')
    mkdirSync(path.join(folder, 'src'))
    writeFileSync(path.join(folder, 'src/main.rs'), '// mine\n')
    const written = await setupGameCrate(project, REPO)
    expect(written).not.toContain('src/main.rs')
    expect(readFileSync(path.join(folder, 'src/main.rs'), 'utf8')).toBe('// mine\n')
    await expect(setupGameCrate(project, REPO)).rejects.toThrow('already has a Cargo.toml')
  })
})
