//! Drawing with agb: a room's tile layers scrolled under a camera, and sprite sheets
//! with their animations.

use agb::{
    display::{
        Graphics, GraphicsFrame, Palette16, Priority,
        object::{Object, Sprite},
        tiled::{InfiniteScrolledMap, PartialUpdateStatus, RegularBackground, RegularBackgroundSize, TileEffect, TileFormat, TileSet, TileSetting},
    },
    fixnum::{Vector2D, vec2},
};

/// A tileset's tiles and the palettes they are drawn with.
pub struct Tileset {
    pub tiles: TileSet,
    /// Which of `palettes` each tile uses.
    pub tile_palettes: &'static [u8],
    pub palettes: &'static [Palette16],
}

/// A room's tile layers, back to front.
pub struct RoomGfx {
    pub tileset: &'static Tileset,
    pub cols: u16,
    pub rows: u16,
    /// Each layer's cells row by row as little-endian `u16`: 0 is empty, n is tile n-1.
    pub layers: &'static [&'static [u8]],
    /// Where its top-left screen sits on the world grid, if it is on the map.
    pub world: Option<(i16, i16)>,
}

impl RoomGfx {
    /// What a layer shows in a cell; blank outside the room.
    fn tile(&'static self, layer: usize, pos: Vector2D<i32>) -> (&'static TileSet, TileSetting) {
        let tiles = &self.tileset.tiles;
        if pos.x < 0 || pos.y < 0 || pos.x >= self.cols as i32 || pos.y >= self.rows as i32 {
            return (tiles, TileSetting::BLANK);
        }
        let at = (pos.y as usize * self.cols as usize + pos.x as usize) * 2;
        let cell = u16::from_le_bytes([self.layers[layer][at], self.layers[layer][at + 1]]);
        if cell == 0 {
            return (tiles, TileSetting::BLANK);
        }
        let palette = self.tileset.tile_palettes[cell as usize - 1];
        (tiles, TileSetting::new(cell - 1, TileEffect::new(false, false, palette)))
    }
}

/// A room on screen. Rooms are far bigger than the GBA's backgrounds, so tiles are
/// written into video memory as the camera reaches them.
pub struct RoomView {
    room: &'static RoomGfx,
    layers: [Option<InfiniteScrolledMap>; 3],
}

impl RoomView {
    /// Sets the background palettes to the room's tileset and makes a background per
    /// layer, the front layer at priority 1 so sprites at priority 0 stand before it.
    pub fn new(room: &'static RoomGfx, graphics: &mut Graphics) -> Self {
        graphics.set_background_palettes(room.tileset.palettes);
        let count = room.layers.len().min(3);
        let mut layers = [const { None }; 3];
        for (index, layer) in layers.iter_mut().enumerate().take(count) {
            let priority = [Priority::P3, Priority::P2, Priority::P1][index + 3 - count];
            *layer = Some(InfiniteScrolledMap::new(RegularBackground::new(priority, RegularBackgroundSize::Background32x32, TileFormat::FourBpp)));
        }
        Self { room, layers }
    }

    /// Moves the camera's top-left corner to a pixel of the room. Returns whether every
    /// tile in view is in place; after a jump that takes a few frames of calling this.
    pub fn set_camera(&mut self, x: i32, y: i32) -> bool {
        let room = self.room;
        let mut ready = true;
        for (index, layer) in self.layers.iter_mut().enumerate() {
            if let Some(map) = layer {
                ready &= map.set_scroll_pos(vec2(x, y), |pos| room.tile(index, pos)) == PartialUpdateStatus::Done;
            }
        }
        ready
    }

    /// Places the camera and fills the whole view at once, for entering a room.
    pub fn load(&mut self, x: i32, y: i32) {
        while !self.set_camera(x, y) {}
    }

    pub fn show(&self, frame: &mut GraphicsFrame) {
        for map in self.layers.iter().flatten() {
            map.show(frame);
        }
    }
}

/// The whole map on screen: every room that shares a tileset drawn as one space, so
/// the camera scrolls from a room into the next with no cut. Tiles are written into
/// video memory a row or column at a time, just ahead of the camera.
///
/// The GBA shows 16 background palettes at once, which is one tileset's worth. Rooms
/// of another tileset are left blank; on entering one, make a new view for it.
pub struct WorldView {
    rooms: &'static [RoomGfx],
    tileset: &'static Tileset,
    count: usize,
    layers: [Option<InfiniteScrolledMap>; 3],
}

impl WorldView {
    /// A view of the rooms that share `room`'s tileset. Sets the background palettes.
    pub fn new(rooms: &'static [RoomGfx], room: usize, graphics: &mut Graphics) -> Self {
        let tileset = rooms[room].tileset;
        graphics.set_background_palettes(tileset.palettes);
        let count = rooms.iter().filter(|r| core::ptr::eq(r.tileset, tileset)).map(|r| r.layers.len()).max().unwrap_or(1).min(3);
        let mut layers = [const { None }; 3];
        for (index, layer) in layers.iter_mut().enumerate().take(count) {
            let priority = [Priority::P3, Priority::P2, Priority::P1][index + 3 - count];
            *layer = Some(InfiniteScrolledMap::new(RegularBackground::new(priority, RegularBackgroundSize::Background32x32, TileFormat::FourBpp)));
        }
        Self { rooms, tileset, count, layers }
    }

    /// Whether a room is drawn by this view: it is on the map and shares the tileset.
    pub fn shows(&self, room: usize) -> bool {
        self.rooms[room].world.is_some() && core::ptr::eq(self.rooms[room].tileset, self.tileset)
    }

    /// What slot `slot` of the view shows at a world tile. Rooms with fewer layers
    /// than the view fill its front slots, so every room's front layer lines up.
    fn tile(rooms: &'static [RoomGfx], tileset: &'static Tileset, count: usize, slot: usize, pos: Vector2D<i32>) -> (&'static TileSet, TileSetting) {
        for room in rooms {
            let Some((wx, wy)) = room.world else { continue };
            let local = vec2(pos.x - wx as i32 * 30, pos.y - wy as i32 * 20);
            if local.x < 0 || local.y < 0 || local.x >= room.cols as i32 || local.y >= room.rows as i32 {
                continue;
            }
            let behind = count - room.layers.len().min(count);
            if !core::ptr::eq(room.tileset, tileset) || slot < behind {
                break;
            }
            return room.tile(slot - behind, local);
        }
        (&tileset.tiles, TileSetting::BLANK)
    }

    /// Moves the camera's top-left corner to a world pixel. Returns whether every tile
    /// in view is in place; it always is while the camera moves less than a screen a frame.
    pub fn set_camera(&mut self, x: i32, y: i32) -> bool {
        let (rooms, tileset, count) = (self.rooms, self.tileset, self.count);
        let mut ready = true;
        for (slot, layer) in self.layers.iter_mut().enumerate() {
            if let Some(map) = layer {
                ready &= map.set_scroll_pos(vec2(x, y), |pos| Self::tile(rooms, tileset, count, slot, pos)) == PartialUpdateStatus::Done;
            }
        }
        ready
    }

    /// Places the camera and fills the whole view at once, for starting or after a jump.
    pub fn load(&mut self, x: i32, y: i32) {
        while !self.set_camera(x, y) {}
    }

    pub fn show(&self, frame: &mut GraphicsFrame) {
        for map in self.layers.iter().flatten() {
            map.show(frame);
        }
    }
}

pub struct Animation {
    pub name: &'static str,
    /// Frame index in the sheet, and how many 60 Hz ticks it shows for.
    pub frames: &'static [(u16, u8)],
    pub looping: bool,
}

pub struct SpriteSheet {
    pub frames: &'static [Sprite],
    pub width: u8,
    pub height: u8,
    /// The point of a frame placed at an entity's position.
    pub anchor: (i16, i16),
    /// Left, top, width and height within a frame.
    pub hitbox: Option<(i16, i16, u16, u16)>,
    pub animations: &'static [Animation],
}

impl SpriteSheet {
    pub fn animation(&'static self, name: &str) -> Option<&'static Animation> {
        self.animations.iter().find(|animation| animation.name == name)
    }

    /// An object showing a frame with the sheet's anchor at a point of the screen.
    /// Flipped, it mirrors around the anchor.
    pub fn object(&'static self, frame: usize, x: i32, y: i32, flip: bool) -> Object {
        let left = if flip { x - (self.width as i32 - self.anchor.0 as i32) } else { x - self.anchor.0 as i32 };
        let mut object = Object::new(&self.frames[frame.min(self.frames.len() - 1)]);
        object.set_pos(vec2(left, y - self.anchor.1 as i32)).set_hflip(flip);
        object
    }
}

/// Steps through an animation one tick per frame.
pub struct AnimPlayer {
    animation: &'static Animation,
    step: usize,
    ticks: u8,
}

impl AnimPlayer {
    pub const fn new(animation: &'static Animation) -> Self {
        Self { animation, step: 0, ticks: 0 }
    }

    /// Switches to another animation from its start; asking for the one already
    /// playing changes nothing, so this can be called every frame.
    pub fn play(&mut self, animation: &'static Animation) {
        if !core::ptr::eq(self.animation, animation) {
            *self = Self::new(animation);
        }
    }

    /// Advances one tick. Call once per frame.
    pub fn tick(&mut self) {
        self.ticks += 1;
        if self.ticks < self.animation.frames[self.step].1 {
            return;
        }
        if self.step + 1 < self.animation.frames.len() {
            self.step += 1;
            self.ticks = 0;
        } else if self.animation.looping {
            self.step = 0;
            self.ticks = 0;
        } else {
            // Hold the last frame.
            self.ticks -= 1;
        }
    }

    /// Whether a non-looping animation has played to its end.
    pub fn finished(&self) -> bool {
        !self.animation.looping && self.step + 1 == self.animation.frames.len() && self.ticks + 1 >= self.animation.frames[self.step].1
    }

    /// The sheet frame to show now.
    pub fn frame(&self) -> usize {
        self.animation.frames[self.step].0 as usize
    }
}

/// Frame `index` of a sheet's data, `len` bytes each. Used by generated code.
pub const fn frame_bytes(all: &'static [u8], index: usize, len: usize) -> &'static [u8] {
    all.split_at(index * len).1.split_at(len).0
}
