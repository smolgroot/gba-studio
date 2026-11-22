extern crate std;

use super::live::{MAX_ACTIVE_ROOMS, slots_for};
use super::tests::{BOX, COLLECTIBLE, HAZARD, PATROL, away, cx, entity_of, world_of_rooms};
use super::*;
use crate::data::Prop;
use crate::data::tests::room;
use crate::data::write::{EntityData, RoomData};
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;
use declare::Declaration;

/// A room of one screen, its top-left screen at `(x, y)` on the world map, with a floor.
fn screen(x: i16, y: i16) -> RoomData<'static> {
    let mut rows: Vec<String> = (0..19).map(|_| ".".repeat(30)).collect();
    rows.push("#".repeat(30));
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    room(&rows, Some((x, y)))
}

const SENTRY: &[&Declaration] = &[&Patrol::DECLARATION, &Hazard::DECLARATION];

/// Type 0 is a sentry (patrol then hazard), type 1 a coin, type 2 has no behaviours.
const TYPES: &[&[&Declaration]] = &[SENTRY, COLLECTIBLE, &[]];

fn sentry(x: i16, reach: i32) -> EntityData<'static> {
    entity_of(0, x, 100, vec![("patrol", Prop::Int(reach)), ("patrol_pace", Prop::Int(1))])
}

fn coin(x: i16) -> EntityData<'static> {
    entity_of(1, x, 100, vec![("value", Prop::Int(5))])
}

/// Rooms A at screen (0, 0) and B at (1, 0), touching, and C at (3, 0), apart.
fn three_rooms(a: Vec<EntityData<'static>>, b: Vec<EntityData<'static>>, c: Vec<EntityData<'static>>) -> World<'static> {
    world_of_rooms(TYPES, vec![(screen(0, 0), a), (screen(1, 0), b), (screen(3, 0), c)])
}

fn hitbox(_kind: u16) -> Hitbox {
    BOX
}

/// An area covering the whole map: every active room runs.
const EVERYWHERE: (i32, i32, i32, i32) = (-10_000, -10_000, 20_000, 20_000);

fn keep(_index: usize) -> bool {
    false
}

/// Runs one frame with the generated defaults: every entity's behaviours, events collected.
fn frame<const N: usize>(table: &mut LiveEntities<N>, world: &World, player: &Body, clock: u32) -> Vec<(u16, Event)> {
    let mut events = Vec::new();
    table.update(world, &cx(player, clock), EVERYWHERE, |_| Dispatch::Behaviours, |entity, event| events.push((entity.index, event)));
    events
}

#[test]
fn every_behaviour_number_builds_its_variant() {
    let types: Vec<&[&Declaration]> = DECLARATIONS.iter().map(core::slice::from_ref).collect();
    let entities = (0..types.len() as u16).map(|kind| entity_of(kind, 10 + kind as i16 * 20, 100, vec![])).collect();
    let world = world_of_rooms(&types, vec![(screen(0, 0), entities)]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    for (kind, declaration) in DECLARATIONS.iter().enumerate() {
        let entity = table.get(kind).expect("every entity is built");
        let numbers: Vec<u16> = entity.behaviours().map(Attached::number).collect();
        assert_eq!(numbers, [declaration.number], "{}", declaration.id);
    }
    assert_eq!(table.dropped(), (0, 0));
}

#[test]
fn an_unknown_behaviour_number_builds_nothing() {
    let world = world_of_rooms(PATROL_TYPES, vec![(screen(0, 0), vec![sentry(50, 8)])]);
    let settings = world.room(0).entity(0).behaviour(Patrol::DECLARATION.number).unwrap();
    assert!(Attached::from_settings(999, &settings).is_none());
}

const PATROL_TYPES: &[&[&Declaration]] = &[PATROL];

#[test]
fn update_runs_each_entitys_behaviours_in_its_types_order() {
    // The sentry walks right 20 pixels in 20 frames; the hazard after it hurts where it
    // has walked to, not where it was placed.
    let world = three_rooms(vec![sentry(50, 20)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    let there = Body::new(50 + 20 - 4, 100 - 8, 8, 8);
    assert_eq!(frame(&mut table, &world, &there, 0), []);
    assert_eq!(frame(&mut table, &world, &there, 20), [(0, Event::Hurt)]);
    assert_eq!(table.get(0).unwrap().actor.x, 70);
}

#[test]
fn a_collectible_is_reported_once_and_then_is_not_active() {
    let world = three_rooms(vec![coin(40), coin(120)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    let on_first = Body::new(36, 92, 8, 8);
    assert_eq!(frame(&mut table, &world, &on_first, 0), [(0, Event::Collect { value: 5 })]);
    assert_eq!(frame(&mut table, &world, &on_first, 1), []);
    let left: Vec<u16> = table.active().map(|entity| entity.index).collect();
    assert_eq!(left, [1]);
}

#[test]
fn a_game_can_handle_a_kind_instead_of_its_behaviours() {
    let world = three_rooms(vec![sentry(50, 20), coin(52)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    let on_both = Body::new(46, 92, 8, 8);
    let mut events = Vec::new();
    let mut handled = Vec::new();
    table.update(
        &world,
        &cx(&on_both, 0),
        EVERYWHERE,
        |entity| {
            if entity.kind == 0 {
                handled.push(entity.index);
                Dispatch::Handled
            } else {
                Dispatch::Behaviours
            }
        },
        |entity, event| events.push((entity.kind, event)),
    );
    assert_eq!(handled, [0]);
    // The sentry touched the player but its hazard did not run; the coin's did.
    assert_eq!(events, [(1, Event::Collect { value: 5 })]);
}

#[test]
fn a_game_can_act_before_the_behaviours_run() {
    let world = three_rooms(vec![sentry(50, 20)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    // Moving its home before the patrol runs: the patrol walks around the new one.
    table.update(
        &world,
        &cx(&away(), 5),
        EVERYWHERE,
        |entity| {
            entity.actor.home.0 += 100;
            Dispatch::Behaviours
        },
        |_, _| {},
    );
    assert_eq!(table.get(0).unwrap().actor.x, 155);
}

#[test]
fn settings_are_read_once_and_kept() {
    let first = three_rooms(vec![sentry(50, 32)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&first, 0, hitbox, keep);
    // Another world with the same rooms but a shorter patrol: the table does not read it.
    let second = three_rooms(vec![sentry(50, 8)], vec![], vec![]);
    frame(&mut table, &second, &away(), 32);
    assert_eq!(table.get(0).unwrap().actor.x, 50 + 32);
    assert_eq!(table.get(0).unwrap().behaviours[0], Some(Attached::Patrol(Patrol::new(32, 1))));
}

#[test]
fn the_active_rooms_are_the_one_entered_and_those_touching_it() {
    let world = three_rooms(vec![coin(10)], vec![coin(10), coin(20)], vec![coin(10)]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    assert_eq!(table.active_rooms().collect::<Vec<_>>(), [0..1, 1..3]);
    assert_eq!(table.active().map(|e| e.index).collect::<Vec<_>>(), [0, 1, 2]);
    table.enter(&world, 2, hitbox, keep);
    assert_eq!(table.active_rooms().collect::<Vec<_>>(), vec![3..4]);
    // Only the active rooms are updated: the coin in room A is not taken from room C.
    let on_a_coin = Body::new(6, 92, 8, 8);
    assert_eq!(frame(&mut table, &world, &on_a_coin, 0), []);
    let active: Vec<u16> = table.active_mut().map(|e| e.index).collect();
    assert_eq!(active, [3]);
}

#[test]
fn only_the_active_rooms_in_the_area_run() {
    let world = three_rooms(vec![coin(10)], vec![coin(10)], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    // The player stands on both coins at once (one at x 10 in each room is 240 apart),
    // as far as touching goes; only room A is in the area.
    let on_a_coin = Body::new(6, 92, 8, 8);
    let on_b_coin = Body::new(246, 92, 8, 8);
    let mut events = Vec::new();
    let screen_a = (0, 0, 240, 160);
    for player in [&on_a_coin, &on_b_coin] {
        table.update(&world, &cx(player, 0), screen_a, |_| Dispatch::Behaviours, |entity, event| events.push((entity.index, event)));
    }
    assert_eq!(events, [(0, Event::Collect { value: 5 })]);
    // A camera across the edge runs both rooms.
    table.update(&world, &cx(&on_b_coin, 0), (100, 0, 240, 160), |_| Dispatch::Behaviours, |entity, event| events.push((entity.index, event)));
    assert_eq!(events[1..], [(1, Event::Collect { value: 5 })]);
}

#[test]
fn the_visible_entities_are_those_of_the_active_rooms_in_the_area() {
    let world = three_rooms(vec![coin(10)], vec![coin(10), coin(20)], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    let shown = |area| table.visible(area).map(|e| e.index).collect::<Vec<_>>();
    assert_eq!(shown((0, 0, 240, 160)), [0]);
    assert_eq!(shown((240, 0, 240, 160)), [1, 2]);
    assert_eq!(shown((100, 0, 240, 160)), [0, 1, 2]);
}

#[test]
fn a_room_left_is_as_it_was_on_coming_back() {
    let world = three_rooms(vec![coin(40), sentry(150, 20)], vec![], vec![coin(10)]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    frame(&mut table, &world, &Body::new(36, 92, 8, 8), 0);
    table.get_mut(1).unwrap().actor.vx = 3;
    table.enter(&world, 2, hitbox, keep);
    table.enter(&world, 0, hitbox, keep);
    assert!(!table.get(0).unwrap().actor.alive, "the coin taken stays taken");
    assert_eq!(table.get(1).unwrap().actor.vx, 3, "the sentry's state is kept");
    assert_eq!(table.active().map(|e| e.index).collect::<Vec<_>>(), [1]);
}

#[test]
fn clearing_builds_entities_again_except_those_skipped() {
    let world = three_rooms(vec![coin(40), coin(80)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    frame(&mut table, &world, &Body::new(36, 92, 8, 8), 0);
    table.clear();
    assert!(table.get(0).is_none());
    table.enter(&world, 0, hitbox, |index| index == 0);
    assert!(table.get(0).is_none(), "skipped: the game had collected it");
    assert!(table.get(1).unwrap().actor.alive);
}

#[test]
fn entities_and_behaviours_past_the_limits_are_left_out_and_counted() {
    let five: &[&Declaration] = &[&Patrol::DECLARATION, &Collectible::DECLARATION, &Hazard::DECLARATION, &Door::DECLARATION, &Checkpoint::DECLARATION];
    let world = world_of_rooms(&[five], vec![(screen(0, 0), (0..3).map(|n| entity_of(0, 10 + n * 20, 100, vec![])).collect())]);
    let mut table = LiveEntities::<2>::new();
    table.enter(&world, 0, hitbox, keep);
    assert_eq!(table.dropped(), (1, 2));
    assert_eq!(table.get(0).unwrap().behaviours().count(), MAX_BEHAVIOURS);
    assert!(table.get(2).is_none());
}

#[test]
fn hitboxes_come_from_the_game_by_type() {
    let world = three_rooms(vec![sentry(50, 0), coin(80)], vec![], vec![]);
    let mut table = LiveEntities::<16>::new();
    let wide = Hitbox { x: -8, y: -4, w: 16, h: 4 };
    table.enter(&world, 0, |kind| if kind == 1 { wide } else { BOX }, keep);
    assert_eq!(table.get(0).unwrap().actor.hitbox, BOX);
    assert_eq!(table.get(1).unwrap().actor.hitbox, wide);
}

// A room on a grid of screens can touch 8 others.
const _: () = assert!(MAX_ACTIVE_ROOMS >= 9);

#[test]
fn a_live_entity_is_small() {
    // What a slot of the table costs in EWRAM: docs/reference/limits.md says so.
    std::println!("a slot is {} bytes", size_of::<Option<LiveEntity>>());
    assert!(size_of::<Option<LiveEntity>>() <= 112, "{}", size_of::<Option<LiveEntity>>());
}

#[test]
fn the_table_has_room_to_grow() {
    assert_eq!(slots_for(0), 16);
    assert_eq!(slots_for(15), 32);
    assert_eq!(slots_for(100), 128);
    assert_eq!(slots_for(500), 640);
}

#[test]
fn hazard_alone_is_listed_in_order() {
    // A type listing only a hazard gets it, and nothing else.
    let world = world_of_rooms(&[HAZARD], vec![(screen(0, 0), vec![entity_of(0, 50, 100, vec![])])]);
    let mut table = LiveEntities::<16>::new();
    table.enter(&world, 0, hitbox, keep);
    assert_eq!(table.get(0).unwrap().behaviours().copied().collect::<Vec<_>>(), [Attached::Hazard(Hazard)]);
}
