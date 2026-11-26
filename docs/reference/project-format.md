# Project format

Plain JSON files in the game's repository, laid out to diff well in git. The schemas in [`core/src/schema.ts`](https://github.com/smolgroot/pecten-studio/blob/main/core/src/schema.ts) are the reference, and `pecten-studio schema` prints them as JSON Schema, with the properties of each behaviour under `behaviours`.

```
studio/project.json         name, build commands, collision classes, entity types, physics
studio/world.json           where each room sits on the world grid, in screens
studio/audio.json           music tracks (MIDI + SF2, XM, MOD) and sound effects
studio/tilesets/<id>.json   a PNG of 8x8 tiles and each tile's collision class
studio/sprites/<id>.json    a sprite sheet: frame size, anchor, hitbox, animations
studio/rooms/<id>.json      size in screens, up to 3 tile layers, up to 2 backgrounds, entities, music
```

## Rules

- A screen is 240x160 pixels, or 30x20 tiles. Rooms are 1 to 32 screens a side.
- The world map may have a `size` in screens, counted from screen (0, 0).
- Tile layers are run-length pairs `[count, cell, ...]`, row by row. Cell 0 is empty and cell n is tile n-1 of the room's tileset.
- A room's `backgrounds`, back to front, are each `{ "image": "assets/backgrounds/sky.png", "parallax": { "x": 25, "y": 0 } }`: a PNG whose size is a multiple of 8, and its scroll speed in percent of the camera's.
- A tile layer and a background may have `"dim": true`, and a room may have `"dimLevel"`, a whole number from 0 (no change, the default) to 16 (black). Layers with `dim` are darkened by the room's level; the others and sprites are not. Left out, nothing is dimmed, so older projects load as they were.
- Collision classes have a kind (`empty`, `solid`, `one-way`, `slope`, `hazard`, `custom`) and, for slopes, the floor height at the tile's left and right edge. What `hazard` and `custom` mean is up to the game. A tileset names a class by its `id`. A room's painted `collision` refers to a class by its place in the `collisionClasses` list, plus one (0 follows the tile), so the order matters; [Project settings](../guide/project-settings#collision-classes) keeps it right when a class is deleted.
- An entity is a type, a position in pixels from the room's top-left, and the properties its type defines (integer, boolean, text, one of a list, or another entity). It may have an `id`, which other entities' references name it by (see below). The entity's `props` hold only the values that differ from its type's; a property it does not list has the type's value, so changing the type's default changes every entity that kept it. A stored value equal to the type's is allowed and builds the same. See [Values set on one entity](../guide/rooms#entity-overrides).
- An entity type's `props` define its own properties, such as `{ "name": "shield", "type": "int", "default": 3, "min": 0, "max": 9 }`. The `name` is lowercase letters, digits and `_`, starting with a letter, and is not the name of a property of one of the type's behaviours. The `type` is `int`, `bool`, `string`, `enum` or `ref`, and the `default` is a value of that type. An `enum` has `options`, at least one, and its default is one of them; no other type has `options`. An `int` may have `min` and `max`, whole numbers that fit in 32 bits (-2147483648 to 2147483647), with `min` not over `max` and the default between them; no other type has them. Left out, an int is any whole number that fits in 32 bits. `min` and `max` were added without a new format version, which is still 1: older projects have neither and load as they were. A studio from before them drops them when it saves the project. A value a placed entity stores must fit its property; the Problems panel reports one that does not as an error in the room, and an int default past 32 bits as an error in `project.json`. The build does not check these values yet, and the game does not know `min` and `max`. The [Entities page](../guide/entities#properties) edits the properties.
- A `ref` property points at another placed entity, in the same room or another: `{ "name": "opens", "type": "ref", "default": "", "types": ["door"] }`. Its `default` is always `""`, none: each placed entity sets its own. `types`, optional and at least one, are the entity type ids it may point at; left out, it may point at any type. No other type has `types`. A placed entity's value is the `id` of the entity it points at, or `""` for none. An entity's `id` is an id like any other (lowercase letters, digits, `-` and `_`, at most 48) and names one entity in the whole project. The studio gives an entity an id, such as `door-1`, when something first points at it; entities nothing points at have none. The Problems panel and the build report, as errors, a reference to an id no entity has (the entity was deleted, or its id changed), a reference to an entity of a type it may not point at, an id two entities have, and a `types` entry naming a type the project does not have. The game gets a reference as the number of the entity it points at: see [Data section](./data-section#property). `ref`, `types` and `id` were added without a new format version, which is still 1: older projects have none of them and load as they were. A studio from before them cannot open a project with a `ref` property, and drops entity ids when it saves a room. See [References between entities](../guide/rooms#entity-references).
- An entity type may have `behaviours`: a list of `{ "id": "patrol", "props": { "patrol": 48 } }`, each a behaviour from the runtime's library with the type's values for its properties. Values left out take the behaviour's default. A placed entity overrides one with a property of the same name in its own `props`. An entity has a behaviour only when its type lists it: a property of the type's own with a behaviour's property name, such as `value`, does not give it one. A type has at most 4; more is a problem in the Problems panel and the build, since the game keeps room for 4 on every entity. Left out, the list is empty, so older projects load as they were. The [Entities page](../guide/entities#behaviours) edits them and leaves out a value equal to the default; the [room panel](../guide/rooms#entity-overrides) leaves out an entity's value equal to its type's. See [Behaviours](../guide/making-a-game#behaviours) for the behaviours, their properties and the problems reported.
- `physics` in `project.json` holds the game type and how it moves. Left out, it is the default platformer. See [Physics](../guide/physics).
- Ids are lowercase letters, digits, `-` and `_`, and are also the file names.
- `build.dataReserve` in `project.json`, optional, is how many bytes the ROM keeps free after the level data, so that a slightly larger project can replace it without a build. See [Data section](./data-section).

## Examples

A collision class and the build section of `project.json`:

```json
{
  "version": 1,
  "name": "Diamond Hands",
  "build": {
    "dev": "mkdir -p dist && cargo build && agb-gbafix target/thumbv4t-none-eabi/debug/game -o dist/game-dev.gba",
    "devRom": "dist/game-dev.gba"
  },
  "collisionClasses": [
    { "id": "solid", "name": "Solid", "colour": "#e5484d", "kind": "solid" },
    { "id": "slope-up", "name": "Slope up 45°", "colour": "#46a758", "kind": "slope", "slope": { "left": 0, "right": 8 } }
  ]
}
```

`world.json`:

```json
{
  "version": 1,
  "rooms": [
    { "room": "badlands", "x": 0, "y": 0 },
    { "room": "trenches", "x": 0, "y": 4 }
  ],
  "start": "badlands",
  "size": { "width": 10, "height": 9 }
}
```

An entity type in `project.json` with an own property and two behaviours, and a placed sentry bot in a room that walks further than the others:

```json
{
  "id": "sentry-bot",
  "name": "Sentry bot",
  "colour": "#e5484d",
  "sprite": "sentry-bot",
  "props": [{ "name": "armour", "type": "int", "default": 1, "min": 0, "max": 5 }],
  "behaviours": [
    { "id": "patrol", "props": { "patrol": 32 } },
    { "id": "hazard" }
  ]
}
```

```json
{ "type": "sentry-bot", "x": 120, "y": 136, "props": { "patrol": 64 } }
```

A switch type whose `opens` points at a door, and a placed switch pointing at the door with the id `door-1`, which may be in another room:

```json
{
  "id": "switch",
  "name": "Switch",
  "colour": "#f5d90a",
  "props": [{ "name": "opens", "type": "ref", "default": "", "types": ["door"] }]
}
```

```json
{ "type": "switch", "x": 40, "y": 136, "props": { "opens": "door-1" } }
{ "type": "door", "id": "door-1", "x": 200, "y": 136 }
```

A track in `audio.json`:

```json
{ "id": "title", "name": "Title", "file": "assets/audio/title.xm", "format": "xm" }
```

## Source of truth

Your PNG, MIDI, tracker and WAV files stay the source of truth. The studio reads and watches them and rewrites a PNG only when you draw on it in the [pixel editor](../guide/pixel-editor).
