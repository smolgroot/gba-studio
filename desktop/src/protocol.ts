// What the main process and the shell page say to each other.
export type BuildMarker = 'idle' | 'running' | 'ok' | 'failed'

export interface TabState {
  root: string
  name: string
  status: 'starting' | 'ready' | 'failed' | 'stopped'
  error: string | null
  build: BuildMarker
  port: number | null
  /** What the project page reports for the top bar, once it has loaded. */
  page: PageStatus | null
}
/** The project page's top bar status, shown on the tab strip's line instead of in the page. */
export interface PageStatus {
  initialised: boolean
  errors: number
  warnings: number
  saveError: string | null
  /** What a coding agent just did; sent only while it should be on screen. */
  agent: { tool: string; summary: string; failed: boolean } | null
  /** Why the folder on disk is not being followed, when it is not. */
  offline: string | null
  /** Whether the built ROM matches the project: up to date, patched or needs build. */
  rom: { text: string; detail: string; tone: 'ok' | 'warning' | 'quiet' } | null
}
/** What a project page and the desktop app say to each other, as `window.pectenPage`. */
export interface PageBridge {
  status: (status: PageStatus) => void
  /** Calls the listener when the menu's Close Document (Ctrl+W) is used; returns a function that stops it. */
  onCloseDocument: (listener: () => void) => () => void
}
/** The message the main process sends a project page for Close Document. */
export const CLOSE_DOCUMENT = 'close-document'
export interface ShellState {
  tabs: TabState[]
  active: string | null
  recent: Array<{ root: string; exists: boolean }>
  /** Folders of the last session that are no longer there. */
  missing: string[]
}
export interface ShellBridge {
  onState: (listener: (state: ShellState) => void) => void
  openFolder: () => void
  open: (root: string) => void
  activate: (root: string) => void
  close: (root: string) => void
  restart: (root: string) => void
  forget: (root: string) => void
}
export const TAB_BAR_HEIGHT = 38
