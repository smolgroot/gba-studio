# Command line and MCP

The studio's project code is also a command line and an MCP server, so an agent (Claude Code or any MCP client) can work on a game without overwriting hand-made art, music and levels.

```sh
pecten-studio validate <folder> [--json]            # every problem; exit 1 on errors
pecten-studio build <folder> [--release] [--json]   # run the project's build command
pecten-studio schema                                # JSON Schema of every document kind
pecten-studio agents <folder> [--claude]            # write AGENTS.md; --claude also sets up Claude Code
pecten-studio mcp <folder>                          # MCP server over stdio
```

From a checkout, `pecten-studio` is `node <this repo>/server/src/cli.ts`.

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
| `sprite_create`, `sprite_set_animation`, `sprite_remove_animation`, `sprite_set_geometry` | Sprites from a sheet in the folder, their animations, anchor and hitbox |
| `audio_add` | Add a WAV, XM, MOD or MIDI file in the folder as a sound effect or track |
| `render_room`, `render_tileset`, `render_sprite` | Pictures: a room (optionally tinted by collision), a tileset or sprite sheet with its grid |
| `build`, `run_rom` | Build the ROM; run it headless for given frames and held buttons and get a picture after each step |
| `studio_view`, `studio_open` | What the author has open; put an item in front of them (studio endpoint only) |

Every write is validated and answered with the problems it left in that file. Errors inside a tool come back as text the agent can act on ("the tileset has 16 tiles, numbered 0 to 15; there is no tile 99").

::: warning Art and music are yours
No tool creates, changes or deletes a file under `assets/`: agents can use the art and music that is there, not make it.
:::
