import { create } from 'zustand'
import type { Audio, MultiKind, Project, Room, Sprite, StartSpot, Tileset, World } from '@pecten-studio/core'
import { api, watchFiles } from './api.ts'
import { toolName } from './tools.ts'
import type { AgentMessage, BuildMessage, BuildStatus, Bundle, RomStatus } from './api.ts'

/** What is open in the document area and described in Properties. */
export interface Selection {
  kind: 'world' | 'project' | 'physics' | 'audio' | 'play' | 'tools' | 'room' | 'tileset' | 'sprite' | 'asset'
  /** Document id, the file path of an asset, or for `tools` the tool open (none: the gallery). */
  id?: string
}
export const selectionKey = (s: Selection): string => `${s.kind}:${s.id ?? ''}`

const KINDS: ReadonlyArray<Selection['kind']> = ['world', 'project', 'physics', 'audio', 'play', 'tools', 'room', 'tileset', 'sprite', 'asset']
/** The open item lives in the URL's hash (`#room:entry`), so a reload or a shared link comes back to it. */
export function selectionFromHash(): Selection {
  const [kind, ...rest] = decodeURIComponent(location.hash.slice(1)).split(':')
  const id = rest.join(':')
  if (!KINDS.includes(kind as Selection['kind'])) return { kind: 'world' }
  if (kind === 'tools') return id ? { kind, id } : { kind }
  const single = kind === 'world' || kind === 'project' || kind === 'physics' || kind === 'audio' || kind === 'play'
  return single ? { kind: kind as Selection['kind'] } : id ? { kind: kind as Selection['kind'], id } : { kind: 'world' }
}

/** The document type behind each kind. */
export interface DocTypes {
  project: Project
  world: World
  audio: Audio
  room: Room
  tileset: Tileset
  sprite: Sprite
}
export type EditKind = keyof DocTypes
type Docs = Bundle['docs']

export function getDoc<K extends EditKind>(docs: Docs, kind: K, id?: string): DocTypes[K] | undefined {
  if (kind === 'project' || kind === 'world' || kind === 'audio') return docs[kind as 'project'] as DocTypes[K] | undefined
  return docs[`${kind as MultiKind}s`][id!] as DocTypes[K] | undefined
}
function withDoc<K extends EditKind>(docs: Docs, kind: K, id: string | undefined, doc: DocTypes[K] | undefined): Docs {
  if (kind === 'project' || kind === 'world' || kind === 'audio') return { ...docs, [kind]: doc }
  const group = { ...docs[`${kind as MultiKind}s`] } as Record<string, unknown>
  if (doc === undefined) delete group[id!]
  else group[id!] = doc
  return { ...docs, [`${kind}s`]: group }
}
const docKey = (kind: EditKind, id?: string): string => `${kind}:${id ?? ''}`

/** The document undo acts on for what is open, if any. The Physics tab edits the project file. */
function editedDoc(selection: Selection): { kind: EditKind; id?: string } | null {
  if (selection.kind === 'asset' || selection.kind === 'play' || selection.kind === 'tools') return null
  return selection.kind === 'physics' ? { kind: 'project' } : { kind: selection.kind, id: selection.id }
}

/** Whether two documents say the same thing, whatever order their keys are in. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((item, i) => same(item, (b as unknown[])[i]))
  const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const key of keys) if (!same(x[key], y[key])) return false
  return true
}
const EDIT_KINDS: EditKind[] = ['project', 'world', 'audio', 'room', 'tileset', 'sprite']
function docKeys(docs: Docs): Array<[EditKind, string | undefined]> {
  return EDIT_KINDS.flatMap((kind): Array<[EditKind, string | undefined]> =>
    kind === 'room' || kind === 'tileset' || kind === 'sprite' ? Object.keys(docs[`${kind}s`]).map((id) => [kind, id]) : [[kind, undefined]],
  )
}

interface History {
  past: unknown[]
  future: unknown[]
}
const HISTORY_LIMIT = 200

// Saving runs outside React state. An edit marks its document unsaved until the write
// that carried it has finished; what the disk says about an unsaved document is ignored.
const unsaved = new Set<string>()
const versions = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Saves that have been started and not finished, or are waiting for their moment. */
const pendingSaves = new Map<string, () => Promise<void>>()
const runningSaves = new Set<Promise<void>>()
/** Counts finished writes: a project load that started before one may be out of date. */
let writes = 0
// ROM status answers can arrive out of order; only the latest question's is kept.
let romQuestions = 0

/** Writes every edit now and waits until they are on disk, for when the page is about to go away. */
export async function flushSaves(): Promise<void> {
  for (const [key, save] of [...pendingSaves]) {
    clearTimeout(timers.get(key))
    void save()
  }
  await Promise.all(runningSaves)
}

interface StudioState {
  bundle: Bundle | null
  error: string | null
  /** Why the last save failed, if it did: the edit is still on screen but not on disk. */
  saveError: string | null
  connected: boolean
  /** Counts disk changes, so image previews refetch. */
  revision: number
  selection: Selection
  build: BuildStatus | null
  /** Whether the built ROM matches the project, for the top bar. */
  rom: RomStatus | null
  /** Asks the server again; the answer to the latest question wins. */
  refreshRom: () => void
  /** The last thing a coding agent did through the studio, for the top bar. */
  agent: { tool: string; summary: string; failed: boolean; at: number } | null
  /** Runs a build and streams its output into `build.log`. */
  runBuild: (mode: 'dev' | 'release') => Promise<void>
  stopBuild: () => Promise<void>
  history: Record<string, History>
  load: () => Promise<void>
  init: (name: string) => Promise<void>
  select: (selection: Selection) => void
  /**
   * A spot the author asked to play from (the map editor's "Play from here"); `n` counts
   * requests so asking for the same spot again starts the game again. Null once the Play
   * panel's Play or Reset button goes back to the start room.
   */
  playFrom: { spot: StartSpot; n: number } | null
  /** Opens the Play panel and starts the game at a spot. */
  playFromHere: (spot: StartSpot) => void
  clearPlayFrom: () => void
  /** Starts following the disk; returns how to stop. */
  watch: () => () => void
  /** Replaces a document, remembers the old one for undo, and saves. Also creates new documents. */
  commit: <K extends EditKind>(kind: K, id: string | undefined, doc: DocTypes[K]) => void
  /** Undo and redo act on the open document. */
  undo: () => void
  redo: () => void
  /** Deletes a room, tileset or sprite from disk. */
  remove: (kind: MultiKind, id: string) => Promise<void>
  /** Stores a file in the game folder; returns its path, or null if it was not stored. */
  upload: (file: File, folder: string) => Promise<string | null>
}

export const useStudio = create<StudioState>((set, get) => {
  const scheduleSave = (kind: EditKind, id: string | undefined) => {
    const key = docKey(kind, id)
    const version = (versions.get(key) ?? 0) + 1
    versions.set(key, version)
    unsaved.add(key)
    clearTimeout(timers.get(key))
    const save = () => {
      pendingSaves.delete(key)
      const doc = getDoc(get().bundle!.docs, kind, id)
      const write = async () => {
        try {
          await api.save(kind, id, doc)
          if (versions.get(key) === version) unsaved.delete(key)
          set({ saveError: null })
        } catch (error) {
          set({ saveError: (error as Error).message })
        }
        writes++
        void get().load()
      }
      const running = write().finally(() => runningSaves.delete(running))
      runningSaves.add(running)
      return running
    }
    pendingSaves.set(key, save)
    timers.set(key, setTimeout(() => void save(), 250))
  }

  const step = (from: 'past' | 'future') => {
    const { selection, bundle, history } = get()
    const edited = editedDoc(selection)
    if (!bundle || !edited) return
    const key = docKey(edited.kind, edited.id)
    const entry = history[key]
    const current = getDoc(bundle.docs, edited.kind, edited.id)
    if (!entry || entry[from].length === 0 || current === undefined) return
    const to = from === 'past' ? 'future' : 'past'
    const target = entry[from][entry[from].length - 1] as DocTypes[EditKind]
    set({
      bundle: { ...bundle, docs: withDoc(bundle.docs, edited.kind, edited.id, target) },
      history: { ...history, [key]: { ...entry, [from]: entry[from].slice(0, -1), [to]: [...entry[to], current] } as History },
    })
    scheduleSave(edited.kind, edited.id)
  }

  return {
    bundle: null,
    error: null,
    saveError: null,
    connected: false,
    revision: 0,
    selection: selectionFromHash(),
    history: {},
    build: null,
    rom: null,
    refreshRom: () => {
      const asked = ++romQuestions
      api.romStatus().then(
        (rom) => asked === romQuestions && set({ rom }),
        () => undefined,
      )
    },
    agent: null,
    playFrom: null,
    playFromHere: (spot) => {
      set((state) => ({ playFrom: { spot, n: (state.playFrom?.n ?? 0) + 1 } }))
      get().select({ kind: 'play' })
    },
    clearPlayFrom: () => set({ playFrom: null }),
    runBuild: async (mode) => {
      try {
        set({ build: await api.build(mode), saveError: null })
      } catch (error) {
        set({ saveError: `Build: ${(error as Error).message}` })
      }
    },
    stopBuild: async () => {
      await api.stopBuild().catch(() => undefined)
    },
    load: async () => {
      const started = writes
      try {
        const fresh = await api.project()
        if (started !== writes) return get().load()
        // Keep what has been edited here and not written yet.
        const local = get().bundle
        let docs = fresh.docs
        if (local) {
          for (const key of unsaved) {
            const [kind, id] = key.split(/:(.*)/s) as [EditKind, string]
            docs = withDoc(docs, kind, id || undefined, getDoc(local.docs, kind, id || undefined))
          }
        }
        // A document that reads the same keeps its identity, so nothing redraws for it.
        // One that something else changed on disk (a coding agent, git) becomes an undo
        // step: Ctrl+Z in the studio takes the change back.
        let history = get().history
        if (local) {
          for (const [kind, id] of docKeys(docs)) {
            const mine = getDoc(local.docs, kind, id)
            const theirs = getDoc(docs, kind, id)
            if (mine === undefined || theirs === undefined || mine === theirs) continue
            if (same(mine, theirs)) {
              docs = withDoc(docs, kind, id, mine)
            } else {
              const key = docKey(kind, id)
              const entry = history[key] ?? { past: [], future: [] }
              history = { ...history, [key]: { past: [...entry.past, mine].slice(-HISTORY_LIMIT), future: [] } }
            }
          }
        }
        set({ bundle: { ...fresh, docs }, history, error: null })
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
          get().refreshRom()
        },
        (connected) => {
          set({ connected })
          // The disk may have changed while the link was down.
          if (connected) {
            void get().load()
            void api.buildStatus().then((build) => set({ build })).catch(() => undefined)
            get().refreshRom()
          }
        },
        (message: BuildMessage | AgentMessage) => {
          const build = get().build
          if (message.type === 'agent') set({ agent: { tool: message.tool, summary: message.summary, failed: message.failed, at: Date.now() } })
          else if (message.type === 'open') {
            const kind = message.selection.kind as Selection['kind']
            if (KINDS.includes(kind)) get().select({ kind, ...(message.selection.id ? { id: message.selection.id } : {}) })
          } else if (message.type === 'build-started') set({ build: { running: true, mode: message.mode, command: message.command, exitCode: null, stopped: false, seconds: null, log: [], roms: build?.roms ?? {} } })
          else if (message.type === 'build-log') set({ build: build && { ...build, log: [...build.log, ...message.lines].slice(-5000) } })
          else set({ build: message.status })
          if (message.type === 'build-started' || message.type === 'build-finished' || message.type === 'rom-patched') get().refreshRom()
        },
      ),
    commit: (kind, id, doc) => {
      const { bundle, history } = get()
      if (!bundle) return
      const key = docKey(kind, id)
      const previous = getDoc(bundle.docs, kind, id)
      if (previous === doc) return
      const entry = history[key] ?? { past: [], future: [] }
      set({
        bundle: { ...bundle, docs: withDoc(bundle.docs, kind, id, doc) },
        // A document that did not exist has nothing to go back to.
        history: previous === undefined ? history : { ...history, [key]: { past: [...entry.past, previous].slice(-HISTORY_LIMIT), future: [] } },
      })
      scheduleSave(kind, id)
    },
    undo: () => step('past'),
    redo: () => step('future'),
    remove: async (kind, id) => {
      const { bundle, selection } = get()
      if (!bundle) return
      const key = docKey(kind, id)
      clearTimeout(timers.get(key))
      pendingSaves.delete(key)
      unsaved.delete(key)
      try {
        await api.remove(kind, id)
        set({ saveError: null })
      } catch (error) {
        set({ saveError: (error as Error).message })
      }
      writes++
      set((state) => ({ bundle: state.bundle && { ...state.bundle, docs: withDoc(state.bundle.docs, kind, id, undefined) } }))
      if (selection.kind === kind && selection.id === id) get().select({ kind: 'world' })
      await get().load()
    },
    upload: async (file, folder) => {
      const name = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
      const path = `${folder}/${name}`
      try {
        try {
          await api.upload(path, file, false)
        } catch (error) {
          if (!/already exists/.test((error as Error).message)) throw error
          if (!window.confirm(`${path} already exists. Replace it?`)) return null
          await api.upload(path, file, true)
        }
        set({ saveError: null })
        await get().load()
        return path
      } catch (error) {
        set({ saveError: `Import of ${file.name} failed: ${(error as Error).message}` })
        return null
      }
    },
  }
})

/** Whether the open document has steps to undo or redo. */
export function useHistoryDepth(): { undo: number; redo: number } {
  const entry = useStudio((s) => {
    const edited = editedDoc(s.selection)
    return edited ? s.history[docKey(edited.kind, edited.id)] : undefined
  })
  return { undo: entry?.past.length ?? 0, redo: entry?.future.length ?? 0 }
}

/** Title of a selection for its tab. */
export function selectionTitle(selection: Selection, bundle: Bundle | null): string {
  const { kind, id } = selection
  const docs = bundle?.docs
  switch (kind) {
    case 'world': return 'World'
    case 'project': return 'Project settings'
    case 'physics': return 'Physics'
    case 'audio': return 'Audio'
    case 'play': return 'Play'
    case 'tools': return id ? toolName(id) : 'Tools'
    case 'room': return docs?.rooms[id!]?.name ?? id!
    case 'tileset': return docs?.tilesets[id!]?.name ?? id!
    case 'sprite': return docs?.sprites[id!]?.name ?? id!
    case 'asset': return id!.split('/').pop()!
  }
}
