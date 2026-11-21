//! Drawing with agb: a room's tile layers scrolled under a camera, the pictures that
//! drift behind them, and sprite sheets with their animations.

use agb::{
    display::{
        Graphics, GraphicsFrame, Palette16, Priority,
        object::{Object, Sprite},
        tiled::{
            InfiniteScrolledMap, PartialUpdateStatus, RegularBackground, RegularBackgroundId, RegularBackgroundSize, TileEffect, TileFormat, TileSet,
            TileSetting,
        },
    },
    fixnum::{Num, Vector2D, vec2},
    input::{Button, ButtonController},
};

use core::cell::Cell;

use crate::behaviour::{Buttons, Hitbox};
use crate::data::{Background, Dim, Room, World};

/// The buttons as behaviours see them, held and pressed this frame, from agb's
/// input after its `update` for the frame. agb numbers its buttons with the same bits.
pub fn buttons(input: &ButtonController) -> (Buttons, Buttons) {
    use Button::*;
    let all = [A, B, Select, Start, Right, Left, Up, Down, R, L];
    let held = all.iter().filter(|&&b| input.is_pressed(b)).fold(0, |bits, &b| bits | b as u16);
    let pressed = all.iter().filter(|&&b| input.is_just_pressed(b)).fold(0, |bits, &b| bits | b as u16);
    (Buttons(held), Buttons(pressed))
}

/// A tileset's tiles and the palettes they are drawn with.
pub struct Tileset {
    pub tiles: TileSet,
    /// Which of `palettes` each tile uses.
    pub tile_palettes: &'static [u8],
    pub palettes: &'static [Palette16],
}

/// A picture cut into tiles, drawn behind rooms. It repeats in both directions.
pub struct BackgroundImage {
    /// Its distinct tiles, and palettes of its own beside the room tileset's.
    pub tiles: Tileset,
    /// Size in tiles.
    pub cols: u16,
    pub rows: u16,
    /// The tile in each cell row by row, as little-endian `u16`.
    pub cells: &'static [u8],
}

impl BackgroundImage {
    /// What the picture shows in a cell of the endless plane it repeats over, with its
    /// palettes loaded from `palette` on.
    fn tile(&'static self, pos: Vector2D<i32>, palette: u8) -> (&'static TileSet, TileSetting) {
        let (col, row) = (pos.x.rem_euclid(self.cols as i32) as usize, pos.y.rem_euclid(self.rows as i32) as usize);
        let at = (row * self.cols as usize + col) * 2;
        let tile = u16::from_le_bytes([self.cells[at], self.cells[at + 1]]);
        (&self.tiles.tiles, TileSetting::new(tile, TileEffect::new(false, false, palette + self.tiles.tile_palettes[tile as usize])))
    }
}

/// The compiled half of the game's graphics, which the data section's rooms name
/// by index: `gfx::TILESETS` and `gfx::BACKGROUNDS`.
#[derive(Clone, Copy)]
pub struct Art {
    pub tilesets: &'static [Tileset],
    pub backgrounds: &'static [BackgroundImage],
}

/// The GBA draws four backgrounds: tile layers and pictures share them.
const SCREEN_LAYERS: usize = 4;
const PALETTES: usize = 16;

/// Darkens the backgrounds a frame has shown, with the console's brightness-decrease
/// effect: no palette slots, tiles or per-frame work beyond two registers. It shares the
/// blend registers with any other effect, so a later fade or alpha blend must take over
/// this call rather than add to it. Sprites are not a target, so they stay bright.
fn darken(frame: &mut GraphicsFrame, level: u8, shown: &[Option<RegularBackgroundId>; 5]) {
    if level == 0 || shown.iter().all(Option::is_none) {
        return;
    }
    // A level is that many sixteenths: `Num<u8, 4>` has 4 fractional bits, so the raw value is the level.
    let mut effect = frame.blend().darken(Num::from_raw(level));
    for id in shown.iter().flatten() {
        effect.enable_background(*id);
    }
}

struct Backdrop {
    layer: Background,
    image: &'static BackgroundImage,
    /// The first of the palettes its image was given.
    palette: u8,
    map: InfiniteScrolledMap,
}

/// The pictures behind what a view shows: those of one room at a time.
struct Backdrops {
    /// Back to front.
    layers: [Option<Backdrop>; 2],
    /// The camera position at which the pictures' top-left corners meet the screen's.
    origin: (i32, i32),
    /// Bit n is set when picture n is darkened. Kept apart from the pictures, which a
    /// next room may share while darkening them differently.
    dim: u8,
}

impl Backdrops {
    const fn new() -> Self {
        Self { layers: [const { None }; 2], origin: (0, 0), dim: 0 }
    }

    /// Whether these are the pictures on show, moving the same way.
    fn shows(&self, mut wanted: impl Iterator<Item = Background>) -> bool {
        self.layers.iter().all(|shown| match (shown, wanted.next()) {
            (Some(shown), Some(wanted)) => shown.layer == wanted,
            (None, None) => true,
            _ => false,
        }) && wanted.next().is_none()
    }

    /// Changes to a room's pictures, laid down from `origin`. Their palettes go after
    /// the `palettes` the tileset uses, and they take what the `tile_layers` leave of
    /// the console's four backgrounds. Asking for the pictures already shown changes
    /// nothing, so they carry on unbroken from room to room.
    fn set(&mut self, room: &Room, art: &Art, origin: (i32, i32), palettes: usize, tile_layers: usize, graphics: &Graphics) {
        self.dim = room.dim().backgrounds;
        if self.shows(room.backgrounds()) {
            return;
        }
        // The old maps go first, so their tiles leave video memory before new ones come.
        self.layers = [const { None }; 2];
        self.origin = origin;
        let mut next = palettes;
        for (index, layer) in room.backgrounds().enumerate().take(SCREEN_LAYERS.saturating_sub(tile_layers).min(2)) {
            // Indices are checked against the compiled pictures when the world is read.
            let Some(image) = art.backgrounds.get(layer.image as usize) else {
                continue;
            };
            let own = image.tiles.palettes;
            // Two layers of one picture share its palettes.
            let shared = self.layers[..index].iter().flatten().find(|other| other.layer.image == layer.image).map(|other| other.palette as usize);
            let first = shared.unwrap_or(next);
            if first + own.len() > PALETTES {
                continue;
            }
            if shared.is_none() {
                for (offset, palette) in own.iter().enumerate() {
                    graphics.set_background_palette((first + offset) as u8, palette);
                }
                next += own.len();
            }
            let map = InfiniteScrolledMap::new(RegularBackground::new(Priority::P3, RegularBackgroundSize::Background32x32, TileFormat::FourBpp));
            self.layers[index] = Some(Backdrop { layer, image, palette: first as u8, map });
        }
    }

    /// Scrolls the pictures for a camera position. Returns whether they are all drawn.
    fn set_camera(&mut self, x: i32, y: i32) -> bool {
        let origin = self.origin;
        let mut ready = true;
        for backdrop in self.layers.iter_mut().flatten() {
            let (image, palette) = (backdrop.image, backdrop.palette);
            let scroll = backdrop.layer.scroll(x - origin.0, y - origin.1);
            ready &= backdrop.map.set_scroll_pos(vec2(scroll.0, scroll.1), |pos| image.tile(pos, palette)) == PartialUpdateStatus::Done;
        }
        ready
    }

    /// Shows the pictures that are fully drawn; one just changed stays hidden for the
    /// few frames it takes. Call after showing the tile layers: at the same priority,
    /// what is shown first is in front.
    fn show(&self, frame: &mut GraphicsFrame, shown: &mut [Option<RegularBackgroundId>; 5]) {
        for (n, backdrop) in self.layers.iter().enumerate().rev() {
            let Some(backdrop) = backdrop else { continue };
            if let Some(id) = backdrop.map.show_if_done(frame)
                && self.dim >> n & 1 == 1
            {
                shown[3 + n] = Some(id);
            }
        }
    }
}

/// What a room's layer shows in a cell; blank outside the room.
fn room_tile(room: &Room, tileset: &'static Tileset, layer: usize, pos: Vector2D<i32>) -> (&'static TileSet, TileSetting) {
    cell_tile(tileset, room.tile(layer, pos.x, pos.y))
}

/// How a layer cell is drawn: 0 is blank, n is tile n-1.
fn cell_tile(tileset: &'static Tileset, cell: u16) -> (&'static TileSet, TileSetting) {
    let tiles = &tileset.tiles;
    // A cell past the tileset's end only comes from a section the build did not check.
    match tileset.tile_palettes.get((cell as usize).wrapping_sub(1)) {
        Some(&palette) if cell > 0 => (tiles, TileSetting::new(cell - 1, TileEffect::new(false, false, palette))),
        _ => (tiles, TileSetting::BLANK),
    }
}

/// A room's tileset. Indices are checked against the compiled tilesets when the
/// world is read, so the fallback to the first is never taken.
fn tileset_of(room: &Room, art: &Art) -> &'static Tileset {
    art.tilesets.get(room.tileset() as usize).unwrap_or(&art.tilesets[0])
}

/// Where one layer of one room is on the world's tile grid, and its cells; no cells
/// where the view draws the room blank.
#[derive(Clone, Copy)]
struct Area<'a> {
    left: i32,
    top: i32,
    cols: i32,
    rows: i32,
    cells: &'a [u16],
}

impl Area<'_> {
    fn holds(&self, pos: Vector2D<i32>) -> bool {
        let (x, y) = (pos.x - self.left, pos.y - self.top);
        x >= 0 && y >= 0 && x < self.cols && y < self.rows
    }

    fn cell(&self, pos: Vector2D<i32>) -> u16 {
        self.cells.get(((pos.y - self.top) * self.cols + pos.x - self.left) as usize).map_or(0, |&cell| u16::from_le(cell))
    }
}

/// A room on screen. Rooms are far bigger than the GBA's backgrounds, so tiles are
/// written into video memory as the camera reaches them.
pub struct RoomView<'a> {
    room: Room<'a>,
    tileset: &'static Tileset,
    layers: [Option<InfiniteScrolledMap>; 3],
    backdrops: Backdrops,
    dim: Dim,
}

impl<'a> RoomView<'a> {
    /// Sets the background palettes to the room's tileset and makes a background per
    /// layer, the front layer at priority 1 so sprites at priority 0 stand before it.
    /// The room's pictures go behind, laid down from its top-left corner.
    pub fn new(room: Room<'a>, art: &Art, graphics: &mut Graphics) -> Self {
        let tileset = tileset_of(&room, art);
        graphics.set_background_palettes(tileset.palettes);
        let count = room.layer_count().min(3);
        let mut layers = [const { None }; 3];
        for (index, layer) in layers.iter_mut().enumerate().take(count) {
            let priority = [Priority::P3, Priority::P2, Priority::P1][index + 3 - count];
            *layer = Some(InfiniteScrolledMap::new(RegularBackground::new(priority, RegularBackgroundSize::Background32x32, TileFormat::FourBpp)));
        }
        let mut backdrops = Backdrops::new();
        backdrops.set(&room, art, (0, 0), tileset.palettes.len(), count, graphics);
        let dim = Dim::new(room.dim().level);
        Self { room, tileset, layers, backdrops, dim }
    }

    /// Sets how dark the room's dimmed layers are, 0 (no change) to 16 (black), for
    /// example to dim the scene behind a dialogue. The room's own level comes back
    /// with a new view.
    pub fn set_dim(&mut self, level: u8) {
        self.dim.set(level);
    }

    /// Moves the level to `level` over `frames` frames, a step each time the camera is set.
    pub fn fade_dim(&mut self, level: u8, frames: u16) {
        self.dim.fade(level, frames);
    }

    /// The level now.
    pub fn dim_level(&self) -> u8 {
        self.dim.level()
    }

    /// Moves the camera's top-left corner to a pixel of the room. Returns whether every
    /// tile in view is in place; after a jump that takes a few frames of calling this.
    pub fn set_camera(&mut self, x: i32, y: i32) -> bool {
        self.dim.step();
        self.place(x, y)
    }

    fn place(&mut self, x: i32, y: i32) -> bool {
        let (room, tileset) = (self.room, self.tileset);
        let mut ready = true;
        for (index, layer) in self.layers.iter_mut().enumerate() {
            if let Some(map) = layer {
                ready &= map.set_scroll_pos(vec2(x, y), |pos| room_tile(&room, tileset, index, pos)) == PartialUpdateStatus::Done;
            }
        }
        ready & self.backdrops.set_camera(x, y)
    }

    /// Places the camera and fills the whole view at once, for entering a room.
    pub fn load(&mut self, x: i32, y: i32) {
        while !self.place(x, y) {}
    }

    pub fn show(&self, frame: &mut GraphicsFrame) {
        let mut shown = [None; 5];
        let dimmed = self.room.dim().tiles;
        for (n, map) in self.layers.iter().enumerate() {
            if let Some(map) = map {
                let id = map.show(frame);
                if dimmed >> n & 1 == 1 {
                    shown[n] = Some(id);
                }
            }
        }
        self.backdrops.show(frame, &mut shown);
        darken(frame, self.dim.level(), &shown);
    }
}

/// The whole map on screen: every room that shares a tileset drawn as one space, so
/// the camera scrolls from a room into the next with no cut. Tiles are written into
/// video memory a row or column at a time, just ahead of the camera.
///
/// The GBA shows 16 background palettes at once, which is one tileset's worth. Rooms
/// of another tileset are left blank; on entering one, make a new view for it.
///
/// Behind the rooms are the pictures of one room, the one the player is in: they
/// drift with the camera rather than sit on the map, so two rooms' pictures cannot
/// meet at a border. Say which with [`WorldView::set_backgrounds`].
pub struct WorldView<'a> {
    /// A copy: `World` is a few slices, and the game may make a new one after the
    /// studio changes the level data (see [`WorldView::set_world`]).
    world: World<'a>,
    art: Art,
    /// The tileset's index in `art`, as rooms name it, and the tileset.
    shared: u16,
    tileset: &'static Tileset,
    count: usize,
    layers: [Option<InfiniteScrolledMap>; 3],
    backdrops: Backdrops,
    dim: Dim,
    /// Bit n is set when view slot n is darkened, for the room the player is in.
    dim_slots: u8,
}

impl<'a> WorldView<'a> {
    /// A view of the rooms that share `room`'s tileset, with `room`'s pictures behind
    /// them. Sets the background palettes.
    pub fn new(world: &World<'a>, art: Art, room: usize, graphics: &mut Graphics) -> Self {
        let world = *world;
        let shared = world.room(room).tileset();
        let tileset = tileset_of(&world.room(room), &art);
        graphics.set_background_palettes(tileset.palettes);
        let count = world.rooms().filter(|r| r.tileset() == shared).map(|r| r.layer_count()).max().unwrap_or(1).min(3);
        let layers = Self::layers(count);
        let mut view = Self { world, art, shared, tileset, count, layers, backdrops: Backdrops::new(), dim: Dim::new(0), dim_slots: 0 };
        view.set_backgrounds(room, graphics);
        view
    }

    /// Empty tile layers for a view of `count` layers, front layer in front.
    fn layers(count: usize) -> [Option<InfiniteScrolledMap>; 3] {
        let mut layers = [const { None }; 3];
        for (index, layer) in layers.iter_mut().enumerate().take(count) {
            let priority = [Priority::P3, Priority::P2, Priority::P1][index + 3 - count];
            *layer = Some(InfiniteScrolledMap::new(RegularBackground::new(priority, RegularBackgroundSize::Background32x32, TileFormat::FourBpp)));
        }
        layers
    }

    /// Redraws every tile in view from a new `World`, keeping the pictures behind. For
    /// tiles changed live; a change to the rooms themselves (size, place on the map,
    /// tileset, layers) needs a new view.
    pub fn redraw(&mut self, world: &World<'a>, x: i32, y: i32) {
        self.world = *world;
        self.layers = Self::layers(self.count);
        self.load(x, y);
    }

    /// Puts a room's pictures behind the view: call it when the player enters a room.
    /// A room with the pictures already shown changes nothing and they scroll on
    /// unbroken; other pictures are laid down from the new room's top-left corner and
    /// appear a few frames later, once drawn. A room with none clears them.
    pub fn set_backgrounds(&mut self, room: usize, graphics: &Graphics) {
        let index = room;
        let room = self.world.room(room);
        let origin = room.world().map_or((0, 0), |(x, y)| (x as i32 * 240, y as i32 * 160));
        self.backdrops.set(&room, &self.art, origin, self.tileset.palettes.len(), self.count, graphics);
        // Rooms with fewer layers than the view fill its front slots.
        let behind = self.count - room.layer_count().min(self.count);
        self.dim_slots = room.dim().tiles << behind;
        // Entering a room puts its own level back; the same room again leaves the game's.
        self.dim.enter(index, room.dim().level);
    }

    /// Sets how dark the dimmed layers of the room the player is in are, 0 (no change)
    /// to 16 (black), for example to dim the scene behind a dialogue. Entering another
    /// room with [`WorldView::set_backgrounds`] puts that room's own level back.
    pub fn set_dim(&mut self, level: u8) {
        self.dim.set(level);
    }

    /// Moves the level to `level` over `frames` frames, a step each time the camera is set.
    pub fn fade_dim(&mut self, level: u8, frames: u16) {
        self.dim.fade(level, frames);
    }

    /// The level now.
    pub fn dim_level(&self) -> u8 {
        self.dim.level()
    }

    /// Reads tiles from a new `World` from now on, without redrawing what is on screen.
    /// For level data changed live where no tile did: the tables may have moved, so
    /// the old `World` must not be read again. To show changed tiles, use [`WorldView::redraw`].
    pub fn set_world(&mut self, world: &World<'a>) {
        self.world = *world;
    }

    /// Whether a room is drawn by this view: it is on the map and shares the tileset.
    pub fn shows(&self, room: usize) -> bool {
        let room = self.world.room(room);
        room.world().is_some() && room.tileset() == self.shared
    }

    /// What slot `slot` of the view shows at a world tile. Rooms with fewer layers
    /// than the view fill its front slots, so every room's front layer lines up.
    fn tile<'w>(
        world: &'w World<'w>,
        shared: u16,
        tileset: &'static Tileset,
        count: usize,
        slot: usize,
        pos: Vector2D<i32>,
        last: &Cell<Option<Area<'w>>>,
    ) -> (&'static TileSet, TileSetting) {
        // Tiles come in rows and columns, so the next is nearly always in the same room.
        if let Some(area) = last.get().filter(|area| area.holds(pos)) {
            return cell_tile(tileset, area.cell(pos));
        }
        // Tested room by room, as finding the screen first would divide, which the GBA
        // does slowly in software.
        for room in world.rooms() {
            let Some((wx, wy)) = room.world() else {
                continue;
            };
            let area = Area { left: wx as i32 * 30, top: wy as i32 * 20, cols: room.cols() as i32, rows: room.rows() as i32, cells: &[] };
            if !area.holds(pos) {
                continue;
            }
            // A room of another tileset is blank in this view, as are the slots behind
            // a room with fewer layers than the view.
            let behind = count - room.layer_count().min(count);
            let cells = if room.tileset() != shared || slot < behind { &[][..] } else { room.layer(slot - behind) };
            let area = Area { cells, ..area };
            last.set(Some(area));
            return cell_tile(tileset, area.cell(pos));
        }
        (&tileset.tiles, TileSetting::BLANK)
    }

    /// Moves the camera's top-left corner to a world pixel. Returns whether every tile
    /// in view is in place; it always is while the camera moves less than a screen a frame.
    pub fn set_camera(&mut self, x: i32, y: i32) -> bool {
        self.dim.step();
        self.place(x, y)
    }

    fn place(&mut self, x: i32, y: i32) -> bool {
        let (world, shared, tileset, count) = (&self.world, self.shared, self.tileset, self.count);
        let mut ready = true;
        for (slot, layer) in self.layers.iter_mut().enumerate() {
            if let Some(map) = layer {
                let last = Cell::new(None);
                ready &= map.set_scroll_pos(vec2(x, y), |pos| Self::tile(world, shared, tileset, count, slot, pos, &last)) == PartialUpdateStatus::Done;
            }
        }
        ready & self.backdrops.set_camera(x, y)
    }

    /// Places the camera and fills the whole view at once, for starting or after a jump.
    pub fn load(&mut self, x: i32, y: i32) {
        while !self.place(x, y) {}
    }

    pub fn show(&self, frame: &mut GraphicsFrame) {
        let mut shown = [None; 5];
        for (n, map) in self.layers.iter().enumerate() {
            if let Some(map) = map {
                let id = map.show(frame);
                if self.dim_slots >> n & 1 == 1 {
                    shown[n] = Some(id);
                }
            }
        }
        self.backdrops.show(frame, &mut shown);
        darken(frame, self.dim.level(), &shown);
    }
}

pub struct Animation {
    pub name: &'static str,
    /// Frame index in the sheet, and how many 60 Hz ticks it shows for.
    pub frames: &'static [(u16, u8)],
    pub looping: bool,
}

impl Animation {
    /// The sheet frame showing `tick` ticks after the animation began: it wraps if the
    /// animation loops and holds the last frame if not. For many entities animated off
    /// one clock, like a room's coins, with no [`AnimPlayer`] each.
    pub fn frame_at(&self, tick: u32) -> usize {
        let total: u32 = self.frames.iter().map(|&(_, ticks)| ticks as u32).sum();
        let mut left = if self.looping && total > 0 { tick % total } else { tick };
        for &(frame, ticks) in self.frames {
            if left < ticks as u32 {
                return frame as usize;
            }
            left -= ticks as u32;
        }
        self.frames.last().map_or(0, |&(frame, _)| frame as usize)
    }
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

    /// The sheet's hitbox (the whole frame if it has none) as left, top, width and
    /// height, for an entity placed at a point: what [`Body::overlaps`] takes.
    ///
    /// [`Body::overlaps`]: crate::physics::Body::overlaps
    pub fn hitbox_at(&self, x: i32, y: i32) -> (i32, i32, i32, i32) {
        let (left, top, w, h) = self.hitbox.unwrap_or((0, 0, self.width as u16, self.height as u16));
        (x - self.anchor.0 as i32 + left as i32, y - self.anchor.1 as i32 + top as i32, w as i32, h as i32)
    }

    /// The sheet's hitbox (the whole frame if it has none) as an offset from the anchor,
    /// which is where an entity's feet are: what an [`Actor`] carries.
    ///
    /// [`Actor`]: crate::behaviour::Actor
    pub fn hitbox(&self) -> Hitbox {
        let (left, top, w, h) = self.hitbox_at(0, 0);
        Hitbox { x: left as i16, y: top as i16, w: w as u16, h: h as u16 }
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
