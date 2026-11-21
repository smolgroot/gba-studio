# Command line and MCP

The studio's project code is also a command line and an MCP server, so an agent (Claude Code or any MCP client) can work on a game without overwriting hand-made art, music and levels.

```sh
pecten-studio validate <folder> [--json]            # every problem; exit 1 on errors
pecten-studio build <folder> [--release] [--json]   # run the project's build command
pecten-studio patch <folder> [--release] [--json]   # put changed level data into the built ROM; exit 3 if it needs a build
pecten-studio schema                                # JSON Schema of every document kind
pecten-studio agents <folder> [--claude]            # write AGENTS.md; --claude also sets up Claude Code
pecten-studio mcp <folder>                          # MCP server over stdio
```

From a checkout, `pecten-studio` is `node <this repo>/server/src/cli.ts`.

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
| `room_create`, `room_resize`, `room_update`, `world_place` | Make, size and rename rooms, set their tileset, music and backgrounds, arrange the world map |
| `entity_add`, `entity_update`, `entity_remove` | Entities in a room |
| `entity_type_set`, `entity_type_remove` | Entity types and their typed properties |
| `tileset_create`, `tileset_set_collision` | Tilesets from a PNG in the folder; collision classes by tile list or range |
| `tileset_generate`, `room_generate`, `pixel_art_convert` | The studio's three generators: a whole tileset with its collision, a room laid out on it, a picture converted to GBA colours. Pictures go to `generated/` |
| `sprite_create`, `sprite_set_animation`, `sprite_remove_animation`, `sprite_set_geometry` | Sprites from a sheet in the folder, their animations, anchor and hitbox |
| `audio_add` | Add a WAV, XM, MOD or MIDI file in the folder as a sound effect or track |
| `render_room`, `render_tileset`, `render_sprite` | Pictures: a room (optionally tinted by collision), a tileset or sprite sheet with its grid |
| `build`, `patch_rom`, `run_rom` | Build the ROM; put changed level data into the built ROM without a build; run it headless for given frames and held buttons and get a picture after each step |
| `studio_view`, `studio_open` | What the author has open; put an item in front of them (studio endpoint only) |

When the ROM `run_rom` runs is out of date, its answer ends with a line that says so, for example "This ROM is out of date: Rust source changed: src/main.rs. Run the build tool to see the change.", or, when only level data changed, a note to run `patch_rom`. An agent then knows the pictures do not show its last edit.

Every write is validated and answered with the problems it left in that file. Errors inside a tool come back as text the agent can act on ("the tileset has 16 tiles, numbered 0 to 15; there is no tile 99").

::: warning Art and music are yours
No tool creates, changes or deletes a file under `assets/`: agents can use the art and music that is there, not make it.
:::

### Making a tileset and a room with no art

The three generators are the same ones as in the [Tools](tools.md) gallery. What they draw goes to `generated/tilesets/` or `generated/pixelart/`, never to `assets/`, and a tool never replaces a file there: a name that is taken gets `-2`, `-3` and so on. The author can move a picture they like into `assets/`, or draw over it.

An agent can go from an empty project to a room by calls alone:

1. `tileset_generate` with a name and a preset (`meadow`, `castle`, `crystal` and others), and optionally a block size, seed and colours. It saves the tileset with collision, adding the slope classes the project lacks, and answers with a picture of the sheet.
2. `room_generate` with that tileset, a style (`corridor`, `halls`, `caverns` or `shaft`), a size in screens and a seed. Rooms are sized to the project's jump. It answers with a picture of the room.
3. `world_place` to put the room on the map, then `room_paint` and the `entity_` tools to finish it.

`room_generate` works only on a tileset laid out like a generated sheet, and says so when it is not.
