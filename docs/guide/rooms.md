# Rooms and the map editor

Open a room from the Rooms list, or select it on the [world map](./world-map) and press **Open room**, to paint it.

![The map editor with the entities tool selected](/screenshots/room-editor.png)

## Tools

| Tool | Key | Notes |
| --- | --- | --- |
| Brush | `B` | Paint the selected tile or stamp. |
| Eraser | `E` | |
| Rectangle | `R` | |
| Flood fill | `G` | |
| Tile picker | `I`, or `Alt` + click | Pick a tile from the map. |
| Entities | `N` | Place and move entities. |
| Play from here | `P` | Click a tile to start the game in this room, standing on that tile. See [Play from here](#play-from-here). |
| Pan | `H`, or hold `Space` | Or use the middle mouse button. |

The **right mouse button** erases while using the brush or rectangle. Zoom with the toolbar buttons or `Ctrl` + wheel. The mouse position is shown as a tile and screen coordinate. Undo and redo are on the toolbar.

Toolbar toggles show a **tile grid**, the **collision** overlay, and **guides** at every screen boundary (240x160 pixels).

## Play from here

To try a room without walking to it, choose **Play from here** (the play-circle icon, or `P`) and click a tile. The studio opens the [Play](./build-and-play#play-from-here) panel and starts the game in this room, with the player standing on that tile. The tile can be any tile of the room; the player is placed as an entity is, with their feet at the middle of the tile's bottom edge.

This works in dev builds only. A release ROM has no [debug record](../reference/debug-map), so the panel tells you to build dev. The start is never written to the ROM file: it applies to the running game only.

## Layers

A room has up to three tile layers. In the **Tiles & Layers** panel you can add, rename, reorder (bring forward, send back), hide and delete layers. A room opens on its front layer. There is also a **Collision** layer at the top of the list.

## Stamps and the tile palette

Click a tile in the tileset palette, or drag across several to paint a block (a stamp). Painting a stamp over an area repeats its pattern from where the stroke began.

## Collision

Tiles carry the collision class given to them in their [tileset](./tilesets). Select **Collision** in the layers list to paint only where a cell should differ from its tile; the eraser gives a cell back to its tile. Use **Show collision** to tint the map with the result. With the Collision layer selected, the *Collision to paint* list in Tiles & Layers shows the available classes and their colours.

![The same room with collision shown](/screenshots/room-collision.png)

## Entities

With the Entities tool, pick an **entity type** in the *Entity to place* list of the Tiles & Layers panel, then:

- **click** to place one;
- **drag** to move it;
- edit its position and typed properties in Properties;
- press `Delete` to remove the selected entity.

Entities are placed by their feet: the middle of the bottom edge. An entity type with a sprite shows that sprite on the map. Add and recolour entity types, and give them behaviours, in [Project settings](./project-settings#behaviours).

### Values set on one entity {#entity-overrides}

When the selected entity's type has [behaviours](./project-settings#behaviours), **Selected entity** in Properties shows a heading for each one under the type's own properties, with its fields. A field shows the type's value, or the behaviour's default, until you set one for this entity. One sentry bot can walk further or slower than the others this way.

![The room panel with a sentry bot selected: patrol shows its type's value, and patrol_pace is set on this entity, marked, with a reset button](/screenshots/entity-overrides.png)

- Type a value to set it on this entity only. Its name then turns blue and has a reset button beside it, and when you hover the name it says what the type has ("Set on this entity; Sentry bot has 2").
- The reset button removes this entity's value, so it follows the type again. Typing the type's value back does the same.
- Changing the entity's type clears all its own values.

Every change is one undo step.

## Room properties

| Property | Meaning |
| --- | --- |
| **Name** | Display name; the id is the file name. |
| **Screens** | Size in whole screens, 1 to 32 a side. Shrinking asks first and undo brings the cut-off part back. Resizing keeps the top-left corner. |
| **Tileset** | The tileset the room is painted with. |
| **Music** | A track from [Audio](./audio). |
| **Backgrounds** | Up to two pictures behind the tiles. |
| **Darkness** | The level, 0 to 16, for the layers set to dim. See [Darkening layers](#darkening-layers). |

## Backgrounds

Import a PNG (or pick one in the folder) in the room's Properties for the **Back** and **Front** slots, and give each a scroll speed across and down, in percent of the camera's. 0 stands still, 100 moves with the room, and a far layer gets less than a near one. A picture repeats in both directions. The two arrows swap back and front; the bin removes a background (the image stays in the folder).

The GBA draws four layers, so tile layers and backgrounds together are at most four. The map shows backgrounds as they lie at the room's top-left corner (a toolbar button hides them); the [Play](./build-and-play) panel shows them moving.

## Darkening layers

A dimmed layer is drawn darker, so what is in front of it stands out: a dialogue box, the player, a pause menu. You choose which layers are dimmed and how dark they are.

![The room panel with a tile layer and a background dimmed, and the Darkness slider](/screenshots/room-dim.png)

- In the **Tiles & Layers** panel, each tile layer has a dim toggle. A dimmed layer shows a "dimmed" tag.
- In **Properties**, each background has the same toggle. Under **Darkness**, one slider sets the level from 0 (no change) to 16 (black). A line below it names the dimmed layers.

The map editor and the [world map](./world-map) show dimmed layers as the console draws them, rounding included. The [Play](./build-and-play) panel runs the real game, so it shows the effect after a build.

The GBA has one brightness setting for the layers it darkens. Every dimmed layer gets the same level, so you cannot give two layers different amounts: a layer is dimmed or it is not. Sprites are never dimmed. The effect costs no palette slots, no tiles and no time per frame, and it leaves the alpha blend free.

The Problems panel warns when a layer is set to dim but the level is 0, and when the level is above 0 but no layer is dimmed. In both cases nothing is darkened.

A change to dimming sits in the room's record in the ROM, so live apply counts it as a change to the rooms: a game that makes a new `WorldView` when the rooms change (the sample does) shows it at once, and the room's own level comes back. A game that does not needs a restart.

The game can change the level while it runs, with `view.set_dim(level)` or `view.fade_dim(level, frames)`. When the player enters a room, its own level comes back. See [Making a game with it](./making-a-game#the-runtime).

## Other rooms

![A larger room, Solana Trenches](/screenshots/room-trenches.png)
