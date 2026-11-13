// The note for coding agents that is written into a game folder.

export const AGENTS_FILE = 'AGENTS.md'

export function agentsGuide(projectName: string): string {
  return `# Working on ${projectName} with a coding agent

This game's rooms, world map, tilesets, sprites and audio are edited in GBA-Studio and
kept as JSON under \`studio/\`. The game's behaviour is Rust code in this crate, built
on [agb](https://agbrs.dev) with the \`gba_studio_rt\` runtime.

## Who owns what

| Files | Made by | Rule |
| --- | --- | --- |
| \`assets/\` (PNG, MIDI, SF2, XM, MOD, WAV) | the author, by hand | Read only. Never regenerate, replace, resize or delete. |
| \`studio/rooms/\`, \`studio/world.json\` | the author, in the studio | Change only what was asked for; leave the rest of a room as it is. |
| \`studio/project.json\`, \`tilesets/\`, \`sprites/\`, \`audio.json\` | the author, in the studio | Same. |
| \`src/\` | you and the author | The game's rules. |
| Generated data in \`OUT_DIR\` (\`studio_data.rs\`, \`studio_gfx.rs\`, \`studio_audio.rs\`) | \`build.rs\` | Never edit; change the project and rebuild. |

Do not draw art or write music in code to stand in for an asset. If something is
missing, say what is needed and use a placeholder the author can see is one.

## Tools

The studio has an MCP server for this folder. Start it with:

\`\`\`sh
gba-studio mcp .
\`\`\`

(\`node <path to gba-studio>/server/src/cli.ts mcp .\` from a checkout.) When the studio
is open on this folder it serves the same tools at \`http://127.0.0.1:4517/mcp\`;
through that endpoint \`studio_view\` tells you what the author has on screen and
\`studio_open\` shows them an item. \`gba-studio agents . --claude\` sets Claude Code
up with a skill and the server entry. Begin with
\`project_overview\`. \`render_room\` and \`render_tileset\` return pictures, and
\`room_read_cells\` returns cells as text. Change rooms with \`room_fill\`,
\`room_paint\` and the \`entity_\` tools rather than by editing JSON: tile layers are
run-length encoded and easy to corrupt. Tilesets, sprites, animations, entity types
and audio have tools of their own (\`tileset_set_collision\`, \`sprite_set_animation\`,
\`entity_type_set\`, \`audio_add\` and others). \`build\` and \`run_rom\` build the game and
return pictures of it running. If the studio is open, it shows your changes as you
make them.

Without MCP, these commands print JSON:

\`\`\`sh
gba-studio validate . --json     # every problem in the project
gba-studio build . --json        # run the dev build; add --release for the release one
gba-studio schema                # JSON Schema of every document kind
\`\`\`

Run \`validate\` after changing anything under \`studio/\`.

## The format in short

- A screen is 240x160 px: 30x20 tiles of 8 px. A room is a whole number of screens.
- \`studio/world.json\` places rooms on a grid of screens. Rooms that touch are
  connected: the player walks from one into the other and the camera scrolls along.
- A room has 1 to 3 tile layers, back to front. A cell holds a tile number of the
  room's tileset. In the files, layers are run-length pairs \`[count, cell, ...]\`
  where cell 0 is empty and cell n is tile n-1.
- Collision comes from the tileset: each tile has a collision class. A room can
  override single cells.
- An entity is a type, a position in pixels (its feet: the middle of its bottom
  edge), and the properties its type defines. What an entity does is code in \`src/\`:
  match on the generated \`data::EntityKind\`.
- Ids are lowercase letters, digits, \`-\` and \`_\`, and are the file names.

## In the game code

\`\`\`rust
gba_studio_rt::include_data!();   // data::WORLD, ROOMS, CLASSES, EntityKind, room and class constants
gba_studio_rt::include_gfx!();    // gfx::ROOMS, TILESETS, SPRITE_<NAME>, ENTITY_SPRITES
gba_studio_rt::include_audio!();  // audio::TRACKS, SFX (needs agb_tracker)
\`\`\`

\`gba_studio_rt::physics::Body\` moves a box through the collision cells of the whole
world (\`body.step(&data::WORLD, drop_through)\`), and \`gba_studio_rt::gfx::WorldView\`
draws the rooms around a camera. The data and physics half of the runtime has no
dependencies and runs on the host, so rules can be unit tested with \`cargo test\`.
`
}

export const SKILL_FILE = '.claude/skills/gba-studio/SKILL.md'

/** A Claude Code skill for a game made with the studio: when to reach for the tools, and how to work. */
export function claudeSkill(projectName: string): string {
  return `---
name: gba-studio
description: Work on ${projectName}, a Game Boy Advance game whose rooms, world map, tilesets, sprites and audio are made in GBA-Studio (JSON under studio/, assets under assets/). Use for any request about levels, rooms, the world map, tiles, collision, entities and where they are placed, sprites and animations, music and sound effects, building the ROM, or seeing the game run. Also use before writing game code that reads room or entity data.
---

# Working on a GBA-Studio game

The author draws the art, writes the music and paints the rooms. You help with the
rest: game code in \`src/\`, and changes to the project they ask for. Read
\`AGENTS.md\` in this folder once; it has the file ownership rules and the format.

## Rules that do not bend

- Files under \`assets/\` are hand-made. Read them. Never regenerate, replace, resize,
  recolour or delete one, and never draw art or compose music in code as a stand-in.
  If an asset is missing, say exactly what is needed (size, frame layout, format).
- In rooms, change what was asked and nothing else. A room is someone's drawing.
- Never edit a room's tile data by hand in JSON. It is run-length encoded; use the
  tools.
- Generated files in \`OUT_DIR\` are output. Change the project and rebuild.

## Tools

Use the \`gba-studio\` MCP tools. If they are not available, tell the author to start
the studio (\`gba-studio .\`) or add the server (\`gba-studio agents . --claude\`), and
fall back to \`gba-studio validate . --json\` and \`gba-studio build . --json\`.

A working order that avoids mistakes:

1. **Orient.** \`project_overview\`. If the author says "this room" or "the selected
   entity", call \`studio_view\` to see what they have open.
2. **Look.** \`render_room\` (add \`collision: true\` to see what is solid),
   \`render_tileset\`, \`render_sprite\`. \`room_read_cells\` when you need exact tile
   numbers. Do not guess tile numbers: count them in the tileset picture, where
   tile n is at column n % columns, row floor(n / columns).
3. **Change.** \`room_fill\` for rectangles, \`room_paint\` for shapes, \`entity_add\`,
   \`entity_update\`, \`entity_remove\`, \`room_create\`, \`room_resize\`, \`world_place\`.
   For assets already in the folder: \`tileset_create\`, \`tileset_set_collision\`,
   \`sprite_create\`, \`sprite_set_animation\`, \`sprite_set_geometry\`, \`audio_add\`.
   For new kinds of things in rooms: \`entity_type_set\`.
4. **Check.** Every change answers with the problems left in that file. Run
   \`validate\` at the end. Render the room again and look at it.
5. **Show.** \`studio_open\` puts what you changed in front of the author. Their
   Ctrl+Z in the studio undoes your change to a document.
6. **Run.** \`build\`, then \`run_rom\` with steps of frames and held buttons; it returns
   a picture after each step. The game starts from power-on every time, so script
   the whole path to what you want to see.

## Coordinates

- Tiles are 8 px. A screen is 30x20 tiles (240x160 px). Rooms are whole screens.
- Room tools take x and y in tiles from the room's top-left.
- Entities are placed in pixels, by their feet (middle of the bottom edge). To stand
  on a floor whose top is tile row r at tile column c: \`x = c * 8 + 4\`, \`y = r * 8\`.
- The world map counts screens. Rooms that touch are connected in the game and the
  camera scrolls between them, so line doorways up: a gap in one room's edge must
  meet a gap in its neighbour's.

## Game code

Behaviour is Rust in \`src/\`, on agb and \`gba_studio_rt\`:

- \`data::WORLD\`, \`data::ROOMS\`, \`data::EntityKind\`, \`data::class::*\` come from
  \`include_data!()\`. Match on \`EntityKind::of(entity)\` to give a type its behaviour;
  read its typed properties with \`entity.int("name")\`, \`.bool\`, \`.str\`.
- \`physics::Body\` moves through \`&data::WORLD\` in world pixels: walls, one-way
  platforms, slopes. \`gfx::WorldView\` draws the rooms; \`gfx::AnimPlayer\` plays a
  sprite's animations by name.
- Adding an entity type is two steps: \`entity_type_set\` in the project, then its
  behaviour in code. After a project change, rebuild before relying on new
  constants: they are generated.
- The data and physics half of the runtime runs on the host. Put rules there and
  test them with \`cargo test\` before trying them on the ROM.
`
}

/** The entry that gives Claude Code the studio's tools for a game folder. */
export function mcpServerEntry(cliPath: string): { command: string; args: string[] } {
  return { command: 'node', args: [cliPath, 'mcp', '.'] }
}
