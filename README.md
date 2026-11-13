# GBA-Studio

A browser-based studio for making Game Boy Advance Metroidvanias from assets you
create yourself: pixel art in PNG, music in MIDI or tracker files, and rooms painted
on a grid of GBA screens. It edits a project of plain JSON files, converts it to
GBA-ready data for Rust games built on [agb](https://agbrs.dev), and runs the
resulting ROM in the browser.

It knows nothing about any particular game. It knows tiles, collision classes,
entities with typed properties, sprites and animations, and music. What an entity
*does* is written in each game's Rust code.

**Status: early but working end to end.** You can draw a project's content in the
editors, build a ROM from it, and play that ROM in the studio. A sample game in
`sample/` is made entirely from a studio project. Things that are not done yet are
listed under [Known limits](#known-limits) and the [roadmap](#roadmap).

## Contents

- [Features](#features)
- [Running it](#running-it)
- [Working with coding agents](#working-with-coding-agents)
- [Making a game with it](#making-a-game-with-it)
- [Project format](#project-format)
- [Repository layout](#repository-layout)
- [Known limits](#known-limits)
- [Roadmap](#roadmap)

## Features

### Interface

- Dark, compact interface in the style of an image editor, drawn at 1.25x.
- **Wide screens:** dockable panels that can be dragged, tabbed and split: Project,
  one tab per open item, Properties, Tiles & Layers, and Problems and Build below.
- **Narrow screens and phones:** one panel at a time, switched with tabs along the
  bottom, with larger touch targets.
- The open item is kept in the address bar (`#room:entry`), so a reload or a pasted
  link comes back to it.

### Saving, undo and live reload

- Every edit saves by itself a moment after you make it. If a save fails, the top bar
  says so and the edit stays on screen.
- Undo and redo work per document (`Ctrl+Z`, `Ctrl+Shift+Z`), up to 200 steps.
- Files changed on disk by something else (your pixel editor, git, a coding agent)
  show up in the studio straight away. Edits you have not saved yet are kept.
- Problems are collected across the whole project and listed in the Problems panel;
  click one to open the item it belongs to. They cover missing files, unknown
  references, rooms with the wrong amount of tile data, overlapping rooms on the
  world map, sprite frames that are not a GBA size, and more.

### Map editor

Open a room to paint it.

- **Tools:** brush, eraser, rectangle, flood fill, tile picker, entities and pan.
- **Layers:** up to three tile layers per room (the GBA has four backgrounds, and one
  is left to the game). Add, rename, reorder, hide and delete layers. A room opens on
  its front layer.
- **Stamps:** click a tile in the tileset palette, or drag across several to paint
  a block. Painting a stamp over an area repeats its pattern from where the stroke
  began.
- **Collision layer:** tiles carry the collision class given to them in their
  tileset. Paint on the collision layer only where a cell should differ; the eraser
  gives a cell back to its tile. A toggle shows the result over the map.
- **Entities:** place them with a click, drag them, edit their position and typed
  properties in Properties, delete them with `Delete`. They are placed by their feet
  (the middle of the bottom edge). An entity type with a sprite shows that sprite on
  the map.
- **Room properties:** name, size in whole screens (shrinking asks first and undo
  brings the cut-off part back), tileset and music track.
- **Guides:** a tile grid and lines at every screen boundary (240x160 pixels).
- Zoom with the buttons or `Ctrl` + wheel; pan with the hand tool, `Space`, or the
  middle button. The mouse position is shown as a tile and screen coordinate.

| Key | Action |
| --- | --- |
| `B` / `E` | Brush / eraser |
| `R` / `G` | Rectangle / fill |
| `I`, or `Alt` + click | Pick a tile from the map |
| `N` | Entities |
| `H`, or hold `Space` | Pan |
| `Delete` | Remove the selected entity |
| Right mouse button | Erase while using the brush or rectangle |

### World map

Rooms are whole numbers of screens placed on a grid. Drag rooms to arrange them,
choose the start room, take a room off the map or put an unplaced one back. A
new room is placed beside the others. Select a room to change its size in screens
right there. In Properties the map can be given a size in screens (and so in tiles);
rooms are then kept inside it, and a room outside is reported as a problem. Without
a size the map grows with its rooms.

Rooms that touch on this grid are connected in the game: the player walks from one
into the other and the camera scrolls across with no cut or loading, the next room's
tiles being written to video memory just ahead of it.

### Tilesets

Import a PNG whose size is a multiple of 8, and paint a collision class on each tile.
The editor shows the image size, tile count and the number of distinct GBA colours
(colours are reduced to 5 bits a channel, as the hardware does).

### Sprites

Import a PNG sheet (or an Aseprite file, which is converted at build time but cannot
be previewed here yet), choose one of the twelve GBA sprite sizes, then:

- build **animations** by clicking frames in the sheet, in the order they play;
- set the duration of each step in ticks (1 tick is one GBA frame, 1/60 s), reorder
  or remove steps, and choose whether it loops;
- set the **anchor** (the point placed at an entity's position) and a **hitbox**;
- watch the result in a live preview that plays at the console's real speed, with the
  anchor and hitbox drawn over it.

### Audio

- Import **WAV** (sound effects), **XM** and **MOD** (tracker music), and **MIDI**
  with an **SF2** soundfont (agb needs one to turn notes into sound).
- Name tracks and effects, remove them from the project (the file stays on disk),
  pick which soundfont a MIDI file uses, and give a room a music track.
- Sound effects play in the studio. Music formats are converted when the ROM is
  built, so you hear them in the Play panel, not in the Audio list.

### Build and Play

- **Build panel:** run the project's dev or release build (commands are set in
  Project settings), with the output streamed live; stop a running build. Failed
  builds are marked and the exit code shown.
- **Play panel:** runs the built ROM on the
  [Pecten](https://github.com/smolgroot/pecten) emulator core in the browser at the
  console's frame rate, with sound (enable it with a click, as browsers require) and
  on-screen buttons on touch devices. It restarts the game by itself when the ROM is
  rebuilt, if you leave that on. Keyboard: arrows, `X` is A, `Z` is B, `Enter` is
  Start, `Shift` is Select, `A` and `S` are L and R.

### Importing files

Images, music and sounds are chosen on your device and stored in the game folder
(`assets/sprites/`, `assets/audio/`, and so on). A file is never replaced without
asking. Your source files stay the source of truth: the studio reads and watches them
and never rewrites them.

## Running it

Needs Node 24 or later and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm build                  # build the web app once
pnpm start sample           # serve the sample project at http://127.0.0.1:4517
pnpm start ../my-game       # or any game folder
```

- `--port N` changes the port.
- `--lan` listens on every network interface, so a tablet on the same network can
  open the studio. Anyone on that network can then edit the game folder and run its
  build command, so use it only on networks you trust.
- Opening a folder with no project offers to create one. That adds a `studio/` folder
  with three small JSON files and touches nothing else.
- The server can only read and write inside the folder it was given (symlinks that
  point out of it are refused), and refuses writes from other web pages.

For work on the studio itself, `pnpm dev` runs the server on `sample/` and the app
under Vite with hot reload at http://localhost:5173.

```sh
pnpm test        # TypeScript tests (schemas, validation, helpers)
pnpm typecheck
cargo test       # Rust tests (build helper, collision and physics)
```

## Working with coding agents

The studio's project code is also a command line and an MCP server, so an agent
(Claude Code or any MCP client) can work on a game without overwriting hand-made
art, music and levels.

```sh
gba-studio validate <folder> [--json]            # every problem; exit 1 on errors
gba-studio build <folder> [--release] [--json]   # run the project's build command
gba-studio schema                                # JSON Schema of every document kind
gba-studio agents <folder>                       # write AGENTS.md into the game folder
gba-studio mcp <folder>                          # MCP server over stdio
```

From a checkout, `gba-studio` is `node <this repo>/server/src/cli.ts`. To give Claude
Code the tools for a game, put this in the game folder's `.mcp.json`:

```json
{
  "mcpServers": {
    "gba-studio": { "command": "node", "args": ["/path/to/gba-studio/server/src/cli.ts", "mcp", "."] }
  }
}
```

The MCP server has 19 tools:

| Tools | What they do |
| --- | --- |
| `project_overview`, `validate`, `list_assets` | Summarise the project, list its problems, list asset files |
| `read_document`, `write_document`, `delete_document` | Whole documents, checked against the schemas before writing |
| `room_read_cells`, `room_fill`, `room_paint` | Read and change tile layers and collision by cell, without touching the run-length data |
| `room_create`, `room_resize`, `world_place` | Make and size rooms, arrange the world map, set the start room |
| `entity_add`, `entity_update`, `entity_remove` | Entities in a room |
| `render_room`, `render_tileset` | Pictures of a room (optionally tinted by collision) and of a tileset with its grid, so the agent can look |
| `build`, `run_rom` | Build the ROM; run it headless for given frames and held buttons and get a picture after each step |

Every write is validated and answered with the problems it left in that file. Writes
are plain file saves, so a studio open on the same folder shows them as they happen.
Errors inside a tool come back as text the agent can act on ("no layer "nope"; layers
are: 0 "Back wall", 1 "Ground", or "collision"").

Creating a project writes an `AGENTS.md` into the game folder. It tells agents which
files are hand-made and must not be regenerated, how the format works, and which
tools to use.

## Making a game with it

A game is a Rust crate on agb that depends on two crates from this repository:

```toml
[dependencies]
gba_studio_rt = { path = "../runtime", features = ["agb"] }

[build-dependencies]
gba_studio_build = { path = "../codegen" }
```

`build.rs` is one line:

```rust
fn main() {
    gba_studio_build::build();
}
```

**The build helper** (`codegen/`) reads `studio/` next to the game's `Cargo.toml`
(or the folder named by `GBA_STUDIO_PROJECT`), converts the PNGs, and writes Rust
and binary data the game includes. It checks what the GBA can hold and says what is
wrong in terms of your project: a tile with more than 15 colours, tiles needing more
than 16 palettes, a tileset over 1024 tiles, a sprite sheet with more than one
palette's worth of colours, an animation using a frame the sheet does not have. It
reports every problem in one run.

The game brings the result in with three macros:

| Macro | Gives | Needs |
| --- | --- | --- |
| `include_data!()` | `data::WORLD`, `ROOMS`, `CLASSES`, constants for room and collision class indices, an `EntityKind` enum, and each room's collision cells and entities | nothing |
| `include_gfx!()` | `gfx::TILESETS`, `ROOMS` (tile layers), one `SPRITE_<NAME>` per sprite with its frames and animations | the `agb` feature |
| `include_audio!()` | `audio::TRACKS`, `SFX` and index constants | `agb_tracker` in the game |

**The runtime** (`runtime/`):

- `data` and `physics` have no dependencies and also compile for the host, so game
  rules can be unit tested without a console. `Body` moves a box through collision
  cells: walls, ceilings, one-way platforms (with drop-through) and 45 degree and
  gentler slopes, in sub-pixel steps. Given the `World`, it moves in world pixels and
  walks from a room into the next without noticing. `World::camera_target` keeps the
  camera on rooms: it follows the player into touching rooms and stops at holes and
  edges of the map.
- `gfx` (behind the `agb` feature) has `WorldView`, which draws every room that
  shares a tileset as one scrolling space, streaming tiles in as the camera moves;
  `RoomView` for a single room on its own; and `SpriteSheet` and `AnimPlayer`.
- Rooms drawn with different tilesets cannot share the screen (the GBA shows one
  set of 16 background palettes), so the game cuts between them instead of scrolling.

`sample/` is a complete game built this way: a hero that runs, jumps, climbs a ramp,
respawns on spikes, and walks from one room into the next while the camera scrolls
across. Its `src/main.rs` is about 170 lines. It builds from its own folder, with the nightly toolchain pinned in
`sample/rust-toolchain.toml` and `agb-gbafix` installed (`cargo install agb-gbafix`):

```sh
cd sample && cargo build        # or press Build dev in the studio
```

Its art is flat-colour placeholders. Regenerate the sample project with
`node scripts/make-sample-assets.ts` and `node scripts/make-sample-project.ts`
(the second refuses to overwrite an existing project unless given `--force`).

## Project format

Plain JSON files in the game's repository, laid out to diff well in git. The schemas
in [`core/src/schema.ts`](core/src/schema.ts) are the reference.

```
studio/project.json         name, build commands, collision classes, entity types
studio/world.json           where each room sits on the world grid, in screens
studio/audio.json           music tracks (MIDI + SF2, XM, MOD) and sound effects
studio/tilesets/<id>.json   a PNG of 8x8 tiles and each tile's collision class
studio/sprites/<id>.json    a sprite sheet: frame size, anchor, hitbox, animations
studio/rooms/<id>.json      size in screens, up to 3 tile layers, entities, music
```

- A screen is 240x160 pixels, or 30x20 tiles. Rooms are 1 to 32 screens a side.
- The world map may have a `size` in screens, counted from screen (0, 0).
- Tile layers are run-length pairs `[count, cell, ...]`, row by row. Cell 0 is empty
  and cell n is tile n-1 of the room's tileset.
- Collision classes have a kind (empty, solid, one-way, slope, hazard, custom) and,
  for slopes, the floor height at the tile's left and right edge. What `hazard` and
  `custom` mean is up to the game.
- An entity is a type, a position in pixels from the room's top-left, and the
  properties its type defines (integer, boolean, text or one of a list).
- Ids are lowercase letters, digits, `-` and `_`, and are also the file names.

## Repository layout

| Folder | What it is |
| --- | --- |
| `core/` | The project format (zod schemas), cross-file validation, run-length and GBA colour helpers, room helpers. Shared by the server and the app. |
| `server/` | The local Node server and the `gba-studio` command: JSON API over one game folder, uploads, file watcher, build runner, and the MCP server with its tools, renderer and headless emulator. |
| `app/` | The React, Vite and MUI interface. |
| `codegen/` | `gba_studio_build`: the build-script helper that turns a project into Rust data. |
| `runtime/` | `gba_studio_rt`: data types, physics and agb drawing for games. |
| `sample/` | A small game made from a studio project. |
| `scripts/` | Generates the sample project; copies the Pecten core into the app. |

The Play panel uses a build of the Pecten emulator core kept in `app/public/wasm`.
After rebuilding Pecten, `scripts/sync-pecten.sh` copies the new build in.

## Known limits

Honest list of what does not work yet:

- **Music in the studio:** MIDI, XM and MOD cannot be heard in the Audio list, only
  in the built game. There is no waveform or ROM-size estimate for audio.
- **Aseprite files:** accepted as sprite images, but not previewed, and the build
  helper only converts PNG sheets for now.
- **Collision classes and entity property definitions** are edited in
  `studio/project.json`, not in the interface. (Entity types can be added, renamed,
  recoloured and given a sprite in Project settings.)
- **Map editor:** no selection, copy and paste, flip, or autotiling yet. Resizing a
  room keeps its top-left corner.
- **Budgets:** the studio does not yet show palette, tile or sprite budgets while you
  draw; the build helper reports them when it runs.
- **Tilesets** are one 16-colour-palette set per tile (up to 16 palettes). The
  runtime uses 4 bits a pixel throughout.
- **One ROM at a time**, and the game logic in the sample is a skeleton: no
  enemies, items, doors or saving. Those are the game's job, built on the runtime.
- **Deleting** a room, tileset or sprite removes its file and cannot be undone
  from the studio.
- Tested with the sample project and generated test files, in Chrome. Touch input,
  other browsers and larger real projects have not been tried.

## Roadmap

Roughly in order. Each item is useful on its own.

### Agents, still to do

- MCP over HTTP from the running studio, so an agent's edits land in the studio's
  undo history and the agent can see what you have selected.
- A Claude Code skill that wraps the server for games built with the studio.
- Tools for tilesets and sprites at the same level as the room tools (set a tile's
  collision class, define an animation), which today go through `write_document`.

### Editors

- Hear MIDI, XM and MOD in the studio, and show an audio size estimate.
- Edit collision classes and entity property definitions in the interface.
- Palette, tile and sprite budget readouts while editing, with the build helper's
  messages shown next to the item they are about.
- Map editor: rectangular selection with copy, paste and flip; room templates;
  autotile brushes.
- Aseprite preview and conversion, including its tags as animations.
- Tilemap import from Tiled, for people who already have levels there.

### Runtime

- Camera helpers (room bounds, screen transitions between rooms, shake).
- Entity helpers: spawning from room data, activation near the camera, simple
  patrol and projectile behaviours.
- Save data for what the player has found and opened, keyed by room and entity.
- Door and ability-gate patterns for the Metroidvania loop.
- Headless test helpers on the Pecten core, so a game can test "the player can
  reach this room" from its studio project.

### Adopting it in Diamond Hands

The first real game to use the studio, moved over one piece at a time while the ROM
keeps working: import the existing ASCII levels as rooms, read levels from
generated data, replace the generated music with your own, and swap code-drawn art
for PNGs as it is redrawn.

### Later

- Touch and tablet polish for the map editor (pinch to zoom, finger painting).
- A desktop wrapper (for example Tauri) so no terminal is needed.
- Publishing the build helper and runtime as crates, and the studio as an `npx`
  command.

### Left out on purpose

- A pixel editor. Draw in Aseprite, LibreSprite or anything else; the studio picks
  the files up as they change.
- A music sequencer. Compose in a DAW or tracker.
- Visual scripting of game logic. Behaviour is Rust in your game.
