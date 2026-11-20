# Making a game with it

A game is a Rust crate on agb that depends on two crates from this repository. **Set up game crate** in the [Build panel](./build-and-play#getting-a-folder-ready-to-build) writes one for you, with its own copy of those crates, so the game can live in any folder. To write one by hand inside a checkout:

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

## The build helper

`codegen/` reads `studio/` next to the game's `Cargo.toml` (or the folder named by `PECTEN_STUDIO_PROJECT`), converts the PNGs, and writes Rust and binary data the game includes. It checks what the GBA can hold and says what is wrong in terms of your project, and reports every problem in one run.

A background is cut into 8x8 tiles like a tileset and keeps one of each tile that repeats. A sprite sheet saved with no transparency at all is taken to be drawn on a flat backdrop: the colour of its top-left pixel becomes transparent.

## The macros

| Macro | Gives | Needs |
| --- | --- | --- |
| `include_data!()` | `data::world()`, which reads the level data from the ROM and returns the `World`; `ENTITY_COUNT` and `LIMITS`; `room::*` and `class::*` index constants; an `EntityKind` enum | nothing |
| `include_gfx!()` | `gfx::TILESETS`, `BACKGROUNDS`, `ART` (both together, for the views), one `SPRITE_<NAME>` per sprite with its frames and animations | the `agb` feature |
| `include_audio!()` | `audio::TRACKS`, `SFX` and index constants | `agb_tracker` in the game |

## Level data in the ROM

The build puts the level data in one block of the ROM, the data section: rooms, their tile layers and collision cells, entities and their properties, where rooms sit on the world map, the start room and the physics. Graphics, sprites and audio are compiled into the game as before. The layout is on the [Data section](../reference/data-section) page.

The game reads the section once, when it starts, and keeps the `World` it gets back:

```rust
pecten_studio_rt::include_data!();
pecten_studio_rt::include_gfx!();

let world = data::world();
let physics = world.physics();
let view = WorldView::new(&world, gfx::ART, room, &mut graphics);
for entity in world.room(room).entities() {
    // entity.kind, entity.x, entity.y, entity.int("value"), ...
}
```

Nothing is copied into RAM: the `World` reads straight from the ROM. `data::world()` stops the game with a message if the section cannot be read, which only happens if it was replaced by one the game was not built for.

The section has room to grow after the data, so a project that becomes a little larger still fits. By default the reserve is a quarter of the data, at least 4 KiB. Set `build.dataReserve` in `studio/project.json` to choose it in bytes. You still build the game for a change to reach the ROM.

`data::ENTITY_COUNT` is the number of entities in the project when it was built. Size `Collected` with it, one bit per entity in 32-bit words:

```rust
const ENTITY_WORDS: usize = data::ENTITY_COUNT.div_ceil(32);
let mut found = Collected::<ENTITY_WORDS>::new();
```

## The runtime

`runtime/` provides:

- **`data` and `physics`**, with no dependencies, which also compile for the host so game rules can be unit tested without a console. `Body` moves a box through collision cells: walls, ceilings, one-way platforms (with drop-through) and 45 degree and gentler slopes, in sub-pixel steps. Given the `World`, it moves in world pixels and walks from a room into the next without noticing. `World::camera_target` keeps the camera on rooms.
- **Collectibles:** `Body::overlaps` tests the player against a box, `Collected` keeps a bit for every entity that has been taken, and `SpriteSheet::hitbox_at` gives a placed entity's box.
- **`gfx`** (behind the `agb` feature): `WorldView` draws every room that shares a tileset as one scrolling space, streaming tiles in as the camera moves; `RoomView` draws a single room; `SpriteSheet` and `AnimPlayer` animate sprites, and `Animation::frame_at` animates many entities off one clock.
- **Backgrounds:** a view draws a room's pictures behind everything, each scrolled by its share of the camera's movement. Call `view.set_backgrounds(room, &graphics)` when the player enters another room.

## The sample game

`sample/` is a complete game built this way: a hero that runs, jumps, climbs a ramp, respawns on spikes, walks from one room into the next while the camera scrolls, collects coins and diamonds, and is sent back by a patrolling sentry bot. Its `src/main.rs` is about 330 lines. It builds from its own folder, with the nightly toolchain pinned in `sample/rust-toolchain.toml` and `agb-gbafix` installed:

```sh
cd sample && cargo build        # or press Build dev in the studio
```

Built with `cargo build --features measure`, the sample shows how long each frame's work takes in place of the score: the worst frame so far on top and the average below, both in hundreds of CPU cycles. A frame at 60 frames a second has about 2808 of them, so a number near that means the game is about to drop frames.

Its art is flat-colour placeholders. Regenerate the sample project with `node scripts/make-sample-assets.ts` and `node scripts/make-sample-project.ts` (the second refuses to overwrite an existing project unless given `--force`).
