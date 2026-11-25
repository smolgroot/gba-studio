# Project settings

Open **Project settings** in the Project panel. It has the project's name, its build commands, its [collision classes](#collision-classes) and a link to the [Entities page](./entities), where the entity types are.

![Project settings with the project name, build commands, the level data reserve and a link to the Entities page](/screenshots/project-settings.png)

## Project and build

| Field | Meaning |
| --- | --- |
| **Name** | The project name shown in the top bar. |
| **Dev build command** | The shell command that makes the dev ROM, run by **Build dev**. |
| **Dev ROM** | Where that command writes the ROM, relative to the game folder. |
| **Release build command** | The command for **Build release**. |
| **Release ROM** | Where the release ROM is written. |
| **Level data reserve** | Bytes kept free after the level data in a built ROM. Leave it empty for the default. See below. |

The Play panel plays the ROM named here once it exists. See [Build and Play](./build-and-play).

### Level data reserve {#level-data-reserve}

A built ROM holds the level data in one [data section](../reference/data-section), with room to grow after it. While a change still fits in that room, the studio can [patch it into the ROM](./build-and-play#patch-on-change) without a build. When it no longer fits, only a build brings it in.

**Level data reserve** is how much room, in bytes. Left empty, the field shows the default: a quarter of the data, rounded up to a KiB, and at least 4 KiB. Type a whole number from 0 to 1048576 (1 MiB) and press `Enter` or leave the field. Anything else, such as a negative or fractional number, is refused: the field says so below it and keeps the old value. Clear the field to go back to the default; `build.dataReserve` is then removed from `studio/project.json`.

The reserve takes effect at the next build. A larger reserve makes the ROM a little larger. The **Build** panel shows how much of the room each built ROM uses; see [Build panel](./build-and-play#level-data-use).

## Entity types {#entity-types}

Entity types, their properties and their behaviours are on the [Entities page](./entities). Under **Entity types**, Project settings has one line with **Open Entities**, which opens it.

The sections below used to be on this page. They have moved:

### Properties {#properties}

See [Properties](./entities#properties) on the Entities page.

#### Entities that store a value {#property-placed}

See [Entities that store a value](./entities#property-placed).

#### Values that do not fit {#property-misfit}

See [Values that do not fit](./entities#property-misfit).

### Behaviours {#behaviours}

See [Behaviours](./entities#behaviours) on the Entities page.

### Making an enemy {#making-an-enemy}

See [Making an enemy](./entities#making-an-enemy).

### Adding a collectible {#adding-a-collectible}

See [Adding a collectible](./entities#adding-a-collectible).

## Collision classes {#collision-classes}

A collision class says how a tile, or a cell of a room, acts: solid, a one-way platform, a slope, a hazard. Tiles get a class in their [tileset](./tilesets#paint-collision), and a room can [paint over them](./rooms#collision). The classes themselves are listed here, one row each.

![Project settings with the collision classes as a table: colour, name, id, kind and, for slopes, the floor height at each edge](/screenshots/collision-classes.png)

Each row has:

- a **colour**: click the swatch to change it. The tileset editor outlines tiles of the class in it, and the room editor tints cells of the class in it;
- a **name**;
- an **Id**, which is how tilesets name the class; see [The id](#class-id);
- a **Kind**: Empty, Solid, One-way, Slope, Hazard or Custom. What Hazard and Custom do is up to the game's code;
- for a slope, two numbers: how high the floor is, in pixels, at the tile's left edge and at its right edge. A tile is 8 pixels high, so the numbers go from 0 (the bottom of the tile) to 8 (the top). A new slope starts at 0 and 8, a 45 degree rise. A number outside 0 to 8 is brought to the nearest end. Changing the kind away from Slope drops the numbers;
- a bin to delete the class.

**Add collision class** below the table adds a class at the end. It has the id `class` (or `class-2`, `class-3` and so on if that is taken), the name "New class" and the kind Solid; change them in its row. A game can have at most 255 collision classes, so the button is disabled when there are 255.

Each edit of a name, colour, kind or number, each added class and each class deleted that nothing uses is one undo step on the project. Use the undo buttons at the top of the page. Deleting a class that is used, and changing an id, reach other documents; see [Undo across documents](#class-undo).

### The order of the classes {#class-order}

Classes cannot be moved. The first class is the one a tile with no class of its own has, and a room paints collision with a class by its place in the list, so moving a class would change what rooms already painted. New classes go at the end.

The first class cannot be deleted: its bin is disabled, and hovering over it says to change its kind or colour instead.

### The id {#class-id}

The id is how a tileset names the class, and it becomes a constant in the game's code: `data::class::SOLID` for `solid`. Editing it changes the tilesets that name the class, in the same undo step. The studio refuses an id, and says why under the row, when it:

- is not valid: lowercase letters, digits, `-` and `_`, up to 48;
- is already another class's;
- would be the same name in code as another class's. `wall-top` and `wall_top` are both `WALL_TOP`.

Rust code in your game that names the old constant must be changed to the new one.

### Deleting a class {#deleting-a-class}

The bin on a row deletes the class. A class that nothing uses is deleted at once. If tilesets or rooms use it, the studio asks first and lists them: for each tileset, how many tiles have the class, and for each room, how many cells have it, and how many of those were painted over their tile in the room's Collision layer ("Room Entry: 4 cells, 1 painted").

![The question asked before deleting a collision class that tilesets and rooms use, listing them](/screenshots/collision-delete.png)

The question says what happens to what uses the class:

- its tiles have the first class instead;
- cells painted with it follow their tile again;
- cells painted with a class later in the list are renumbered and stay as they are.

**Delete class** confirms it. **Cancel** keeps the class.

### Undo across documents {#class-undo}

Deleting a class that is used, and changing an id, change tilesets and rooms along with the project. So does a property change on the Entities page that reaches placed entities (see [Entities that store a value](./entities#property-placed)). They are one undo step for the project: the undo buttons at the top of Project settings put the project, the tilesets and the rooms all back, and redo does it all again.

If one of those tilesets or rooms was changed after, the undo does nothing, and Project settings says why at the top of the page, for example: "Not undone: Entry was changed after the class “Hazard” was deleted. Undo that change first." For a property changed on the Entities page, the notice is at the top of that page and reads "Not undone: Entry was changed after the property “shield” was changed." Undo the change in that document, then undo here. Redo says "Not redone" in the same way.

### Builds {#class-builds}

The class list is compiled into the game, so adding a class, deleting one or changing an id needs a build: the Play panel says "Needs a build" (see [Patch on change](./build-and-play#patch-on-change)). A change to a class's kind or slope numbers is level data and is patched in without one. A class's name and colour are only for the studio.
