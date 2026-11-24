# Tilesets

A tileset is a PNG whose size is a multiple of 8, cut into 8x8 tiles, with a collision class painted on each tile.

![The Badlands tileset with collision classes painted on the tiles](/screenshots/tileset.png)

## Create one

Press **+** beside Tilesets, name it, and choose a PNG already in the folder or **Import an image**.

![The New tileset dialog](/screenshots/new-tileset.png)

To make one from scratch, use the [Platformer tileset generator](./tools#platformer-tileset-generator) in Tools.

## Paint collision

1. Open the tileset.
2. Choose a class in **Paint collision** (Solid, One-way platform, slopes, Hazard and so on).
3. Click or drag across tiles to give them that class. Tiles are outlined in the class colour.

The classes are added, renamed, recoloured and deleted in [Project settings](./project-settings#collision-classes). A tile you have not given a class has the first class in the list. When a class is deleted there, the tiles that had it have the first class instead.

The top bar shows the image size, the tile count and the number of distinct GBA colours (colours are reduced to 5 bits a channel, as the hardware does). At its right end, a readout such as "480/1024 tiles · 7/16 palettes" shows the background tiles and palettes the image needs, counted as the build counts them; hover it to see what is counted. It turns amber from 90% of a limit and red past it. If the build could not convert the image (a tile with 16 colours, or a 17th palette needed), the readout says "not convertible" and gives the reason. Properties shows the name, image and number of tiles with a class. **Edit pixels** opens the image in the [pixel editor](./pixel-editor).

## Limits

- At most 1024 tiles, and 15 colours per tile.
- A tileset can use up to 16 palettes, one per tile.

The GBA's video memory holds 1024 background tiles and 16 background palettes of 15 colours and transparent. A tileset over a limit, or one that cannot be converted, is listed in Problems on the tileset, with the build helper's wording, as soon as the image is saved. Rooms add their backgrounds' tiles and palettes to the tileset's; see [Rooms](./rooms#tile-and-palette-budget).
