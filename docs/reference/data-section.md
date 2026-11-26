# Data section

A built game keeps its level data in one block of the ROM, the data section: rooms,
their tile layers and collision cells, entities and their properties, the behaviours
of each entity type, where rooms sit on the world map, the start room and the
physics. The game reads all of it from there when it starts. Graphics (tile and
picture pixels, palettes, sprites) and audio are compiled into the game and are not
in the section; the section refers to them by number.

Because the layout is fixed and versioned, a tool can find the section in a `.gba`
file and replace it without compiling the game, as long as the new data fits. The
studio does this when you edit while the game runs, and with `pecten-studio patch`
(see [Build and Play](../guide/build-and-play)).

This page is for tools that read or write the section. A game does not need it: it
calls `data::world()` and uses the runtime's `World`.

## Finding it

The section starts with the 8 bytes `PECTDATA`, on a 4-byte boundary, once in the
ROM. Search the file for them.

## Room to grow

After the data come zero bytes up to the section's capacity. A replacement section
can be as large as the capacity. The reserve is set by `build.dataReserve` in
`studio/project.json`, in bytes, from 0 to 1 MiB, or with **Level data reserve** in
[Project settings](../guide/project-settings#level-data-reserve). Left out, it is a
quarter of the data, rounded up to a KiB, and at least 4 KiB. The studio's
[Build panel](../guide/build-and-play#level-data-use) shows the bytes used and the
capacity of each built ROM, read from the header below.

The game also has a fixed list of entity types, tilesets, background pictures and
tracks, and the ids of rooms and collision classes become names in its code. The
section's manifest records them, so a tool can tell when a new section no longer
fits the game and it must be rebuilt. A section that names more than the game was
built with is refused when the game starts.

A game sizes what it remembers about entities (`Collected`) with
`data::ENTITY_SLOTS`, the number of entities the capacity could hold, so entities
added by a patch are remembered too.

## Layout

Version 1. All numbers are little-endian. Offsets in the header's table count from
the start of the section; offsets inside records count from the start of the part
they point into. Every part starts on a 4-byte boundary.

### Header

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | `PECTDATA` |
| 8 | 2 | Layout version: 1. A game refuses any other. |
| 10 | 2 | Entries in the table: 9. A section written before behaviours had their part has 8, and reads as having no behaviours. A later version may add parts after these; a reader skips those it does not know. |
| 12 | 4 | Bytes used, header included. |
| 16 | 4 | Capacity: bytes the section takes in the ROM, at least the bytes used. |
| 20 | 8 each | The table: `{ offset u32, length u32 }` for each part below, in this order. |

| Part | Holds |
| --- | --- |
| 0 strings | UTF-8 text, each string once. A string elsewhere is `{ offset u32, length u32 }` into this part. |
| 1 classes | Collision classes, 12 bytes each. |
| 2 rooms | Rooms, 64 bytes each, in project order. |
| 3 entities | Entities, 12 bytes each, room after room. |
| 4 props | Entity properties, 20 bytes each. |
| 5 cells | Collision cells and tile layer cells. |
| 6 globals | The start room, the entity count and the physics, 92 bytes. |
| 7 manifest | What the game compiled from the project. The game does not read it. |
| 8 behaviours | Which behaviours each entity type has, and where their properties start. |

### Collision class

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | Id (string) |
| 8 | 1 | Kind: 0 empty, 1 solid, 2 one-way, 3 slope, 4 hazard, 5 custom |
| 9 | 1 | Slope height at the left edge, 0 to 8 |
| 10 | 1 | Slope height at the right edge, 0 to 8 |
| 11 | 1 | 0 |

A cell's class is its index in this list. There is at least one class and at most 255, the most a build accepts.

### Room

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | Id (string) |
| 8 | 8 | Name (string) |
| 16 | 2 | Width in tiles, a multiple of 30 |
| 18 | 2 | Height in tiles, a multiple of 20 |
| 20 | 2 | Left screen on the world map (signed) |
| 22 | 2 | Top screen on the world map (signed) |
| 24 | 2 | Flags: 1 on the map, 2 has music, bits 2 to 4 tile layers dimmed (back layer first), bits 5 and 6 backgrounds dimmed, bits 8 to 12 the dim level, 0 to 16. Data written before dimming has zeros here, which is no dimming. |
| 26 | 2 | Track number, if it has music |
| 28 | 2 | Tileset number |
| 30 | 1 | Tile layers, 0 to 3 |
| 31 | 1 | Background layers, 0 to 2 |
| 32 | 4 | Offset of its collision cells in the cells part: one byte per cell, the class index, row by row |
| 36 | 4 | Offset of its tile layers in the cells part, even: each layer is one `u16` per cell, row by row, back layer first. 0 is empty, n is tile n-1 of the tileset. |
| 40 | 4 | Number of its first entity in the entities part. Rooms' entities follow each other in room order, so this is also the count of entities in the rooms before. |
| 44 | 4 | Number of entities |
| 48 | 8 | First background layer |
| 56 | 8 | Second background layer |

A background layer is a picture number (`u16`), then how far it scrolls for every 256
pixels the camera moves, across and down (`u16` each, 0 to 256), then two zero
bytes. Unused layers are zeros.

The map position, music and backgrounds are ignored when the flags or counts say
the room has none.

### Entity

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 2 | Entity type number |
| 2 | 2 | x in pixels from the room's left (signed) |
| 4 | 2 | y in pixels from the room's top (signed) |
| 6 | 2 | Number of properties |
| 8 | 4 | Number of its first property in the props part |

An entity has every property its type defines, defaults filled in. Then come the
properties of each behaviour its type lists, behaviour after behaviour in the type's
order, and each behaviour's in the order the behaviour declares them. Each has the
placed entity's value, else the type's, else the behaviour's default. They have
their names, like the type's own, but the game reads them by position: the
[behaviours](#behaviours) part says where each behaviour's start.

### Property

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | Name (string) |
| 8 | 1 | Type: 0 integer, 1 boolean, 2 text |
| 9 | 3 | 0 |
| 12 | 4 | Integer (signed), boolean (0 or 1), or for text the offset of the string |
| 16 | 4 | For text, the string's length; otherwise 0 |

A property that is one of a list is written as text, its value. The list's options and an integer's smallest and largest are for the studio and are not written.

A reference to another entity is written as an integer: the number of the entity it points at, as `World::entity_index` counts them (rooms in id order, then each room's entities in order, from 0), or -1 for none. The game reads it with `Entity::reference`, which gives that number, or `None` for -1, and `LiveEntities::get` takes the number. Entity ids are for the studio and are not written. Because a reference is an integer, the layout did not change for it, and a ROM built before references existed can be patched with a project that has them.

### Globals

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 2 | Start room number, or `0xFFFF` for none |
| 2 | 2 | 0 |
| 4 | 4 | Number of entities, which must match the entities part |
| 8 | 84 | Physics: 21 signed 32-bit numbers |

The physics numbers, in order, in the units of the [Physics](../guide/physics) tab
(speeds in 1/256 pixel per frame):

| # | Field | # | Field |
| --- | --- | --- | --- |
| 0 | mode: 0 platformer, 1 top-down | 11 | coyote frames, 0 to 255 |
| 1 | gravity | 12 | jump buffer frames, 0 to 255 |
| 2 | fall gravity | 13 | top-down movement: 0 free, 1 grid |
| 3 | max fall speed | 14 | top-down speed |
| 4 | run speed | 15 | top-down acceleration |
| 5 | ground acceleration | 16 | top-down friction |
| 6 | ground friction | 17 | directions, 4 or 8 |
| 7 | air acceleration | 18 | normalise diagonals: 0 or 1 |
| 8 | jump speed | 19 | corner slide |
| 9 | jump cut | 20 | grid size |
| 10 | air jumps, 0 to 255 | | |

### Manifest

Four counts (`u32` each): entity types, tilesets, pictures, tracks. Then, in that
order:

| Record | Size | Fields |
| --- | --- | --- |
| Entity type | 16 | id (string), sprite id (string, empty for none) |
| Tileset | 16 | id (string), tiles (`u32`), palettes (`u32`) |
| Picture | 16 | file path (string), distinct tiles (`u32`), palettes (`u32`) |
| Track | 8 | id (string) |

After the tracks, one `u32`: how many entities the game's table of live entities
holds (`data::LIVE_ENTITIES`). A manifest that ends after the tracks was written by
an older build: the number is not known, and a tool does not check it. The layout
version is still 1.

Tilesets and pictures are in the order the rooms number them: tilesets by id,
pictures by path. The tile and palette counts let a tool check the GBA's video
memory limits for a room without converting the pictures again.

A new section can replace the old one without a build while the project's entity
types (and their sprites), collision class ids, room ids, tilesets and their tile
counts, background pictures and tracks are the same as these, in the same order,
and while the project has no more entities than the game's table holds.

### Behaviours

All in `u16` halfwords:

| Halfwords | Field |
| --- | --- |
| 2 | Number of entity types, low half first |
| 2 each | For each entity type, by number: its first entry, counted from the first entry, and its number of entries |
| 2 each | The entries: `{ behaviour number, position of its first property }` |

A type's entries are its behaviours in the order the type lists them. The behaviour
number is the one the runtime declares (`pecten-studio schema` gives it under
`behaviours`): 0 patrol, 1 collectible, 2 hazard, 3 projectile, 4 shooter, 5 moving
platform, 6 door, 7 checkpoint, 8 ability pickup, 9 spawner. The position counts
from the entity's first property, and the behaviour's properties follow it in the
order it declares them, the same for every entity of the type. A type with no
behaviours has a count of 0, as does a type past the number of types here. An entity
whose position is past its own number of properties fails the check below.

## What the game checks

When it starts, the game checks the whole section before using it: the header, that
every part and every record lies inside the data, that strings are UTF-8, that every
cell names a class that exists, that every entity has the properties its type's
behaviours start at, and that tilesets, pictures, tracks and entity types
are ones the game was built with. A section that fails stops the game with a message
saying to rebuild it. Once checked, the section is read in place and nothing is
copied into RAM.
