// What the map editor is set to: tool, layer, brush. Shared by the room view, the
// Tiles & Layers panel and Properties.
import { create } from 'zustand'

export type Tool = 'brush' | 'eraser' | 'rect' | 'fill' | 'pick' | 'entity' | 'pan'
/** A block of tiles picked in the tileset, in tiles: what the brush stamps. */
export interface Stamp {
  x: number
  y: number
  w: number
  h: number
}

interface EditorState {
  tool: Tool
  /** Index of the tile layer being painted, or the collision overrides. */
  layer: number | 'collision'
  stamp: Stamp
  /** Index of the collision class painted on the collision layer. */
  collisionClass: number
  /** Entity type placed by the entity tool. */
  entityType: string | null
  /** Index of the selected entity in the open room. */
  entity: number | null
  hidden: number[]
  showGrid: boolean
  showCollision: boolean
  /** Whether the room's background pictures are drawn behind its tiles. */
  showBackgrounds: boolean
  set: (patch: Partial<Omit<EditorState, 'set'>>) => void
}

export const useEditor = create<EditorState>((set) => ({
  tool: 'brush',
  layer: 0,
  stamp: { x: 1, y: 0, w: 1, h: 1 },
  collisionClass: 1,
  entityType: null,
  entity: null,
  hidden: [],
  showGrid: true,
  showCollision: false,
  showBackgrounds: true,
  set: (patch) => set(patch),
}))
