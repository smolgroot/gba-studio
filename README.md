# Pecten-Studio

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
- **Layers:** up to three tile layers per room. Add, rename, reorder, hide and delete
  layers. A room opens on its front layer.
- **Backgrounds:** up to two pictures behind a room's tiles, for parallax. Import a
  PNG (or pick one in the folder) in the room's Properties and give it a scroll speed
  across and down, in percent of the camera's: 0 stands still, 100 moves with the
  room, and a far layer gets less than a near one. A picture repeats in both
  directions. The GBA draws four layers, so tile layers and backgrounds together are
  at most four. The map shows them as they lie at the room's top-left corner (a
  toolbar button hides them); the Play panel shows them moving.
- **Darkening:** a tile layer or background can be set to dim, and the room has one
  level, 0 to 16, for all dimmed layers. The room panel has a toggle per layer and a
  Darkness slider; sprites are never dimmed.
- **Stamps:** click a tile in the tileset palette, or drag across several to paint
  a block. Painting a stamp over an area repeats its pattern from where the stroke
  began.
- **Collision layer:** tiles carry the collision class given to them in their
  tileset. Paint on the collision layer only where a cell should differ; the eraser
  gives a cell back to its tile. A toggle shows the result over the map.
- **Entities:** place them with a click, drag them, edit their position and typed
  properties in Properties, delete them with `Delete`. They are placed by their feet
  (the middle of the bottom edge). An entity type with a sprite shows that sprite on
  the map. A placed entity can set its own values for its type's behaviours, with a
  button to reset each to the type's.
- **Behaviours:** give an entity type ready-made behaviours (patrol, collectible,
  hazard, door and others) in Project settings, each with a form for its properties,
  in the order the game runs them. A new enemy needs no Rust in the sample game.
- **Room properties:** name, size in whole screens (shrinking asks first and undo
  brings the cut-off part back), tileset, music track and backgrounds.
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
choose the start room, take a room off the map or put an unplaced one back. Press
**New room** to make one beside the others, or **double-click an empty screen** to
make a room right there. A project with no tileset yet can import one from a PNG in
the same dialog. Select a room to change its size in screens right there. In Properties the map can be given a size in screens (and so in tiles);
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

### Pixel editor

Open any PNG in the Asset files list, or press **Edit pixels** in a tileset or sprite,
to draw on it in the studio. The **+** beside Asset files makes a new blank image of
any size in `assets/sprites/`, `assets/tilesets/` or `assets/backgrounds/`.

- **Tools:** pencil, eraser, line, rectangle, filled rectangle, ellipse, fill, colour
  picker and pan, with a brush size of 1 to 16 pixels.
- **Colours:** a colour picker and hex field, the colours already in the image, your
  recent colours, and a 16-colour starter palette. Colours are snapped to the GBA's
  15-bit palette by default (5 bits a channel), so what you paint is what the console
  shows; the number of distinct colours is shown as you draw.
- A pixel grid and an 8x8 tile grid; the mouse position is shown in pixels and tiles.
- Resize the image, keeping its top-left corner.
- Undo and redo (`Ctrl+Z`, `Ctrl+Shift+Z`), up to 100 steps.
- The PNG is **written back a moment after each stroke**, so tilesets, sprites and
  rooms that use it update at once. A file changed by another program while nothing
  is unsaved here is reloaded, and the old picture becomes an undo step.

| Key | Action |
| --- | --- |
| `B` / `E` | Pencil / eraser |
| `L`, `R`, `U`, `O` | Line, rectangle, filled rectangle, ellipse |
| `G` | Fill |
| `I`, or `Alt` + click | Pick a colour from the image |
| `H`, or hold `Space` | Pan |
| `[` / `]` | Smaller / bigger brush |
| `X` | Back to the previous colour |
| Right mouse button | Erase with any drawing tool |

### Audio

- Import **WAV** (sound effects), **XM** and **MOD** (tracker music), and **MIDI**
  with an **SF2** soundfont (agb needs one to turn notes into sound).
- Name tracks and effects, remove them from the project (the file stays on disk),
  pick which soundfont a MIDI file uses, and give a room a music track.
- Read a MIDI file as a piano roll, with its tracks, notes, velocities and bars.
- Sound effects play in the studio. Music formats are converted when the ROM is
  built, so you hear them in the Play panel, not in the Audio list.

### Build and Play

- **Build panel:** run the project's dev or release build (commands are set in
  Project settings), with the output streamed live; stop a running build. Failed
  builds are marked and the exit code shown. A dev build also writes a debug map
  beside the ROM: where the game's state is in RAM, for tools reading the emulator.
- **Play panel:** runs the built ROM on the
  [Pecten](https://github.com/smolgroot/pecten) emulator core in the browser at the
  console's frame rate, with sound (enable it with a click, as browsers require) and
  on-screen buttons on touch devices. It restarts the game by itself when the ROM is
  rebuilt, if you leave that on. While the game runs, saved changes to tiles,
  collision, entities, world placement and physics are patched into the ROM in a
  fraction of a second, without a build (**Patch on change**), and go into the
  running game with the player where they are (**Live apply**, for games that poll
  for it); changes that need a build say why and offer one. The map editor's
  **Play from here** tool (`P`) starts a dev game in the clicked room, on the clicked tile. Keyboard: arrows, `X` is A, `Z` is B, `Enter` is
  Start, `Shift` is Select, `A` and `S` are L and R.
- **ROM state in the top bar:** up to date, patched, or needs build with the
  reason (`Rust source changed: src/main.rs`, `new sprite "bat"`,
  `assets/hero.png changed`), and a button that builds or patches.

### Importing files

Images, music and sounds are chosen on your device and stored in the game folder
(`assets/sprites/`, `assets/audio/`, and so on). A file is never replaced without
asking. Your source files stay the source of truth: the studio reads and watches them
and rewrites a PNG only when you draw on it in the pixel editor.

## Running it

Needs Node 24 or later and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm build                  # build the web app once
pnpm start sample           # serve the sample project at http://127.0.0.1:4517
pnpm start ../my-game       # or any game folder
```

For a window of its own, with several projects open in tabs, use the desktop app:
[download it for Linux](https://github.com/smolgroot/gba-studio/releases/latest), run it from a checkout with `pnpm desktop:dev [folder]`,
or build the packages with `pnpm desktop:dist`. Pushing a version tag publishes a
release. See [the desktop guide](docs/guide/desktop.md).

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
pecten-studio validate <folder> [--json]            # every problem; exit 1 on errors
pecten-studio build <folder> [--release] [--json]   # run the project's build command
pecten-studio patch <folder> [--release] [--json]   # put changed level data into the built ROM; exit 3 if it needs a build
pecten-studio schema                                # JSON Schema of every document kind
pecten-studio agents <folder> [--claude]            # write AGENTS.md; --claude also sets up Claude Code
pecten-studio mcp <folder>                          # MCP server over stdio
```

From a checkout, `pecten-studio` is `node <this repo>/server/src/cli.ts`.

### Setting up Claude Code

```sh
pecten-studio agents ../my-game --claude
```

writes three things into the game folder, leaving anything already there alone
unless you add `--force`:

- `AGENTS.md`: which files are hand-made and must not be regenerated, how the format
  works, and which tools to use. (Also written whenever a project is created.)
- `.claude/skills/pecten-studio/SKILL.md`: a skill that tells Claude when to use the
  tools and in what order: look, change, check, show, run.
- `.mcp.json`: the studio's server, added beside any other servers in the file.

### Two ways to connect

| | Stdio: `pecten-studio mcp <folder>` | The running studio: `http://127.0.0.1:4517/mcp` |
| --- | --- | --- |
| Needs the studio open | No | Yes |
| Sees what you have on screen (`studio_view`) | No | Yes |
| Can show you an item (`studio_open`) | No | Yes |
| Builds appear in the Build panel | No | Yes |
| What it did shows in the studio's top bar | No | Yes |

Either way, the edits are file saves: an open studio shows them at once, and
**Ctrl+Z in the studio undoes an agent's change** to a document, like any other step.
To use the studio's endpoint from Claude Code:

```json
{ "mcpServers": { "pecten-studio": { "type": "http", "url": "http://127.0.0.1:4517/mcp" } } }
```

The endpoint refuses requests from other web pages, like the rest of the server.

### The tools

| Tools | What they do |
| --- | --- |
| `project_overview`, `validate`, `list_assets` | Summarise the project, list its problems, list asset files |
| `read_document`, `write_document`, `delete_document` | Whole documents, checked against the schemas before writing |
| `room_read_cells`, `room_fill`, `room_paint` | Read and change tile layers and collision by cell, without touching the run-length data |
| `room_create`, `room_resize`, `room_update`, `world_place` | Make, size and rename rooms, set their tileset, music, backgrounds and darkening, arrange the world map |
| `entity_add`, `entity_update`, `entity_remove` | Entities in a room |
| `entity_type_set`, `entity_type_remove` | Entity types and their typed properties |
| `entity_type_add_behaviour`, `entity_type_remove_behaviour` | Give an entity type a behaviour or change its values; take one away |
| `tileset_create`, `tileset_set_collision` | Tilesets from a PNG in the folder; collision classes by tile list or range |
| `tileset_generate`, `room_generate`, `pixel_art_convert` | The three generators: a tileset with collision, a room on it, a converted picture. Pictures go to `generated/` |
| `sprite_create`, `sprite_set_animation`, `sprite_remove_animation`, `sprite_set_geometry` | Sprites from a sheet in the folder, their animations, anchor and hitbox |
| `audio_add` | Add a WAV, XM, MOD or MIDI file in the folder as a sound effect or track |
| `render_room`, `render_tileset`, `render_sprite` | Pictures: a room (optionally tinted by collision), a tileset or sprite sheet with its grid |
| `build`, `patch_rom`, `run_rom` | Build the ROM; put changed level data into the built ROM without a build; run it headless for given frames and held buttons and get a picture after each step |
| `studio_view`, `studio_open` | What the author has open; put an item in front of them (studio endpoint only) |

Every write is validated and answered with the problems it left in that file. Errors
inside a tool come back as text the agent can act on ("the tileset has 16 tiles,
numbered 0 to 15; there is no tile 99"). No tool creates, changes or deletes a file
under `assets/`: agents can use the art and music that is there, not make it. The
generator tools write to `generated/` and never replace a file there.

## Making a game with it

A game is a Rust crate on agb that depends on two crates from this repository:

```toml
[dependencies]
pecten_studio_rt = { path = "../runtime", features = ["agb"] }

[build-dependencies]
pecten_studio_build = { path = "../codegen" }
```

`build.rs` is one line:

```rust
fn main() {
    pecten_studio_build::build();
}
```

**The build helper** (`codegen/`) reads `studio/` next to the game's `Cargo.toml`
(or the folder named by `PECTEN_STUDIO_PROJECT`), converts the PNGs, and writes Rust
and binary data the game includes. It checks what the GBA can hold and says what is
wrong in terms of your project: a tile with more than 15 colours, tiles needing more
than 16 palettes, a tileset over 1024 tiles, a sprite sheet with more than one
palette's worth of colours, an animation using a frame the sheet does not have,
backgrounds that with the rooms' tiles need more than 4 layers, 16 palettes or the
1024 tiles video memory holds. It reports every problem in one run. A background is
cut into 8x8 tiles like a tileset and keeps one of each tile that repeats. A sprite sheet saved with no transparency at all is
taken to be drawn on a flat backdrop: the colour of its top-left pixel becomes
transparent.

The game brings the result in with three macros:

| Macro | Gives | Needs |
| --- | --- | --- |
| `include_data!()` | `data::world()`, which reads the level data from the ROM and returns the `World`; `ENTITY_SLOTS` and `LIMITS`; `room::*` and `class::*` index constants; an `EntityKind` enum; the table of live entities and the loop that runs their behaviours: `entities()`, `Entities`, `LIVE_ENTITIES`, `HITBOXES`, `enter_room`, `update_entities` and `view` | nothing |
| `include_gfx!()` | `gfx::TILESETS`, `BACKGROUNDS`, `ART` (both together, for the views), one `SPRITE_<NAME>` per sprite with its frames and animations | the `agb` feature |
| `include_audio!()` | `audio::TRACKS`, `SFX` and index constants | `agb_tracker` in the game |

Level data (rooms, tile layers, collision cells, entities and their properties, world
placement, the start room and physics) is in one data section in the ROM, with a
fixed, versioned layout and room to grow after it (**Level data reserve** in
Project settings, `build.dataReserve` in `project.json`; by default a quarter of the
data, at least 4 KiB). The Build panel shows how much of it each built ROM uses. Graphics, sprites
and audio stay compiled. The game reads the section once at start with
`let world = data::world();` and passes `&world` to what needs it: `world.physics()`,
`body.step(&world, ...)`, `WorldView::new(&world, gfx::ART, room, &mut graphics)`,
`world.room(i).entities()`. The layout is in
[`docs/reference/data-section.md`](docs/reference/data-section.md).

**The runtime** (`runtime/`):

- `data` and `physics` have no dependencies and also compile for the host, so game
  rules can be unit tested without a console. `Body` moves a box through collision
  cells: walls, ceilings, one-way platforms (with drop-through) and 45 degree and
  gentler slopes, in sub-pixel steps. Given the `World`, it moves in world pixels and
  walks from a room into the next without noticing. `World::camera_target` keeps the
  camera on rooms: it follows the player into touching rooms and stops at holes and
  edges of the map.
- Collectibles: `Body::overlaps` tests the player against a box, `Collected` keeps a
  bit for every entity that has been taken (numbered across rooms by
  `World::entity_index`, and plain words a game can save), and
  `SpriteSheet::hitbox_at` gives a placed entity's box.
- `behaviour` has ready-made behaviours for placed entities: `Patrol`, `Collectible`,
  `Hazard`, `Projectile` and `Shooter`, `MovingPlatform`, `Door`, `Checkpoint`,
  `AbilityPickup` and `Spawner`. An entity type lists its behaviours, given in
  Project settings. Each is a plain struct built from the settings the type and the
  placed entity give it, read by position with no name lookups, with an `update`
  for one frame that moves an `Actor` and answers with an `Event` (`Hurt`,
  `Collect`, `Grant`, `Checkpoint`, `Fire`, `Spawn`, `Opened`). The
  game decides what an event does. `LiveEntities` keeps every entity with its
  behaviours (at most 4) while the game runs, built from the ROM once when its room
  is first near the player, so a room left is as it was on coming back; the
  generated `data::update_entities` runs the ones on screen, with a hook for the
  game's own code before each entity and one for every event. `Abilities` is a set
  of 32 abilities that doors check, and `Pool` a fixed-size home for shots and
  spawned enemies. No dependencies,
  no allocation, tested on the host.
- `gfx` (behind the `agb` feature) has `WorldView`, which draws every room that
  shares a tileset as one scrolling space, streaming tiles in as the camera moves;
  `RoomView` for a single room on its own; and `SpriteSheet` and `AnimPlayer`.
  `Animation::frame_at` animates many entities off one clock.
- Backgrounds: a view draws the pictures of one room behind everything, each scrolled
  by its share of the camera's movement. `WorldView::new` starts with those of the
  room it is given; call `view.set_backgrounds(room, &graphics)` when the player
  enters another. Rooms with the same pictures at the same speeds keep one unbroken
  backdrop; different ones are swapped in a few frames later, laid down from the new
  room's top-left corner.
- Darkening: the console's brightness-decrease effect darkens the room's dimmed layers
  by one level, with no palette slots or per-frame work. `view.set_dim(level)` sets the
  level, `view.fade_dim(level, frames)` moves to it a step at each `set_camera`, and
  `view.dim_level()` reads it. `set_backgrounds` for a new room restores that room's
  own level. `world.room(n).dim()` gives the room's settings.
- Rooms drawn with different tilesets cannot share the screen (the GBA shows one
  set of 16 background palettes), so the game cuts between them instead of scrolling.

`sample/` is a complete game built this way: a hero that runs, jumps, climbs a ramp,
respawns on spikes, walks from one room into the next while the camera scrolls
across in front of a sky and hills that drift at a quarter and half of its speed,
collects coins and diamonds that add to a count in the corner, and is sent back to
where it entered the room by a patrolling sentry bot. Its `src/main.rs` is
about 360 lines, and names no behaviour: one `data::update_entities` call runs them.

A collectible is an entity type with a sprite that lists the `collectible` behaviour,
with its `value`: the sample takes any such entity the hero touches. To add another
kind (a ruby, a key), import its PNG as a sprite, add the entity type in Project
settings, give it the Collectible behaviour with its value, and place it in rooms with
the entities tool; no Rust changes. An enemy is made the same way with Patrol and
Hazard, as the sentry bot is. It builds from its own folder, with the nightly toolchain pinned in
`sample/rust-toolchain.toml` and `agb-gbafix` installed (`cargo install agb-gbafix`):

```sh
cd sample && cargo build        # or press Build dev in the studio
```

Built with `--features measure`, it shows each frame's cost in place of the score:
the worst frame on top and the average below, in hundreds of CPU cycles (a frame has
about 2808).

Its art is flat-colour placeholders. Regenerate the sample project with
`node scripts/make-sample-assets.ts` and `node scripts/make-sample-project.ts`
(the second refuses to overwrite an existing project unless given `--force`).
`node scripts/check-new-enemy.ts` checks, on a copy of the sample and with the MCP
tools only, that a new patrolling enemy made from a PNG builds and plays with no Rust
change (it needs the sample's toolchain; the cold build takes a minute or two).

## Project format

Plain JSON files in the game's repository, laid out to diff well in git. The schemas
in [`core/src/schema.ts`](core/src/schema.ts) are the reference.

```
studio/project.json         name, build commands, collision classes, entity types
studio/world.json           where each room sits on the world grid, in screens
studio/audio.json           music tracks (MIDI + SF2, XM, MOD) and sound effects
studio/tilesets/<id>.json   a PNG of 8x8 tiles and each tile's collision class
studio/sprites/<id>.json    a sprite sheet: frame size, anchor, hitbox, animations
studio/rooms/<id>.json      size in screens, up to 3 tile layers, up to 2 backgrounds, entities, music
```

- A screen is 240x160 pixels, or 30x20 tiles. Rooms are 1 to 32 screens a side.
- The world map may have a `size` in screens, counted from screen (0, 0).
- Tile layers are run-length pairs `[count, cell, ...]`, row by row. Cell 0 is empty
  and cell n is tile n-1 of the room's tileset.
- A room's `backgrounds`, back to front, are each
  `{ "image": "assets/backgrounds/sky.png", "parallax": { "x": 25, "y": 0 } }`: a PNG
  whose size is a multiple of 8, and its scroll speed in percent of the camera's.
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
| `server/` | The local Node server and the `pecten-studio` command: JSON API over one game folder, uploads, file watcher, build runner, and the MCP server with its tools, renderer and headless emulator. |
| `app/` | The React, Vite and MUI interface. |
| `desktop/` | The Electron app: project tabs, with one server process and page for each open folder. |
| `codegen/` | `pecten_studio_build`: the build-script helper that turns a project into Rust data. |
| `runtime/` | `pecten_studio_rt`: data types, physics and agb drawing for games. |
| `sample/` | A small game made from a studio project. |
| `scripts/` | Generates the sample project; copies the Pecten core into the app; takes the docs' screenshots; checks a new enemy end to end. |

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
  recoloured and given a sprite and behaviours in Project settings.)
- **Map editor:** no selection, copy and paste, flip, or autotiling yet. Resizing a
  room keeps its top-left corner.
- **Backgrounds:** the map editor shows them still; only the built game moves them.
  A view shows one room's backgrounds at a time, so where two rooms with different
  ones meet, the backdrop changes as the player crosses rather than at the border on
  screen. A background's colours share the 16 background palettes with the tileset,
  15 colours a tile: a photo will not convert, pixel art with few colours will.
- **Desktop app:** Linux on x64 only for now, and the packaged app does not include the
  `pecten-studio` command.
- **Darkening:** one level for all of a room's dimmed layers; each layer is dimmed or
  not. Sprites are never dimmed. A change is not applied live to a running game.
- **Behaviours:** an entity type has at most 4; the game keeps room for 4 on every
  entity. The table of live entities takes 108 bytes of EWRAM a slot, with room for
  a quarter more entities than the project has (at least 16 more), so 500 entities
  take about 69 KB. More entities than that need a build, not a live apply.
- **Budgets:** the studio does not yet show palette, tile or sprite budgets while you
  draw; the build helper reports them when it runs.
- **Tilesets** are one 16-colour-palette set per tile (up to 16 palettes). The
  runtime uses 4 bits a pixel throughout.
- **One ROM at a time**, and the game logic in the sample is a skeleton:
  coins and diamonds to collect and one kind of enemy that hurts on touch, but no
  health, combat, doors or saving. Those are the game's job, built on the runtime.
- **Deleting** a room, tileset or sprite removes its file and cannot be undone
  from the studio.
- Tested with the sample project and generated test files, in Chrome. Touch input,
  other browsers and larger real projects have not been tried.

## Roadmap

Roughly in order. Each item is useful on its own. The full, prioritised list is in
[`UserStories.md`](UserStories.md).

### Agents, still to do

- Try the tools with a real agent on a real game and tune their descriptions from
  what it gets wrong; so far they have been driven by test scripts only.
- An agent-visible selection in the map (a rectangle you drag, that `studio_view`
  reports), so "fill this area" needs no coordinates.
- A tool that asks "can the player get from here to there", on the runtime's
  physics.

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
- Entity helpers: waking entities by their distance from the camera.
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

- A music sequencer. Compose in a DAW or tracker.
- Visual scripting of game logic. Entities do what their behaviours from the runtime's
  library and the Rust in your game say.
