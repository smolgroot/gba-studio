# Tools

**Tools**, in the Project sidebar and on the activity bar, opens a gallery of helpers that make assets: the [Platformer tileset generator](#platformer-tileset-generator), the [Metroidvania room generator](#metroidvania-room-generator) and the [Pixel art converter](#pixel-art-converter). Click a card to open a tool in the main area. What a tool saves goes into the game folder like any other file.

## Platformer tileset generator

Makes a complete tileset for a 2D platformer from a few colours and a seed, for outdoor levels, buildings or sci-fi interiors. Each block is a *surface* material (grass, snow, moss, or a lit trim strip) over a *body* material (earth, bricks, cut stone, cobbles, wood planks or metal panels).

1. Pick a **Template**: Meadow, Snowcap, Dunes, Volcanic, Castle, Mossy ruins, Brick town, Crystal cave, Swamp, Wood cabin, Spaceship, Reactor deck or Ice palace. A template sets the colours and the material, and keeps the seed and block size.
2. Change the **Seed**, or press the dice for a new one. The same options and seed always give the same pixels.
3. Adjust the colours, material and texture (see below). The preview redraws as you go. The second toolbar button shows the blocks in a small level.
4. Name it and press **Save to project**. This writes `assets/tilesets/<name>.png`. With **Make a tileset with collision set** on, it also creates the tileset, or updates the one already using that file. **PNG** downloads the image instead.

### What is on the sheet

The sheet is 8 blocks wide and 5 blocks tall:

| Row | Blocks |
| --- | --- |
| 1 | top left, top, top right, pillar top, inner corner top left and top right, single block, top variant |
| 2 | left, fill, right, pillar, inner corner bottom left and bottom right, two fill variants |
| 3 | bottom left, bottom, bottom right, pillar bottom, platform left, middle and right, spikes |
| 4 | grass tuft, flower, rock, torch, back wall, back wall variant, window, back wall in shadow |
| 5 | slope up and slope down at 45°, gentle slope up (low half, high half), gentle slope down (high half, low half), stalactite, hanging vine |

With wood planks or metal panels, the level preview puts a wall behind everything instead of sky. Hover over a block to see its name, its first tile number and its collision. In a room, pick a whole block as a stamp in Tiles & Layers to paint with it.

Sides that meet other ground stay flat and seamless. Only sides facing air get edge noise, rounded corners and the outline. Variants keep the same brick and stone courses as the fill, so they swap in without a seam.

### Options

- **Block size**: 8 px (one GBA tile), 16 px (2 × 2 tiles) or 32 px (4 × 4 tiles). Changing it rescales the pixel sizes.
- **Colours**: light and dark ends for the surface, the body and an accent (flowers, torch flames, window glow). **Shades** sets how many tones go between them. **Palette** shows the final colours as the GBA shows them.
- **Body**: Earth, Bricks, Cut stone, Cobblestone, Wood planks or Metal panels. Use bricks or cut stone with **Top edge: Battlements** and no surface layer for castles and buildings.
- **Metal panels** are for sci-fi interiors such as a spaceship: riveted plates, vents, and light strips in the accent colours on the variant blocks. The surface layer becomes a lit trim along floors. The window becomes a porthole, and the decorations become a canister, a terminal, a crate, a wall lamp, a pipe and a cable. Block names and positions do not change, so rooms painted with one theme work with another.
- **Surface layer**, **Surface depth**, **Overhang** (how far it hangs down open sides) and **Drips** (ragged lower edge).
- **Edge noise** and **Corner radius** shape the edges that face air.
- **Contrast**, **Strata** (horizontal layers in earth) and **Stones** (pebbles in earth, knots in wood) set the texture.
- **Dark outline** and **Dither between shades**.

### Made for the GBA build

- Blocks sit edge to edge with no padding or margin, and the sheet's width and height are multiples of 8.
- The whole sheet uses at most 15 colours, already snapped to the GBA's 5 bits a channel. Every tile fits one palette, and the tileset uses 1 of the 16.
- A sheet is 40 tiles at 8 px, 160 at 16 px and 640 at 32 px, out of the 1024 a background can address. Backgrounds in the same room share that budget.
- Collision comes set: ground is Solid, platforms are One-way along their top row of tiles, spikes are Hazard, and decorations and back walls have none. Tiles that are all air get no class.
- Slope blocks are cut into tiles that are each a slope, Solid (under the floor line) or empty (over it). A 45° slope uses the *Slope up* and *Slope down* classes; gentle slopes need classes rising 0→4 and 4→8 pixels (and the same going down). Saving adds any of these the project lacks to **Project settings → Collision classes**.
- Sheets saved before slopes were added are 4 blocks tall. Saving again from the generator adds the fifth row; the first four rows keep their tile numbers, so rooms painted with them are unchanged.

## Metroidvania room generator

Lays out a whole room with the blocks of a tileset made by the tileset generator: ground, slopes, one-way platforms, spike pits, back walls and decorations. Steps, gaps and ladders are sized from the project's **Physics**, so the player can get from each exit to every other one.

1. Pick a **Style**, a starting point for the shape: *Corridor* (flat floors on a few levels), *Stepped halls* (levels joined by slopes), *Caverns* (wandering ground with slopes and small places) or *Shaft* (a climb on ledges). A style sets the layout and the shape sliders, and keeps everything else.
2. Pick the **Tileset**. It must be laid out like the tileset generator's sheet. One saved before slopes existed still works, without slopes. With no tileset in the project yet, the preview uses the tileset generator's current settings, but you need to save a tileset before you can save a room.
3. Set the room's **Width** and **Height** in screens, the **Seed** (the dice gives a new one), the **Layout** and the **Exits**.
4. Tune the shape and dressing (see below), then name it and press **Save to project**. This writes `studio/rooms/<name>.json` with a *Back wall* layer (if the room has one) and a *Ground* layer. **Open** shows it in the room editor, where you can paint over it. Place it on the world map to play it.

The same options, seed, tileset block size and physics always give the same room. Each part of the room has its own random stream, so changing the dressing never moves the ground. The grid button shows where one screen ends and the next begins. Hover over the room to see the blocks under the pointer.

### Layouts

- **Levels (linear floors)**: the room is cut into bands of air stacked down the room, each one and a half jumps plus 48 pixels high. Each band is a corridor with long flat floors on a few levels. Bands are joined at alternate ends by a hole with one-way platforms up it, so a tall room is a zigzag climb.
- **Caverns (organic)**: the same bands, but the floor and ceiling wander from block to block. The bands are joined by holes anywhere along them, sometimes two.
- **Shaft (vertical climb)**: one tall space, climbed on ledges that alternate sides a jump apart, each within a running jump of the last. A ledge is solid where there is room to stand under it, and one-way otherwise.

**Exits** open the room's edges. A left exit is at the bottom level and a right exit at the top level (when there is more than one), so with both the room is a climb. A top exit is a gap in the ceiling with platforms up to it. A bottom exit is a hole in the floor, kept narrow enough to jump over. Floors are flat for a few blocks at each exit.

### Shape

- **Variation**: how much floors, ceilings and shaft walls wander. At 0, *Levels* gives flat floors with the odd step.
- **Slopes**: how many one-block steps become slopes, at 45° in one block or gentle over two. A step of a few blocks becomes a run of slope. Needs a tileset with the slope row.
- **Platforms**: one-way platforms a jump over the floor where there is headroom, sometimes two stacked.
- **Small places**: lofts dug into low ceilings, floored by a one-way platform a jump up. With 32 px blocks and a jump of one block they are niches off the floor instead.
- **Spike pits**: spikes sunk one block into long floors, never wider than a running jump clears.

### Dressing

- **Back wall**: *None*, *Patches* (crumbling walls for ruins) or *Everywhere* (indoors). The back wall goes on its own layer behind the ground, with windows and a shadow band under ceilings.
- **Decoration**: tufts, flowers and rocks on the ground, stalactites and vines under ceilings, and torches on the back wall. With metal panels these are the machinery versions.

### Sized to the jump

The generator works in blocks and reads the full jump from the project's physics (as **Physics** shows it):

- A step is never taller than the jump, less a few pixels.
- A gap is never wider than about half the distance a full jump carries at full run.
- Floors leave 40 pixels of headroom, side exits are 48 pixels tall, and stacked bands keep at least 24 pixels of ground between them.

Change the physics and the rooms you generate next follow it. Rooms already saved do not change.

## Pixel art converter

Turns any picture (a drawing, a render, a photo) into a small image the GBA can show: fewer, bigger pixels, a GBA palette, and dark strokes around shapes if you want them.

1. Bring in a picture. **Open…** picks a file (PNG, JPEG, GIF or WebP), **Paste** or Ctrl+V (⌘V) takes one from the clipboard, and you can drop a file on the view. **From game** uses a PNG already in the game folder. The picture stays on your computer until you save the result.
2. Pick a **size**: 16, 24, 32, 48, 64, 96 or 128 px, or type any size up to 512 in **Size**. It is the result's longest side.
3. Fit the colours, add strokes (see below), and press **Save to project**. This writes the PNG to the folder you chose, `assets/sprites` by default. **Open** shows it in the pixel editor. **PNG** downloads it instead.

The second toolbar button shows the original next to the result. The grid button shows the 8 × 8 tiles. The bar above the view gives the size, the number of colours, and whether the result is a size a GBA sprite can have.

### Pixelate

- **Canvas**: *Square* makes the result size × size with the picture centred, the usual shape for a sprite. *Whole 8 × 8 tiles* keeps the picture's shape and pads it out to multiples of 8, for tiles and backgrounds. *Fit the picture* keeps the picture's shape exactly.
- **Sampling**: *Sharp* gives each pixel the most common colour under it, which keeps edges clean and is best for drawings. *Smooth* averages, which suits photos and soft gradients.
- **Remove the background** clears the colour in the picture's corners, starting from the border. The same colour inside the shape stays. **Tolerance** sets how close a colour has to be to count as background. Pictures that already have transparency keep it. Alpha is all or nothing in the result, as on the GBA.

### GBA palette

- **Fit the colours to a GBA palette** snaps every colour to the GBA's 5 bits a channel and keeps at most **Colours** of them, chosen to match the picture best. With it off, colours are only snapped to 5 bits.
- **Mode**: *16 colours* gives 15 colours and transparent, one palette, as sprites and 4 bpp tiles use. *256 colours* allows up to 255.
- **Dither** mixes neighbouring colours to suggest the colours that were dropped: *Ordered* gives a regular pattern, *Diffusion* a looser grain. Leave it off for flat, clean pixel art.

### Strokes

- **Dark strokes around shapes** draws a line where the shape meets transparency, so you usually need **Remove the background** for a picture on a plain background. *Outside the shape* adds the line around the shape, and a pixel of room is kept for it inside the size. *On the shape's edge* recolours the shape's own border pixels, so the shape keeps its size.
- **Round the corners too** also draws on diagonal neighbours, for a closed line around corners.
- **Colour**: *Shade of the shape* uses a dark, slightly cool shade of the colour next to each stroke pixel. Untick it to use one colour everywhere. That colour is always kept in the palette.
- **Inner lines** darkens the darker side of strong colour edges inside the shape. Higher values catch weaker edges.

Strokes are drawn before the palette is fitted, so they count toward the colours.
