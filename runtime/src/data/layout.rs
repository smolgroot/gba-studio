//! The byte layout of the data section, shared by the reader in [`super`] and the
//! writer in [`super::write`]. `docs/reference/data-section.md` describes the same
//! layout for tools: change them together, and raise [`VERSION`] when a reader of the
//! old layout would misread the new one.
//!
//! Everything is little-endian. Offsets are in bytes; those in the header's table are
//! from the start of the section, those inside records are from the start of the
//! section they point into. Every section starts on a 4-byte boundary.

/// The first bytes of the section, so tools can find it in a ROM.
pub const MAGIC: [u8; 8] = *b"PECTDATA";
/// The layout version. A reader refuses any other.
pub const VERSION: u16 = 1;

/// Header: magic, version (u16), section count (u16), bytes used (u32), capacity (u32).
pub const HEADER: usize = 20;
pub const H_VERSION: usize = 8;
pub const H_SECTIONS: usize = 10;
pub const H_USED: usize = 12;
pub const H_CAPACITY: usize = 16;

/// Sections in the table, each `{ offset u32, length u32 }`, in this order. A later
/// version may add sections after these; a reader skips those it does not know.
pub const SECTIONS: usize = 8;
pub const S_STRINGS: usize = 0;
pub const S_CLASSES: usize = 1;
pub const S_ROOMS: usize = 2;
pub const S_ENTITIES: usize = 3;
pub const S_PROPS: usize = 4;
pub const S_CELLS: usize = 5;
pub const S_GLOBALS: usize = 6;
pub const S_MANIFEST: usize = 7;

/// Where the first section may start: after the header and the table.
pub const fn table_end(sections: usize) -> usize {
    (HEADER + sections * 8).next_multiple_of(4)
}

/// A string: `{ offset u32, length u32 }` into the strings section, UTF-8.
pub const STR: usize = 8;

/// A collision class: id (string), kind (u8), slope left and right (u8), one zero byte.
pub const CLASS: usize = 12;
pub const C_ID: usize = 0;
pub const C_KIND: usize = 8;
pub const C_SLOPE: usize = 9;

/// Collision kinds as stored.
pub const KIND_EMPTY: u8 = 0;
pub const KIND_SOLID: u8 = 1;
pub const KIND_ONE_WAY: u8 = 2;
pub const KIND_SLOPE: u8 = 3;
pub const KIND_HAZARD: u8 = 4;
pub const KIND_CUSTOM: u8 = 5;

/// A room.
pub const ROOM: usize = 64;
pub const R_ID: usize = 0;
pub const R_NAME: usize = 8;
/// Size in tiles, u16 each.
pub const R_COLS: usize = 16;
pub const R_ROWS: usize = 18;
/// Top-left screen on the world grid, i16 each; meaningful when [`FLAG_ON_MAP`] is set.
pub const R_WORLD_X: usize = 20;
pub const R_WORLD_Y: usize = 22;
/// u16 of `FLAG_` bits.
pub const R_FLAGS: usize = 24;
/// Track index, u16; meaningful when [`FLAG_MUSIC`] is set.
pub const R_MUSIC: usize = 26;
/// Index of its tileset among the game's compiled tilesets, u16.
pub const R_TILESET: usize = 28;
/// Tile layers (u8, 0 to 3) and background layers (u8, 0 to 2).
pub const R_LAYER_COUNT: usize = 30;
pub const R_BACKGROUND_COUNT: usize = 31;
/// Into the cells section, u32: `cols * rows` collision class indices (u8).
pub const R_COLLISION: usize = 32;
/// Into the cells section, u32, even: the tile layers back to front, `cols * rows` u16 each.
pub const R_LAYERS: usize = 36;
/// Index of its first entity in the entities section, and how many it has; u32 each.
/// Rooms' entities follow each other in room order, so the first is also the number
/// of entities in the rooms before.
pub const R_FIRST_ENTITY: usize = 40;
pub const R_ENTITY_COUNT: usize = 44;
/// Two background layers of [`BACKGROUND`] bytes; those past the count are zeros.
pub const R_BACKGROUNDS: usize = 48;

pub const FLAG_ON_MAP: u16 = 1;
pub const FLAG_MUSIC: u16 = 2;
/// Dimming, in the same u16: which tile layers (3 bits, back to front) and which
/// backgrounds (2 bits) are darkened, and by how much (5 bits, 0 to 16). Rooms
/// written before dimming have zeros here, which is no dimming.
pub const FLAG_DIM_TILES_SHIFT: u16 = 2;
pub const FLAG_DIM_BACKGROUNDS_SHIFT: u16 = 5;
pub const FLAG_DIM_LEVEL_SHIFT: u16 = 8;

/// A background layer: picture index among the game's compiled pictures (u16), then
/// parallax across and down in 256ths of the camera's movement (u16 each), then zeros.
pub const BACKGROUND: usize = 8;

/// An entity: type index (u16), x and y in pixels (i16), property count (u16), index of
/// its first property in the props section (u32).
pub const ENTITY: usize = 12;
pub const E_KIND: usize = 0;
pub const E_X: usize = 2;
pub const E_Y: usize = 4;
pub const E_PROP_COUNT: usize = 6;
pub const E_FIRST_PROP: usize = 8;

/// A property: name (string), tag (u8) and three zero bytes, value (u32), value length (u32).
/// An integer is its i32 bits, a boolean 0 or 1; text is an offset and length into the
/// strings section. The length is 0 for integers and booleans.
pub const PROP: usize = 20;
pub const P_NAME: usize = 0;
pub const P_TAG: usize = 8;
pub const P_VALUE: usize = 12;
pub const P_LENGTH: usize = 16;

pub const TAG_INT: u8 = 0;
pub const TAG_BOOL: u8 = 1;
pub const TAG_TEXT: u8 = 2;

/// The globals: start room (u16, [`NO_ROOM`] for none), two zero bytes, entity count
/// (u32), then the physics as [`PHYSICS_FIELDS`] i32s.
pub const G_START: usize = 0;
pub const G_ENTITY_COUNT: usize = 4;
pub const G_PHYSICS: usize = 8;
pub const NO_ROOM: u16 = 0xFFFF;
/// Mode (0 platformer, 1 top-down); the 12 platformer fields; then the 8 top-down
/// fields (movement 0 free, 1 grid; normalize_diagonal 0 or 1), in the order of
/// [`crate::physics`]'s structs.
pub const PHYSICS_FIELDS: usize = 21;
pub const GLOBALS: usize = G_PHYSICS + PHYSICS_FIELDS * 4;

/// The reserve when the project sets none: a quarter of the data, rounded up to a
/// KiB, and never under 4 KiB.
pub const fn default_reserve(used: usize) -> usize {
    let quarter = (used / 4).next_multiple_of(1024);
    if quarter < 4096 { 4096 } else { quarter }
}

/// The manifest: what the game compiled from the project, beside the section, so a
/// tool can tell whether a new section still fits the game or it must be rebuilt.
/// The game itself does not read it.
///
/// Four counts (u32 each): entity types, tilesets, pictures, tracks. Then the records,
/// in that order:
/// - entity type, [`M_ENTITY_TYPE`] bytes: id (string), sprite id (string, empty for none);
/// - tileset, [`M_ART`] bytes: id (string), tiles (u32), palettes (u32);
/// - picture, [`M_ART`] bytes: file path (string), distinct tiles (u32), palettes (u32);
/// - track, [`STR`] bytes: id (string).
///
/// Collision class and room ids, which also become code, are in their own sections.
pub const M_COUNTS: usize = 16;
pub const M_ENTITY_TYPE: usize = 16;
pub const M_ART: usize = 16;
