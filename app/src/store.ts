import { create } from 'zustand'
import { api, watchFiles } from './api.ts'
import type { Bundle } from './api.ts'

/** What is open in the document area and described in Properties. */
export interface Selection {
  kind: 'world' | 'project' | 'audio' | 'room' | 'tileset' | 'sprite' | 'asset'
  /** Document id, or the file path of an asset. */
  id?: string
}
export const selectionKey = (s: Selection): string => `${s.kind}:${s.id ?? ''}`

const KINDS: ReadonlyArray<Selection['kind']> = ['world', 'project', 'audio', 'room', 'tileset', 'sprite', 'asset']
/** The open item lives in the URL's hash (`#room:entry`), so a reload or a shared link comes back to it. */
function selectionFromHash(): Selection {
  const [kind, ...rest] = decodeURIComponent(location.hash.slice(1)).split(':')
  const id = rest.join(':')
  if (!KINDS.includes(kind as Selection['kind'])) return { kind: 'world' }
  const single = kind === 'world' || kind === 'project' || kind === 'audio'
  return single ? { kind: kind as Selection['kind'] } : id ? { kind: kind as Selection['kind'], id } : { kind: 'world' }
}

interface StudioState {
  bundle: Bundle | null
  error: string | null
  connected: boolean
  /** Counts disk changes, so image previews refetch. */
  revision: number
  selection: Selection
  load: () => Promise<void>
  init: (name: string) => Promise<void>
  select: (selection: Selection) => void
  /** Starts following the disk; returns how to stop. */
  watch: () => () => void
}

export const useStudio = create<StudioState>((set, get) => ({
  bundle: null,
  error: null,
  connected: false,
  revision: 0,
  selection: selectionFromHash(),
  load: async () => {
    try {
      set({ bundle: await api.project(), error: null })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },
  init: async (name) => {
    try {
      set({ bundle: await api.init(name), error: null })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },
  select: (selection) => {
    if (selectionKey(selection) === selectionKey(get().selection)) return
    set({ selection })
    history.replaceState(null, '', `#${selection.kind}${selection.id ? `:${encodeURIComponent(selection.id)}` : ''}`)
  },
  watch: () =>
    watchFiles(
      () => {
        set((state) => ({ revision: state.revision + 1 }))
        void get().load()
      },
      (connected) => {
        set({ connected })
        // The disk may have changed while the link was down.
        if (connected) void get().load()
      },
    ),
}))

/** Title of a selection for its tab. */
export function selectionTitle(selection: Selection, bundle: Bundle | null): string {
  const { kind, id } = selection
  const docs = bundle?.docs
  switch (kind) {
    case 'world': return 'World'
    case 'project': return 'Project settings'
    case 'audio': return 'Audio'
    case 'room': return docs?.rooms[id!]?.name ?? id!
    case 'tileset': return docs?.tilesets[id!]?.name ?? id!
    case 'sprite': return docs?.sprites[id!]?.name ?? id!
    case 'asset': return id!.split('/').pop()!
  }
}
