# Entities

An entity is a thing placed in a room: a player start, an enemy, a pickup. Its *type* says what it looks like, which properties it carries and what it does. The types are on the **Entities** page.

Open it from the **Entity types** section of the Project panel, after Sprites: click a type to open the page on that type, or **+** to add one. The section's icon in the [activity bar](./interface#the-activity-bar) shows the number of types and opens the section. Each row in the section shows a small picture of the type's sprite, its name, and its behaviours and number of properties.

![The Entities page: the entity types listed with their sprites, behaviours and how many are placed, and the sentry bot shown with its properties, behaviours and the rooms that place it](/screenshots/entities.png)

The selected type is part of the address, `#entities:sentry-bot`, so a reload, the back button or a pasted link opens the same type. An address with a type that no longer exists opens the page on the first type.

The page edits `studio/project.json`, as Project settings and Physics do. While it is open, the **Properties** panel shows how many types there are and how many entities are placed in all.

## The list of types {#the-list}

The types are listed on the left. **Add entity type** at the top adds a type called "New entity", selects it and puts the cursor in its name, so you can type the name straight away.

Each row shows:

- the first frame of the type's sprite, or a square in the type's colour when it has no sprite;
- its **name**;
- its **behaviours**, by name ("Patrol, Hazard"), or "No behaviours", then how many properties of its own it has ("Patrol, Hazard · 4 properties"). Hover it to read the whole line when it is cut short;
- how many entities of the type are placed in rooms.

Click a row to select it. With the list focused, `Up` and `Down` move the selection, and `Home` and `End` go to the first and last type.

On a narrow page the list sits above the selected type instead of beside it.

## An entity type {#entity-types}

The selected type is shown on the right. At the top is a large picture of its sprite's first frame, at the largest whole scale that fits, so its pixels stay square. Beside it:

- the type's name, its **Id** and how many are placed: "3 placed in 2 rooms", or "not placed yet";
- **Name**;
- **Colour**: click the swatch to change it. The map uses it when the type has no sprite, and lists use it beside the name;
- **Sprite**: one of the project's [sprites](./sprites), or "No sprite";
- **Delete**, which deletes the type; see [Deleting a type](#deleting-a-type).

Under them are the type's [Properties](#properties) and [Behaviours](#behaviours). When the page is wide enough they sit side by side; when it is not, the behaviours go under the properties.

![The Entities page on a wide window, with the sentry bot's properties beside its behaviours](/screenshots/entities-wide.png)

At the bottom, **Placed in** has a button for each room that places the type, with how many it places there. Click one to open the room. A type that no room places says "Not placed in any room yet".

The default of a property, and a behaviour's value, is what every entity of the type has until you set its own in the [room panel](./rooms#entity-overrides). A changed value here reaches the entities that kept the type's on the next patch, live apply or build.

### Deleting a type {#deleting-a-type}

**Delete** deletes a type that no room places at once. If rooms place it, the studio asks first and says how many entities in which rooms use it, for example: "Delete the entity type “Coin”? 10 entities in 2 rooms (Entry, Shaft) use it; they stay in their rooms and show as problems until they get another type."

Those entities are not deleted. They stay where they are, and the [Problems panel](./interface#problems) lists each one until you give it another type in the room panel or delete it. Undo brings the type back, and the entities have it again.

### Getting here from a room or a problem {#links}

- In the [room panel](./rooms#entities), a placed entity's **Type** field has a button beside it, "Open Sentry bot on the Entities page", that opens its type here.
- A problem about an entity type, its properties or its behaviours opens that type here when you click it in the [Problems panel](./interface#problems).

## Properties {#properties}

A property is a named value that every entity of a type carries: a shield, a mood, a label. The game's code reads it by name. The settings of a behaviour are separate; see [Behaviours](#behaviours).

**Properties** is a table, one row for each property:

![The Entities page with the sentry bot selected: its properties, one of each type (a list, an integer with limits, a boolean, text), above its behaviours](/screenshots/entity-properties.png)

| Column | Meaning |
| --- | --- |
| **Name** | Lowercase letters, digits and `_`, starting with a letter. It becomes a field in the game's code. |
| **Type** | **Integer**, **Boolean**, **Text**, **One of a list** or **Another entity**. |
| **Default** | What every entity of the type has until you set its own. A number; **Yes** or **No**; text, which may be empty; or one of the list's options. For another entity it is always **None**: each placed entity sets its own. |
| **Allowed** | For an integer, an optional **Smallest** and **Largest**. For a list, its options, separated by commas. For another entity, a checkbox for each entity type: the types it may point at. Nothing for a boolean or text. |

The bin at the end of a row deletes the property. **Add property** below the table adds an integer called `property` (`property_2`, `property_3` and so on if that is taken) with a default of 0. Change it in its row.

The studio refuses a name, and says why under the row, when it:

- is not valid: lowercase letters, digits and `_`, starting with a letter;
- is already another property of the type's;
- is the name of a property of one of the type's [behaviours](#behaviours). The build refuses that too.

An integer is a whole number that fits in 32 bits, from -2,147,483,648 to 2,147,483,647, because that is what the game keeps it in. **Smallest** and **Largest** narrow that. A limit is a whole number in that range, and an empty field is no limit. The default and the number field in the [room panel](./rooms#entity-overrides) take only values between the limits: a number outside is brought to the nearest one. If a new limit would leave the default outside, the default moves to that limit. The smallest cannot be over the largest; the studio says so under the row and keeps the old limit. The limits are for the studio: the game does not know them.

A list needs at least one option. Type them separated by commas. A blank option and a repeated one are left out. If you take out the option that is the default, the first option becomes the default.

### Another entity {#ref-properties}

A property of the kind **Another entity** points at one placed entity, in the same room or another: a switch at the door it opens, a door at where it leads. Each placed entity picks its own target in the [room panel](./rooms#entity-references), from a list or by clicking it on the map, and the map draws a line to it. The type's default is **None**.

![The Entities page with the switch selected: its property opens is Another entity, with None as its default, and may point only at doors](/screenshots/entity-property-ref.png)

Under **Allowed**, tick the entity types it may point at, so a switch offers only doors. With none ticked, it says **Any type** and may point at any entity. If you delete a type that a reference lists, the [Problems panel](./interface#problems) reports it in `project.json`, for example "entity type "switch": property "opens" may point at type "gate", which the project does not have"; click it to open the type here.

The game gets the number of the entity it points at, or nothing for **None**; see [References](./making-a-game#references).

Changing a property's **Type** gives it a default of the new type: 0, **No**, empty, the first option, or **None**. A new list starts with one option: the text the property had as its default, or `option` if it had none. The options and limits of the old type go. A value that a placed entity stored is never converted: 7 does not become "7".

Each own property costs 20 bytes on every placed entity of its type in the level data, and a text or list value also adds its text, once. A reference costs the same 20 bytes, and an entity's id costs nothing: it is not written to the ROM. A type with 4 properties, placed 50 times, takes 4,000 bytes. The [Build panel's](./build-and-play#level-data-use) level data readout counts them.

### Entities that store a value {#property-placed}

A placed entity can keep its own value for a property; see [Values set on one entity](./rooms#entity-overrides). Changing a property can leave such a value wrong, so the studio looks at the rooms first:

- **Renaming** a property renames the stored values with it, so the entities keep them.
- **Deleting** a property that no entity stores is done at once. If entities store a value for it, the studio asks first and lists them ("Entry: Sentry bot #8: 7"). **Delete property** drops their values, and **Cancel** keeps the property.
- **Changing the type, a list's options or an integer's limits** asks first when a stored value would no longer fit, and lists each one with why:

![The question asked when narrowing a property would leave a placed entity's stored value outside it, listing the entity and why](/screenshots/entity-property-misfit.png)

The question says "Change “shield”? These stored values no longer fit it: Entry: Sentry bot #8: shield is 7; it is a whole number from 0 to 5. Changing it drops them, so those entities have the property's default again." **Change and drop them** makes the change and drops those values. **Cancel** leaves the property as it was. A value is dropped, never converted. The number after # is the entity's place in the room's list, counted from 0, as the [Problems panel](./interface#problems) counts them. A value that was already wrong before the change is left as it is, and Problems lists it.

### Values that do not fit {#property-misfit}

The [Problems panel](./interface#problems) reports a stored value that does not fit its property as an error in the room, so a hand edit or a coding agent's edit shows there too:

> entity 3 (sentry): mood is "loud"; it is one of calm, angry

It also reports an integer default past 32 bits as an error in `project.json`. The build does not check the values of a type's own properties yet and builds what is stored, so fix what Problems lists before you build.

## Behaviours {#behaviours}

A behaviour is something an entity does that the runtime already knows how to do: patrol, hurt the player, be collected, open as a door. The list of behaviours and their properties is in [Behaviours](./making-a-game#the-behaviours).

**Behaviours** lists the type's behaviours. Each is a card with its name, what it does, and a field for each of its properties:

- Each field is a whole number in the range the behaviour allows. Type a value and press `Enter` or leave the field; a value outside the range is brought to its nearest end.
- The field shows the behaviour's default until you change it. A value equal to the default is not written to `project.json`, so the type follows the default if it changes.
- A property with no default, such as `grants_ability` of **Ability pickup**, is empty and says **Required: 0 to 31**. A value outside the range is refused, with the reason under the field. The type, or every placed entity of it, must set it; until then the [Problems panel](./interface#problems) lists it.
- **Run earlier** and **Run later** (the arrows) change the order the game runs the type's behaviours in. Put **Hazard** after the behaviour that moves the entity, so it hurts where the entity is now.
- The bin removes the behaviour from the type.

**Add a behaviour…** below the cards lists the behaviours the type does not have, each with what it does. Pick one to add it at the end. A behaviour that shares a property with one the type has is listed but cannot be picked, with the reason, for example "Projectile (shares shot_speed with Shooter)": a type can have only one of them, so give shots a type of their own. A behaviour with a property of the same name as one of the type's own [properties](#properties) is listed but cannot be picked either: "Collectible (the type has its own property value)". Rename the property first. A type has at most 4 behaviours: once it has 4, every behaviour is listed but cannot be picked, with "the type has 4, the most it can have". The game keeps room for 4 behaviours on every entity while it runs, so each one more would cost every entity memory.

A placed entity can set its own value for a behaviour's property; see [Values set on one entity](./rooms#entity-overrides). An entity that sets none follows the type.

## Undo {#undo}

Each edit of a field, each type, property or behaviour added, and each type or property deleted, is one undo step on the project: use the undo buttons at the top of the page, or `Ctrl+Z` and `Ctrl+Shift+Z`. They step `studio/project.json`, the same steps as in Project settings and Physics.

A property rename that reaches rooms, and a property delete or change that drops stored values, change those rooms along with the project. They are one undo step: undo puts the project and the rooms back, and redo does it all again. If one of those rooms was changed after, the undo does nothing, and the top of the page says why, for example: "Not undone: Entry was changed after the property “shield” was changed. Undo that change first." Undo the change in that room, then undo here. Redo says "Not redone" in the same way. Collision classes work the same way; see [Undo across documents](./project-settings#class-undo).

## Making an enemy {#making-an-enemy}

An enemy needs no Rust in the sample game, because its loop runs every behaviour each entity's type lists (see [In the frame loop](./making-a-game#in-the-frame-loop)):

1. Import the enemy's PNG as a [sprite](./sprites).
2. Click **Add entity type**, name the type and give it the sprite.
3. Under **Behaviours**, add **Patrol**, then **Hazard**. Set `patrol` to how far it walks each way, in pixels. Give the type properties of its own, such as a `shield`, if the game's code reads them.
4. Place it in a room with the entities tool, and build.

It walks back and forth where it was placed, and sends the hero back when they touch. The sample's sentry bot is made this way.

## Adding a collectible {#adding-a-collectible}

A collectible is an entity type with a sprite and the **Collectible** behaviour, with its `value`. To add another kind (a ruby, a key): import its PNG as a [sprite](./sprites), add the entity type here, add **Collectible** to its behaviours and set its `value`. Then place it in rooms with the entities tool. The sample game takes any entity whose type has **Collectible** when the hero touches it. A property of the type's own named `value` does not make it a collectible.
