# GBA-Studio

A browser tool for building Game Boy Advance Metroidvanias from assets you make
yourself: PNG pixel art, MIDI or tracker music, and rooms painted on a grid of GBA
screens. It targets Rust games built on [agb](https://agbrs.dev) and knows nothing
about any particular game.

Status: **M0, the skeleton.** The studio opens a game folder, validates its project
files, shows the world, rooms, tilesets and asset files read-only, and reloads when
files change on disk. Editing, the build pipeline and the Play panel are the next
milestones (see below).

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

- **M1 Assets:** tileset and sprite import, animation editor and preview, palette
  and tile budget checks, audio playback.
- **M2 Map editor:** paint rooms with layers, collision and entities, undo/redo;
  arrange rooms on the world grid.
- **M3 Pipeline:** a Rust `build.rs` helper that turns the project into agb data, a
  small runtime crate, a sample game, and Build and Play panels (Play runs the ROM in
  the browser on the Pecten emulator core).
- **M4:** adopt it in Diamond Hands, one piece at a time.
- **M5:** touch polish, autotile brushes, optional desktop wrapper.

Left out on purpose: a pixel editor and a music sequencer. Draw and compose in the
tools made for that; the studio picks the files up as they change.
