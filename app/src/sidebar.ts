// The Project sidebar's layout: whether it is shown, which sections are folded, and how
// the open sections share its height. Kept per browser, like VS Code's view layout.
import { create } from 'zustand'

/** The sidebar's sections, top to bottom. */
export const SECTIONS = ['Rooms', 'Tilesets', 'Sprites', 'Entity types', 'Asset files'] as const
export type SectionTitle = (typeof SECTIONS)[number]

const KEY = 'pecten-studio:sidebar'

interface Saved {
  hidden: boolean
  collapsed: Record<string, boolean>
  /** Relative heights of the open sections; a section without one gets an equal share. */
  sizes: Record<string, number>
}

interface SidebarState extends Saved {
  /** Bumped to ask the sidebar to bring a section into view. */
  reveal: { title: SectionTitle; at: number } | null
  setHidden: (hidden: boolean) => void
  toggleHidden: () => void
  setCollapsed: (title: string, collapsed: boolean) => void
  setSizes: (sizes: Record<string, number>, keep?: boolean) => void
  resetSizes: () => void
  /** Shows the sidebar with this section open. */
  open: (title: SectionTitle) => void
}

function load(): Saved {
  const empty: Saved = { hidden: false, collapsed: {}, sizes: {} }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    if (saved) return { ...empty, ...saved }
    // Earlier versions kept the folded sections on their own.
    return { ...empty, collapsed: JSON.parse(localStorage.getItem('pecten-studio:collapsed-sections') ?? '{}') }
  } catch {
    return empty
  }
}

function save({ hidden, collapsed, sizes }: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify({ hidden, collapsed, sizes })) } catch { /* storage unavailable */ }
}

export const useSidebar = create<SidebarState>((set, get) => {
  const update = (patch: Partial<SidebarState>, keep = true) => {
    set(patch)
    if (keep) save(get())
  }
  return {
    ...load(),
    reveal: null,
    setHidden: (hidden) => update({ hidden }),
    toggleHidden: () => update({ hidden: !get().hidden }),
    setCollapsed: (title, collapsed) => update({ collapsed: { ...get().collapsed, [title]: collapsed } }),
    setSizes: (sizes, keep = true) => update({ sizes }, keep),
    resetSizes: () => update({ sizes: {} }),
    open: (title) => update({ hidden: false, collapsed: { ...get().collapsed, [title]: false }, reveal: { title, at: Date.now() } }),
  }
})
