//! What a studio project is at run time: rooms of collision cells and entities, placed
//! on a world grid of screens, and the physics they are played with.
//!
//! All of it is read from one block of bytes in the ROM, the data section, whose
//! layout is in [`layout`] and `docs/reference/data-section.md`. Tools can find the
//! section by its magic number and replace it without compiling the game. Nothing is
//! copied out of it: [`World`] and the views it hands out read the bytes in place.
//!
//! [`World::new`] checks the whole section once. After that no getter can fail or
//! read out of bounds, so the frame loop never checks again.

pub mod layout;
#[cfg(any(test, feature = "write"))]
pub mod write;

use crate::physics::{Movement, Physics, PhysicsMode, PlatformerPhysics, TopDownPhysics};
use layout::*;

/// Side of a background tile in pixels.
pub const TILE: i32 = 8;
pub const SCREEN_W: i32 = 240;
pub const SCREEN_H: i32 = 160;
const SCREEN_COLS: i32 = SCREEN_W / TILE;
const SCREEN_ROWS: i32 = SCREEN_H / TILE;

/// Numbered as the data section stores them, so reading one is a range check.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CollisionKind {
    Empty = KIND_EMPTY,
    Solid = KIND_SOLID,
    /// Solid from above only.
    OneWay = KIND_ONE_WAY,
    /// A floor that crosses the tile; see [`CollisionClass::floor_height`].
    Slope = KIND_SLOPE,
    Hazard = KIND_HAZARD,
    /// Means what the game says it means.
    Custom = KIND_CUSTOM,
}

impl CollisionKind {
    #[inline]
    const fn from_byte(byte: u8) -> Option<Self> {
        Some(match byte {
            KIND_EMPTY => Self::Empty,
            KIND_SOLID => Self::Solid,
            KIND_ONE_WAY => Self::OneWay,
            KIND_SLOPE => Self::Slope,
            KIND_HAZARD => Self::Hazard,
            KIND_CUSTOM => Self::Custom,
            _ => return None,
        })
    }

    /// The byte the data section stores for this kind.
    pub const fn to_byte(self) -> u8 {
        match self {
            Self::Empty => KIND_EMPTY,
            Self::Solid => KIND_SOLID,
            Self::OneWay => KIND_ONE_WAY,
            Self::Slope => KIND_SLOPE,
            Self::Hazard => KIND_HAZARD,
            Self::Custom => KIND_CUSTOM,
        }
    }
}

/// How a cell behaves. Its id is [`World::class_id`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CollisionClass {
    pub kind: CollisionKind,
    /// For a slope: the floor's height over the tile's bottom edge at its left and right side, 0 to 8.
    pub slope: (u8, u8),
}

impl CollisionClass {
    /// How high a slope's floor is over the tile's bottom edge at pixel column `x` (0 to 7).
    /// A 45 degree rise gives 1 to 8, so neighbouring tiles of a ramp meet without a step.
    #[inline]
    pub const fn floor_height(&self, x: i32) -> i32 {
        let (left, right) = (self.slope.0 as i32, self.slope.1 as i32);
        left + ((right - left) * (2 * x + 1) + 8).div_euclid(16)
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Prop<'a> {
    Int(i32),
    Bool(bool),
    Str(&'a str),
}

/// What is wrong with a data section that [`World::new`] refused. Each says where.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DataError {
    /// Shorter than its header and table, or than the size the header gives.
    TooShort,
    /// It does not start with [`layout::MAGIC`]: not a data section.
    Magic,
    /// Written for another layout version than this runtime reads.
    Version(u16),
    /// A section, by its number in [`layout`], is outside the data, misaligned, or
    /// not a whole number of records.
    Section(usize),
    /// A string is outside the strings section or is not UTF-8.
    Text,
    /// A collision class has an unknown kind or a slope over 8.
    Class(usize),
    /// A room's cells, layers, backgrounds, entities, tileset or music do not fit
    /// what the section or the game holds, or a cell names a class there is not.
    Room(usize),
    /// An entity, by its project-wide index, has a type the game does not have or
    /// properties outside the props section.
    Entity(usize),
    /// A property has an unknown tag.
    Prop(usize),
    /// The start room or the entity count does not match the rooms.
    Globals,
    /// A physics field is out of its range.
    Physics,
}

/// What the compiled half of the game has, so [`World::new`] can refuse a section
/// that names more. `u16::MAX` for any.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Limits {
    pub entity_kinds: u16,
    pub tilesets: u16,
    pub backgrounds: u16,
    pub tracks: u16,
}

impl Limits {
    pub const ANY: Self = Self { entity_kinds: u16::MAX, tilesets: u16::MAX, backgrounds: u16::MAX, tracks: u16::MAX };
}

// Records are read as arrays of little-endian words, so that a field is one aligned
// load at a constant index, with no bounds check: as cheap as a field of a struct.
// Offsets are the byte offsets of `layout`.
#[inline]
const fn word<const N: usize>(record: &[u32; N], at: usize) -> u32 {
    u32::from_le(record[at / 4])
}
#[inline]
const fn half<const N: usize>(record: &[u32; N], at: usize) -> u16 {
    (word(record, at) >> (at % 4 * 8)) as u16
}
#[inline]
const fn byte<const N: usize>(record: &[u32; N], at: usize) -> u8 {
    (word(record, at) >> (at % 4 * 8)) as u8
}

const fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}
const fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Bytes as words, if they are 4-aligned and a whole number of words.
fn as_words(bytes: &[u8]) -> Option<&[u32]> {
    if !bytes.as_ptr().cast::<u32>().is_aligned() || bytes.len() % 4 != 0 {
        return None;
    }
    // SAFETY: the pointer is aligned for u32, the length is in bounds, and any bits are a u32.
    Some(unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast::<u32>(), bytes.len() / 4) })
}

/// Bytes as halfwords, if they are 2-aligned and a whole number of halfwords.
fn as_halves(bytes: &[u8]) -> Option<&[u16]> {
    if !bytes.as_ptr().cast::<u16>().is_aligned() || bytes.len() % 2 != 0 {
        return None;
    }
    // SAFETY: the pointer is aligned for u16, the length is in bounds, and any bits are a u16.
    Some(unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast::<u16>(), bytes.len() / 2) })
}

/// Records of `N` words each, if the section is exactly that.
fn records<const N: usize>(bytes: &[u8]) -> Option<&[[u32; N]]> {
    match as_words(bytes)?.as_chunks::<N>() {
        (records, []) => Some(records),
        _ => None,
    }
}

type ClassRecord = [u32; CLASS / 4];
type RoomRecord = [u32; ROOM / 4];
type EntityRecord = [u32; ENTITY / 4];
type PropRecord = [u32; PROP / 4];
type Globals = [u32; GLOBALS / 4];

/// The project as the game plays it: every room, the collision classes, the start
/// room and the physics, read from a data section.
#[derive(Clone, Copy, Debug)]
pub struct World<'a> {
    strings: &'a [u8],
    classes: &'a [ClassRecord],
    rooms: &'a [RoomRecord],
    entities: &'a [EntityRecord],
    props: &'a [PropRecord],
    /// Collision cells, and the same bytes as halfwords for tile layers.
    cells: &'a [u8],
    tiles: &'a [u16],
    globals: &'a Globals,
}

impl<'a> World<'a> {
    /// Reads a data section, checking all of it against itself and against what the
    /// game was compiled with. The section must start on a 4-byte boundary.
    pub fn new(bytes: &'a [u8], limits: &Limits) -> Result<Self, DataError> {
        if bytes.len() >= 8 && bytes[..8] != MAGIC {
            return Err(DataError::Magic);
        }
        if bytes.len() < HEADER {
            return Err(DataError::TooShort);
        }
        let version = u16_at(bytes, H_VERSION);
        if version != VERSION {
            return Err(DataError::Version(version));
        }
        let sections = u16_at(bytes, H_SECTIONS) as usize;
        let used = u32_at(bytes, H_USED) as usize;
        if sections < SECTIONS || used > bytes.len() || used < table_end(sections) {
            return Err(DataError::TooShort);
        }
        let bytes = &bytes[..used];
        let mut found: [&[u8]; SECTIONS] = [&[]; SECTIONS];
        for (n, slot) in found.iter_mut().enumerate() {
            let (offset, length) = (u32_at(bytes, HEADER + n * 8) as usize, u32_at(bytes, HEADER + n * 8 + 4) as usize);
            if offset % 4 != 0 || offset < table_end(sections) || offset.checked_add(length).is_none_or(|end| end > used) {
                return Err(DataError::Section(n));
            }
            *slot = &bytes[offset..offset + length];
        }
        let section = |n: usize| DataError::Section(n);
        let world = Self {
            strings: found[S_STRINGS],
            classes: records(found[S_CLASSES]).ok_or(section(S_CLASSES))?,
            rooms: records(found[S_ROOMS]).ok_or(section(S_ROOMS))?,
            entities: records(found[S_ENTITIES]).ok_or(section(S_ENTITIES))?,
            props: records(found[S_PROPS]).ok_or(section(S_PROPS))?,
            cells: found[S_CELLS],
            tiles: as_halves(found[S_CELLS]).ok_or(section(S_CELLS))?,
            globals: match records::<{ GLOBALS / 4 }>(found[S_GLOBALS]) {
                Some([globals]) => globals,
                _ => return Err(section(S_GLOBALS)),
            },
        };
        world.check(limits)?;
        Ok(world)
    }

    fn check_str<const N: usize>(&self, record: &[u32; N], at: usize) -> Result<(), DataError> {
        let (offset, length) = (word(record, at) as usize, word(record, at + 4) as usize);
        match offset.checked_add(length).filter(|&end| end <= self.strings.len()) {
            Some(end) if core::str::from_utf8(&self.strings[offset..end]).is_ok() => Ok(()),
            _ => Err(DataError::Text),
        }
    }

    fn check(&self, limits: &Limits) -> Result<(), DataError> {
        let classes = self.class_count();
        if classes == 0 || classes > 256 {
            return Err(DataError::Section(S_CLASSES));
        }
        for (n, class) in self.classes.iter().enumerate() {
            self.check_str(class, C_ID)?;
            if CollisionKind::from_byte(byte(class, C_KIND)).is_none() || byte(class, C_SLOPE) > 8 || byte(class, C_SLOPE + 1) > 8 {
                return Err(DataError::Class(n));
            }
        }
        let mut entities = 0;
        for (n, room) in self.rooms.iter().enumerate() {
            let bad = DataError::Room(n);
            self.check_str(room, R_ID)?;
            self.check_str(room, R_NAME)?;
            let cells = half(room, R_COLS) as usize * half(room, R_ROWS) as usize;
            let flags = half(room, R_FLAGS);
            let (layers, backgrounds) = (byte(room, R_LAYER_COUNT) as usize, byte(room, R_BACKGROUND_COUNT) as usize);
            let collision = word(room, R_COLLISION) as usize;
            let layer_cells = word(room, R_LAYERS) as usize;
            let (first, count) = (word(room, R_FIRST_ENTITY) as usize, word(room, R_ENTITY_COUNT) as usize);
            let in_cells = |offset: usize, length: usize| offset.checked_add(length).is_some_and(|end| end <= self.cells.len());
            if !in_cells(collision, cells)
                || layer_cells % 2 != 0
                || !in_cells(layer_cells, cells * 2 * layers)
                || layers > 3
                || backgrounds > 2
                || half(room, R_TILESET) >= limits.tilesets
                || (flags & FLAG_MUSIC != 0 && half(room, R_MUSIC) >= limits.tracks)
                || first != entities
                || first.checked_add(count).is_none_or(|end| end > self.entities.len())
            {
                return Err(bad);
            }
            if (0..backgrounds).any(|b| half(room, R_BACKGROUNDS + b * BACKGROUND) >= limits.backgrounds) {
                return Err(bad);
            }
            if self.cells[collision..collision + cells].iter().any(|&class| class as usize >= classes) {
                return Err(bad);
            }
            entities += count;
        }
        if entities != self.entities.len() || word(self.globals, G_ENTITY_COUNT) as usize != entities {
            return Err(DataError::Globals);
        }
        for (n, entity) in self.entities.iter().enumerate() {
            let (first, count) = (word(entity, E_FIRST_PROP) as usize, half(entity, E_PROP_COUNT) as usize);
            if half(entity, E_KIND) >= limits.entity_kinds || first.checked_add(count).is_none_or(|end| end > self.props.len()) {
                return Err(DataError::Entity(n));
            }
        }
        for (n, prop) in self.props.iter().enumerate() {
            self.check_str(prop, P_NAME)?;
            match byte(prop, P_TAG) {
                TAG_INT => {}
                TAG_BOOL if word(prop, P_VALUE) <= 1 => {}
                TAG_TEXT => self.check_str(prop, P_VALUE)?,
                _ => return Err(DataError::Prop(n)),
            }
        }
        let start = half(self.globals, G_START);
        if start != NO_ROOM && start as usize >= self.room_count() {
            return Err(DataError::Globals);
        }
        let byte = |n: usize| (0..=255).contains(&self.physics_field(n));
        let flag = |n: usize| (0..=1).contains(&self.physics_field(n));
        if !flag(0) || !byte(10) || !byte(11) || !byte(12) || !flag(13) || !byte(17) || !flag(18) {
            return Err(DataError::Physics);
        }
        Ok(())
    }

    #[inline]
    fn str_at<const N: usize>(&self, record: &[u32; N], at: usize) -> &'a str {
        let (offset, length) = (word(record, at) as usize, word(record, at + 4) as usize);
        // Checked as UTF-8 in `new`; the fallback is never taken.
        core::str::from_utf8(&self.strings[offset..offset + length]).unwrap_or("")
    }

    #[inline]
    fn physics_field(&self, n: usize) -> i32 {
        word(self.globals, G_PHYSICS + n * 4) as i32
    }

    #[inline]
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    /// A room by its index, as `data::room::*` numbers them.
    ///
    /// # Panics
    /// If there is no room `index`.
    #[inline]
    pub fn room(&self, index: usize) -> Room<'_> {
        Room { world: self, index, record: &self.rooms[index] }
    }

    /// Every room, in project order.
    #[inline]
    pub fn rooms(&self) -> impl ExactSizeIterator<Item = Room<'_>> + '_ {
        self.rooms.iter().enumerate().map(|(index, record)| Room { world: self, index, record })
    }

    #[inline]
    pub fn class_count(&self) -> usize {
        self.classes.len()
    }

    /// A collision class by its index, as [`Room::class_index`] gives them.
    ///
    /// # Panics
    /// If there is no class `index`; no cell names one.
    #[inline]
    pub fn collision_class(&self, index: u8) -> CollisionClass {
        let class = &self.classes[index as usize];
        // Kinds are checked in `new`.
        let kind = CollisionKind::from_byte(byte(class, C_KIND)).unwrap_or(CollisionKind::Empty);
        CollisionClass { kind, slope: (byte(class, C_SLOPE), byte(class, C_SLOPE + 1)) }
    }

    /// The id a collision class has in the project.
    pub fn class_id(&self, index: u8) -> &'a str {
        self.str_at(&self.classes[index as usize], C_ID)
    }

    /// Index of the room a new game starts in.
    pub fn start(&self) -> Option<u16> {
        Some(half(self.globals, G_START)).filter(|&room| room != NO_ROOM)
    }

    /// The numbers set in the studio's Physics tab.
    pub fn physics(&self) -> Physics {
        let field = |n: usize| self.physics_field(n);
        Physics {
            mode: if field(0) == 1 { PhysicsMode::TopDown } else { PhysicsMode::Platformer },
            platformer: PlatformerPhysics {
                gravity: field(1),
                fall_gravity: field(2),
                max_fall_speed: field(3),
                run_speed: field(4),
                ground_acceleration: field(5),
                ground_friction: field(6),
                air_acceleration: field(7),
                jump_speed: field(8),
                jump_cut: field(9),
                air_jumps: field(10) as u8,
                coyote_frames: field(11) as u8,
                jump_buffer_frames: field(12) as u8,
            },
            top_down: TopDownPhysics {
                movement: if field(13) == 1 { Movement::Grid } else { Movement::Free },
                speed: field(14),
                acceleration: field(15),
                friction: field(16),
                directions: field(17) as u8,
                normalize_diagonal: field(18) == 1,
                corner_slide: field(19),
                grid_size: field(20),
            },
        }
    }

    /// How many entities the project has, over every room.
    #[inline]
    pub fn entity_count(&self) -> usize {
        self.entities.len()
    }

    /// A number for one entity of one room, unique in the project: entities counted
    /// room by room in project order. What [`Collected`] and save data key on.
    #[inline]
    pub fn entity_index(&self, room: usize, entity: usize) -> usize {
        self.room(room).first_entity() + entity
    }

    /// These cells with a wall wherever the map has no room.
    pub const fn enclosed(&self) -> Enclosed<'_> {
        Enclosed(self)
    }

    pub fn room_cells(&self, room: usize) -> RoomCells<'_> {
        RoomCells { room: self.room(room) }
    }

    /// The room holding a world pixel.
    #[inline]
    pub fn room_at(&self, x: i32, y: i32) -> Option<usize> {
        self.room_at_tile(x.div_euclid(TILE), y.div_euclid(TILE))
    }

    /// A room's top-left corner in world pixels, if it is on the map.
    #[inline]
    pub fn origin(&self, room: usize) -> Option<(i32, i32)> {
        self.room(room).world().map(|(x, y)| (x as i32 * SCREEN_W, y as i32 * SCREEN_H))
    }

    /// The room covering a screen of the world grid.
    #[inline]
    pub fn room_at_screen(&self, sx: i32, sy: i32) -> Option<usize> {
        self.room_at_tile(sx * SCREEN_COLS, sy * SCREEN_ROWS)
    }

    /// The room covering a tile of the world, counted in tiles from the map's top-left.
    #[inline]
    pub fn room_at_tile(&self, col: i32, row: i32) -> Option<usize> {
        // Compared in tiles: the GBA divides in software, and physics asks this for
        // every cell it tests.
        self.rooms.iter().position(|room| {
            if half(room, R_FLAGS) & FLAG_ON_MAP == 0 {
                return false;
            }
            let (x, y) = (half(room, R_WORLD_X) as i16 as i32 * SCREEN_COLS, half(room, R_WORLD_Y) as i16 as i32 * SCREEN_ROWS);
            col >= x && row >= y && col < x + half(room, R_COLS) as i32 && row < y + half(room, R_ROWS) as i32
        })
    }

    /// Where the camera's top-left corner should be, in world pixels, to centre on a
    /// point of `room`. The view never shows a screen of the map that has no room, so
    /// it scrolls on into touching rooms and stops at the map's holes and edges.
    /// `joined` says whether another room may be on screen together with this one (a
    /// game refuses rooms whose tileset differs, as their palettes cannot be shown at once).
    pub fn camera_target(&self, room: usize, x: i32, y: i32, joined: impl Fn(usize) -> bool) -> (i32, i32) {
        let Some((left, top)) = self.origin(room) else {
            return (x - SCREEN_W / 2, y - SCREEN_H / 2);
        };
        let here = self.room(room);
        let shown = |cx: i32, cy: i32| {
            let screens = |from: i32, size: i32| from.div_euclid(size)..=(from + size - 1).div_euclid(size);
            screens(cy, SCREEN_H).all(|sy| screens(cx, SCREEN_W).all(|sx| self.room_at_screen(sx, sy).is_some_and(|r| r == room || joined(r))))
        };
        let free = (x - SCREEN_W / 2, y - SCREEN_H / 2);
        let held = (free.0.clamp(left, left + here.width() - SCREEN_W), free.1.clamp(top, top + here.height() - SCREEN_H));
        // Follow freely if that shows rooms only; else hold one axis inside this room, then both.
        [free, (free.0, held.1), (held.0, free.1)].into_iter().find(|&(cx, cy)| shown(cx, cy)).unwrap_or(held)
    }

    /// Where a point that left `room` (in that room's pixels) lands: the neighbouring
    /// room on the world grid and the same point in its pixels. `None` where the map ends.
    pub fn cross(&self, room: usize, x: i32, y: i32) -> Option<(usize, i32, i32)> {
        let (wx, wy) = self.room(room).world()?;
        let world_x = wx as i32 * SCREEN_W + x;
        let world_y = wy as i32 * SCREEN_H + y;
        let next = self.room_at_screen(world_x.div_euclid(SCREEN_W), world_y.div_euclid(SCREEN_H))?;
        if next == room {
            return None;
        }
        let (nx, ny) = self.room(next).world()?;
        Some((next, world_x - nx as i32 * SCREEN_W, world_y - ny as i32 * SCREEN_H))
    }
}

/// A picture behind a room and how it follows the camera.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Background {
    /// Index of the picture among the game's compiled ones (`gfx::BACKGROUNDS`).
    pub image: u16,
    /// How far it scrolls for every 256 pixels the camera moves, across and down:
    /// 0 stands still, 256 moves with the room, less looks farther away.
    pub parallax: (u16, u16),
}

impl Background {
    /// The pixel of the picture at the screen's top-left corner, for a camera that
    /// has moved `(dx, dy)` from where the picture was laid down.
    #[inline]
    pub const fn scroll(&self, dx: i32, dy: i32) -> (i32, i32) {
        ((dx * self.parallax.0 as i32) >> 8, (dy * self.parallax.1 as i32) >> 8)
    }
}

/// One room of a [`World`].
#[derive(Clone, Copy, Debug)]
pub struct Room<'a> {
    world: &'a World<'a>,
    index: usize,
    record: &'a RoomRecord,
}

impl<'a> Room<'a> {
    /// Its index in the world.
    #[inline]
    pub const fn index(&self) -> usize {
        self.index
    }
    pub fn id(&self) -> &'a str {
        self.world.str_at(self.record, R_ID)
    }
    pub fn name(&self) -> &'a str {
        self.world.str_at(self.record, R_NAME)
    }
    /// Size in tiles: a whole number of screens, 30 by 20 each.
    #[inline]
    pub const fn cols(&self) -> u16 {
        half(self.record, R_COLS)
    }
    #[inline]
    pub const fn rows(&self) -> u16 {
        half(self.record, R_ROWS)
    }
    #[inline]
    pub const fn width(&self) -> i32 {
        self.cols() as i32 * TILE
    }
    #[inline]
    pub const fn height(&self) -> i32 {
        self.rows() as i32 * TILE
    }
    /// Where its top-left screen sits on the world grid, if it is on the map.
    #[inline]
    pub const fn world(&self) -> Option<(i16, i16)> {
        if half(self.record, R_FLAGS) & FLAG_ON_MAP == 0 { None } else { Some((half(self.record, R_WORLD_X) as i16, half(self.record, R_WORLD_Y) as i16)) }
    }
    /// Index of the track that plays here.
    #[inline]
    pub const fn music(&self) -> Option<u16> {
        if half(self.record, R_FLAGS) & FLAG_MUSIC == 0 { None } else { Some(half(self.record, R_MUSIC)) }
    }
    /// Index of the tileset it is drawn with, in `gfx::TILESETS`.
    #[inline]
    pub const fn tileset(&self) -> u16 {
        half(self.record, R_TILESET)
    }

    /// Collision class index of every cell, row by row: painted overrides and the
    /// tiles' own classes already resolved.
    #[inline]
    pub fn collision(&self) -> &'a [u8] {
        let at = word(self.record, R_COLLISION) as usize;
        &self.world.cells[at..at + self.cols() as usize * self.rows() as usize]
    }

    /// Collision class index of a cell; 0 (the project's first class) outside the room.
    #[inline]
    pub fn class_index(&self, col: i32, row: i32) -> u8 {
        let (cols, rows) = (self.cols() as i32, self.rows() as i32);
        if col < 0 || row < 0 || col >= cols || row >= rows {
            return 0;
        }
        self.world.cells[word(self.record, R_COLLISION) as usize + (row * cols + col) as usize]
    }

    /// How many tile layers it has, 1 to 3.
    #[inline]
    pub const fn layer_count(&self) -> usize {
        byte(self.record, R_LAYER_COUNT) as usize
    }

    /// A tile layer's cell, `layer` 0 being the back one: 0 is empty, n is tile n-1.
    /// Outside the room, 0.
    #[inline]
    pub fn tile(&self, layer: usize, col: i32, row: i32) -> u16 {
        let (cols, rows) = (self.cols() as i32, self.rows() as i32);
        if layer >= self.layer_count() || col < 0 || row < 0 || col >= cols || row >= rows {
            return 0;
        }
        let cell = layer * (cols * rows) as usize + (row * cols + col) as usize;
        u16::from_le(self.world.tiles[word(self.record, R_LAYERS) as usize / 2 + cell])
    }

    /// A whole tile layer, row by row, as [`Room::tile`] reads it: little-endian
    /// halfwords, so `u16::from_le` each. Empty past the last layer.
    #[inline]
    pub fn layer(&self, layer: usize) -> &'a [u16] {
        if layer >= self.layer_count() {
            return &[];
        }
        let cells = self.cols() as usize * self.rows() as usize;
        let at = word(self.record, R_LAYERS) as usize / 2 + layer * cells;
        &self.world.tiles[at..at + cells]
    }

    /// The pictures behind its tile layers, back to front: two at most.
    #[inline]
    pub fn backgrounds(&self) -> impl ExactSizeIterator<Item = Background> + 'a {
        let record = self.record;
        (0..byte(record, R_BACKGROUND_COUNT) as usize).map(move |n| {
            let at = R_BACKGROUNDS + n * BACKGROUND;
            Background { image: half(record, at), parallax: (half(record, at + 2), half(record, at + 4)) }
        })
    }

    /// The [`World::entity_index`] of its first entity.
    #[inline]
    pub const fn first_entity(&self) -> usize {
        word(self.record, R_FIRST_ENTITY) as usize
    }

    #[inline]
    pub const fn entity_count(&self) -> usize {
        word(self.record, R_ENTITY_COUNT) as usize
    }

    /// An entity of the room, by its place in the room's list.
    ///
    /// # Panics
    /// If the room has no entity `index`.
    #[inline]
    pub fn entity(&self, index: usize) -> Entity<'a> {
        assert!(index < self.entity_count(), "the room has no such entity");
        Entity::read(self.world, &self.world.entities[self.first_entity() + index])
    }

    /// Its entities in the order they were placed.
    #[inline]
    pub fn entities(&self) -> impl ExactSizeIterator<Item = Entity<'a>> + 'a {
        let (world, first) = (self.world, self.first_entity());
        world.entities[first..first + self.entity_count()].iter().map(move |record| Entity::read(world, record))
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Entity<'a> {
    world: &'a World<'a>,
    /// Index of its entity type in the project; the generated `EntityKind` names them.
    pub kind: u16,
    /// Position in pixels from the room's top-left: by convention the feet, the middle
    /// of the bottom edge.
    pub x: i16,
    pub y: i16,
    props: &'a [PropRecord],
}

impl<'a> Entity<'a> {
    #[inline]
    fn read(world: &'a World<'a>, record: &'a EntityRecord) -> Self {
        let first = word(record, E_FIRST_PROP) as usize;
        Entity {
            world,
            kind: half(record, E_KIND),
            x: half(record, E_X) as i16,
            y: half(record, E_Y) as i16,
            props: &world.props[first..first + half(record, E_PROP_COUNT) as usize],
        }
    }

    /// A property by name. Every property its type defines is there, with defaults filled in.
    #[inline]
    pub fn prop(&self, name: &str) -> Option<Prop<'a>> {
        let strings = self.world.strings;
        let prop = self.props.iter().find(|prop| {
            let (offset, length) = (word(prop, P_NAME) as usize, word(prop, P_NAME + 4) as usize);
            length == name.len() && strings[offset..offset + length] == *name.as_bytes()
        })?;
        Some(match byte(prop, P_TAG) {
            TAG_BOOL => Prop::Bool(word(prop, P_VALUE) != 0),
            TAG_TEXT => Prop::Str(self.world.str_at(prop, P_VALUE)),
            _ => Prop::Int(word(prop, P_VALUE) as i32),
        })
    }
    #[inline]
    pub fn int(&self, name: &str) -> Option<i32> {
        match self.prop(name) {
            Some(Prop::Int(value)) => Some(value),
            _ => None,
        }
    }
    #[inline]
    pub fn bool(&self, name: &str) -> Option<bool> {
        match self.prop(name) {
            Some(Prop::Bool(value)) => Some(value),
            _ => None,
        }
    }
    #[inline]
    pub fn str(&self, name: &str) -> Option<&'a str> {
        match self.prop(name) {
            Some(Prop::Str(value)) => Some(value),
            _ => None,
        }
    }
}

/// A grid of collision cells a body can move through.
pub trait Cells {
    /// The class of a cell. Where there is nothing, the project's first class.
    fn class(&self, col: i32, row: i32) -> CollisionClass;

    /// The class of the cell holding a pixel.
    #[inline]
    fn class_at(&self, x: i32, y: i32) -> CollisionClass {
        self.class(x.div_euclid(TILE), y.div_euclid(TILE))
    }
}

/// One room on its own, in pixels from its top-left corner.
#[derive(Clone, Copy)]
pub struct RoomCells<'a> {
    pub room: Room<'a>,
}

impl Cells for RoomCells<'_> {
    #[inline]
    fn class(&self, col: i32, row: i32) -> CollisionClass {
        self.room.world.collision_class(self.room.class_index(col, row))
    }
}

/// Every room on the map as one space, in world pixels: screen `(sx, sy)` of the map
/// starts at pixel `(sx * 240, sy * 160)`.
impl Cells for World<'_> {
    #[inline]
    fn class(&self, col: i32, row: i32) -> CollisionClass {
        let index = self.room_at_tile(col, row).map_or(0, |room| {
            let room = self.room(room);
            let (wx, wy) = room.world().unwrap_or((0, 0));
            room.class_index(col - wx as i32 * SCREEN_COLS, row - wy as i32 * SCREEN_ROWS)
        });
        self.collision_class(index)
    }
}

/// A world whose outside is solid, for games with no pits: see [`World::enclosed`].
#[derive(Clone, Copy)]
pub struct Enclosed<'a>(&'a World<'a>);

const MAP_EDGE: CollisionClass = CollisionClass { kind: CollisionKind::Solid, slope: (0, 0) };

impl Cells for Enclosed<'_> {
    #[inline]
    fn class(&self, col: i32, row: i32) -> CollisionClass {
        if self.0.room_at_tile(col, row).is_some() { Cells::class(self.0, col, row) } else { MAP_EDGE }
    }
}

/// Which entities are gone for good: coins picked up, doors opened. A bit per entity,
/// numbered by [`World::entity_index`]; `WORDS` of 32 bits each, so size it with
/// `data::ENTITY_COUNT.div_ceil(32)`. The words are plain data a game can save.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Collected<const WORDS: usize> {
    pub words: [u32; WORDS],
}

impl<const WORDS: usize> Default for Collected<WORDS> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const WORDS: usize> Collected<WORDS> {
    pub const fn new() -> Self {
        Self { words: [0; WORDS] }
    }

    /// Whether an entity has been taken. An index past the end has not.
    pub const fn has(&self, index: usize) -> bool {
        index / 32 < WORDS && self.words[index / 32] & (1 << (index % 32)) != 0
    }

    /// Marks an entity as taken. Returns whether that is news: false if it already
    /// was, or if the index is past the end.
    pub const fn take(&mut self, index: usize) -> bool {
        if index / 32 >= WORDS || self.has(index) {
            return false;
        }
        self.words[index / 32] |= 1 << (index % 32);
        true
    }

    /// How many entities have been taken.
    pub fn count(&self) -> u32 {
        self.words.iter().map(|word| word.count_ones()).sum()
    }
}

#[cfg(test)]
pub(crate) mod tests;
