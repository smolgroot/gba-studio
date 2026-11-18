// What a new project starts with.
import { FORMAT_VERSION, Physics } from './schema.ts'
import type { Audio, Project, World } from './schema.ts'

export function newProject(name: string): { project: Project; world: World; audio: Audio } {
  return {
    project: {
      version: FORMAT_VERSION,
      name,
      build: {
        dev: 'cargo build',
        release: 'cargo build --release',
        devRom: 'dist/game-dev.gba',
        releaseRom: 'dist/game.gba',
      },
      collisionClasses: [
        { id: 'empty', name: 'Empty', colour: '#000000', kind: 'empty' },
        { id: 'solid', name: 'Solid', colour: '#e5484d', kind: 'solid' },
        { id: 'oneway', name: 'One-way platform', colour: '#f5d90a', kind: 'oneway' },
        { id: 'slope-up', name: 'Slope up 45°', colour: '#46a758', kind: 'slope', slope: { left: 0, right: 8 } },
        { id: 'slope-down', name: 'Slope down 45°', colour: '#46a758', kind: 'slope', slope: { left: 8, right: 0 } },
        { id: 'hazard', name: 'Hazard', colour: '#d6409f', kind: 'hazard' },
      ],
      entityTypes: [{ id: 'player-start', name: 'Player start', colour: '#3e63dd', props: [] }],
      physics: Physics.parse({}),
    },
    world: { version: FORMAT_VERSION, rooms: [] },
    audio: { version: FORMAT_VERSION, tracks: [], sfx: [] },
  }
}
