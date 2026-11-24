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
- Collision classes have a kind (`empty`, `solid`, `one-way`, `slope`, `hazard`, `custom`) and, for slopes, the floor height at the tile's left and right edge. What `hazard` and `custom` mean is up to the game.
- An entity is a type, a position in pixels from the room's top-left, and the properties its type defines (integer, boolean, text or one of a list). The entity's `props` hold only the values that differ from its type's; a property it does not list has the type's value, so changing the type's default changes every entity that kept it. A stored value equal to the type's is allowed and builds the same. See [Values set on one entity](../guide/rooms#entity-overrides).
- An entity type may have `behaviours`: a list of `{ "id": "patrol", "props": { "patrol": 48 } }`, each a behaviour from the runtime's library with the type's values for its properties. Values left out take the behaviour's default. A placed entity overrides one with a property of the same name in its own `props`. An entity has a behaviour only when its type lists it: a property of the type's own with a behaviour's property name, such as `value`, does not give it one. A type has at most 4; more is a problem in the Problems panel and the build, since the game keeps room for 4 on every entity. Left out, the list is empty, so older projects load as they were. [Project settings](../guide/project-settings#behaviours) edits them and leaves out a value equal to the default; the [room panel](../guide/rooms#entity-overrides) leaves out an entity's value equal to its type's. See [Behaviours](../guide/making-a-game#behaviours) for the behaviours, their properties and the problems reported.
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
  "props": [{ "name": "armour", "type": "int", "default": 1 }],
  "behaviours": [
    { "id": "patrol", "props": { "patrol": 32 } },
    { "id": "hazard" }
  ]
}
```

```json
{ "type": "sentry-bot", "x": 120, "y": 136, "props": { "patrol": 64 } }
```

A track in `audio.json`:

```json
{ "id": "title", "name": "Title", "file": "assets/audio/title.xm", "format": "xm" }
```

## Source of truth

Your PNG, MIDI, tracker and WAV files stay the source of truth. The studio reads and watches them and rewrites a PNG only when you draw on it in the [pixel editor](../guide/pixel-editor).
