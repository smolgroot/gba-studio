# Command line and MCP

The studio's project code is also a command line and an MCP server, so an agent (Claude Code or any MCP client) can work on a game without overwriting hand-made art, music and levels.

```sh
pecten-studio validate <folder> [--json]            # every problem; exit 1 on errors
pecten-studio build <folder> [--release] [--json]   # run the project's build command
pecten-studio patch <folder> [--release] [--json]   # put changed level data into the built ROM; exit 3 if it needs a build
pecten-studio schema                                # JSON Schema of every document kind and behaviour
pecten-studio agents <folder> [--claude]            # write AGENTS.md; --claude also sets up Claude Code
pecten-studio mcp <folder>                          # MCP server over stdio
```

From a checkout, `pecten-studio` is `node <this repo>/server/src/cli.ts`.

## Building

`pecten-studio build` runs the dev build command from [Project settings](./project-settings), or the release one with `--release`, and prints its output. With `--json` the build's output goes to stderr, and stdout gets one object with `ok`, `mode`, `command`, `exitCode`, `seconds`, `log` and `rom`. `rom` is null when there is no ROM at the configured path; otherwise it has the `path`, `size` and `modified` time, and `data`: `{ used, capacity }`, the bytes of level data in the ROM's [data section](../reference/data-section) and the room it has, or null when the game does not read its level data from the ROM. These are the numbers the [Build panel](./build-and-play#level-data-use) shows.

## Patching the ROM

`pecten-studio patch` does what **Patch on change** does in the [Play panel](./build-and-play#patch-on-change): it writes the project's current level data (tiles, collision, entities and their properties, world placement, physics) into the built dev ROM without compiling. Add `--release` to patch the release ROM instead. The ROM must have been built once with this version of the studio. A game running in the Play panel takes the patched ROM as it takes its own patches: in place with [Live apply](./build-and-play#live-apply) on, by a restart otherwise.

| Exit code | Meaning |
| --- | --- |
| 0 | Patched, or the ROM already holds this level data and nothing else has changed. |
| 1 | The project has errors; nothing was written. |
| 2 | The command was used wrongly, or could not run (for example, the folder cannot be read). |
| 3 | The change needs a build. The reasons are printed. |

With `--json` it prints an object with `ok` and `status` (`patched`, `unchanged`, `needs-build` or `invalid`), the `rom` path, and then `used` and `capacity` (bytes of level data, and the room the build left for it) and `ms`, or `reasons` for a build, or `problems`.

Before writing, it checks what a patch cannot bring in: the game's Rust code, sprite documents, the audio list and the files under `assets/` that the project uses. If any of these changed since the ROM was built, it writes nothing and exits 3 with reasons such as `Rust source changed: src/main.rs` or `assets/hero.png changed`. These are the reasons the studio's top bar shows; see [ROM state in the top bar](./build-and-play#rom-state-in-the-top-bar).

The MCP tool `patch_rom` does the same, with `mode` set to `dev` (the default) or `release`, and answers in one line like the command.

## Setting up Claude Code

```sh
pecten-studio agents ../my-game --claude
```

writes three things into the game folder, leaving anything already there alone unless you add `--force`:

- `AGENTS.md`: which files are hand-made and must not be regenerated, how the format works, and which tools to use. (Also written whenever a project is created.)
- `.claude/skills/pecten-studio/SKILL.md`: a skill that tells Claude when to use the tools and in what order: look, change, check, show, run.
- `.mcp.json`: the studio's server, added beside any other servers in the file.

## Two ways to connect

| | Stdio: `pecten-studio mcp <folder>` | The running studio: `http://127.0.0.1:4517/mcp` |
| --- | --- | --- |
| Needs the studio open | No | Yes |
| Sees what you have on screen (`studio_view`) | No | Yes |
| Can show you an item (`studio_open`) | No | Yes |
| Builds appear in the Build panel | No | Yes |
| What it did shows in the studio's top bar | No | Yes |

Either way, the edits are file saves: an open studio shows them at once, and **Ctrl+Z in the studio undoes an agent's change**. To use the studio's endpoint from Claude Code:

```json
{ "mcpServers": { "pecten-studio": { "type": "http", "url": "http://127.0.0.1:4517/mcp" } } }
```

The endpoint refuses requests from other web pages, like the rest of the server.

In the [desktop app](./desktop#coding-agents), each open project has its own endpoint on its own port. **Project > Copy MCP Endpoint** copies the address to use. The `pecten-studio` command is not included in the packaged app, so the commands above and stdio need a checkout.

## The tools

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
| `tileset_generate`, `room_generate`, `pixel_art_convert` | The studio's three generators: a whole tileset with its collision, a room laid out on it, a picture converted to GBA colours. Pictures go to `generated/` |
| `sprite_create`, `sprite_set_animation`, `sprite_remove_animation`, `sprite_set_geometry` | Sprites from a sheet in the folder, their animations, anchor and hitbox |
| `audio_add` | Add a WAV, XM, MOD or MIDI file in the folder as a sound effect or track |
| `render_room`, `render_tileset`, `render_sprite` | Pictures: a room (optionally tinted by collision), a tileset or sprite sheet with its grid |
| `build`, `patch_rom`, `run_rom` | Build the ROM; put changed level data into the built ROM without a build; run it headless for given frames and held buttons and get a picture after each step |
| `studio_view`, `studio_open` | What the author has open; put an item in front of them (studio endpoint only) |

`room_update` darkens layers (see [Darkening layers](./rooms#darkening-layers)) with three parameters: `dimLevel`, from 0 to 16; `dimLayers`, the tile layers to darken, by number (0 is the back layer) or name, which replaces the set, so `[]` turns dimming off for all tile layers; and `dim` on each entry of `backgrounds`. `project_overview` shows which layers are dimmed and the level.

`entity_add` and `entity_update` store only the values that differ from the entity's type: a property's default, or a behaviour's property as the type sets it. A value equal to the type's is left out, so the entity follows the type if it changes, and the answer says so, for example "Left out 2 values that Bot already has (shield, patrol): the entity follows the type." `entity_update` compares with the type the entity has after the call. A name the type does not have is kept, and the answer reports it as a problem. A room written earlier that stores a value equal to the type's builds the same; the value is dropped the next time the entity's values are written. See [Values set on one entity](./rooms#entity-overrides).

When the ROM `run_rom` runs is out of date, its answer ends with a line that says so, for example "This ROM is out of date: Rust source changed: src/main.rs. Run the build tool to see the change.", or, when only level data changed, a note to run `patch_rom`. An agent then knows the pictures do not show its last edit.

Every write is validated and answered with the problems it left in that file. `validate` and `pecten-studio validate` also report rooms and tilesets over the 1024 background tiles or 16 background palettes, and images the build could not convert, so an agent sees them without running a build. Errors inside a tool come back as text the agent can act on ("the tileset has 16 tiles, numbered 0 to 15; there is no tile 99").

::: warning Art and music are yours
No tool creates, changes or deletes a file under `assets/`: agents can use the art and music that is there, not make it.
:::

### Behaviours {#behaviours}

`entity_type_add_behaviour` takes a `type`, a `behaviour` id and optional `props`, the type's values for the behaviour's properties. A new behaviour goes last in the order the game runs them, or ahead of the one named in `before`. When the type already has the behaviour, it keeps its place and `props` are merged into its values. The tool's description lists every [behaviour](./making-a-game#the-behaviours) with its properties, ranges and defaults, so an agent does not have to guess them.

`entity_type_remove_behaviour` takes a `type` and a `behaviour`. Placed entities keep the values they set for its properties; the answer says how many still do, and `validate` then reports them.

Both answer with the problems left in `project.json`, such as a value out of range. `entity_type_set` keeps the behaviours a type has. A placed entity sets its own value for a behaviour's property through `props` in `entity_add` and `entity_update`, which answer with the problems in its room. `entity_update`'s `props` replace all of the entity's own values, those of its type's properties and of its behaviours, so pass the ones to keep; any equal to the type's are left out, as above. `pecten-studio schema` gives each behaviour's properties under `behaviours`.

An agent can make a new enemy this way with no Rust: `sprite_create` from a PNG in the folder, `entity_type_set` with the sprite, `entity_type_add_behaviour` with `patrol` and then `hazard`, `entity_add`, `build`, and `run_rom` to see it walk.

### Making a tileset and a room with no art

The three generators are the same ones as in the [Tools](tools.md) gallery. What they draw goes to `generated/tilesets/` or `generated/pixelart/`, never to `assets/`, and a tool never replaces a file there: a name that is taken gets `-2`, `-3` and so on. The author can move a picture they like into `assets/`, or draw over it.

An agent can go from an empty project to a room by calls alone:

1. `tileset_generate` with a name and a preset (`meadow`, `castle`, `crystal` and others), and optionally a block size, seed and colours. It saves the tileset with collision, adding the slope classes the project lacks, and answers with a picture of the sheet.
2. `room_generate` with that tileset, a style (`corridor`, `halls`, `caverns` or `shaft`), a size in screens and a seed. Rooms are sized to the project's jump. It answers with a picture of the room.
3. `world_place` to put the room on the map, then `room_paint` and the `entity_` tools to finish it.

`room_generate` works only on a tileset laid out like a generated sheet, and says so when it is not.
