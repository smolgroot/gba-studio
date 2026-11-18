// What the main process and the shell page say to each other.
export type BuildMarker = 'idle' | 'running' | 'ok' | 'failed'

export interface TabState {
  root: string
  name: string
  status: 'starting' | 'ready' | 'failed' | 'stopped'
  error: string | null
  build: BuildMarker
  port: number | null
}
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
