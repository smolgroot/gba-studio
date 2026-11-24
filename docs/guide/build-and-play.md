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

Output is streamed live. A failed build is marked and its exit code shown; a successful one says how long it took. The build helper reports every hardware problem in one run, in terms of your project: a tile with more than 15 colours, tiles needing more than 16 palettes, a tileset over 1024 tiles, a sprite sheet with too many colours, an animation using a frame the sheet does not have, or backgrounds that with the rooms' tiles need more than 4 layers, 16 palettes or the 1024 tiles video memory holds. The studio counts background tiles and palettes as you paint and lists rooms and tilesets over them in Problems, so most of these show up before you build (see [Rooms](./rooms#tile-and-palette-budget)).

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
| **Entities** | Show the list of the player and the live entities beside the game, let you pick one on the game screen, and change its numbers while the game runs. On by default. See [Entities](#entities). |
| **Overlays** | Four check boxes, **Hitboxes**, **Collision**, **Camera** and **Rooms**, that draw over the game screen what the physics sees. Off by default. See [Overlays](#overlays). |

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
- more entities than the game has room for: "the game has room for 32 entities; the project now has 33". A build leaves room for a quarter more entities than the project has, and at least 16 more (see [In the frame loop](./making-a-game#in-the-frame-loop));
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
| Entities or their properties | Builds the entities again from the new data, except those already collected. A moved or new coin comes back; a coin you took that did not change stays taken, even when an entity added to an earlier room moves the numbers of the ones after it. |
| A room's size, its place on the world map or its tileset, or a collision class | Makes its view of the rooms again, at the camera. |

When the change can't go in live, the game restarts with the new ROM, as it does with **Live apply** off, and the line says why after "Restarted:":

- the ROM is a release build, which has no [debug map](../reference/debug-map) for the studio to signal through;
- something other than level data changed in the ROM, as after a rebuild;
- the game was built with a runtime older than live apply: build it again;
- the game did not take the change within 30 frames (half a second), because it does not look for changes. The game has to call `debug::Live::poll` once a frame and read its level data again when it reports a change; see [Making a game with it](./making-a-game#the-runtime). The sample does. A game made by **Set up game crate** does not, so it restarts.

Both ways need **Restart on rebuild** on. With it off, the running game is left as it is until you press **Restart**.

### Entities

While a dev ROM runs, the **Entities** list beside the game screen shows the player and every live entity, updated every frame. When the panel is narrow, the list sits under the screen. Untick **Entities** to hide it.

![The Play panel with the entity list beside the game, a coin picked on the screen and its row open](/screenshots/play-entities.png)

The first line says the frame, the room the player is in and the camera's top-left corner, as "Frame 133 · room entry · camera 720, 160". Then come:

- **Player**, always first: the top-left corner of its body, in world pixels, and its speed in pixels a frame, to 1/256 of a pixel (as on the [Physics](./physics) tab).
- Each live entity, as its type and its number in the world ("coin #1"): its feet, in world pixels, and its speed in whole pixels a frame.

The list holds the entities of the player's room and of each room touching it on the [world map](./world-map), sharing an edge or a corner: the rooms the game is running. Entities that were taken or destroyed are not listed. Nor is the player start, which the sample takes off the table on the first frame. Shots and other things the game makes while it runs are not in the table, so they are not listed either.

Click a row to select it and open it. The numbers in an open row can be changed while the game runs (see [Changing numbers](#changing-numbers)). An entity shows:

| Line | What it is |
| --- | --- |
| x, y | Its feet, in world pixels. |
| vx, vy | Its speed, in whole pixels a frame. |
| home x, home y | Where it was placed, in world pixels. A patrol walks around it. |
| faces left | Ticked when it faces left. |
| alive | Ticked while it is in the game. |
| room | The room it was placed in. |
| hitbox | Its size and where it sits from the feet, or "none (no sprite)" for a type with no sprite. |
| Properties as placed | Its properties and those of its type's behaviours, as the running ROM gives them to the game. A behaviour that changes its settings as it runs keeps its own copy, which is not shown. |

The player shows:

| Line | What it is |
| --- | --- |
| x, y | The top-left corner of its body, in world pixels. |
| vx (1/256), vy (1/256) | Its speed, in 1/256 pixel a frame: 256 is one pixel a frame. |
| size | Its width and height in pixels. |
| state | Whether it is on the ground or has hit a wall or a ceiling, or "in the air". |

You can also click a thing on the game screen. It is selected in the list, its row opens, and its box is outlined in blue on the screen. Where several boxes overlap, the smallest is picked, so a coin in front of a door can still be chosen. An entity with no sprite has no box, so it is picked by a small square standing on its feet. Clicking an empty spot clears the selection.

If the selected entity stops being live, the list says "#1 is no longer live: it was taken, or its room is no longer active." until you pick another.

The list reads the game's memory through the [debug map](../reference/debug-map), which release builds leave out. When it can't show the entities, it says why:

| The list says | Why |
| --- | --- |
| This ROM has no debug map, as release builds do not: play the dev ROM to see its entities. | The release ROM is running. |
| Build again to see entities: this ROM was built by an older studio, whose debug map has no entity table. | The dev ROM was built before the list existed. Only the player is listed. |
| The game does not use the generated entity table (data::entities()), so there are no entities to list. | The game keeps its entities in its own way. Only the player is listed. |

A game needs no code for the list: the generated `data::entities()` tells the studio where the table is (see [In the frame loop](./making-a-game#in-the-frame-loop)). It costs the game nothing a frame and nothing in a release build.

#### Changing numbers

To try a fix without a build, change a number in the open row while the game runs. A field shows the live value, which changes every frame, until you click into it; from then on it keeps what you type. Press `Enter` or leave the field to write the value, or press `Escape` to put the live value back. The game uses the new value on its next frame.

![The entity list with a coin's x changed while the game runs, and the coin moved on the screen](/screenshots/play-entities-edit.png)

| Key | What it does |
| --- | --- |
| `Enter` | Write the value you typed. Leaving the field does the same. |
| `Escape` | Leave the field without writing, and show the live value again. |

While a field has the focus, the keys you press go to it, not to the game.

Tick or untick **faces left** to turn an entity round. Untick **alive** to take it out of the game: it leaves the list, as a coin you took does.

A patrol sets its x from its home every frame, so a new x for it is lost on the next frame. Its row says "A patrol walks around its home and sets its x every frame: change its home to move it." Change **home x** or **home y** instead, and the patrol moves by as much.

Only the numbers above can be changed here. The player's size and state, and an entity's room and hitbox, are read only. Properties as placed are changed in the room, as the list says: "Properties as placed: change them in the room, and Live apply puts them in" (see [Live apply](#live-apply)).

A change made here is in the game's memory only. Restarting the game, or a live apply that changes entities, builds the entities again from the rooms. To keep a value, put it in the room.

The player is a local of the game's code, which the studio cannot safely write, so it asks the game to take the change. The game does that with one call a frame, `debug::apply_player_edit` (see [Making a game with it](./making-a-game#the-runtime)). The sample makes this call. A game that does not call it never takes the change: its player stays as it was, and the list says “The game has not taken the change to the player”. Entities need no code.

When a change can't be made, the row says "Not changed:" and why:

| The row says | Why |
| --- | --- |
| Not changed: x must be a whole number. | The value has a fraction, or is not a number. |
| Not changed: x must be from -2147483648 to 2147483647. | The game keeps each number in 32 bits, which hold no more than that. |
| Not changed: #1 is no longer live: it was taken, or its room is no longer active. | The entity left the game before the value was written. |
| Not changed: Build again to change it: this ROM was built by an older studio. Its debug map has no player edit. | The dev ROM was built before the player could be changed. Its entities' x, y, vx, vy, faces left and alive can still be changed; their home is not shown. |

Changing numbers works on dev ROMs only, as the list does. It costs the game 20 bytes of EWRAM and one read a frame for the player, and nothing in a release build.

### Overlays

Under the buttons, the **Overlays** row has four check boxes that draw what the physics sees over the game screen. Each is its own switch, and all are off by default. They do not need the **Entities** list to be open.

![The Play panel with the four overlays on: hitboxes, collision cells, the camera's cross and room borders drawn over the game screen](/screenshots/play-overlays.png)

| Overlay | What it draws |
| --- | --- |
| **Hitboxes** | A green box round the player and an amber box round each live entity. An entity whose type has no hitbox gets a small cross where its feet are. |
| **Collision** | The cells that stop or hurt the player, by their class: solid cells filled in red, a one-way cell with a thin cyan line along its top, a slope filled up to its floor in violet, a hazard filled and outlined in amber, and a custom class outlined in grey. Empty cells are not drawn. |
| **Camera** | A pink cross at the middle of the view. Under the screen the panel writes where the camera is: "Camera 720, 160: the cross is the middle of the view." |
| **Rooms** | The border of each room of the [world map](./world-map) that is in view, brighter for the player's room. A faint line marks each 240x160 screen inside a room that is bigger than one screen. |

The camera's position is the world pixel at the top-left of the screen. The cross has no target on purpose: how a game aims its camera is its own code, so the overlay shows only where the view is. To see how far the player is from the middle of the view, turn on **Hitboxes** as well.

The studio draws the overlays into each picture the emulator makes. The GBA screen is 240 by 160 pixels, and the studio scales that picture up, so a line is one game pixel wide at any zoom. The game and the ROM are not touched: an overlay adds nothing to the ROM, to the game's memory or to the console's time, and a release build holds nothing for it.

**Collision** shows the cells in the running ROM's level data, which are the ones the physics reads. A change you made shows once it is in the game, by a [patch](#patch-on-change) or a build. The [map editor's](./rooms) own collision overlay shows the project as it is now. **Collision** and **Rooms** need the ROM's level data section; a ROM whose game never reads its level data (see [How the studio knows](#how-the-studio-knows)) has none, so it shows only the player's box and the camera.

Overlays work on dev ROMs only, as the [Entities](#entities) list does, because they read the game's memory through the [debug map](../reference/debug-map). On a release ROM the panel says "This ROM has no debug map, as release builds do not: play the dev ROM to see its entities." under the check boxes when the **Entities** list is hidden; with the list shown, the list says it.

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
