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
        dim: RoomDim::default(),
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

// Darkening.

#[test]
fn dim_settings_survive_the_data_section() {
    let mut dimmed = room(&["."], None);
    dimmed.dim = RoomDim { level: 11, tiles: 0b101, backgrounds: 0b10 };
    let mut plain = room(&["."], Some((1, 2)));
    plain.dim = RoomDim::default();
    let world = world_of(vec![dimmed, plain]);
    assert_eq!(world.room(0).dim(), RoomDim { level: 11, tiles: 0b101, backgrounds: 0b10 });
    assert_eq!(world.room(1).dim(), RoomDim::default());
    // The other flags are not disturbed.
    assert_eq!(world.room(1).world(), Some((1, 2)));
}

#[test]
fn a_room_without_dim_bits_is_not_dimmed() {
    // Rooms written before dimming have zeros in these bits of the flags.
    assert_eq!(RoomDim::from_flags(FLAG_ON_MAP | FLAG_MUSIC), RoomDim::default());
    assert!(!RoomDim::default().is_on());
}

#[test]
fn dim_flag_bits_are_where_the_layout_says() {
    // Tile layers at bit 2, backgrounds at bit 5, level at bit 8: tools read the same.
    let dim = RoomDim { level: 16, tiles: 0b001, backgrounds: 0b11 };
    assert_eq!(dim.to_flags(), (1 << 2) | (0b11 << 5) | (16 << 8));
    assert_eq!(RoomDim::from_flags(dim.to_flags()), dim);
    assert_eq!(dim.to_flags() & (FLAG_ON_MAP | FLAG_MUSIC), 0);
}

#[test]
fn a_level_needs_a_layer_to_do_anything() {
    assert!(RoomDim { level: 4, tiles: 0b010, backgrounds: 0 }.is_on());
    assert!(RoomDim { level: 4, tiles: 0, backgrounds: 0b01 }.is_on());
    assert!(!RoomDim { level: 4, tiles: 0, backgrounds: 0 }.is_on());
    assert!(!RoomDim { level: 0, tiles: 0b111, backgrounds: 0b11 }.is_on());
}

#[test]
fn a_level_above_black_is_refused_when_reading() {
    let mut rooms = vec![room(&["."], None)];
    rooms[0].dim = RoomDim { level: 17, tiles: 1, backgrounds: 0 };
    let (bytes, _) = write(&world_data(rooms), None);
    assert!(World::new(&bytes, &Limits::ANY).is_err());
}

#[test]
fn set_dim_jumps_and_clamps() {
    let mut dim = Dim::new(3);
    assert_eq!(dim.level(), 3);
    dim.set(16);
    assert_eq!(dim.level(), 16);
    dim.set(200);
    assert_eq!(dim.level(), MAX_DIM);
    assert!(!dim.fading());
}

#[test]
fn a_fade_reaches_its_target_exactly_in_the_frames_asked() {
    let mut dim = Dim::new(0);
    dim.fade(16, 8);
    let mut seen = Vec::new();
    for _ in 0..8 {
        assert!(dim.fading());
        dim.step();
        seen.push(dim.level());
    }
    assert_eq!(seen, [2, 4, 6, 8, 10, 12, 14, 16]);
    assert!(!dim.fading());
    assert!(!dim.step());
    assert_eq!(dim.level(), 16);
}

#[test]
fn a_fade_down_and_a_slow_fade_never_skip_past_the_target() {
    let mut dim = Dim::new(12);
    dim.fade(0, 5);
    let mut last = 12;
    for _ in 0..5 {
        dim.step();
        assert!(dim.level() <= last);
        last = dim.level();
    }
    assert_eq!(dim.level(), 0);
    // More frames than levels: the level holds between changes.
    dim.fade(4, 60);
    let mut changes = 0;
    for _ in 0..60 {
        changes += dim.step() as u32;
    }
    assert_eq!((dim.level(), changes), (4, 4));
}

#[test]
fn a_fade_over_no_frames_is_a_jump_and_a_new_fade_starts_where_the_level_is() {
    let mut dim = Dim::new(2);
    dim.fade(9, 0);
    assert_eq!((dim.level(), dim.fading()), (9, false));
    dim.fade(0, 3);
    dim.step();
    assert_eq!(dim.level(), 6);
    dim.fade(16, 2);
    dim.step();
    assert_eq!(dim.level(), 11);
    dim.set(1);
    assert!(!dim.fading());
    assert_eq!(dim.level(), 1);
}

#[test]
fn darkened_colours_match_the_shared_fixture() {
    // codegen/fixture/dim.json is read by the studio's preview tests too. The runtime has
    // no JSON reader, so this takes the numbers after each key in turn.
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../codegen/fixture/dim.json")).unwrap();
    let after = |key: &str, from: usize| -> (u16, usize) {
        let at = from + text[from..].find(key).unwrap() + key.len();
        let digits: std::string::String = text[at..].chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
        (digits.parse().unwrap(), at)
    };
    let (mut at, mut count) = (text.find("\"cases\"").unwrap(), 0);
    while text[at..].contains("\"level\"") {
        let (level, next) = after("\"level\"", at);
        let (input, next) = after("\"in\"", next);
        let (output, next) = after("\"out\"", next);
        assert_eq!(super::dim::darken_bgr555(input, level as u8), output, "{input} at {level}");
        (at, count) = (next, count + 1);
    }
    assert!(count > 100);
}

#[test]
fn asking_for_the_same_fade_every_frame_lets_it_run() {
    let mut dim = Dim::new(0);
    for _ in 0..8 {
        dim.fade(16, 8);
        dim.step();
    }
    assert_eq!(dim.level(), 16);
    // Already there: nothing starts.
    dim.fade(16, 8);
    assert!(!dim.fading());
}

#[test]
fn entering_a_room_puts_its_own_level_back_but_the_same_room_again_does_not() {
    let mut dim = Dim::new(0);
    dim.enter(0, 6);
    assert_eq!(dim.level(), 6);
    // A dialogue dims the scene; the view is told about the room again (it may be every frame).
    dim.set(14);
    dim.enter(0, 6);
    assert_eq!(dim.level(), 14);
    // Another room restores its own level, ending a fade in progress.
    dim.fade(0, 10);
    dim.enter(1, 3);
    assert_eq!((dim.level(), dim.fading()), (3, false));
    // And coming back to the first room does the same.
    dim.set(16);
    dim.enter(0, 6);
    assert_eq!(dim.level(), 6);
}
