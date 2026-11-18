# Build and Play

## Build panel

The Build panel sits beside Problems below the editor.

![The Build panel with the dev build output](/screenshots/build-panel.png)

| Button | What it does |
| --- | --- |
| **Build dev** | Runs the dev build command from [Project settings](./project-settings). |
| **Build release** | Runs the release build command. |
| **Stop** | Stops a running build. |
| **Play...** | Opens the Play panel on the built ROM. |

Output is streamed live. A failed build is marked and its exit code shown; a successful one says how long it took. The build helper reports every hardware problem in one run, in terms of your project: a tile with more than 15 colours, tiles needing more than 16 palettes, a tileset over 1024 tiles, a sprite sheet with too many colours, an animation using a frame the sheet does not have, or backgrounds that with the rooms' tiles need more than 4 layers, 16 palettes or the 1024 tiles video memory holds.

The same builds can be run from the command line; see [Command line and MCP](./agents).

### Getting a folder ready to build

When the folder has no `Cargo.toml`, the panel offers **Set up game crate**. It writes a small Rust game that shows the start room, with its own copy of the studio's crates, and never replaces a file that exists. See [what it adds](./desktop#building-a-game).

The panel also names anything missing from the Rust tools (`rustup`, the pinned nightly, `rust-src`, `agb-gbafix`) with the command that installs it. **Check again** looks once more after you have installed it.

In the [desktop app](./desktop), builds carry on while you work in another project, and a dot on the project's tab shows how the last one went.

## Play panel

Open **Play** in the Project panel. It runs the built ROM on the [Pecten](https://github.com/smolgroot/pecten) emulator core inside the studio at the console's frame rate.

![Diamond Hands running in the Play panel](/screenshots/play.png)

| Control | What it does |
| --- | --- |
| **Play / Restart** | Load and run the ROM. |
| **Reset** | Restart the game. |
| **Sound** | Turn sound on. Browsers require a click first. |
| **Restart on rebuild** | Restart by itself when the ROM is rebuilt. |

The panel names the ROM, its size and when it was built. On touch devices, on-screen buttons appear.

### Keyboard

| Key | GBA button |
| --- | --- |
| Arrows | D-pad |
| `X` | A |
| `Z` | B |
| `Enter` | Start |
| `Shift` | Select |
| `A` / `S` | L / R |

::: tip
In the desktop app, the game pauses while its project's tab is hidden.

Only one ROM runs at a time. If both dev and release ROMs exist, the panel lets you choose between them.
:::
