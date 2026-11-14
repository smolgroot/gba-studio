# Project format

Plain JSON files in the game's repository, laid out to diff well in git. The schemas in [`core/src/schema.ts`](https://github.com/smolgroot/gba-studio/blob/main/core/src/schema.ts) are the reference, and `gba-studio schema` prints them as JSON Schema.

```
studio/project.json         name, build commands, collision classes, entity types
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
- Collision classes have a kind (`empty`, `solid`, `one-way`, `slope`, `hazard`, `custom`) and, for slopes, the floor height at the tile's left and right edge. What `hazard` and `custom` mean is up to the game.
- An entity is a type, a position in pixels from the room's top-left, and the properties its type defines (integer, boolean, text or one of a list).
- Ids are lowercase letters, digits, `-` and `_`, and are also the file names.

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

A track in `audio.json`:

```json
{ "id": "title", "name": "Title", "file": "assets/audio/title.xm", "format": "xm" }
```

## Source of truth

Your PNG, MIDI, tracker and WAV files stay the source of truth. The studio reads and watches them and rewrites a PNG only when you draw on it in the [pixel editor](../guide/pixel-editor).
