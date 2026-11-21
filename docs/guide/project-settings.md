# Project settings

Open **Project settings** in the Project panel.

![Project settings with build commands, the level data reserve and entity types](/screenshots/project-settings.png)

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

An entity is a thing placed in a room: a player start, an enemy, a pickup. Its *type* is defined here, and each row has:

- a **colour**, used on the map when the type has no sprite;
- a **name**;
- a **sprite**, or "No sprite";
- a bin to delete the type.

Use the **+** at the end of the list to add a type. Types can be added, renamed, recoloured and given a sprite here. Their typed properties (integer, boolean, text or one of a list), their [behaviours](./making-a-game#giving-a-type-its-behaviours) and the project's collision classes are defined in `studio/project.json`, not yet in the interface; see the [project format](../reference/project-format).

### Adding a collectible

A collectible is an entity type with a sprite that lists the `collectible` [behaviour](./making-a-game#giving-a-type-its-behaviours), with its `value`. To add another kind (a ruby, a key): import its PNG as a [sprite](./sprites), add the entity type here, and give it the behaviour in `studio/project.json`, under the type's `behaviours`:

```json
"behaviours": [{ "id": "collectible", "props": { "value": 10 } }]
```

Then place it in rooms with the entities tool. No Rust changes are needed in the sample game, which takes any entity whose type lists `collectible` when the hero touches it. An enemy is made the same way: the sample's sentry bot lists `patrol` and `hazard`. A property of the type's own named `value` does not make it a collectible. The studio has no panel for behaviours yet, so they are edited in `studio/project.json`.
