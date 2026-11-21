//! Writes a data section. The build helper uses this to put a project into the ROM,
//! and the tests use it to make worlds. Needs `alloc`, behind the `write` feature.

use alloc::{collections::BTreeMap, vec, vec::Vec};

use super::{Background, CollisionClass, Prop, RoomDim, layout::*};
use crate::physics::{Movement, Physics, PhysicsMode};

/// A collision class to write.
#[derive(Clone, Debug)]
pub struct ClassData<'a> {
    pub id: &'a str,
    pub class: CollisionClass,
}

/// An entity to write.
#[derive(Clone, Debug)]
pub struct EntityData<'a> {
    pub kind: u16,
    pub x: i16,
    pub y: i16,
    pub props: Vec<(&'a str, Prop<'a>)>,
}

/// A room to write. `collision` and each of `layers` hold `cols * rows` cells.
#[derive(Clone, Debug)]
pub struct RoomData<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub cols: u16,
    pub rows: u16,
    pub world: Option<(i16, i16)>,
    pub music: Option<u16>,
    pub tileset: u16,
    pub collision: Vec<u8>,
    pub layers: Vec<Vec<u16>>,
    pub backgrounds: Vec<Background>,
    /// Which layers are darkened, and by how much.
    pub dim: RoomDim,
    pub entities: Vec<EntityData<'a>>,
}

/// A tileset or a picture as the game compiled it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtData<'a> {
    /// A tileset's id, or a picture's file path.
    pub id: &'a str,
    pub tiles: u32,
    pub palettes: u32,
}

/// What the game compiled from the project: see [`S_MANIFEST`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Manifest<'a> {
    /// Each entity type's id and its sprite's, in project order.
    pub entity_types: Vec<(&'a str, Option<&'a str>)>,
    pub tilesets: Vec<ArtData<'a>>,
    pub pictures: Vec<ArtData<'a>>,
    pub tracks: Vec<&'a str>,
}

/// Everything a section holds.
#[derive(Clone, Debug)]
pub struct WorldData<'a> {
    pub classes: Vec<ClassData<'a>>,
    pub rooms: Vec<RoomData<'a>>,
    pub start: Option<u16>,
    pub physics: Physics,
    pub manifest: Manifest<'a>,
    /// For each entity type, by index, its behaviours: each one's number and the
    /// position of its first property among the entity's. Types past the end have none.
    pub behaviours: Vec<Vec<(u16, u16)>>,
}

/// Strings, each kept once.
#[derive(Default)]
struct Strings<'a> {
    bytes: Vec<u8>,
    seen: BTreeMap<&'a str, u32>,
}

impl<'a> Strings<'a> {
    fn put(&mut self, out: &mut Vec<u8>, text: &'a str) {
        let bytes = &mut self.bytes;
        let offset = *self.seen.entry(text).or_insert_with(|| {
            bytes.extend_from_slice(text.as_bytes());
            (bytes.len() - text.len()) as u32
        });
        out.extend_from_slice(&offset.to_le_bytes());
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    }
}

fn pad(bytes: &mut Vec<u8>) {
    bytes.resize(bytes.len().next_multiple_of(4), 0);
}

/// Writes a section with `reserve` zero bytes after the data (the default reserve if
/// `None`). Returns the section, `capacity` bytes long, and how many of them are used.
///
/// The writer trusts its input: sizes and indices that do not fit are written as they
/// are and refused by [`super::World::new`]. The build helper checks the project first.
pub fn write(world: &WorldData, reserve: Option<usize>) -> (Vec<u8>, usize) {
    let mut strings = Strings::default();
    let mut sections: [Vec<u8>; SECTIONS] = Default::default();

    for class in &world.classes {
        let out = &mut sections[S_CLASSES];
        strings.put(out, class.id);
        out.extend_from_slice(&[class.class.kind.to_byte(), class.class.slope.0, class.class.slope.1, 0]);
    }

    let (mut entity_count, mut prop_count) = (0u32, 0u32);
    for room in &world.rooms {
        let cells = &mut sections[S_CELLS];
        let collision = cells.len() as u32;
        cells.extend_from_slice(&room.collision);
        pad(cells);
        let layers = cells.len() as u32;
        for layer in &room.layers {
            cells.extend(layer.iter().flat_map(|cell| cell.to_le_bytes()));
        }
        pad(cells);

        let out = &mut sections[S_ROOMS];
        strings.put(out, room.id);
        strings.put(out, room.name);
        let (wx, wy) = room.world.unwrap_or((0, 0));
        let flags = if room.world.is_some() { FLAG_ON_MAP } else { 0 } | if room.music.is_some() { FLAG_MUSIC } else { 0 } | room.dim.to_flags();
        for half in [room.cols, room.rows, wx as u16, wy as u16, flags, room.music.unwrap_or(0), room.tileset] {
            out.extend_from_slice(&half.to_le_bytes());
        }
        out.extend_from_slice(&[room.layers.len() as u8, room.backgrounds.len() as u8]);
        for word in [collision, layers, entity_count, room.entities.len() as u32] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        for n in 0..2 {
            let background = room.backgrounds.get(n).copied().unwrap_or(Background { image: 0, parallax: (0, 0) });
            for half in [background.image, background.parallax.0, background.parallax.1, 0] {
                out.extend_from_slice(&half.to_le_bytes());
            }
        }

        for entity in &room.entities {
            let out = &mut sections[S_ENTITIES];
            for half in [entity.kind, entity.x as u16, entity.y as u16, entity.props.len() as u16] {
                out.extend_from_slice(&half.to_le_bytes());
            }
            out.extend_from_slice(&prop_count.to_le_bytes());
            for (name, value) in &entity.props {
                let out = &mut sections[S_PROPS];
                strings.put(out, name);
                match *value {
                    Prop::Int(n) => {
                        out.extend_from_slice(&[TAG_INT, 0, 0, 0, n.to_le_bytes()[0], n.to_le_bytes()[1], n.to_le_bytes()[2], n.to_le_bytes()[3], 0, 0, 0, 0])
                    }
                    Prop::Bool(b) => out.extend_from_slice(&[TAG_BOOL, 0, 0, 0, b as u8, 0, 0, 0, 0, 0, 0, 0]),
                    Prop::Str(text) => {
                        out.extend_from_slice(&[TAG_TEXT, 0, 0, 0]);
                        strings.put(out, text);
                    }
                }
                prop_count += 1;
            }
            entity_count += 1;
        }
    }

    let globals = &mut sections[S_GLOBALS];
    globals.extend_from_slice(&world.start.unwrap_or(NO_ROOM).to_le_bytes());
    globals.extend_from_slice(&[0, 0]);
    globals.extend_from_slice(&entity_count.to_le_bytes());
    let (p, t) = (&world.physics.platformer, &world.physics.top_down);
    let fields: [i32; PHYSICS_FIELDS] = [
        (world.physics.mode == PhysicsMode::TopDown) as i32,
        p.gravity,
        p.fall_gravity,
        p.max_fall_speed,
        p.run_speed,
        p.ground_acceleration,
        p.ground_friction,
        p.air_acceleration,
        p.jump_speed,
        p.jump_cut,
        p.air_jumps as i32,
        p.coyote_frames as i32,
        p.jump_buffer_frames as i32,
        (t.movement == Movement::Grid) as i32,
        t.speed,
        t.acceleration,
        t.friction,
        t.directions as i32,
        t.normalize_diagonal as i32,
        t.corner_slide,
        t.grid_size,
    ];
    for field in fields {
        globals.extend_from_slice(&field.to_le_bytes());
    }
    let manifest = &world.manifest;
    let out = &mut sections[S_MANIFEST];
    for count in [manifest.entity_types.len(), manifest.tilesets.len(), manifest.pictures.len(), manifest.tracks.len()] {
        out.extend_from_slice(&(count as u32).to_le_bytes());
    }
    for (id, sprite) in &manifest.entity_types {
        strings.put(out, id);
        strings.put(out, sprite.unwrap_or(""));
    }
    for art in manifest.tilesets.iter().chain(&manifest.pictures) {
        strings.put(out, art.id);
        out.extend_from_slice(&art.tiles.to_le_bytes());
        out.extend_from_slice(&art.palettes.to_le_bytes());
    }
    for track in &manifest.tracks {
        strings.put(out, track);
    }
    sections[S_STRINGS] = strings.bytes;

    let out = &mut sections[S_BEHAVIOURS];
    let kinds = world.behaviours.len() as u32;
    let mut halves = vec![kinds as u16, (kinds >> 16) as u16];
    let mut first = 0u16;
    for kind in &world.behaviours {
        halves.extend([first, kind.len() as u16]);
        first += kind.len() as u16;
    }
    halves.extend(world.behaviours.iter().flatten().flat_map(|&(number, at)| [number, at]));
    out.extend(halves.iter().flat_map(|half| half.to_le_bytes()));

    let mut out = vec![0u8; table_end(SECTIONS)];
    out[..8].copy_from_slice(&MAGIC);
    out[H_VERSION..H_VERSION + 2].copy_from_slice(&VERSION.to_le_bytes());
    out[H_SECTIONS..H_SECTIONS + 2].copy_from_slice(&(SECTIONS as u16).to_le_bytes());
    for (n, section) in sections.iter().enumerate() {
        pad(&mut out);
        let (entry, offset) = (HEADER + n * 8, out.len() as u32);
        out[entry..entry + 4].copy_from_slice(&offset.to_le_bytes());
        out[entry + 4..entry + 8].copy_from_slice(&(section.len() as u32).to_le_bytes());
        out.extend_from_slice(section);
    }
    pad(&mut out);
    let used = out.len();
    let capacity = (used + reserve.unwrap_or_else(|| default_reserve(used))).next_multiple_of(4);
    out[H_USED..H_USED + 4].copy_from_slice(&(used as u32).to_le_bytes());
    out[H_CAPACITY..H_CAPACITY + 4].copy_from_slice(&(capacity as u32).to_le_bytes());
    out.resize(capacity, 0);
    (out, used)
}
