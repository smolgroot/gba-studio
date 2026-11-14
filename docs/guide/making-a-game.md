# Making a game with it

A game is a Rust crate on agb that depends on two crates from this repository.

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
| `include_data!()` | `data::WORLD`, `ROOMS`, `CLASSES`, constants for room and collision class indices, an `EntityKind` enum, and each room's collision cells and entities | nothing |
| `include_gfx!()` | `gfx::TILESETS`, `ROOMS` (tile layers and backgrounds), `BACKGROUNDS`, one `SPRITE_<NAME>` per sprite with its frames and animations | the `agb` feature |
| `include_audio!()` | `audio::TRACKS`, `SFX` and index constants | `agb_tracker` in the game |

## The runtime

`runtime/` provides:

- **`data` and `physics`**, with no dependencies, which also compile for the host so game rules can be unit tested without a console. `Body` moves a box through collision cells: walls, ceilings, one-way platforms (with drop-through) and 45 degree and gentler slopes, in sub-pixel steps. Given the `World`, it moves in world pixels and walks from a room into the next without noticing. `World::camera_target` keeps the camera on rooms.
- **Collectibles:** `Body::overlaps` tests the player against a box, `Collected` keeps a bit for every entity that has been taken, and `SpriteSheet::hitbox_at` gives a placed entity's box.
- **`gfx`** (behind the `agb` feature): `WorldView` draws every room that shares a tileset as one scrolling space, streaming tiles in as the camera moves; `RoomView` draws a single room; `SpriteSheet` and `AnimPlayer` animate sprites, and `Animation::frame_at` animates many entities off one clock.
- **Backgrounds:** a view draws a room's pictures behind everything, each scrolled by its share of the camera's movement. Call `view.set_backgrounds(room, &graphics)` when the player enters another room.

## The sample game

`sample/` is a complete game built this way: a hero that runs, jumps, climbs a ramp, respawns on spikes, walks from one room into the next while the camera scrolls, collects coins and diamonds, and is sent back by a patrolling sentry bot. Its `src/main.rs` is about 250 lines. It builds from its own folder, with the nightly toolchain pinned in `sample/rust-toolchain.toml` and `agb-gbafix` installed:

```sh
cd sample && cargo build        # or press Build dev in the studio
```

Its art is flat-colour placeholders. Regenerate the sample project with `node scripts/make-sample-assets.ts` and `node scripts/make-sample-project.ts` (the second refuses to overwrite an existing project unless given `--force`).
