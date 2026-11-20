// The Tools section: helpers that make assets, each opened from a card in the gallery.
// Kept free of React so the store can name a tool's tab.

export interface ToolInfo {
  id: string
  name: string
  description: string
  tags: string[]
}

export const TOOLS: readonly ToolInfo[] = [
  {
    id: 'tileset-generator',
    name: 'Platformer tileset generator',
    description: 'Ground, platforms, pillars, bricks and decorations from a few colours and a seed. Saves a GBA-ready tileset with its collision set.',
    tags: ['Tilesets', 'Procedural'],
  },
  {
    id: 'room-generator',
    name: 'Metroidvania room generator',
    description: 'Rooms laid out from a generated tileset: linear levels, caverns with slopes and small places, or a climbing shaft. Sized to the jump, so every exit can be reached.',
    tags: ['Rooms', 'Procedural'],
  },
  {
    id: 'pixel-art',
    name: 'Pixel art converter',
    description: 'Turns a picture into pixel art at 16, 32, 64 px or any size, fits it to a GBA palette and adds dark strokes around shapes.',
    tags: ['Sprites', 'Images'],
  },
]

export const toolName = (id: string): string => TOOLS.find((t) => t.id === id)?.name ?? id
