extern crate std;

use super::write::{ClassData, EntityData, RoomData, WorldData, write};
use super::*;
use alloc::{boxed::Box, vec, vec::Vec};

pub(crate) const CLASSES: [CollisionClass; 5] = [
    CollisionClass { kind: CollisionKind::Empty, slope: (0, 0) },
    CollisionClass { kind: CollisionKind::Solid, slope: (0, 0) },
    CollisionClass { kind: CollisionKind::OneWay, slope: (0, 0) },
    CollisionClass { kind: CollisionKind::Slope, slope: (0, 8) },
    CollisionClass { kind: CollisionKind::Slope, slope: (8, 0) },
];
const CLASS_IDS: [&str; 5] = ["empty", "solid", "oneway", "up", "down"];

/// A room drawn in text: `#` solid, `=` one-way, `/` and `\` slopes.
pub(crate) fn room(map: &[&str], world: Option<(i16, i16)>) -> RoomData<'static> {
    let collision: Vec<u8> = map
        .iter()
        .flat_map(|row| row.bytes())
        .map(|c| match c {
            b'#' => 1,
            b'=' => 2,
            b'/' => 3,
            b'\\' => 4,
            _ => 0,
        })
        .collect();
    let (cols, rows) = (map[0].len() as u16, map.len() as u16);
    RoomData {
        id: "test",
        name: "Test",
        cols,
        rows,
        world,
        music: None,
        tileset: 0,
        layers: vec![collision.iter().map(|&c| c as u16).collect()],
        collision,
        backgrounds: Vec::new(),
        entities: Vec::new(),
    }
}

pub(crate) fn world_data(rooms: Vec<RoomData<'static>>) -> WorldData<'static> {
    WorldData {
        classes: CLASS_IDS.iter().zip(CLASSES).map(|(id, class)| ClassData { id, class }).collect(),
        rooms,
        start: Some(0),
        physics: Physics { mode: PhysicsMode::Platformer, platformer: PlatformerPhysics::DEFAULT, top_down: TopDownPhysics::DEFAULT },
        manifest: Default::default(),
    }
}

/// A world of these rooms, its bytes kept for the rest of the test run.
pub(crate) fn world_of(rooms: Vec<RoomData<'static>>) -> World<'static> {
    let (bytes, _) = write(&world_data(rooms), None);
    let bytes: &'static [u8] = Box::leak(bytes.into_boxed_slice());
    World::new(bytes, &Limits::ANY).unwrap()
}

fn coin(x: i16) -> EntityData<'static> {
    EntityData { kind: 0, x, y: 0, props: vec![("value", Prop::Int(5))] }
}

#[test]
fn entities_are_numbered_across_rooms() {
    let mut rooms = vec![room(&["."], None), room(&["."], None), room(&["."], None)];
    rooms[0].entities = vec![coin(0), coin(1)];
    rooms[2].entities = vec![coin(0), coin(1), coin(2)];
    let world = world_of(rooms);
    assert_eq!(world.entity_count(), 5);
    assert_eq!(world.entity_index(0, 1), 1);
    assert_eq!(world.entity_index(2, 0), 2);
    assert_eq!(world.entity_index(2, 2), 4);
    assert_eq!(world.room(2).entity(2).x, 2);
    assert_eq!(world.room(1).entities().len(), 0);
}

#[test]
fn reads_back_everything_written() {
    let mut first = room(&["#..", ".=/"], Some((3, -1)));
    first.id = "cave";
    first.name = "Crystal cave";
    first.music = Some(2);
    first.tileset = 1;
    first.layers = vec![vec![0, 1, 2, 3, 4, 5], vec![9; 6], vec![65535, 0, 0, 0, 0, 7]];
    first.backgrounds = vec![Background { image: 0, parallax: (64, 0) }, Background { image: 3, parallax: (128, 256) }];
    first.entities = vec![
        EntityData { kind: 2, x: -4, y: 300, props: vec![("value", Prop::Int(-7)), ("open", Prop::Bool(true)), ("says", Prop::Str("héllo"))] },
        EntityData { kind: 1, x: 10, y: 20, props: vec![] },
    ];
    let mut data = world_data(vec![first, room(&["."], None)]);
    data.start = Some(1);
    data.physics.mode = PhysicsMode::TopDown;
    data.physics.platformer.air_jumps = 2;
    data.physics.platformer.jump_cut = -1;
    data.physics.top_down = TopDownPhysics {
        movement: Movement::Grid,
        speed: 99,
        acceleration: 3,
        friction: 4,
        directions: 4,
        normalize_diagonal: false,
        corner_slide: 6,
        grid_size: 8,
    };
    let (bytes, used) = write(&data, Some(0));
    assert_eq!(bytes.len(), used);
    let world = World::new(&bytes, &Limits::ANY).unwrap();

    assert_eq!(world.class_count(), 5);
    assert_eq!(world.collision_class(3), CLASSES[3]);
    assert_eq!(world.class_id(2), "oneway");
    assert_eq!(world.start(), Some(1));
    assert_eq!(world.physics(), data.physics);

    let cave = world.room(0);
    assert_eq!((cave.id(), cave.name()), ("cave", "Crystal cave"));
    assert_eq!((cave.cols(), cave.rows(), cave.width(), cave.height()), (3, 2, 24, 16));
    assert_eq!((cave.world(), cave.music(), cave.tileset()), (Some((3, -1)), Some(2), 1));
    assert_eq!(cave.collision(), &[1, 0, 0, 0, 2, 3]);
    assert_eq!(cave.class_index(2, 1), 3);
    assert_eq!(cave.class_index(3, 0), 0, "outside is class 0");
    assert_eq!(cave.layer_count(), 3);
    assert_eq!(cave.tile(0, 2, 1), 5);
    assert_eq!(cave.tile(1, 0, 0), 9);
    assert_eq!(cave.tile(2, 0, 0), 65535);
    assert_eq!(cave.tile(2, 2, 1), 7);
    assert_eq!(cave.tile(3, 0, 0), 0, "no fourth layer");
    assert_eq!(cave.tile(0, -1, 0), 0);
    assert_eq!(cave.backgrounds().collect::<Vec<_>>(), [Background { image: 0, parallax: (64, 0) }, Background { image: 3, parallax: (128, 256) }]);

    let sign = cave.entity(0);
    assert_eq!((sign.kind, sign.x, sign.y), (2, -4, 300));
    assert_eq!(sign.int("value"), Some(-7));
    assert_eq!(sign.bool("open"), Some(true));
    assert_eq!(sign.str("says"), Some("héllo"));
    assert_eq!(sign.int("open"), None, "a property of another type");
    assert_eq!(sign.prop("missing"), None);
    assert_eq!(cave.entity(1).prop("value"), None);

    let other = world.room(1);
    assert_eq!((other.world(), other.music(), other.backgrounds().len()), (None, None, 0));
    assert_eq!(world.rooms().map(|room| room.index()).collect::<Vec<_>>(), [0, 1]);
}

#[test]
fn the_section_has_a_header_a_table_and_a_reserve() {
    let (bytes, used) = write(&world_data(vec![room(&["#."], Some((0, 0)))]), None);
    assert_eq!(&bytes[..8], b"PECTDATA");
    assert_eq!(u16::from_le_bytes([bytes[8], bytes[9]]), layout::VERSION);
    assert_eq!(u16::from_le_bytes([bytes[10], bytes[11]]) as usize, layout::SECTIONS);
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
    assert_eq!(word(12), used);
    assert_eq!(word(16), bytes.len());
    assert_eq!(bytes.len() - used, layout::default_reserve(used));
    assert!(bytes[used..].iter().all(|&b| b == 0));
    for n in 0..layout::SECTIONS {
        let (offset, length) = (word(20 + n * 8), word(24 + n * 8));
        assert_eq!(offset % 4, 0);
        assert!(offset + length <= used);
    }
    let (sized, _) = write(&world_data(vec![room(&["#."], None)]), Some(100));
    assert_eq!(sized.len(), (used + 100).next_multiple_of(4));
}

#[test]
fn the_default_reserve_is_a_quarter_and_at_least_4_kib() {
    assert_eq!(layout::default_reserve(0), 4096);
    assert_eq!(layout::default_reserve(16000), 4096);
    assert_eq!(layout::default_reserve(16400), 5120);
    assert_eq!(layout::default_reserve(40000), 10240);
}

#[test]
fn refuses_sections_that_do_not_hold_together() {
    let good = || write(&world_data(vec![room(&["#."], Some((0, 0)))]), Some(0)).0;
    let refused = |bytes: &[u8]| World::new(bytes, &Limits::ANY).err();
    assert!(refused(&good()).is_none());
    assert_eq!(refused(&good()[..10]), Some(DataError::TooShort));

    let mut bytes = good();
    bytes[0] = b'X';
    assert_eq!(refused(&bytes), Some(DataError::Magic));

    let mut bytes = good();
    bytes[8] = 2;
    assert_eq!(refused(&bytes), Some(DataError::Version(2)));

    // The rooms section said to run past the end.
    let mut bytes = good();
    let entry = layout::HEADER + layout::S_ROOMS * 8 + 4;
    bytes[entry..entry + 4].copy_from_slice(&10_000u32.to_le_bytes());
    assert_eq!(refused(&bytes), Some(DataError::Section(layout::S_ROOMS)));

    // A room whose collision cells start past the cells section.
    let mut bytes = good();
    let rooms = u32::from_le_bytes(bytes[layout::HEADER + layout::S_ROOMS * 8..][..4].try_into().unwrap()) as usize;
    bytes[rooms + layout::R_COLLISION..][..4].copy_from_slice(&5_000u32.to_le_bytes());
    assert_eq!(refused(&bytes), Some(DataError::Room(0)));

    // A cell naming a class there is not.
    let mut data = world_data(vec![room(&["#."], None)]);
    data.rooms[0].collision[1] = 9;
    assert_eq!(refused(&write(&data, None).0), Some(DataError::Room(0)));

    // Indices the compiled game does not have.
    let mut data = world_data(vec![room(&["#."], None)]);
    data.rooms[0].tileset = 2;
    data.rooms[0].entities = vec![coin(0)];
    let bytes = write(&data, None).0;
    let limits = Limits { tilesets: 2, ..Limits::ANY };
    assert_eq!(World::new(&bytes, &limits).err(), Some(DataError::Room(0)));
    let limits = Limits { tilesets: 3, entity_kinds: 0, ..Limits::ANY };
    assert_eq!(World::new(&bytes, &limits).err(), Some(DataError::Entity(0)));

    let mut data = world_data(vec![room(&["#."], None)]);
    data.start = Some(1);
    assert_eq!(refused(&write(&data, None).0), Some(DataError::Globals));

    let mut data = world_data(vec![room(&["#."], None)]);
    data.physics.top_down.directions = 0;
    let mut bytes = write(&data, None).0;
    let globals = u32::from_le_bytes(bytes[layout::HEADER + layout::S_GLOBALS * 8..][..4].try_into().unwrap()) as usize;
    bytes[globals + layout::G_PHYSICS + 17 * 4..][..4].copy_from_slice(&300i32.to_le_bytes());
    assert_eq!(refused(&bytes), Some(DataError::Physics));
}

#[test]
fn an_entity_is_taken_once() {
    let mut found = Collected::<2>::new();
    assert!(!found.has(40));
    assert!(found.take(40));
    assert!(found.has(40));
    assert!(!found.take(40));
    assert!(!found.has(39) && !found.has(41) && !found.has(8));
    assert!(found.take(0));
    assert_eq!(found.count(), 2);
}

#[test]
fn an_index_past_the_end_is_never_taken() {
    let mut found = Collected::<1>::new();
    assert!(!found.take(32));
    assert!(!found.has(32));
    assert_eq!(found.count(), 0);
}
