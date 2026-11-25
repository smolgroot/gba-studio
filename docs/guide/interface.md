# The interface

The studio is dark and compact, in the style of an image editor.

![Dockable panels on a wide screen](/screenshots/studio-overview.png)

## Layout on wide screens

Panels are dockable: drag them, tab them together and split them.

| Panel | What it holds |
| --- | --- |
| **Project** | Everything in the game, see below. |
| **Document tabs** | One tab per open item: World, a room, a tileset, a sprite, Project settings, Play, Audio, Tools or one tool, or an image in the pixel editor. |
| **Properties** | The settings of whatever is open or selected: a room's name, size, tileset, music and backgrounds, a sprite's anchor and hitbox, and so on. |
| **Tiles & Layers** | In a room: its layers, the entity types to place and the collision classes. |
| **Problems** and **Build** | Below the editor. Problems lists what is wrong; Build runs and streams the build. |

The top bar shows the project name and, on the right, whether the built ROM is up to date and the number of errors and warnings. When a change needs a build, it says why and offers **Build dev**; see [ROM state in the top bar](./build-and-play#rom-state-in-the-top-bar). In the [desktop app](./desktop), the project tabs take the top bar's place and show the same on their right.

## The Project panel

<span id="the-project-panel"></span>

| Section | Contents |
| --- | --- |
| **World**, **Project settings**, **Play**, **Audio**, **Tools** | The fixed pages. World shows the number of rooms; Audio shows tracks and sound effects. |
| **Rooms** | Every room with its size in screens. **+** makes a new room (a room needs a tileset first). |
| **Tilesets** | PNGs of 8x8 tiles with collision classes. **+** makes one from a PNG. |
| **Sprites** | Sprite sheets with their frame size and number of animations. **+** makes one from a sheet. |
| **Asset files** | Every PNG, audio and other file in `assets/`, with its size. **+** makes a new blank image to draw. Click a PNG to open it in the [pixel editor](./pixel-editor). |

The panel always fills the window's height and never scrolls as a whole. Each open section scrolls its own list, and the open sections share the height between them. Drag the line above a section to give it more or less room; double-click the line to share the height out evenly again. Click a section's title to fold it.

### The activity bar

The thin strip of icons on the far left works like VS Code's. The top button, or `Ctrl+B`, hides the Project panel to give the editor the room and brings it back. Below it, the fixed pages (World, Project settings, Physics, Play, Audio, [Tools](./tools)) open in one click. The section icons (Rooms, Tilesets, Sprites, Asset files) show the panel with that section open; clicking one whose section is already open folds it.

## Narrow screens and phones

One panel is shown at a time, switched with the tabs along the bottom (Project, the open item, Tiles, Properties, Build, Problems). Touch targets are larger.

![The studio at phone width](/screenshots/mobile.png)

## Addresses

The open item is kept in the address bar (`#room:entry`), so a reload or a pasted link comes back to it.

## Saving, undo and live reload

- **Autosave.** Every edit saves by itself a moment after you make it. If a save fails, the top bar says so and the edit stays on screen.
- **Undo and redo** work per document: `Ctrl+Z` and `Ctrl+Shift+Z`, up to 200 steps. Pixel images keep 100 steps.
- **Live reload.** Files changed on disk by something else (your pixel editor, git, a coding agent) show up in the studio straight away. Edits you have not saved yet are kept.
- **Agent edits are undoable.** Ctrl+Z in the studio undoes a coding agent's change to a document like any other step.

## Problems

Problems are collected across the whole project and listed in the Problems panel. Click one to open the item it belongs to. They cover:

- missing files and unknown references;
- rooms with the wrong amount of tile data;
- overlapping rooms on the world map, or rooms outside a sized map;
- sprite frames that are not a GBA size;
- tilesets and rooms over the 1024 background tiles or 16 background palettes, and images the build could not convert (see [Rooms](./rooms#tile-and-palette-budget));
- entity types' behaviours: unknown ones, and properties missing, unknown or out of range (see [Behaviours](./making-a-game#giving-a-type-its-behaviours));
- a value stored by a placed entity that does not fit its type's own property, such as a number for a boolean or an option the list does not have, and an integer default past 32 bits (see [Values that do not fit](./project-settings#property-misfit));
- and more.

Fix them before you build; the build helper reports the limits the studio does not check yet (sprite colours, layers) when it runs. See [Build and Play](./build-and-play).

## Importing files

Images, music and sounds are chosen on your device and stored in the game folder (`assets/sprites/`, `assets/audio/`, and so on). A file is never replaced without asking. Your source files stay the source of truth: the studio reads and watches them and rewrites a PNG only when you draw on it in the pixel editor.
