// Runs one project's studio server in a process of its own, for the desktop app.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { docPath } from '@pecten-studio/core'
import { setEmulatorCore } from './emulator.ts'
import { startServer } from './server.ts'

export interface HostStart {
  type: 'start'
  folder: string
  port: number
  appDist: string
  crates: string
  emulatorCore: string
  buildEnv: NodeJS.ProcessEnv
}
export type HostRequest = HostStart | { type: 'close' }
export type HostMessage =
  | { type: 'ready'; url: string; port: number; name: string }
  | { type: 'failed'; code: string | null; message: string }
  | { type: 'name'; name: string }
  | { type: 'event'; event: { type: string; status?: { exitCode: number | null; stopped: boolean } } }
  | { type: 'closed' }

interface ParentPort {
  on: (event: 'message', listener: (message: { data: HostRequest }) => void) => void
  postMessage: (message: HostMessage) => void
}
const parent = (process as unknown as { parentPort: ParentPort }).parentPort

let close: (() => Promise<void>) | undefined

async function projectName(folder: string): Promise<string> {
  try {
    const { name } = JSON.parse(await readFile(path.join(folder, docPath('project')), 'utf8')) as { name?: unknown }
    if (typeof name === 'string' && name) return name
  } catch {
    // No project yet, or one being edited: the folder's name will do.
  }
  return path.basename(folder)
}

async function start(request: HostStart): Promise<void> {
  setEmulatorCore(request.emulatorCore)
  let lastName = await projectName(request.folder)
  const server = await startServer({
    folder: request.folder,
    host: '127.0.0.1',
    port: request.port,
    appDist: request.appDist,
    crates: request.crates,
    buildEnv: request.buildEnv,
    onEvent: (message) => {
      const event = message as { type: string; paths?: string[]; status?: { exitCode: number | null; stopped: boolean } }
      if (event.type === 'build-started' || event.type === 'build-finished') {
        parent.postMessage({ type: 'event', event: { type: event.type, ...(event.status ? { status: { exitCode: event.status.exitCode, stopped: event.status.stopped } } : {}) } })
      }
      if (event.type === 'changed' && event.paths?.includes(docPath('project'))) {
        void projectName(request.folder).then((name) => {
          if (name === lastName) return
          lastName = name
          parent.postMessage({ type: 'name', name })
        })
      }
    },
  })
  close = server.close
  parent.postMessage({ type: 'ready', url: server.url, port: Number(new URL(server.url).port), name: lastName })
}

parent.on('message', ({ data }) => {
  if (data.type === 'start') {
    start(data).catch((error: NodeJS.ErrnoException) => {
      parent.postMessage({ type: 'failed', code: error.code ?? null, message: error.message })
    })
  } else {
    void (close?.() ?? Promise.resolve()).finally(() => {
      parent.postMessage({ type: 'closed' })
      process.exit(0)
    })
  }
})
