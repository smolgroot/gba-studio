# Build and Play

## Build panel

The Build panel sits beside Problems below the editor.

![The Build panel after a dev build, with how much level data each ROM holds](/screenshots/build-panel.png)

| Button | What it does |
| --- | --- |
| **Build dev** | Runs the dev build command from [Project settings](./project-settings). |
| **Build release** | Runs the release build command. |
| **Stop** | Stops a running build. |
| **Play...** | Opens the Play panel on the built ROM. |

Output is streamed live. A failed build is marked and its exit code shown; a successful one says how long it took. The build helper reports every hardware problem in one run, in terms of your project: a tile with more than 15 colours, tiles needing more than 16 palettes, a tileset over 1024 tiles, a sprite sheet with too many colours, an animation using a frame the sheet does not have, or backgrounds that with the rooms' tiles need more than 4 layers, 16 palettes or the 1024 tiles video memory holds.

The same builds can be run from the command line; see [Command line and MCP](./agents).

### Level data use {#level-data-use}

Under the buttons, the panel has one line for each built ROM, saying how much of its [data section](../reference/data-section) the level data uses:

> dev ROM · level data 10,700 of 14,796 bytes (72%), 4,096 free

The free bytes are the room left for [Patch on change](#patch-on-change). Above 90% the line is in the warning colour: an edit that adds data may soon need a full build. To make more room, raise the [Level data reserve](./project-settings#level-data-reserve) in Project settings, then build.

A ROM whose game never reads its level data has no section, and its line says "no level data section: the game does not read its level data from the ROM".

The lines update after each build and each patch.

### Getting a folder ready to build

When the folder has no `Cargo.toml`, the panel offers **Set up game crate**. It writes a small Rust game that shows the start room, with its own copy of the studio's crates, and never replaces a file that exists. See [what it adds](./desktop#building-a-game).

The panel also names anything missing from the Rust tools (`rustup`, the pinned nightly, `rust-src`, `agb-gbafix`) with the command that installs it. **Check again** looks once more after you have installed it.

In the [desktop app](./desktop), builds carry on while you work in another project, and a dot on the project's tab shows how the last one went.

## ROM state in the top bar

The top bar says whether the built ROM is what a build would make now. It shows the dev ROM, the one Play starts by default. When there is only a release ROM, it shows that one ("Release ROM up to date").

![The top bar saying the ROM needs a build because the Rust source changed, with the Build dev button](/screenshots/top-bar-needs-build.png)

| Top bar | Meaning |
| --- | --- |
| **ROM up to date** | The ROM matches the project. |
| **ROM patched** | The ROM matches the project, because level data was patched in since the build. |
| **Needs build:** *reason* | Only a build brings the ROM up to date. The first reason is shown, then "(+N)" for the others. A **Build dev** button runs the build. |
| **Level data not patched in** | Only level data changed, and it has not been put into the ROM yet (Play is not running, or **Patch on change** is off). A **Patch** button puts it in without a build. |
| **Building…** | A build is running. |
| **Not built** | There is no ROM yet. A **Build dev** button runs the build. |

Hover over the label to see every reason. The state is checked again after each saved change, build and patch. At phone width the label is hidden to leave room for the project's name; the **Build** panel is a tap away. In the [desktop app](./desktop), the same label sits at the right of the tab row, without the buttons: use the **Build** and **Play** panels.

The reasons are in the project's terms:

| Reason | What changed |
| --- | --- |
| Rust source changed: `src/main.rs` | The game's code: `Cargo.toml`, `Cargo.lock`, `build.rs`, `rust-toolchain.toml`, or a file under `src/` or `.cargo/`. Up to three files are named, then "and N more". |
| new sprite "bat", sprite "coin" changed, sprite "coin" was removed | A sprite document in `studio/sprites/`: its anchor, hitbox or animations are compiled into the game. |
| the audio list changed | `studio/audio.json`: formats, soundfonts and sound effects. |
| `assets/hero.png` changed | Any file the documents name: tileset images, sprite sheets and palette files, room backgrounds, tracks, soundfonts and sound effects. |

These come first, then the level data reasons listed under [Patch on change](#patch-on-change).

### How the studio knows

When a build ends without errors, the studio writes a record of what went into it beside the ROM, as `<rom>.build.json` (for example `dist/sample-dev.gba.build.json`). It holds a fingerprint of each file above, taken when the build **started**, so a file you change while the build runs still counts as changed. A patch updates the record. The file is not part of the project; leave it in the ignored `dist/` folder.

A ROM built outside the studio (with `cargo build` in a terminal) has no record. For that ROM, any of the files above that is newer than the ROM counts as changed. Build once from the studio to get exact answers again.

A successful dev build also writes `<rom>.debug.json` beside the ROM (for example `dist/sample-dev.gba.debug.json`): where the game keeps its state in RAM, for tools that read the emulator's memory. The build log names it. Release builds have none. See [Debug map](../reference/debug-map).

A game that never reads its level data (nothing calls `data::world()`) has no level data section in its ROM, because the linker leaves out what nothing uses. The studio then goes by the record alone. Such a ROM can't be patched; the Play panel says so when you change level data, and a build is the way to try the change.

## Play panel

Open **Play** in the Project panel. It runs the built ROM on the [Pecten](https://github.com/smolgroot/pecten) emulator core inside the studio at the console's frame rate.

![Diamond Hands running in the Play panel](/screenshots/play.png)

| Control | What it does |
| --- | --- |
| **Play / Restart** | Load and run the ROM. |
| **Reset** | Restart the game. |
| **Sound** | Turn sound on. Browsers require a click first. |
| **Restart on rebuild** | Restart by itself when the ROM is rebuilt. |
| **Patch on change** | While the game runs, put each saved change to the level data into the ROM without a build. On by default. |
| **Live apply** | Put a patched change into the game that is running, instead of restarting it. On by default. See [Live apply](#live-apply). |

The panel names the ROM, its size and when it was built. On touch devices, on-screen buttons appear.

### Play from here

The map editor's **Play from here** tool ([Rooms](./rooms#play-from-here)) starts the game in the room you clicked, standing on the tile you clicked. The panel says "Started in room "entry" at 124, 96." (the room and the spot in room pixels) below the buttons.

The spot is kept when a rebuild restarts the game, so you can tune a late room without walking back to it. **Play / Restart** and **Reset** clear it and start from the start room.

It needs a dev ROM built with this version of the studio. A release ROM has no debug record, so the panel says "this ROM has no debug record" and asks you to build dev. A dev ROM built before this tool existed says to build the dev game again. The start is written into the emulator's copy of the ROM, not the file on disk.

### Patch on change

While the game runs, each change you save to tiles, collision, entities and their properties, where rooms sit on the [world map](./world-map), or [physics](./physics) is written into the built ROM's level data in a fraction of a second. Nothing is compiled. With **Live apply** on, the change then goes into the game as it runs; otherwise the game restarts with it. Below the buttons the panel says how long it took, how much of the room for level data is used, and what became of the game, as "Patched in 64 ms · level data 10,700 of 14,796 bytes · Applied live."

Some changes are compiled into the game, so only a build brings them in. The panel then shows "Needs a build:" with the reasons, and a **Build dev** button (**Build release** when the release ROM is shown). These need a build:

- the game's Rust code, a sprite document, the audio list, or the pixels of any image or sound file the project uses (see [ROM state in the top bar](#rom-state-in-the-top-bar));
- an entity type added or removed, or an entity type's sprite changed;
- rooms or collision classes added, removed or put in a different order;
- tilesets, or the number of tiles in one;
- background pictures;
- music tracks;
- level data larger than the room the last build left for it. That room is the **Level data reserve** in [Project settings](./project-settings#level-data-reserve), and the [Build panel](#level-data-use) shows how much is left.

![The Play panel saying a change needs a build, with the Build dev button](/screenshots/play-needs-build.png)

Only the ROM at the project's dev ROM path (or release ROM path, when that one is shown) is patched. It must have been built once with this version of the studio. A project with errors is not patched: the panel lists them, as the [Problems panel](./interface#problems) does.

The same patch can be run from the command line or by an agent; see [Command line and MCP](./agents).

### Live apply

With **Live apply** on, a patched change goes into the game that is running, so you can tune a room while standing in it. The player keeps their place, speed and state, and the camera, the score and the clock carry on. The status line ends "Applied live." once the game has taken the change.

![The Play panel after a change was applied live to the running game](/screenshots/play-patched.png)

| You change | What the game does |
| --- | --- |
| Tiles or collision in a room | Draws the tiles in view again. Drawing a whole screen of tiles takes longer than a frame, so the game skips a couple of frames (about two on the sample). |
| Physics | Uses the new settings from the next frame. |
| Entities or their properties | Respawns only the entities that changed. A moved or new coin comes back; a coin you took that did not change stays taken, even when an entity added to an earlier room moves the numbers of the ones after it. |
| A room's size, its place on the world map or its tileset, or a collision class | Makes its view of the rooms again, at the camera. |

When the change can't go in live, the game restarts with the new ROM, as it does with **Live apply** off, and the line says why after "Restarted:":

- the ROM is a release build, which has no [debug map](../reference/debug-map) for the studio to signal through;
- something other than level data changed in the ROM, as after a rebuild;
- the game was built with a runtime older than live apply: build it again;
- the game did not take the change within 30 frames (half a second), because it does not look for changes. The game has to call `debug::Live::poll` once a frame and read its level data again when it reports a change; see [Making a game with it](./making-a-game#the-runtime). The sample does. A game made by **Set up game crate** does not, so it restarts.

Both ways need **Restart on rebuild** on. With it off, the running game is left as it is until you press **Restart**.

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
