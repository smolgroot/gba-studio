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
| `include_data!()` | `data::world()`, which reads the level data from the ROM and returns the `World`; `ENTITY_SLOTS` and `LIMITS`; `room::*` and `class::*` index constants; an `EntityKind` enum; the table of live entities and the loop that runs their behaviours: `entities()`, `Entities`, `LIVE_ENTITIES`, `HITBOXES`, `enter_room`, `update_entities` and `view` (see [In the frame loop](#in-the-frame-loop)) | nothing |
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
    // entity.kind, entity.x, entity.y, entity.int("armour"), entity.behaviour(n), ...
}
```

Nothing is copied into RAM: the `World` reads straight from the ROM. `data::world()` stops the game with a message if the section cannot be read, which only happens if it was replaced by one the game was not built for.

The section has room to grow after the data, so a project that becomes a little larger still fits. By default the reserve is a quarter of the data, at least 4 KiB. Set **Level data reserve** in [Project settings](./project-settings#level-data-reserve) to choose it in bytes (it is `build.dataReserve` in `studio/project.json`). The [Build panel](./build-and-play#level-data-use) shows how much of it each built ROM uses. While that room lasts, the studio can replace the level data in a built ROM without compiling: see [Patch on change](./build-and-play#patch-on-change).

`data::ENTITY_SLOTS` is the number of entities the data section has room for, so it also covers entities added later without a build. Size `Collected` with it, one bit per entity in 32-bit words:

```rust
const ENTITY_WORDS: usize = data::ENTITY_SLOTS.div_ceil(32);
let mut found = Collected::<ENTITY_WORDS>::new();
```

## The runtime

`runtime/` provides:

- **`data` and `physics`**, with no dependencies, which also compile for the host so game rules can be unit tested without a console. `Body` moves a box through collision cells: walls, ceilings, one-way platforms (with drop-through) and 45 degree and gentler slopes, in sub-pixel steps. Given the `World`, it moves in world pixels and walks from a room into the next without noticing. `World::camera_target` keeps the camera on rooms.
- **Collectibles:** `Body::overlaps` tests the player against a box, `Collected` keeps a bit for every entity that has been taken, and `SpriteSheet::hitbox_at` gives a placed entity's box.
- **`behaviour`:** ready-made behaviours for placed entities: patrol, collectible, hazard, projectile and shooter, moving platform, door, checkpoint, ability pickup and spawner; `LiveEntities`, the fixed-size table that keeps every entity with its behaviours while the game runs; and a fixed-size `Pool` for what is made while the game runs. See [Behaviours](#behaviours) below.
- **`gfx`** (behind the `agb` feature): `WorldView` draws every room that shares a tileset as one scrolling space, streaming tiles in as the camera moves; `RoomView` draws a single room; `SpriteSheet` and `AnimPlayer` animate sprites, and `Animation::frame_at` animates many entities off one clock.
- **Backgrounds:** a view draws a room's pictures behind everything, each scrolled by its share of the camera's movement. Call `view.set_backgrounds(room, &graphics)` when the player enters another room.
- **`debug`:** `debug::publish` copies the game's state (frame count, room, camera, player, collected bits) to one place in RAM, where tools reading the emulator's memory find it through the [debug map](../reference/debug-map). Call it once a frame, after everything has moved:

  ```rust
  use pecten_studio_rt::debug::{self, GameState};

  let mut shown = GameState::new();
  shown.collected(&found);
  loop {
      // ... move everything ...
      shown.frame = clock;
      shown.room = room as u32;
      (shown.camera_x, shown.camera_y) = camera;
      shown.player = body;
      debug::publish(&shown);
  }
  ```

  It costs 64 bytes of EWRAM and a few word writes a frame in dev builds, and nothing in release builds, where `publish` does nothing.

  `debug::Live` lets the Play panel's [Live apply](./build-and-play#live-apply) put level data changes into the running game. Poll it once a frame. When it reports a change, the level data's tables may have moved, so make the world again with `data::world()` and give the new one to the view; nothing may read the old `World` after that. Keep the player, the camera and the score as they are:

  ```rust
  use pecten_studio_rt::debug::Live;

  let mut live = Live::new();
  loop {
      if let Some(changes) = live.poll() {
          world = data::world();
          physics = world.physics();
          if changes.rooms() {
              // Rooms resized, moved or given another tileset: a new view.
              view = WorldView::new(&world, gfx::ART, room, &mut graphics);
              view.load(camera.0, camera.1);
          } else if changes.tiles() {
              view.redraw(&world, camera.0, camera.1);
          } else {
              view.set_world(&world);
          }
      }
      // ... move everything ...
  }
  ```

  `changes.physics()` and `changes.entities()` say whether those changed too; the studio has already respawned changed entities by clearing their collected bits. `poll` costs one read and a compare a frame, and 12 bytes of EWRAM, in dev builds. In a release build it always returns `None`. A game that does not poll is restarted on each change instead. The sample's `src/main.rs` shows it in full, with the player's room found again after the change.

  `debug::apply_player_edit` takes a change to the player made in the Play panel's [Entities list](./build-and-play#changing-numbers). The player's `Body` is a local of your `main`, which the compiler may keep in registers, so the studio cannot safely write it; it leaves a request in RAM instead. Call it once a frame, before the player moves. It copies the new position and speed into the body once, and returns true when it did:

  ```rust
  use pecten_studio_rt::debug;

  loop {
      // A change made in the Play panel's Entities list, before the player moves.
      debug::apply_player_edit(&mut body);
      // ... read the buttons, move the player ...
  }
  ```

  It costs 20 bytes of EWRAM and one read a frame in dev builds, and does nothing in a release build. A game that does not call it shows its player in the list, but a change to it is never taken. Entities need no code: the studio writes their slots in the table of live entities, which the game reads every frame.

## Behaviours

`behaviour` has what common entities do, so a game only writes what is special about it. Like `data` and `physics`, it has no dependencies, does not allocate, and compiles for the host, so you can test a game's rules without a console.

Every behaviour has the same shape, the `Behaviour` trait:

```rust
const DECLARATION: Declaration;
fn from_settings(settings: &Settings) -> Option<Self>;
fn from_entity(entity: &Entity) -> Option<Self>; // given: built on from_settings
fn update(&mut self, actor: &mut Actor, world: &World, cx: &Context) -> Event;
```

`DECLARATION` says what the behaviour is called in a project, its number, and which properties it reads, in order (see [Giving a type its behaviours](#giving-a-type-its-behaviours)). `from_entity` gives the behaviour for an entity whose type lists it, and `None` for any other entity, or when a setting is not one it can use. `update` runs one frame: it moves the actor if the behaviour moves things, and says what happened.

`from_entity` asks the entity for the behaviour's settings with `entity.behaviour(DECLARATION.number)` and passes them to `from_settings`. **`Settings`** (in `data`) are the behaviour's properties on one entity, by position, in the order `DECLARATION` lists them: `settings.int(0)` is the first, `settings.bool(1)` the second, and each gives `None` when the property there is not of that type. Nothing is looked up by name. Each behaviour implements `from_settings` and gets `from_entity` with it. `Patrol`'s reads its two properties:

```rust
fn from_settings(settings: &Settings) -> Option<Self> {
    // patrol, then patrol_pace, as DECLARATION lists them.
    Some(Self::new(settings.int(0)?, settings.int(1)?.max(1) as u32))
}
```

`entity.behaviours()` gives every behaviour the entity's type has, in the type's order, as `(number, settings)` pairs, for a game that dispatches on the numbers itself. **`Attached`** is any one of the runtime's behaviours: `Attached::from_settings(number, &settings)` builds the one with that number, and its `update` runs it. That is what the [table of live entities](#in-the-frame-loop) keeps for each entity.

### Actors, context and events

Entities in the data section are in the ROM and do not change, so a behaviour works on an **`Actor`**: the entity while the game runs. It has its feet (the middle of its bottom edge) in world pixels, `home` (where it was placed), a velocity `vx` and `vy`, `faces_left`, `alive`, and a `Hitbox` (an offset from the feet and a size).

- `Actor::at(x, y, hitbox)` makes one standing at a point of the world.
- `Actor::placed(&world, room, number, hitbox)` makes one for entity `number` of a room, where it was placed. It gives `None` if the room has no such entity or is not on the world map.
- `actor.bounds()` gives its box in world pixels, and `actor.touches(&body)` says whether a body overlaps it.
- With the `agb` feature, `sheet.hitbox()` gives a sprite sheet's hitbox in the form an actor takes (the whole frame if the sheet has none).

A **`Context`** holds what a behaviour may look at besides its actor and the world: the player's `Body`, the clock (frames since the game began), the buttons held and pressed this frame, and the abilities the player has. `Buttons` is a plain bit set in the GBA's button order, with constants `Buttons::A`, `B`, `SELECT`, `START`, `RIGHT`, `LEFT`, `UP`, `DOWN`, `R` and `L`, and `has` to test them. `gfx::buttons(&input)` fills both sets from agb's `ButtonController`, after its `update` for the frame.

**`Abilities`** is a set of 32 abilities, numbered 0 to 31: double jump, a key, a dash. What each number means is yours to say. `Abilities::NONE` has none, `abilities.has(n)` tests one, and `abilities.grant(n)` adds one and returns whether it is new (false if the player had it, or if `n` is past 31). It is a plain `u32` inside (`abilities.0`), so it is easy to save.

An **`Event`** is what came of the frame. Behaviours never change the game's own state, such as the score, the player or what has been collected. The game decides what an event does: play a sound, add to the score, send the player back.

| Event | Means |
| --- | --- |
| `Event::None` | Nothing that concerns the game. |
| `Event::Hurt` | The player touched something that hurts. |
| `Event::Collect { value }` | The player took a collectible worth `value`. The actor is no longer alive. |
| `Event::Grant { ability }` | The player picked up an ability, 0 to 31. Add it to their `Abilities`. |
| `Event::Checkpoint { x, y }` | The player reached a checkpoint. `x` and `y` are where they come back to: its feet, in world pixels. |
| `Event::Fire(shot)` | A shooter fired. Put a projectile for the `Shot` in a `Pool`. |
| `Event::Spawn { x, y }` | A spawner wants a new entity with its feet at `x`, `y`, in world pixels. |
| `Event::Opened` | A door opened. It no longer blocks. |

More events may be added, so a `match` on `Event` needs a `_` arm.

### The behaviours

Each behaviour has an id, the name an entity type lists it by in `project.json` (see [Giving a type its behaviours](#giving-a-type-its-behaviours)). Its properties are all whole numbers. Each has the range it allows, and a default, the value the build writes when a type lists the behaviour and neither the type nor the placed entity sets it.

| Behaviour | Id | Properties | Does |
| --- | --- | --- | --- |
| `Patrol` | `patrol` | `patrol`: pixels each way, 0 to 4096, 32 if not set. `patrol_pace`: frames to walk a pixel, 1 to 255, 2 if not set. | Walks back and forth along x around `home`, and sets `faces_left`. Where it is follows from the clock alone, so the studio can tell where a patrol is from the frame count. A `patrol` of 0 stands still. |
| `Collectible` | `collectible` | `value`: what it is worth, 0 to 1,000,000, 1 if not set. | When the player touches it: `Collect { value }`, once, and the actor is no longer alive. |
| `Hazard` | `hazard` | none | While the player touches it: `Hurt`, every frame. |
| `Projectile` | `projectile` | `shot_speed`: pixels a frame, left if negative, −16 to 16, 2 if not set. | Flies at its speed for up to `Projectile::DEFAULT_LIFE` frames (240, four seconds). It dies when the middle of its hitbox reaches a solid cell, when its time runs out, or when it hits the player, which gives `Hurt`. |
| `Shooter` | `shooter` | `fire_every`: frames between shots, 1 to 3600, 60 if not set. `shot_speed`: pixels a frame its shots fly, 1 to 16, 2 if not set. `sight`: pixels, 0 to 1024, 96 if not set. | While the player is within `sight` pixels both across and up and down, it turns to face them, and every `fire_every` frames gives `Fire(shot)`: a shot from the middle of its hitbox towards the player along x. |
| `MovingPlatform` | `moving-platform` | `travel_x`: pixels across, left if negative. `travel_y`: pixels down, up if negative. Both −4096 to 4096, 0 if not set. `travel_pace`: frames to move a pixel, 1 to 255, 2 if not set. | Goes back and forth in a straight line between `home` and `home` plus the travel. Where it is follows from the clock alone, like a patrol. The top of its hitbox is a one-way floor (see [Platforms and doors](#platforms-and-doors)). |
| `Door` | `door` | `needs_ability`: the ability that opens it, 0 to 31, or −1 for none, −1 if not set. | Closed until the player touches it, or stands right against it, while having the ability. A door that needs none opens while the player holds Up. Then `Opened`, once. While closed it blocks the player. |
| `Checkpoint` | `checkpoint` | none | The first time the player touches it: `Checkpoint { x, y }`, with its feet. |
| `AbilityPickup` | `ability-pickup` | `grants_ability`: the ability it gives, 0 to 31. It has no default: the type or each placed entity must set it. | When the player touches it: `Grant { ability }`, once, and the actor is no longer alive. |
| `Spawner` | `spawner` | `spawn_every`: frames between spawns, 1 to 3600, 120 if not set. `max_alive`: how many of its children may be alive at once, 0 to 255, 3 if not set. | Every `spawn_every` frames, while fewer than `max_alive` of its children are alive, `Spawn { x, y }` with its feet. |

An entity has a behaviour only when its type lists it in `project.json`. A property of its own with a behaviour's property name, such as `value` or `patrol`, does not make it one. A hazard and a checkpoint read no properties, but they too are given only to the types that list them. So a game can ask every entity for every behaviour it uses, and each entity answers only for its own. The generated `data::update_entities` does this for you; see [In the frame loop](#in-the-frame-loop).

One entity can have up to 4 behaviours. Update them in order on the same actor. Put `Hazard` after the behaviour that moves the actor, so it hurts where the actor is now. The sample's sentry bot is a `Patrol` and then a `Hazard`.

A `Collectible` is not alive after it is taken. The table of live entities keeps it so until the game restarts or a live apply builds the entities again, so to keep an entity taken for good (and to save it), record it in `Collected`, as below. The same goes for an `AbilityPickup`, and for a door you want to stay open.

`Door`, `Checkpoint` and `Spawner` keep state (whether the door is open, whether the checkpoint was reached, how many children are alive). The table of live entities keeps every behaviour with its actor between frames, so this needs nothing from you. If you build behaviours yourself with `from_entity`, keep these three between frames; the others keep nothing they cannot work out again, so they can be built every frame.

### Giving a type its behaviours

Give a type its behaviours on the [Entities page](./entities#behaviours), where each one has a form, and set a placed entity's own values in the [room panel](./rooms#entity-overrides). The type keeps them in `studio/project.json`, under `behaviours`, by id, with the type's values for their properties:

```json
{
  "id": "sentry-bot",
  "name": "Sentry bot",
  "colour": "#e5484d",
  "sprite": "sentry-bot",
  "props": [],
  "behaviours": [
    { "id": "patrol", "props": { "patrol": 32 } },
    { "id": "hazard" }
  ]
}
```

- A property left out takes the behaviour's default, so here every sentry bot has a `patrol_pace` of 2.
- A placed entity overrides a value with a property of the same name in its own `props`, for example `"patrol": 64` on one sentry bot that walks further.
- List them in the order they are meant to run on the actor: `hazard` after the behaviour that moves it.
- A type has at most 4. The table of live entities keeps room for 4 behaviours on each entity, whatever its type, so a higher limit would cost every entity more memory (see [Cost](#cost)).
- A type that lists no behaviours has an empty list, so projects made before behaviours could be listed load as they were.
- A type's own properties, which the game's code reads by name, are defined on the [Entities page](./entities#properties), not here. An own property cannot have the name of one of the type's behaviours' properties: the Properties table refuses the name, and **Add a behaviour** does not let you pick a behaviour that has a property named like one of the type's own.

The build writes each listed behaviour's properties into the [data section](../reference/data-section#entity) after the type's own, with the placed entity's value, the type's, or the default, and records which behaviours each type has and where their properties start (the [behaviours part](../reference/data-section#behaviours)). That is how the game finds them: listing `shooter` on a type makes every entity of it a shooter, with a `fire_every` of 60 unless you set another. The generated loop runs every behaviour a type lists; the game's code decides what their events do, as in the loop below.

An agent gives and takes behaviours with the `entity_type_add_behaviour` and `entity_type_remove_behaviour` tools (see [Command line and MCP](./agents#behaviours)). `pecten-studio schema` prints each behaviour's id, number, summary and properties as JSON Schema, under `behaviours`.

The behaviours declare their properties once, next to their code in the runtime (`Behaviour::DECLARATION`, all of them in `behaviour::DECLARATIONS`). The studio reads them from `core/src/behaviourschema.ts`, which is written from the declarations by `cargo run -p pecten_studio_build --bin behaviours-schema`. When you change a declaration in the studio's own repository, run it again: `cargo test` fails while the file is out of date. A project can list only the behaviours in `behaviour::DECLARATIONS`, so a new one is added there, in the studio's repository, with a number of its own and a `from_settings` that reads its properties in the order it declares them.

The studio checks listed behaviours, and every problem is an error, the same words in the [Problems panel](./interface#problems) and in the build:

| Problem | Example |
| --- | --- |
| A behaviour the runtime does not have | entity type "typo" has unknown behaviour "patroll"; the behaviours are patrol, collectible, hazard, projectile, shooter, moving-platform, door, checkpoint, ability-pickup, spawner |
| The same behaviour listed twice | entity type "twice" has behaviour "hazard" twice |
| A property the behaviour does not have | entity type "extra": behaviour "patrol" has no property "speed"; its properties are patrol, patrol_pace |
| A value of the wrong type or out of range, on the type or on a placed entity | entity type "slow": patrol_pace is 0; it is a whole number from 1 to 255 |
| A required property with no value on the type or the placed entity | entity 0 (key): grants_ability has no value; behaviour "ability-pickup" needs it, and the type does not set it |
| A type's own property with the name of one of its behaviours' | entity type "own" has its own property "value", which behaviour "collectible" also has; rename its own |
| Two behaviours of one type with the same property | entity type "both": behaviours "shooter" and "projectile" both have property "shot_speed"; a type can have only one of them |
| More than 4 behaviours on one type | entity type "many" has 5 behaviours; an entity can have at most 4 |

`shooter` and `projectile` both read `shot_speed`, so a type can have only one of them: give shots a type of their own.

### In the frame loop

`include_data!()` writes the loop that runs every entity's behaviours, so a game names no behaviour and matches no entity type to run one. A new type with behaviours needs no change to the game's code.

The entities live in one table, `data::Entities`, which has a slot for every entity of the world:

- `data::entities()` gives the table. It is a `static`, so it sits in EWRAM, not on the stack. Call it once and keep the reference: a second call stops the game with a message. In a dev build it also tells the studio where the table is, once, so the Play panel's [Entities list](./build-and-play#entities) can show it and change its entities' numbers; a game that keeps its entities some other way has no list.
- `data::enter_room(entities, &world, room, skip)` makes `room` and the rooms touching it on the world map the active ones. Call it when the game starts and each time the player enters another room. Each entity is built from the ROM the first time its room is active: its actor at its feet, its type's hitbox and its behaviours with their settings. It is then kept, so a room the player leaves and comes back to is as they left it: a door stays open and a checkpoint stays reached. `skip` takes an entity's number in the world and says to leave it out, such as one already in `Collected`.
- `data::update_entities(entities, &world, &cx, camera, before, event)` runs one frame of every living entity in the active rooms that the camera shows. `camera` is its top-left corner in world pixels. The other active rooms' entities wait, as they are, until the camera comes to them.
- `entities.visible(data::view(camera))` gives the same entities, room by room, to draw.

For each entity, `update_entities` first calls `before(kind, &mut entity)`, with its `EntityKind`. That is the place for what is special to a type. It answers `Dispatch::Behaviours` to run the type's behaviours, in the type's order, or `Dispatch::Handled` when the game has done the entity's frame itself, and none of them run. Then every event the behaviours give goes to `event(kind, &mut entity, event)`, where the game decides what it means.

The sample's loop is this one call. The player start only marks where the game begins, so it takes it off the table on the first frame:

```rust
use pecten_studio_rt::behaviour::{Abilities, Context, Dispatch, Event};

let entities = data::entities();
data::enter_room(entities, &world, room, |_| false);

// In the frame loop, after the player has moved:
let (held, pressed) = pecten_studio_rt::gfx::buttons(&input);
let cx = Context { player: &body, clock, held, pressed, abilities: Abilities::NONE };
let mut hurt = false;
data::update_entities(
    entities,
    &world,
    &cx,
    camera,
    |kind, entity| {
        if kind == EntityKind::PlayerStart {
            entity.actor.alive = false;
            Dispatch::Handled
        } else {
            Dispatch::Behaviours
        }
    },
    |kind, entity, event| match event {
        Event::Collect { value } if found.take(entity.index as usize) => {
            score = score.saturating_add(value.max(0) as u32);
        }
        Event::Hurt => hurt = true,
        _ => {}
    },
);
for entity in entities.visible(data::view(camera)) {
    let Some(sheet) = gfx::ENTITY_SPRITES[entity.kind as usize] else { continue };
    // draw the sprite at entity.actor.x - camera.0, entity.actor.y - camera.1,
    // flipped if entity.actor.faces_left
}
```

When the player enters another room, call `data::enter_room` again. The sample has no abilities yet, so it passes `Abilities::NONE`; a game that has them passes the player's own.

A **`LiveEntity`** is one slot of the table:

- `actor`, where it is, and whether it is still alive. A dead one is skipped and not drawn.
- `kind`, its type's number. `EntityKind::of_live(&entity)` names it.
- `room`, the room it was placed in, and `index`, its number in the world, the bit it has in `Collected`.
- `behaviours`, up to 4 `Attached`, in the type's order. `entity.behaviours()` and `entity.behaviours_mut()` go through them.

The table also has `active()` and `active_mut()`, every living entity of the active rooms, on screen or not; `get(index)` and `get_mut(index)`, one entity by its number in the world, if it has been built; and `clear()`, which forgets them all, so each is built again from the ROM when its room is next entered.

After a [live apply](./build-and-play#live-apply) that changed entities, they may have moved, or be new. The sample calls `entities.clear()` and then `data::enter_room` with `|index| found.has(index)`, so every entity is built again from the new data and those already collected stay collected. State that is only in the table, such as an open door, starts again.

`data::LIVE_ENTITIES` is the number of slots: the project's entities and a quarter more, at least 16 more, rounded up to 16. The spare slots are for entities placed while the game runs, by a live apply. When the project has more entities than that, a live apply needs a build: "the game has room for 32 entities; the project now has 33". `data::HITBOXES` gives each type's hitbox, taken from its sprite, as an offset from its feet; a type with no sprite has an empty one, which touches nothing. `entities.dropped()` counts entities and behaviours the last `enter_room` had no room for; both are 0 unless the ROM was changed past what the studio allows.

#### Without the table

`from_entity` is the lower-level way: build a behaviour from a placed entity yourself, update it, and act on its event. The behaviours read their settings from the ROM each time they are built. A game that does this builds an actor for each entity in view and asks it for each behaviour it uses:

```rust
use pecten_studio_rt::behaviour::{Actor, Behaviour, Collectible, Event, Hazard, Patrol};

for (number, entity) in world.room(room).entities().enumerate() {
    let taken = world.entity_index(room, number);
    if found.has(taken) {
        continue;
    }
    let Some(sheet) = gfx::ENTITY_SPRITES[entity.kind as usize] else { continue };
    let mut actor = Actor::at(left + entity.x as i32, top + entity.y as i32, sheet.hitbox());
    if let Some(mut patrol) = Patrol::from_entity(&entity) {
        patrol.update(&mut actor, &world, &cx);
    }
    if let Some(mut coin) = Collectible::from_entity(&entity)
        && let Event::Collect { value } = coin.update(&mut actor, &world, &cx)
        && found.take(taken)
    {
        score = score.saturating_add(value.max(0) as u32);
        continue;
    }
    if let Some(mut hazard) = Hazard::from_entity(&entity) {
        hurt |= hazard.update(&mut actor, &world, &cx) == Event::Hurt;
    }
    // draw the sprite at actor.x, actor.y, flipped if actor.faces_left
}
```

Here `left` and `top` are the room's place on the world map, from `world.origin(room)`, and `taken` is the entity's number across rooms. Built this way every frame, a door, checkpoint or spawner forgets its state; keep those structs between frames.

### Shots and spawned enemies

Shots and spawned enemies are not in the data section, so they need somewhere to live while the game runs. A **`Pool<T, N>`** holds up to `N` of them in a fixed array, and allocates nothing.

- `Pool::new()` makes an empty one. `pool.add(thing)` puts a thing in a free slot and gives `Ok(slot)`, or `Err(thing)` back when every slot is taken, so you can drop it or make room.
- `pool.remove(slot)`, `pool.get(slot)` and `pool.get_mut(slot)` work on one slot.
- `pool.iter()` and `pool.iter_mut()` give the things with their slots, and `pool.retain(|thing| ...)` keeps only those for which it says true: the way to drop dead shots once a frame.
- `pool.len()`, `pool.is_empty()` and `pool.is_full()` say how many there are.

When a shooter gives `Fire(shot)`, `shot.launch(hitbox)` gives the actor and the projectile that fly it, ready for a pool. The shot starts at the shooter's middle, so anchor shot sprites in their middle.

```rust
use pecten_studio_rt::behaviour::{Actor, Event, Pool, Projectile};

let mut shots: Pool<(Actor, Projectile), 8> = Pool::new();

// In the frame loop, in the `event` hook of `data::update_entities`:
|kind, entity, event| match event {
    // A full pool gives the shot back: it is not fired.
    Event::Fire(shot) => { let _ = shots.add(shot.launch(SHOT_SHEET.hitbox())); }
    _ => {}
}

// Then, once a frame, every shot flies:
for (_, (actor, projectile)) in shots.iter_mut() {
    hurt |= projectile.update(actor, &world, &cx) == Event::Hurt;
    // draw the shot at actor.x, actor.y, flipped if actor.faces_left
}
shots.retain(|(actor, _)| actor.alive);
```

Here `SHOT_SHEET` is the shot's sprite sheet, and `cx` the frame's `Context`. A spawner works the same way: when it gives `Spawn { x, y }`, make the child's actor with `Actor::at(x, y, hitbox)` and add it to a pool, with its behaviours. Keep the spawner's number in the world (`entity.index`) with each child. When a child dies, or the pool is full and it could not be made, find the spawner with `entities.get_mut(index)` and call `despawned()` on its `Attached::Spawner`, so it does not count it.

The GBA shows at most 128 sprites at once, and everything else on screen needs some of them, so choose `N` with the sprites you have to spare.

### Platforms and doors

Moving platforms and closed doors keep the player out of where they are, so they act on the player's `Body` after it has moved. Keep a copy of the body from before `Body::step` (`Body` is `Copy`), then:

- `platform.carry(&actor, &mut body, &before)` lands a falling body on the platform's top and moves a body standing there along with it. A body going up passes through from below, as through a one-way platform, so the player can jump onto it and off it. It returns whether the body is on the platform. Update the platform first, in the same frame: the update sets the actor's `vx` and `vy` to its move, which `carry` gives to the body.
- `door.block(&actor, &mut body, &before)` pushes the body back out of a closed door, on the side it came from, and sets `hit_wall`, `on_ground` or `hit_ceiling` as `Body::step` would. It returns whether it pushed. An open door does nothing.

The table of live entities runs the platforms and doors with the others, from the body where it is after `Body::step`. Then go through the active entities for them:

```rust
use pecten_studio_rt::behaviour::Attached;

// In the frame loop:
let before = body;
body.step(&world, input.is_pressed(Button::Down));
let cx = Context { player: &body, clock, held, pressed, abilities };
data::update_entities(entities, &world, &cx, camera, |_, _| Dispatch::Behaviours, |_, entity, event| {
    if event == Event::Opened {
        // play a sound, record entity.index in `Collected` to keep it open
    }
});
for entity in entities.active_mut() {
    let actor = entity.actor;
    for behaviour in entity.behaviours_mut() {
        match behaviour {
            Attached::MovingPlatform(platform) => { platform.carry(&actor, &mut body, &before); }
            Attached::Door(door) => { door.block(&actor, &mut body, &before); }
            _ => {}
        }
    }
}
```

Here `abilities` is the game's `Abilities`. The platform's update has set its actor's `vx` and `vy` to its move, which `carry` gives to the body. A closed door counts as touched when the player stands right against it, since its own blocking keeps them from overlapping it. A game that builds behaviours itself with `from_entity` does the same with its own platforms and doors: update the platform, then `carry`, and keep each door between frames.

When a checkpoint gives `Checkpoint { x, y }`, keep the point and put the player back there with `Body::standing_at(x, y, w, h)`. When an ability pickup gives `Grant { ability }`, call `abilities.grant(ability)`, and pass the abilities in each frame's `Context` so doors can see them.

### Cost

A frame at 60 frames a second has about 280,000 cycles. The table of live entities reads each entity's position and behaviour settings from the ROM once, when it is built. Each frame, an entity costs its behaviours' updates and nothing more. The sample's frame takes 28,700 cycles on average, less than when its sentry bot, coins and diamonds were written by hand (29,600). `from_entity` compares no names either: it looks through the few behaviours the entity's type has for the one asked for, and reads that behaviour's settings by position from the ROM. Done for every entity in view, every frame, those reads add up a little: the sample took 30,200 cycles that way.

The library itself takes no RAM. Each behaviour struct is a few bytes, an actor 36, and a pool holds room for `N` things whether or not they are in use, all on the game's side. IWRAM is 32 KB and EWRAM 256 KB, so a pool of eight shots, under 400 bytes, is small, but size pools to what a room needs.

The table of live entities is in EWRAM, 108 bytes a slot, with room for 4 behaviours in each whatever the type has. The sample's 32 slots take 3,532 bytes. A world of 500 entities gets 640 slots, about 69 KB of the 256 KB.

## The sample game

`sample/` is a complete game built this way: a hero that runs, jumps, climbs a ramp, respawns on spikes, walks from one room into the next while the camera scrolls, collects coins and diamonds, and is sent back by a patrolling sentry bot. Its `src/main.rs` is about 360 lines, with the sentry bot, coins and diamonds taken from the [behaviours](#behaviours) their types list in `studio/project.json`. It has no shooters, moving platforms, doors, checkpoints, ability pickups or spawners yet, and does nothing with their events. Its loop is one `data::update_entities` call, which runs whatever behaviours each type lists, so a new enemy or pickup needs no change to `main.rs`: give a type a sprite and patrol and hazard, or collectible, place it, and build (see [Making an enemy](./entities#making-an-enemy)). It builds from its own folder, with the nightly toolchain pinned in `sample/rust-toolchain.toml` and `agb-gbafix` installed:

```sh
cd sample && cargo build        # or press Build dev in the studio
```

Built with `cargo build --features measure`, the sample shows how long each frame's work takes in place of the score: the worst frame so far on top and the average below, both in hundreds of CPU cycles. A frame at 60 frames a second has about 2808 of them, so a number near that means the game is about to drop frames.

Its art is flat-colour placeholders. Regenerate the sample project with `node scripts/make-sample-assets.ts` and `node scripts/make-sample-project.ts` (the second refuses to overwrite an existing project unless given `--force`).

In the studio's own repository, `node scripts/check-new-enemy.ts` checks that end to end on a copy of the sample, with the MCP tools only: it draws a 16x16 PNG, makes a sprite and an entity type with patrol and hazard, places it, builds, and runs the ROM to see the enemy walk and send the hero back. It needs the sample's toolchain, and the cold build takes a minute or two.
