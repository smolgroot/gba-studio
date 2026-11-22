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
- its **behaviours**, by name ("Patrol, Hazard"), or "No behaviours": click them to open the type's behaviours below the row;
- a bin to delete the type.

Use **Add entity type** at the end of the list to add a type. Types can be added, renamed, recoloured, given a sprite and given behaviours here. Their typed properties of their own (integer, boolean, text or one of a list) and the project's collision classes are defined in `studio/project.json`, not yet in the interface; see the [project format](../reference/project-format).

### Behaviours {#behaviours}

A behaviour is something an entity does that the runtime already knows how to do: patrol, hurt the player, be collected, open as a door. The list of behaviours and their properties is in [Behaviours](./making-a-game#the-behaviours).

![Project settings with the sentry bot's behaviours open: patrol and hazard, each with its form](/screenshots/entity-behaviours.png)

Click a type's behaviours to open them. Each behaviour is a card with its name, what it does, and a field for each of its properties:

- Each field is a whole number in the range the behaviour allows. Type a value and press `Enter` or leave the field; a value outside the range is brought to its nearest end.
- The field shows the behaviour's default until you change it. A value equal to the default is not written to `project.json`, so the type follows the default if it changes.
- A property with no default, such as `grants_ability` of **Ability pickup**, is empty and says **Required: 0 to 31**. A value outside the range is refused, with the reason under the field. The type, or every placed entity of it, must set it; until then the [Problems panel](./interface#problems) lists it.
- **Run earlier** and **Run later** (the arrows) change the order the game runs the type's behaviours in. Put **Hazard** after the behaviour that moves the entity, so it hurts where the entity is now.
- The bin removes the behaviour from the type.

**Add a behaviour…** below the cards lists the behaviours the type does not have, each with what it does. Pick one to add it at the end. A behaviour that shares a property with one the type has is listed but cannot be picked, with the reason, for example "Projectile (shares shot_speed with Shooter)": a type can have only one of them, so give shots a type of their own. A type has at most 4 behaviours: once it has 4, every behaviour is listed but cannot be picked, with "the type has 4, the most it can have". The game keeps room for 4 behaviours on every entity while it runs, so each one more would cost every entity memory.

Every change is one undo step. A placed entity can set its own value for a behaviour's property; see [Entities](./rooms#entities).

### Making an enemy

An enemy needs no Rust in the sample game, because its loop runs every behaviour each entity's type lists (see [In the frame loop](./making-a-game#in-the-frame-loop)):

1. Import the enemy's PNG as a [sprite](./sprites).
2. Add an entity type here and give it the sprite.
3. Open its behaviours and add **Patrol**, then **Hazard**. Set `patrol` to how far it walks each way, in pixels.
4. Place it in a room with the entities tool, and build.

It walks back and forth where it was placed, and sends the hero back when they touch. The sample's sentry bot is made this way.

### Adding a collectible

A collectible is an entity type with a sprite and the **Collectible** behaviour, with its `value`. To add another kind (a ruby, a key): import its PNG as a [sprite](./sprites), add the entity type here, add **Collectible** to its behaviours and set its `value`. Then place it in rooms with the entities tool. The sample game takes any entity whose type has **Collectible** when the hero touches it. A property of the type's own named `value` does not make it a collectible.
