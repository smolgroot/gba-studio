import type { ArtCosts, DocKind, Documents, Problem } from '@pecten-studio/core'

export interface AssetFile {
  path: string
  size: number
}
export interface Bundle {
  folder: string
  initialised: boolean
  docs: Documents
  problems: Problem[]
  assets: AssetFile[]
  /** Tiles and palettes of the tileset and background images, worked out by the server. */
  art: ArtCosts
}

export interface RomInfo {
  path: string
  size: number
  modified: number
  /** Bytes of the level data section in use and its capacity; null if the ROM has none. */
  data: { used: number; capacity: number } | null
}
export interface BuildStatus {
  running: boolean
  mode: 'dev' | 'release' | null
  command: string | null
  exitCode: number | null
  stopped: boolean
  seconds: number | null
  log: string[]
  roms: Partial<Record<'dev' | 'release', RomInfo>>
}
export interface ToolchainReport {
  hasCrate: boolean
  canSetUp: boolean
  items: Array<{ name: string; ok: boolean; install?: string }>
}
/** What a patch of the level data into the built ROM did: see server/src/patch.ts. */
export type PatchResult =
  | { status: 'patched' | 'unchanged'; rom: string; used: number; capacity: number; ms: number }
  | { status: 'needs-build'; rom: string | null; reasons: string[] }
  | { status: 'invalid'; rom: string | null; problems: string[] }

/** Whether the built ROM matches the project: see server/src/patch.ts and design/US-004.md. */
export type RomStatus =
  | { state: 'none' | 'building'; mode: 'dev' | 'release' }
  | { state: 'up-to-date' | 'patched' | 'can-patch'; mode: 'dev' | 'release'; rom: string }
  | { state: 'needs-build'; mode: 'dev' | 'release'; rom: string; reasons: string[] }

/** What the server pushes while a build runs. */
export type BuildMessage =
  | { type: 'build-started'; mode: 'dev' | 'release'; command: string }
  | { type: 'build-log'; lines: string[] }
  | { type: 'build-finished'; status: BuildStatus }
  /** Level data was written into a ROM without a build. */
  | { type: 'rom-patched'; status: BuildStatus }
/** What a coding agent did through the studio's MCP endpoint, or asks the page to show. */
export type AgentMessage =
  | { type: 'agent'; tool: string; summary: string; failed: boolean }
  | { type: 'open'; selection: { kind: string; id?: string } }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new Error(body?.error ?? `${response.status} ${response.statusText}`)
  return body as T
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  project: () => request<Bundle>('/api/project'),
  init: (name: string) => request<Bundle>('/api/init', json('POST', { name })),
  save: (kind: DocKind, id: string | undefined, doc: unknown) =>
    request<{ ok: true }>(`/api/doc/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`, json('PUT', doc)),
  buildStatus: () => request<BuildStatus>('/api/build'),
  build: (mode: 'dev' | 'release') => request<BuildStatus>('/api/build', json('POST', { mode })),
  stopBuild: () => request<{ ok: true }>('/api/build/stop', json('POST', {})),
  romStatus: () => request<RomStatus>('/api/rom-status'),
  patch: (mode: 'dev' | 'release') => request<PatchResult>('/api/patch', json('POST', { mode })),
  toolchain: () => request<ToolchainReport>('/api/toolchain'),
  setupCrate: () => request<{ written: string[] }>('/api/setup-crate', json('POST', {})),
  context: (view: unknown) => request<{ ok: true }>('/api/context', json('POST', view)),
  remove: (kind: DocKind, id: string) => request<{ ok: true }>(`/api/doc/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  upload: (path: string, file: Blob, overwrite: boolean) =>
    request<{ ok: true; path: string }>(`/api/upload?path=${encodeURIComponent(path)}${overwrite ? '&overwrite=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    }),
}

/** URL of a file in the game folder; `revision` changes when the disk does, so previews reload. */
export function fileUrl(path: string, revision: number): string {
  return `/files/${path.split('/').map(encodeURIComponent).join('/')}?r=${revision}`
}

/** Calls `onChange` when files change on disk and `onStatus` as the link goes up and down; reconnects by itself. */
export function watchFiles(onChange: (paths: string[]) => void, onStatus: (connected: boolean) => void, onMessage?: (message: BuildMessage | AgentMessage) => void): () => void {
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const connect = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    socket.onopen = () => onStatus(true)
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: 'changed'; paths: string[] } | BuildMessage | AgentMessage
      if (message.type === 'changed') onChange(message.paths)
      else onMessage?.(message)
    }
    socket.onclose = () => {
      onStatus(false)
      if (!stopped) retry = setTimeout(connect, 1500)
    }
  }
  connect()
  return () => {
    stopped = true
    clearTimeout(retry)
    socket?.close()
  }
}
