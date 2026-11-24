# Debug map

A running game keeps its state wherever its code puts it, usually in locals of
`main`, at addresses no tool can know. The debug map says where to look. Once a
frame the game copies the state that matters to a tool (the frame count, the room,
the camera, the player) into one block of RAM. A record in the ROM holds that
block's address, and after each build the studio writes a map file beside the ROM
that gives the address and the layout. The record also points at a small inbox,
where a tool tells the game that its level data changed, a start override, where a
tool asks the game to begin in a given room at a given spot, a cell that says
where the game's table of live entities is, and a player edit, where a tool asks
the game to change the player.

This page is for tools that read a running game's memory, such as an emulator
script or an agent checking where the player is. A game does not need it: it calls
`debug::publish` once a frame (see
[Making a game with it](../guide/making-a-game#the-runtime)), polls
`debug::Live` once a frame if it takes changes live, and calls
`debug::apply_player_edit` once a frame if its player can be changed from the
studio.

## What the game does

The game fills a `GameState` and hands it to `debug::publish` after everything has
moved:

```rust
use pecten_studio_rt::debug::{self, GameState};

let mut shown = GameState::new();
shown.collected(&found);

loop {
    // ... move the player, the camera and the entities ...
    shown.frame = clock;
    shown.room = room as u32;
    (shown.camera_x, shown.camera_y) = camera;
    shown.player = body;
    debug::publish(&shown);
}
```

`GameState::new()` sets the stamp and leaves everything else zero.
`shown.collected(&found)` points the state at the game's `Collected` bits; they must
stay where they are while the game runs, as locals of `main` do. A new game made by
**Set up game crate** already does this for the room, the camera and the frame
count.

The game does nothing for its entities. The generated `data::entities()` (see
[In the frame loop](../guide/making-a-game#in-the-frame-loop)) calls
`debug::show_entities` once, as it hands the table out, and that fills the cell. A
game that keeps its entities some other way has no table to show.

For the player, the game calls `debug::apply_player_edit` once a frame, before the
player moves, so that a tool can change it (see [The player edit](#the-player-edit)):

```rust
loop {
    debug::apply_player_edit(&mut body);
    // ... move the player, the camera and the entities ...
}
```

## The record in the ROM

The record starts with the 8 bytes `PECTDBUG`, on a 4-byte boundary, once in the
ROM. Search the file for them. All numbers are little-endian.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | `PECTDBUG` |
| 8 | 4 | Version: 5 |
| 12 | 4 | Address of the state block in RAM |
| 16 | 4 | Size of the block in bytes: 64 |
| 20 | 4 | Address of the inbox in RAM |
| 24 | 4 | Size of the inbox in bytes: 12 |
| 28 | 16 | The start override (below) |
| 44 | 4 | Address of the entity table's cell in RAM |
| 48 | 4 | Size of the cell in bytes: 12 |
| 52 | 4 | Address of the player edit in RAM |
| 56 | 4 | Size of the player edit in bytes: 20 |

Version 5 records are 60 bytes. Version 4 records stop after the cell's size, at 52
bytes, and have no player edit. Version 3 records stop after the start override, at
44 bytes, and have no entity table. Version 2 records stop after the inbox's size, at 28
bytes, and have no start override. Version 1 records stop after the block's size, at 20
bytes, and have no inbox.

The linker fills in the addresses, so they change from build to build. The block,
the inbox, the cell and the player edit are in EWRAM (`0x02000000` to `0x0203FFFF`); the studio refuses a record
that points anywhere other than EWRAM or IWRAM.

## The state block

Versions 1 to 5. 64 bytes, all 32-bit words except the flags inside the player's body.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | Stamp: `PSGS` once the game has published | `u32` |
| 4 | 4 | Frames since the game began | `u32` |
| 8 | 4 | Room index, in the data section's room table | `u32` |
| 12 | 4 | Camera left, in world pixels | `i32` |
| 16 | 4 | Camera top, in world pixels | `i32` |
| 20 | 36 | The player's body (below) | body |
| 56 | 4 | Address of the collected bits, or 0 | address |
| 60 | 4 | Words of 32 bits at that address | `u32` |

A block that is still all zeros, with no stamp, is one the game has not published
yet: it has just started, or it never calls `publish`.

### Body

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | x: left edge, in world pixels | `i32` |
| 4 | 4 | y: top edge, in world pixels | `i32` |
| 8 | 4 | Width in pixels | `i32` |
| 12 | 4 | Height in pixels | `i32` |
| 16 | 4 | Speed across, in 1/256 pixel per frame | `i32` |
| 20 | 4 | Speed down, in 1/256 pixel per frame | `i32` |
| 24 | 8 | Sub-pixel position, for the runtime's own use | |
| 32 | 1 | Standing on something: 0 or 1 | `bool` |
| 33 | 1 | Hit a wall in the last step: 0 or 1 | `bool` |
| 34 | 1 | Hit a ceiling in the last step: 0 or 1 | `bool` |
| 35 | 1 | 0 | |

### Collected bits

One bit per entity of the project, numbered as the
[data section](./data-section) numbers them: entity n is bit `n % 32` of word
`n / 32`. A set bit means the player has taken it. Read the address and the word
count from the block while the game runs.

### Entities

The block holds no entities. Where the game keeps them is in the
[entity table](#the-entity-table), from version 4.

## The inbox

Version 2. 12 bytes, three 32-bit words. The Play panel's
[Live apply](../guide/build-and-play#live-apply) writes it after it has changed the
level data in the emulator's copy of the ROM; the game reads it once a frame with
`debug::Live::poll`.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | Generation: one more for each change the tool has made | `u32` |
| 4 | 4 | What changed since the game last looked (bits below) | `u32` |
| 8 | 4 | The last generation the game has taken | `u32` |

| Bit | Value | Changed | The game |
| --- | --- | --- | --- |
| 0 | 1 | Tile layers or collision of a room | Draws the tiles in view again. |
| 1 | 2 | The physics settings | Reads them again. |
| 2 | 4 | Entities or their properties | Reads them again. |
| 3 | 8 | Rooms resized, moved on the map or given another tileset, the collision classes, or the start room | Makes its view again. |

To send a change:

1. Write the new bytes of the [data section](./data-section) into the ROM. A game
   reads the section from the cartridge, so the change must be in the emulator's
   copy of the ROM, not only in the file.
2. If entities changed, move the bits in the collected words to the entities' new
   numbers, and clear the bits of entities that are new or changed, so they
   respawn. Adding an entity to a room moves the number of every entity after it.
3. OR the bits for what changed into `changed`, and add one to `generation`.
4. Run frames until `seen` equals the new `generation`: the game has taken the
   change. A game that does not poll never sets it; the Play panel gives up after 30
   frames and restarts the game with the new ROM.

When `generation` differs from `seen`, `poll` copies `generation` to `seen`, clears
`changed` and returns what it held. The game then makes its `World` again, because
the section's tables may have moved. Write the inbox between frames, as the studio
does, so the game never sees half a change.

## The start override

Version 3. 16 bytes in the ROM, four 32-bit words, all zero as built. The game reads
them once, as it starts. It is in the ROM and not in RAM so that it is there before the
first frame. The Play panel's [Play from here](../guide/build-and-play#play-from-here)
writes it into the emulator's copy of the ROM before the first frame; the file on disk
is never changed.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | `set`: 1 to start at the spot, 0 to start as usual | `u32` |
| 4 | 4 | `room`: the room's index, its position among the project's room ids in sorted order, as in the [data section](./data-section) | `u32` |
| 8 | 4 | `x`: in room pixels | `i32` |
| 12 | 4 | `y`: in room pixels | `i32` |

The spot is where an entity placed on a tile stands: `x` is the middle of the tile and
`y` the bottom edge of the tile, so the player's feet are there. The game starts in that
room with the player at the spot, as it does for a `player-start` entity. If `set` is
not 1, or the room does not exist, it starts as usual. A release build has no record, so
nothing can set it.

## The entity table

Version 4, with the slot's home from version 5. The game keeps its placed entities in one table, `data::Entities`, with a
slot for every entity of the world. The table is a `static` in EWRAM, so it does not
move while the game runs. The Play panel's
[Entities list](../guide/build-and-play#entities) reads it, and writes it to
[change an entity](#changing-an-entity).

### The cell

12 bytes, three 32-bit words, at the address in the record. They are all zero until
the game takes its table from `data::entities()`, which writes them once. If they are
still zero after the first frame, the game does not use the generated table.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | Address of the first slot | `address` |
| 4 | 4 | Number of slots | `u32` |
| 8 | 4 | Size of a slot in bytes: 108 | `u32` |

The slots follow one another, built or not: slot n starts at the first slot's address
plus n times the slot size. Read them all in one go, `slots × slotSize` bytes (about
7 KB for 64 slots). Check the slot size against the map's before reading: a game built
with another runtime may lay its slots out differently.

### Slot

108 bytes. Offsets count from the start of the slot.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | x: the entity's feet, in world pixels | `i32` |
| 4 | 4 | y: the entity's feet, in world pixels | `i32` |
| 8 | 4 | homeX: where it was placed, in world pixels | `i32` |
| 12 | 4 | homeY: where it was placed, in world pixels | `i32` |
| 16 | 4 | Speed across, in whole pixels a frame | `i32` |
| 20 | 4 | Speed down, in whole pixels a frame | `i32` |
| 24 | 1 | Faces left: 0 or 1 | `bool` |
| 25 | 1 | Alive: 0 or 1 | `bool` |
| 26 | 2 | Hitbox left, from the feet | `i16` |
| 28 | 2 | Hitbox top, from the feet | `i16` |
| 30 | 2 | Hitbox width; 0 for a type with no sprite | `u16` |
| 32 | 2 | Hitbox height; 0 for a type with no sprite | `u16` |
| 36 | 2 | Entity type number, in the order of the [data section](./data-section#manifest)'s manifest | `u16` |
| 38 | 2 | Room index, in the data section's room table | `u16` |
| 40 | 2 | The entity's number in the world, as the [data section](./data-section) numbers entities | `u16` |
| 42 | 1 | Built: 1 when the slot holds an entity | `bool` |
| 44 | 64 | The entity's behaviours and their state, for the runtime's own use | |

An entity's speeds are whole pixels, not the 1/256 pixel of the player's body. Its
properties are not in the slot: read them from the data section by its number. The
behaviours keep their own copies, which some change as they run; those are not laid
out for tools.

Version 4 has the same slot, but leaves bytes 8 to 15 for the runtime's own use. From
version 5 only bytes 44 on, the behaviours, are the runtime's own.

### Which entities are live

A slot is in use when `built` and `alive` are both 1. A room's entities are built the
first time it becomes active, and kept after that, so the table also holds rooms the
player has left. The game runs only the entities of the active rooms:

1. the player's room, the block's `room`;
2. then each room touching it on the [world map](../guide/world-map), sharing an edge
   or a corner, by room number, up to 16 rooms in all.

A room that is not on the world map is active alone. Work out the touching rooms from
the rooms' places in the data section, and keep the slots whose `room` is one of
them. An entity that has been taken or destroyed has `alive` at 0, or is never built.

### Changing an entity

To change a live entity, write a field of its slot between frames: `x`, `y`, `vx`,
`vy`, `homeX`, `homeY`, `facesLeft` or `alive`. The game reads its table again each
frame, so it uses the new value on the next one. Write `alive` 0 to take the entity
out of the game. Check that the slot is live first: a write to a slot that is not
built, or whose entity is no longer alive, changes nothing the game uses.

A patrol sets `x` from `homeX` every frame, so an `x` written to a patrolling entity
is lost on the next frame. Move it by its home. Other fields of the slot, and the
behaviours' state, are not for tools to write.

## The player edit

Version 5. 20 bytes in RAM, five 32-bit words, all zero as built. The player's body
is a local of the game's `main`, which the compiler may keep in registers, so a write
to the copy in the block, or to the body itself, can be lost. A tool asks instead, and
the game takes the change once a frame with `debug::apply_player_edit`.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 4 | `set`: 1 while the request waits for the game | `u32` |
| 4 | 4 | `x`: left edge, in world pixels, as the body's | `i32` |
| 8 | 4 | `y`: top edge, in world pixels, as the body's | `i32` |
| 12 | 4 | `vx`: speed across, in 1/256 pixel per frame | `i32` |
| 16 | 4 | `vy`: speed down, in 1/256 pixel per frame | `i32` |

To send a change, between frames:

1. Read the player edit. If `set` is not 1, fill `x`, `y`, `vx` and `vy` from the
   block's player, so the values you do not change stay as they are.
2. Change the value or values you want.
3. Write `set` = 1.

On its next frame the game copies the four values into its body and writes `set` 0.
If `set` is still 1, the game has not taken the last request: change that request
instead of starting from the block, and both changes go in together. A game that does
not call `apply_player_edit` leaves `set` at 1 and its player as it was.

## The map file

After a build succeeds, from the **Build** panel, `pecten-studio build` or the MCP
`build` tool, the studio reads the record from the ROM and writes
`<rom>.debug.json` beside it, for example `dist/sample-dev.gba.debug.json`. The
build log says `debug map: dist/sample-dev.gba.debug.json`. The file is not
part of the project; leave it in the ignored `dist/` folder.

```json
{
  "rom": "dist/sample-dev.gba",
  "version": 5,
  "state": {
    "address": 33558220,
    "size": 64,
    "stamp": "PSGS",
    "fields": [
      { "name": "stamp", "offset": 0, "type": "u32" },
      { "name": "frame", "offset": 4, "type": "u32" },
      { "name": "room", "offset": 8, "type": "u32" },
      { "name": "cameraX", "offset": 12, "type": "i32" },
      { "name": "cameraY", "offset": 16, "type": "i32" },
      { "name": "player", "offset": 20, "type": "body" },
      { "name": "collected", "offset": 56, "type": "address" },
      { "name": "collectedWords", "offset": 60, "type": "u32" }
    ]
  },
  "body": {
    "size": 36,
    "fields": [
      { "name": "x", "offset": 0, "type": "i32" },
      { "name": "y", "offset": 4, "type": "i32" },
      { "name": "w", "offset": 8, "type": "i32" },
      { "name": "h", "offset": 12, "type": "i32" },
      { "name": "vx", "offset": 16, "type": "i32" },
      { "name": "vy", "offset": 20, "type": "i32" },
      { "name": "onGround", "offset": 32, "type": "bool" },
      { "name": "hitWall", "offset": 33, "type": "bool" },
      { "name": "hitCeiling", "offset": 34, "type": "bool" }
    ]
  },
  "collected": { "bitsPerWord": 32 },
  "dataSection": { "address": 134361432 },
  "inbox": {
    "address": 33558752,
    "size": 12,
    "fields": [
      { "name": "generation", "offset": 0, "type": "u32" },
      { "name": "changed", "offset": 4, "type": "u32" },
      { "name": "seen", "offset": 8, "type": "u32" }
    ]
  },
  "startOverride": {
    "address": 134380332,
    "size": 16,
    "fields": [
      { "name": "set", "offset": 0, "type": "u32" },
      { "name": "room", "offset": 4, "type": "u32" },
      { "name": "x", "offset": 8, "type": "i32" },
      { "name": "y", "offset": 12, "type": "i32" }
    ]
  },
  "entities": {
    "address": 33558784,
    "size": 12,
    "fields": [
      { "name": "address", "offset": 0, "type": "address" },
      { "name": "slots", "offset": 4, "type": "u32" },
      { "name": "slotSize", "offset": 8, "type": "u32" }
    ],
    "slot": {
      "size": 108,
      "fields": [
        { "name": "x", "offset": 0, "type": "i32" },
        { "name": "y", "offset": 4, "type": "i32" },
        { "name": "vx", "offset": 16, "type": "i32" },
        { "name": "vy", "offset": 20, "type": "i32" },
        { "name": "homeX", "offset": 8, "type": "i32" },
        { "name": "homeY", "offset": 12, "type": "i32" },
        { "name": "facesLeft", "offset": 24, "type": "bool" },
        { "name": "alive", "offset": 25, "type": "bool" },
        { "name": "hitboxX", "offset": 26, "type": "i16" },
        { "name": "hitboxY", "offset": 28, "type": "i16" },
        { "name": "hitboxW", "offset": 30, "type": "u16" },
        { "name": "hitboxH", "offset": 32, "type": "u16" },
        { "name": "kind", "offset": 36, "type": "u16" },
        { "name": "room", "offset": 38, "type": "u16" },
        { "name": "index", "offset": 40, "type": "u16" },
        { "name": "built", "offset": 42, "type": "bool" }
      ]
    }
  },
  "playerEdit": {
    "address": 33558764,
    "size": 20,
    "fields": [
      { "name": "set", "offset": 0, "type": "u32" },
      { "name": "x", "offset": 4, "type": "i32" },
      { "name": "y", "offset": 8, "type": "i32" },
      { "name": "vx", "offset": 12, "type": "i32" },
      { "name": "vy", "offset": 16, "type": "i32" }
    ]
  }
}
```

This is the sample's map; the addresses in yours will differ.

| Field | Holds |
| --- | --- |
| `rom` | The ROM the map is for, from the game folder. |
| `version` | The record's version, which is also the layout's. |
| `state` | The block's address and size in RAM, the stamp it carries once published, and its fields. |
| `body` | The layout of a field of type `body`. |
| `collected` | How the collected bits are packed. Their address is the block's `collected` field. |
| `dataSection` | Where the [data section](./data-section) starts in the GBA's memory map (the ROM is at `0x08000000`), or `null` if the game has none. |
| `inbox` | The inbox's address and size in RAM, and its fields, or `null` for a version 1 record. |
| `startOverride` | The start override's address in the GBA's memory map (in the ROM, so from `0x08000000`), its size and its fields, or `null` for a version 1 or 2 record. Offsets count from the start of the override. |
| `entities` | The [entity table](#the-entity-table)'s cell: its address and size in RAM and its fields, and `slot`, the size and fields of a slot. `null` for a record before version 4. |
| `playerEdit` | The [player edit](#the-player-edit)'s address and size in RAM, and its fields, or `null` for a record before version 5. |

Field types: `u32` and `i32` are 32-bit numbers, unsigned and signed; `u16` and
`i16` are 16-bit numbers, unsigned and signed; `bool` is one byte, 0 or 1; `address`
is a 32-bit address in the GBA's memory map; `body` is a body, laid out as `body`
says. Offsets count from the start of the part the fields belong to: the block, a
body, the inbox, the start override, the cell, a slot or the player edit. Positions are in world
pixels. The player's speeds are in 1/256 pixel per frame, as on the
[Physics](../guide/physics) tab; an entity's are in whole pixels per frame.

A build that fails or is stopped leaves the map as it was.

## Reading it from the emulator

1. Build the game, and read `state.address` from the map.
2. While the game runs, read `state.size` bytes at that address from the
   emulator's memory (its memory viewer, a script, or a save state's copy of
   EWRAM).
3. Check that the first four bytes are `PSGS`. If they are zeros, the game has not
   published yet; read again a frame later.
4. Read each field at its offset, little-endian, by its type.

Read between frames: the game writes the whole block once a frame, after it has
moved everything, so a block read in the middle of that copy can mix two frames.

For the entities, read the cell at `entities.address` once the block carries its
stamp, then the slots it points at, each frame, as [above](#the-entity-table).

The map and the ROM go together. After every build, read the map again: the
addresses can move.

## Release builds

The block, the inbox, the entity table's cell, the player edit, the record and the copy are only in builds with debug assertions, which
Cargo's dev profile has and its release profile does not. In a release build
`debug::publish`, `debug::show_entities` and `debug::apply_player_edit` do nothing, `Live::poll` always returns `None`, and the ROM has
no record, so the Play panel restarts the game on every change. The build then writes no
map, removes an old one, and logs
`no debug map: dist/sample.gba has no debug record (release builds leave it out)`.
The same happens for a game that never calls `debug::publish`.

To keep the map in a release build, turn on the runtime's `debug-map` feature in
the game's `Cargo.toml`:

```toml
pecten_studio_rt = { path = "../runtime", features = ["agb", "debug-map"] }
```

## What it costs

In a build with the map: 64 bytes of EWRAM (of 256 KB) for the block, 12 for the
inbox, 12 for the entity table's cell and 20 for the player edit; 60 bytes of ROM for
the record and a few dozen for the copy, the poll, filling the cell and taking a
player edit; and 16 word writes and two reads a frame, under 100 of the frame's
280,896 cycles. A frame that takes a player edit reads five more words. Changing an
entity costs the game nothing: the tool writes the slot. The cell is written once, when the
game takes its table, so it costs no time a frame. The table itself is the game's
own, with or without the map: a slot is 108 bytes either way. A
change taken live costs more on the frame it arrives: the game makes its `World`
again, and for tiles draws every tile in view, which on the sample skips about two
frames. IWRAM and video memory are not used. In a release
build it costs nothing.

## Versions

The version in the record says which layout the block has. It goes up when the
block, the body or a part the record points at changes, and the map file's
`version` with it. Version 2 added the inbox, version 3 the start override, which
costs 16 bytes of ROM, and version 4 the entity table, which costs 8 more bytes of
ROM and 12 of EWRAM; the block did not change. Version 5 added the player edit, which
costs 8 more bytes of ROM and 20 of EWRAM, and the slot's home (`homeX` and `homeY`,
bytes the slot already had). Each new part comes after the last, so the offsets of
older records stay where they were.
The studio still reads versions 1 to 4. A version 4 game has no player edit, so the
Entities list can change its entities' `x`, `y`, `vx`, `vy`, `facesLeft` and `alive`
but asks for a new build to change the player, and shows no home. Versions 1 to 3
have no entity table, so the Play panel's Entities list shows only the player and
asks for a new build. A game built
before version 2 restarts on each change instead of taking it live. A version 2 game
has no start override, so **Play from here** asks for a new build. A studio refuses a record with a version it does not
read, or a size that does not match its version, and the build log says to bring
the studio and the game's runtime to the same version. A tool should check the
version before it reads the block.
