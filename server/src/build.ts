// Runs the project's build commands and reports their output as it comes.
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { Project, docPath } from '@pecten-studio/core'
import { HttpError } from './project.ts'
import type { ProjectFolder } from './project.ts'

export type BuildMode = 'dev' | 'release'

export interface RomInfo {
  path: string
  size: number
  /** Milliseconds since the epoch: changes when the ROM is rebuilt. */
  modified: number
}

export interface BuildStatus {
  running: boolean
  mode: BuildMode | null
  command: string | null
  /** Exit code of the last finished build; null if none has run, it was stopped, or one is running. */
  exitCode: number | null
  stopped: boolean
  /** Seconds the last finished build took. */
  seconds: number | null
  log: string[]
  roms: Partial<Record<BuildMode, RomInfo>>
}

const MAX_LOG_LINES = 5000

export class Builder {
  private child: ChildProcess | null = null
  private state: Omit<BuildStatus, 'roms'> = { running: false, mode: null, command: null, exitCode: null, stopped: false, seconds: null, log: [] }
  private project: ProjectFolder
  private broadcast: (message: unknown) => void
  private env: NodeJS.ProcessEnv | undefined

  constructor(project: ProjectFolder, broadcast: (message: unknown) => void, env?: NodeJS.ProcessEnv) {
    this.project = project
    this.broadcast = broadcast
    this.env = env
  }

  private async settings(): Promise<Project['build']> {
    const text = await readFile(this.project.resolve(docPath('project')), 'utf8').catch(() => {
      throw new HttpError(409, 'this folder has no studio project')
    })
    const parsed = Project.safeParse(JSON.parse(text))
    if (!parsed.success) throw new HttpError(409, 'studio/project.json has errors; see Problems')
    return parsed.data.build
  }

  async status(): Promise<BuildStatus> {
    const roms: BuildStatus['roms'] = {}
    const build = await this.settings().catch(() => null)
    for (const mode of ['dev', 'release'] as const) {
      const path = build?.[`${mode}Rom`]
      if (!path) continue
      const info = await stat(this.project.resolve(path)).catch(() => null)
      if (info?.isFile()) roms[mode] = { path, size: info.size, modified: info.mtimeMs }
    }
    return { ...this.state, roms }
  }

  async start(mode: BuildMode): Promise<void> {
    if (mode !== 'dev' && mode !== 'release') throw new HttpError(400, 'build mode is "dev" or "release"')
    if (this.child) throw new HttpError(409, 'a build is already running')
    const command = (await this.settings())[mode]
    const started = Date.now()
    this.state = { running: true, mode, command, exitCode: null, stopped: false, seconds: null, log: [] }
    // Its own process group, so stopping it also stops what it started (cargo, rustc).
    const child = spawn(command, { cwd: this.project.root, env: this.env ?? process.env, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.broadcast({ type: 'build-started', mode, command })

    let pending: string[] = []
    let timer: NodeJS.Timeout | undefined
    const flush = () => {
      timer = undefined
      if (pending.length === 0) return
      this.state.log.push(...pending)
      if (this.state.log.length > MAX_LOG_LINES) this.state.log.splice(0, this.state.log.length - MAX_LOG_LINES)
      this.broadcast({ type: 'build-log', lines: pending })
      pending = []
    }
    const reader = (stream: NodeJS.ReadableStream) => {
      let partial = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        // Cargo redraws its progress line with carriage returns: keep the last state of a line.
        const lines = (partial + chunk).split('\n')
        partial = lines.pop()!
        pending.push(...lines.map((line) => line.split('\r').pop()!))
        timer ??= setTimeout(flush, 60)
      })
      stream.on('end', () => {
        if (partial) pending.push(partial.split('\r').pop()!)
      })
    }
    reader(child.stdout!)
    reader(child.stderr!)

    const finish = async (exitCode: number | null, problem?: string) => {
      if (this.child !== child) return
      this.child = null
      clearTimeout(timer)
      if (problem) pending.push(problem)
      flush()
      this.state = { ...this.state, running: false, exitCode: this.state.stopped ? null : exitCode, seconds: Math.round((Date.now() - started) / 100) / 10 }
      this.broadcast({ type: 'build-finished', status: await this.status() })
    }
    child.on('error', (error) => void finish(null, `could not run the build command: ${error.message}`))
    child.on('close', (code) => void finish(code))
  }

  /** Runs a build to its end. `onLine` gets the output as it comes. */
  async run(mode: BuildMode, onLine?: (line: string) => void): Promise<BuildStatus> {
    const previous = this.broadcast
    return new Promise<BuildStatus>((resolve, reject) => {
      this.broadcast = (message) => {
        previous(message)
        const m = message as { type: string; lines?: string[]; status?: BuildStatus }
        if (m.type === 'build-log') m.lines?.forEach((line) => onLine?.(line))
        if (m.type === 'build-finished') {
          this.broadcast = previous
          resolve(m.status!)
        }
      }
      this.start(mode).catch((error: unknown) => {
        this.broadcast = previous
        reject(error as Error)
      })
    })
  }

  /** Whether a build is running now. */
  get running(): boolean {
    return this.child !== null
  }

  /** Tells the studio's pages that a ROM was rewritten without a build, so Play restarts it. */
  async romPatched(): Promise<void> {
    this.broadcast({ type: 'rom-patched', status: await this.status() })
  }

  stop(): void {
    const child = this.child
    if (!child?.pid) return
    this.state.stopped = true
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}
