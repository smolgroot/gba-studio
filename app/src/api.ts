import type { DocKind, Documents, Problem } from '@gba-studio/core'

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
}

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
export function watchFiles(onChange: (paths: string[]) => void, onStatus: (connected: boolean) => void): () => void {
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const connect = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    socket.onopen = () => onStatus(true)
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; paths: string[] }
      if (message.type === 'changed') onChange(message.paths)
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
