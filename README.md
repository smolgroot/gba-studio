# GBA-Studio

A browser tool for building Game Boy Advance Metroidvanias from assets you make
yourself: PNG pixel art, MIDI or tracker music, and rooms painted on a grid of GBA
screens. It targets Rust games built on [agb](https://agbrs.dev) and knows nothing
about any particular game.

Status: **the editors work; the ROM pipeline does not exist yet.** You can paint
rooms, arrange the world, set up tilesets and sprites with animations, and import
music and sounds. Nothing here builds or runs a ROM yet (see the roadmap).

## What it does today

- **Map editor:** brush, eraser, rectangle, fill and tile picker on up to three
  tile layers; multi-tile stamps picked by dragging across the tileset; a collision
  layer for cells that should differ from their tile; entities placed, dragged and
  given properties; guides at every screen boundary.
- **World:** drag rooms on a grid of screens, choose the start room. Overlapping
  rooms are reported as problems.
- **Tilesets:** import a PNG, paint a collision class onto each tile.
- **Sprites:** import a sheet, choose a GBA frame size, build animations by clicking
  frames, set per-frame timing in 60 Hz ticks, anchor and hitbox, and watch the
  result play. Entity types can show their sprite on the map.
- **Audio:** import WAV as sound effects, and XM, MOD and MIDI (with an SF2
  soundfont) as music tracks; assign a track to a room. WAV plays in the studio;
  music formats are only converted at build time, so they cannot be heard here yet.
- **Everywhere:** every edit saves by itself, undo and redo per document, and files
  changed on disk by other tools (your pixel editor, git, a coding agent) reload live.

Keys in the map editor: B brush, E eraser, R rectangle, G fill, I pick (or Alt +
click), N entities, H pan (or hold Space, or the middle button), Delete removes the
selected entity, right button erases, Ctrl + wheel zooms, Ctrl+Z and Ctrl+Shift+Z
undo and redo.

## Run it

Needs Node 24 or later and pnpm.

```sh
pnpm install
pnpm build                       # build the web app once
pnpm start ../my-game            # serve that game folder at http://127.0.0.1:4517
pnpm start sample                # or the bundled sample project
```

`--port N` changes the port. `--lan` listens on every network interface so a tablet
can open the studio; anyone on that network can then edit the game folder, so use it
on networks you trust.

Opening a folder with no project offers to create one. That adds a `studio/` folder
with three JSON files and touches nothing else.

For work on the studio itself, `pnpm dev` runs the server against `sample/` and the
app under Vite with hot reload at http://localhost:5173.

```sh
pnpm test        # unit tests
pnpm typecheck
```

## Layout

| Folder | What it is |
| --- | --- |
| `core/` | The project format (zod schemas), cross-file validation, GBA colour and run-length helpers. Shared by server and app. |
| `server/` | Local Node server: JSON API over one game folder, file previews, file watcher over a websocket. Never reads or writes outside the folder it was given. |
| `app/` | React + Vite + MUI interface, with dockable panels on wide screens and one panel at a time on narrow ones. |
| `sample/` | A two-room sample project with a placeholder tileset. Regenerate with `node scripts/make-sample-assets.ts` and `node scripts/make-sample-project.ts`. |

## Project format

Plain JSON in the game's repository, made to diff well in git. The schemas in
`core/src/schema.ts` are the reference.

```
studio/project.json      name, build commands, collision classes, entity types
studio/world.json        where each room sits on the world grid, in screens
studio/audio.json        music tracks (MIDI + SF2, XM, MOD) and sound effects
studio/tilesets/<id>.json  a PNG of 8x8 tiles and each tile's collision class
studio/sprites/<id>.json   a sprite sheet: frame size, anchor, hitbox, animations
studio/rooms/<id>.json     size in screens, up to 3 tile layers, entities, music
```

A screen is 240x160 pixels, 30x20 tiles. Rooms are whole numbers of screens. Tile
layers are run-length pairs `[count, cell, ...]`, row by row, where cell 0 is empty
and cell n is tile n-1 of the room's tileset.

Your PNG, MIDI and other source files stay the source of truth: the studio reads and
watches them and never rewrites them.

## Roadmap

- **Editors, still to do:** hear MIDI, XM and MOD in the studio; edit collision
  classes and entity property definitions (today in `studio/project.json`); palette
  and tile budget checks; selection with copy and paste in the map editor.
- **M3 Pipeline:** a Rust `build.rs` helper that turns the project into agb data, a
  small runtime crate, a sample game, and Build and Play panels (Play runs the ROM in
  the browser on the Pecten emulator core).
- **M4:** adopt it in Diamond Hands, one piece at a time.
- **M5:** touch polish, autotile brushes, optional desktop wrapper.
- **M6 AI-ready:** `validate` and `build` commands with JSON output, an MCP server
  over the same project code as the UI (read and write documents, paint tiles, place
  entities, render a room to PNG, build and run the ROM headless), and an `AGENTS.md`
  written into each game folder, so coding agents can work on a project without
  overwriting hand-made art and levels.

Left out on purpose: a pixel editor and a music sequencer. Draw and compose in the
tools made for that; the studio picks the files up as they change.
