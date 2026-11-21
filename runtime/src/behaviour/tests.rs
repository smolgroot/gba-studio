extern crate std;

use super::*;
use crate::data::tests::{room, world_data};
use crate::data::write::{EntityData, write};
use crate::data::{Limits, Prop, World};
use alloc::boxed::Box;
use alloc::vec;
use alloc::vec::Vec;
use declare::Declaration;

const BOX: Hitbox = Hitbox { x: -4, y: -8, w: 8, h: 8 };

const PATROL: &[&Declaration] = &[&Patrol::DECLARATION];
const COLLECTIBLE: &[&Declaration] = &[&Collectible::DECLARATION];
const HAZARD: &[&Declaration] = &[&Hazard::DECLARATION];
const PROJECTILE: &[&Declaration] = &[&Projectile::DECLARATION];
const SHOOTER: &[&Declaration] = &[&Shooter::DECLARATION];
const PLATFORM: &[&Declaration] = &[&MovingPlatform::DECLARATION];
const DOOR: &[&Declaration] = &[&Door::DECLARATION];
const CHECKPOINT: &[&Declaration] = &[&Checkpoint::DECLARATION];
const ABILITY: &[&Declaration] = &[&AbilityPickup::DECLARATION];
const SPAWNER: &[&Declaration] = &[&Spawner::DECLARATION];

/// A world of one 8x4-cell room, the second screen of the map's top row, holding these
/// entities. Entity type `n` has the behaviours `types[n]`. Each entity's properties are
/// laid out as the build writes them: those that belong to no behaviour of its type
/// first, then each behaviour's in declared order, with the value the entity names, or
/// else the default, or else the lowest allowed.
fn world_with(types: &[&[&'static Declaration]], entities: Vec<EntityData<'static>>) -> World<'static> {
    let behaviours_of = |kind: u16| types.get(kind as usize).copied().unwrap_or(&[]);
    let entities = entities
        .into_iter()
        .map(|mut entity| {
            let behaviours = behaviours_of(entity.kind);
            let named = core::mem::take(&mut entity.props);
            let theirs = |name: &str| behaviours.iter().any(|b| b.prop(name).is_some());
            entity.props = named.iter().filter(|(name, _)| !theirs(name)).cloned().collect();
            for prop in behaviours.iter().flat_map(|b| b.props) {
                let value = named.iter().find(|(name, _)| *name == prop.name).map(|(_, value)| *value).unwrap_or(match (prop.default, prop.ty) {
                    (Some(declare::PropValue::Int(value)), _) => Prop::Int(value),
                    (Some(declare::PropValue::Bool(value)), _) => Prop::Bool(value),
                    (None, declare::PropType::Int { min, .. }) => Prop::Int(min),
                    (None, declare::PropType::Bool) => Prop::Bool(false),
                });
                entity.props.push((prop.name, value));
            }
            entity
        })
        .collect::<Vec<_>>();
    let mut only = room(&["........", "........", "........", "########"], Some((1, 0)));
    // A type's own properties are the same for all its entities; take them from its first.
    let own =
        |kind: u16| entities.iter().find(|e| e.kind == kind).map_or(0, |e| e.props.len() - behaviours_of(kind).iter().map(|b| b.props.len()).sum::<usize>());
    let positions = (0..types.len() as u16)
        .map(|kind| {
            let mut at = own(kind);
            behaviours_of(kind)
                .iter()
                .map(|b| {
                    let first = at as u16;
                    at += b.props.len();
                    (b.number, first)
                })
                .collect()
        })
        .collect();
    only.entities = entities;
    let mut data = world_data(vec![only]);
    data.behaviours = positions;
    let (bytes, _) = write(&data, None);
    World::new(Box::leak(bytes.into_boxed_slice()), &Limits::ANY).unwrap()
}

fn entity(x: i16, y: i16, props: Vec<(&'static str, Prop<'static>)>) -> EntityData<'static> {
    entity_of(0, x, y, props)
}

fn entity_of(kind: u16, x: i16, y: i16, props: Vec<(&'static str, Prop<'static>)>) -> EntityData<'static> {
    EntityData { kind, x, y, props }
}

fn cx(player: &Body, clock: u32) -> Context<'_> {
    Context { player, clock, held: Buttons::default(), pressed: Buttons::default(), abilities: Abilities::NONE }
}

/// A player body far from everything.
fn away() -> Body {
    Body::new(-1000, -1000, 8, 8)
}

/// Builds the behaviour from the world's first entity and runs its updates for each clock tick in turn.
fn run<B: Behaviour>(world: &World, actor: &mut Actor, player: &Body, clocks: impl IntoIterator<Item = u32>) -> Vec<Event> {
    let mut behaviour = B::from_entity(&world.room(0).entity(0)).expect("the entity has the behaviour's properties");
    clocks.into_iter().map(|clock| behaviour.update(actor, world, &cx(player, clock))).collect()
}

// The shared shape.

#[test]
fn an_actor_is_placed_in_world_pixels() {
    let world = world_with(&[], vec![entity(10, 24, vec![])]);
    let actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    assert_eq!((actor.x, actor.y, actor.home), (250, 24, (250, 24)));
    assert_eq!(actor.bounds(), (246, 16, 8, 8));
    assert!(actor.alive);
    assert_eq!(Actor::placed(&world, 0, 1, BOX), None);
    assert_eq!(Actor::placed(&world, 1, 0, BOX), None);
}

#[test]
fn touching_is_overlap_of_hitbox_and_body() {
    let actor = Actor::at(100, 100, BOX); // box 96..104 x 92..100
    assert!(actor.touches(&Body::new(103, 99, 4, 4)));
    assert!(!actor.touches(&Body::new(104, 92, 4, 4)), "edges that meet do not overlap");
    assert!(!actor.touches(&Body::new(96, 100, 4, 4)));
}

#[test]
fn buttons_test_each_bit() {
    let held = Buttons(Buttons::A | Buttons::UP);
    assert!(held.has(Buttons::A) && held.has(Buttons::UP) && held.has(Buttons::A | Buttons::UP));
    assert!(!held.has(Buttons::B) && !held.has(Buttons::A | Buttons::B));
}

/// Every behaviour goes through the one trait, so generated dispatch can call them alike.
#[test]
fn every_behaviour_runs_through_the_trait() {
    fn frame<B: Behaviour>(entity: &Entity, actor: &mut Actor, world: &World, cx: &Context) -> Option<Event> {
        B::from_entity(entity).map(|mut behaviour| behaviour.update(actor, world, cx))
    }
    let world = world_with(
        &[&[&Patrol::DECLARATION, &Collectible::DECLARATION, &Hazard::DECLARATION, &Checkpoint::DECLARATION]],
        vec![entity(0, 0, vec![("patrol", Prop::Int(4)), ("value", Prop::Int(1))])],
    );
    let first = world.room(0).entity(0);
    let player = away();
    let mut actor = Actor::at(0, 0, BOX);
    assert_eq!(frame::<Patrol>(&first, &mut actor, &world, &cx(&player, 0)), Some(Event::None));
    assert_eq!(frame::<Collectible>(&first, &mut actor, &world, &cx(&player, 0)), Some(Event::None));
    assert_eq!(frame::<Hazard>(&first, &mut actor, &world, &cx(&player, 0)), Some(Event::None));
    assert_eq!(frame::<Checkpoint>(&first, &mut actor, &world, &cx(&player, 0)), Some(Event::None));
    // These need their own properties, which the entity does not have.
    assert_eq!(frame::<Projectile>(&first, &mut actor, &world, &cx(&player, 0)), None);
    assert_eq!(frame::<Shooter>(&first, &mut actor, &world, &cx(&player, 0)), None);
    assert_eq!(frame::<MovingPlatform>(&first, &mut actor, &world, &cx(&player, 0)), None);
    assert_eq!(frame::<Door>(&first, &mut actor, &world, &cx(&player, 0)), None);
    assert_eq!(frame::<AbilityPickup>(&first, &mut actor, &world, &cx(&player, 0)), None);
    assert_eq!(frame::<Spawner>(&first, &mut actor, &world, &cx(&player, 0)), None);
}

// Patrol.

#[test]
fn a_patrol_walks_out_turns_and_comes_back() {
    let patrol = Patrol::new(3, 1);
    let walk: Vec<_> = (0..13).map(|clock| patrol.offset(clock)).collect();
    #[rustfmt::skip]
    assert_eq!(walk, [
        (0, false), (1, false), (2, false),
        (3, true), (2, true), (1, true), (0, true), (-1, true), (-2, true),
        (-3, false), (-2, false), (-1, false),
        (0, false),
    ]);
}

#[test]
fn a_patrol_moves_its_actor_around_home_at_its_pace() {
    let world = world_with(&[PATROL], vec![entity(40, 24, vec![("patrol", Prop::Int(8)), ("patrol_pace", Prop::Int(4))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let home = actor.home.0;
    run::<Patrol>(&world, &mut actor, &away(), [4 * 5]);
    assert_eq!((actor.x - home, actor.faces_left), (5, false));
    run::<Patrol>(&world, &mut actor, &away(), [4 * 10]);
    assert_eq!((actor.x - home, actor.faces_left), (6, true));
    assert_eq!(actor.y, actor.home.1, "a patrol stays at its height");
}

#[test]
fn a_patrol_reads_its_properties_with_a_default_pace() {
    let world = world_with(&[PATROL, &[]], vec![entity(0, 0, vec![("patrol", Prop::Int(32))]), entity_of(1, 0, 0, vec![("value", Prop::Int(1))])]);
    assert_eq!(Patrol::from_entity(&world.room(0).entity(0)), Some(Patrol::new(32, Patrol::DEFAULT_PACE)));
    assert_eq!(Patrol::from_entity(&world.room(0).entity(1)), None, "no `patrol` property, no patrol");
}

#[test]
fn a_patrol_with_no_reach_or_pace_stands_still() {
    assert_eq!(Patrol::new(0, 2).offset(77), (0, false));
    assert_eq!(Patrol::new(-5, 2).offset(77), (0, false));
    assert_eq!(Patrol::new(4, 0).pace, 1, "a pace of 0 would divide by zero");
}

// Collectible.

#[test]
fn a_collectible_is_taken_once() {
    let world = world_with(&[COLLECTIBLE], vec![entity(40, 24, vec![("value", Prop::Int(5))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let (x, y, _, _) = actor.bounds();
    let player = Body::new(x, y, 8, 8);
    assert_eq!(run::<Collectible>(&world, &mut actor, &player, [0, 1, 2]), [Event::Collect { value: 5 }, Event::None, Event::None]);
    assert!(!actor.alive);
}

#[test]
fn a_collectible_out_of_reach_stays() {
    let world = world_with(&[COLLECTIBLE], vec![entity(40, 24, vec![("value", Prop::Int(5))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let (x, y, w, _) = actor.bounds();
    assert_eq!(run::<Collectible>(&world, &mut actor, &Body::new(x + w, y, 8, 8), [0]), [Event::None]);
    assert!(actor.alive);
    assert_eq!(Collectible::from_entity(&world_with(&[], vec![entity(0, 0, vec![])]).room(0).entity(0)), None);
}

// Hazard.

#[test]
fn a_hazard_hurts_while_touched() {
    let world = world_with(&[HAZARD], vec![entity(40, 24, vec![])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let (x, y, _, _) = actor.bounds();
    assert_eq!(run::<Hazard>(&world, &mut actor, &Body::new(x, y, 8, 8), [0, 1]), [Event::Hurt, Event::Hurt]);
    assert_eq!(run::<Hazard>(&world, &mut actor, &Body::new(x - 8, y, 8, 8), [2]), [Event::None], "a near miss");
    actor.alive = false;
    assert_eq!(run::<Hazard>(&world, &mut actor, &Body::new(x, y, 8, 8), [3]), [Event::None], "a dead hazard hurts no one");
}

/// The sample's sentry bot: a patrol that hurts where it has walked to, not where it was placed.
#[test]
fn a_patrolling_hazard_hurts_where_it_has_walked() {
    let world =
        world_with(&[&[&Patrol::DECLARATION, &Hazard::DECLARATION]], vec![entity(40, 24, vec![("patrol", Prop::Int(16)), ("patrol_pace", Prop::Int(1))])]);
    let first = world.room(0).entity(0);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let (x, y, _, _) = actor.bounds();
    let at_home = Body::new(x, y, 8, 8);
    let (mut patrol, mut hazard) = (Patrol::from_entity(&first).unwrap(), Hazard::from_entity(&first).unwrap());
    let frame = |patrol: &mut Patrol, hazard: &mut Hazard, actor: &mut Actor, clock| {
        patrol.update(actor, &world, &cx(&at_home, clock));
        hazard.update(actor, &world, &cx(&at_home, clock))
    };
    assert_eq!(frame(&mut patrol, &mut hazard, &mut actor, 0), Event::Hurt);
    assert_eq!(frame(&mut patrol, &mut hazard, &mut actor, 12), Event::None, "walked 12 px away");
}

// Pool and abilities.

#[test]
fn a_pool_fills_up_and_frees_slots() {
    let mut pool = Pool::<u8, 2>::new();
    assert!(pool.is_empty());
    assert_eq!((pool.add(10), pool.add(20)), (Ok(0), Ok(1)));
    assert!(pool.is_full());
    assert_eq!(pool.add(30), Err(30), "a full pool gives the thing back");
    assert_eq!(pool.remove(0), Some(10));
    assert_eq!(pool.add(30), Ok(0), "a freed slot is used again");
    pool.retain(|thing| *thing != 30);
    assert_eq!(pool.iter().collect::<Vec<_>>(), [(1, &20)]);
    assert_eq!((pool.len(), pool.remove(5)), (1, None));
}

#[test]
fn abilities_are_numbered_0_to_31() {
    let mut abilities = Abilities::NONE;
    assert!(abilities.grant(3) && abilities.grant(31));
    assert!(!abilities.grant(3), "already had");
    assert!(!abilities.grant(32), "past 31");
    assert!(abilities.has(3) && abilities.has(31) && !abilities.has(4) && !abilities.has(200));
    assert_eq!((ability_number(-1), ability_number(0), ability_number(31), ability_number(32)), (None, Some(0), Some(31), None));
}

// Projectile and shooter.

const SHOT: Hitbox = Hitbox { x: -2, y: -2, w: 4, h: 4 };

#[test]
fn a_projectile_flies_until_it_hits_a_solid_cell() {
    // The room's floor is its last row: world y 24 to 31.
    let world = world_with(&[], vec![]);
    let (mut actor, mut shot) = Shot { x: 260, y: 8, vx: 0, vy: 4 }.launch(SHOT);
    let frames: Vec<_> = (0..6).map(|clock| (shot.update(&mut actor, &world, &cx(&away(), clock)), actor.alive)).collect();
    // Its middle (its feet: the hitbox is centred on them) goes 12, 16, 20, 24: in the floor on the fourth frame.
    assert_eq!(frames.iter().map(|f| f.1).collect::<Vec<_>>(), [true, true, true, false, false, false]);
    assert!(frames.iter().all(|f| f.0 == Event::None));
}

#[test]
fn a_projectile_runs_out_of_time() {
    let world = world_with(&[], vec![]);
    let mut actor = Actor::at(250, 8, SHOT);
    let mut shot = Projectile::new(1, 0, 2);
    let alive: Vec<_> = (0..3).map(|clock| (shot.update(&mut actor, &world, &cx(&away(), clock)), actor.alive).1).collect();
    assert_eq!(alive, [true, true, false]);
    assert_eq!(actor.x, 252, "it stops where its time ran out");
}

#[test]
fn a_projectile_hurts_the_player_once() {
    let world = world_with(&[], vec![]);
    let (mut actor, mut shot) = Shot { x: 250, y: 8, vx: 2, vy: 0 }.launch(SHOT);
    let player = Body::new(253, 0, 8, 16);
    assert_eq!(shot.update(&mut actor, &world, &cx(&player, 0)), Event::Hurt);
    assert!(!actor.alive);
    assert_eq!(shot.update(&mut actor, &world, &cx(&player, 1)), Event::None);
}

#[test]
fn a_placed_projectile_flies_at_its_shot_speed() {
    let world = world_with(&[PROJECTILE], vec![entity(10, 8, vec![("shot_speed", Prop::Int(-3))])]);
    let mut actor = Actor::placed(&world, 0, 0, SHOT).unwrap();
    run::<Projectile>(&world, &mut actor, &away(), [0, 1]);
    assert_eq!((actor.x - actor.home.0, actor.faces_left), (-6, true));
}

#[test]
fn a_shooter_fires_at_its_rate_towards_a_player_in_sight() {
    let world = world_with(&[SHOOTER], vec![entity(40, 24, vec![("fire_every", Prop::Int(30)), ("shot_speed", Prop::Int(3)), ("sight", Prop::Int(64))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap(); // middle (280, 20)
    let left = Body::new(230, 12, 8, 16); // middle (234, 20)
    let events = run::<Shooter>(&world, &mut actor, &left, [0, 1, 29, 30, 60]);
    let fired = Event::Fire(Shot { x: 280, y: 20, vx: -3, vy: 0 });
    assert_eq!(events, [fired, Event::None, Event::None, fired, fired]);
    assert!(actor.faces_left);
    let right = Body::new(300, 12, 8, 16);
    assert_eq!(run::<Shooter>(&world, &mut actor, &right, [0]), [Event::Fire(Shot { x: 280, y: 20, vx: 3, vy: 0 })]);
    assert!(!actor.faces_left, "it turns to the player");
}

#[test]
fn a_shooter_holds_fire_out_of_sight() {
    let world = world_with(&[SHOOTER], vec![entity(40, 24, vec![("fire_every", Prop::Int(1))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap(); // middle (280, 20)
    let far = Body::new(280 + Shooter::DEFAULT_SIGHT + 1, 12, 8, 16); // middle 101 px away
    assert_eq!(run::<Shooter>(&world, &mut actor, &far, [0]), [Event::None]);
    let above = Body::new(276, 20 - 97 - 8, 8, 16);
    assert_eq!(run::<Shooter>(&world, &mut actor, &above, [0]), [Event::None]);
}

// Moving platform.

const LEDGE: Hitbox = Hitbox { x: -8, y: -4, w: 16, h: 4 };

#[test]
fn a_platform_goes_out_and_back_along_its_line() {
    let platform = MovingPlatform::new((4, -2), 1);
    let path: Vec<_> = (0..9).map(|clock| platform.offset(clock)).collect();
    assert_eq!(path, [(0, 0), (1, 0), (2, -1), (3, -1), (4, -2), (3, -1), (2, -1), (1, 0), (0, 0)]);
    assert_eq!(MovingPlatform::new((0, 0), 1).offset(5), (0, 0));
}

#[test]
fn a_platform_reads_its_properties_and_moves_its_actor() {
    let world =
        world_with(&[PLATFORM, &[]], vec![entity(20, 16, vec![("travel_x", Prop::Int(16)), ("travel_pace", Prop::Int(4))]), entity_of(1, 0, 0, vec![])]);
    let mut actor = Actor::placed(&world, 0, 0, LEDGE).unwrap();
    run::<MovingPlatform>(&world, &mut actor, &away(), [4 * 3 + 1]);
    assert_eq!((actor.x - actor.home.0, actor.vx, actor.vy), (3, 0, 0), "between two steps it is still");
    run::<MovingPlatform>(&world, &mut actor, &away(), [4 * 3 + 4]);
    assert_eq!((actor.x - actor.home.0, actor.vx), (4, 1));
    assert_eq!(MovingPlatform::from_entity(&world.room(0).entity(1)), None);
}

#[test]
fn a_platform_carries_a_body_standing_on_it() {
    let world = world_with(&[], vec![]);
    let platform = MovingPlatform::new((8, 0), 1);
    let mut actor = Actor::at(100, 100, LEDGE); // top at 96
    let mut moving = platform;
    moving.update(&mut actor, &world, &cx(&away(), 1)); // moved right 1 px
    let before = Body::new(95, 80, 8, 16); // feet at 96, on the top where it was
    let mut body = before;
    body.vy = 1;
    body.y += 1; // gravity pulled it a pixel
    assert!(platform.carry(&actor, &mut body, &before));
    assert_eq!((body.x, body.y, body.vy, body.on_ground), (96, 80, 0, true));
}

#[test]
fn a_platform_catches_a_falling_body_and_lets_a_rising_one_through() {
    let platform = MovingPlatform::new((0, 0), 1);
    let actor = Actor::at(100, 100, LEDGE); // top at 96
    let before = Body::new(96, 77, 8, 16); // feet at 93
    let mut falling = before;
    (falling.y, falling.vy) = (83, 6); // feet at 99, past the top
    assert!(platform.carry(&actor, &mut falling, &before));
    assert_eq!((falling.y, falling.vy, falling.on_ground), (80, 0, true));

    let below = Body::new(96, 96, 8, 16);
    let mut rising = below;
    (rising.y, rising.vy) = (88, -8);
    assert!(!platform.carry(&actor, &mut rising, &below));
    assert_eq!(rising.y, 88);

    let mut beside = Body::new(120, 83, 8, 16);
    beside.vy = 6;
    assert!(!platform.carry(&actor, &mut beside, &Body::new(120, 77, 8, 16)), "not over the platform");
}

#[test]
fn a_body_can_jump_off_a_platform() {
    let platform = MovingPlatform::new((0, 0), 1);
    let actor = Actor::at(100, 100, LEDGE); // top at 96
    let standing = Body::new(96, 80, 8, 16); // feet on the top
    let mut jumping = standing;
    (jumping.y, jumping.vy) = (75, -5);
    assert!(!platform.carry(&actor, &mut jumping, &standing));
    assert_eq!(jumping.y, 75, "not pulled back down");
}

// Door.

const TALL: Hitbox = Hitbox { x: -4, y: -16, w: 8, h: 16 };

#[test]
fn a_closed_door_blocks_from_either_side() {
    let door = Door::new(None);
    let actor = Actor::at(100, 100, TALL); // box 96..104 x 84..100
    let from_left = Body::new(88, 84, 8, 16);
    let mut body = from_left;
    body.x = 92;
    assert!(door.block(&actor, &mut body, &from_left));
    assert_eq!((body.x, body.hit_wall), (88, true));
    let from_right = Body::new(104, 84, 8, 16);
    let mut body = from_right;
    body.x = 101;
    assert!(door.block(&actor, &mut body, &from_right));
    assert_eq!(body.x, 104);
    let clear = Body::new(80, 84, 8, 16);
    assert!(!door.block(&actor, &mut clear.clone(), &clear));
}

#[test]
fn a_door_with_no_ability_opens_against_it_while_pressing_up() {
    let world = world_with(&[DOOR], vec![entity(40, 24, vec![("needs_ability", Prop::Int(-1))])]);
    let mut actor = Actor::placed(&world, 0, 0, TALL).unwrap(); // box 276..284
    let mut door = Door::from_entity(&world.room(0).entity(0)).unwrap();
    assert_eq!(door.needs, None);
    let against = Body::new(268, 8, 8, 16); // right edge meets the door's left
    assert_eq!(door.update(&mut actor, &world, &cx(&against, 0)), Event::None, "not pressing Up");
    let up = Context { held: Buttons(Buttons::UP), ..cx(&against, 1) };
    assert_eq!(door.update(&mut actor, &world, &up), Event::Opened);
    assert_eq!(door.update(&mut actor, &world, &up), Event::None, "opens once");
    let mut through = against;
    through.x = 278;
    assert!(!door.block(&actor, &mut through, &against), "an open door does not block");
    let far = away();
    let away_up = Context { held: Buttons(Buttons::UP), ..cx(&far, 2) };
    assert_eq!(Door::new(None).update(&mut actor, &world, &away_up), Event::None, "Up from afar opens nothing");
}

#[test]
fn a_door_that_needs_an_ability_opens_only_with_it() {
    let world = world_with(&[DOOR], vec![entity(40, 24, vec![("needs_ability", Prop::Int(5))])]);
    let mut actor = Actor::placed(&world, 0, 0, TALL).unwrap();
    let mut door = Door::from_entity(&world.room(0).entity(0)).unwrap();
    let against = Body::new(268, 8, 8, 16);
    let without = Context { held: Buttons(Buttons::UP), abilities: Abilities(1 << 4), ..cx(&against, 0) };
    assert_eq!(door.update(&mut actor, &world, &without), Event::None, "Up does not open a door that needs an ability");
    let with = Context { abilities: Abilities(1 << 5), ..cx(&against, 1) };
    assert_eq!(door.update(&mut actor, &world, &with), Event::Opened);
}

// Checkpoint and ability pickup.

#[test]
fn a_checkpoint_is_reached_once() {
    let world = world_with(&[CHECKPOINT], vec![entity(40, 24, vec![])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let on = Body::new(278, 16, 8, 8);
    assert_eq!(run::<Checkpoint>(&world, &mut actor, &away(), [0]), [Event::None]);
    assert_eq!(run::<Checkpoint>(&world, &mut actor, &on, [0, 1]), [Event::Checkpoint { x: 280, y: 24 }, Event::None]);
    assert!(actor.alive, "a checkpoint stays");
}

#[test]
fn an_ability_pickup_grants_its_ability_once() {
    let world = world_with(&[ABILITY], vec![entity(40, 24, vec![("grants_ability", Prop::Int(7))]), entity(0, 0, vec![("grants_ability", Prop::Int(40))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let on = Body::new(278, 16, 8, 8);
    assert_eq!(run::<AbilityPickup>(&world, &mut actor, &on, [0, 1]), [Event::Grant { ability: 7 }, Event::None]);
    assert!(!actor.alive);
    assert_eq!(AbilityPickup::from_entity(&world.room(0).entity(1)), None, "no ability 40");
}

// Spawner.

#[test]
fn a_spawner_stops_at_max_alive_and_starts_again_when_one_dies() {
    let world = world_with(&[SPAWNER], vec![entity(40, 24, vec![("spawn_every", Prop::Int(10)), ("max_alive", Prop::Int(2))])]);
    let mut actor = Actor::placed(&world, 0, 0, BOX).unwrap();
    let mut spawner = Spawner::from_entity(&world.room(0).entity(0)).unwrap();
    let mut frame = |spawner: &mut Spawner, clock| spawner.update(&mut actor, &world, &cx(&away(), clock));
    let spawn = Event::Spawn { x: 280, y: 24 };
    assert_eq!([frame(&mut spawner, 0), frame(&mut spawner, 5), frame(&mut spawner, 10), frame(&mut spawner, 20)], [spawn, Event::None, spawn, Event::None]);
    spawner.despawned();
    assert_eq!(frame(&mut spawner, 30), spawn);
    assert_eq!(spawner.alive, 2);
}

#[test]
fn a_spawner_reads_a_default_max() {
    let world = world_with(&[SPAWNER], vec![entity(0, 0, vec![("spawn_every", Prop::Int(0))])]);
    assert_eq!(Spawner::from_entity(&world.room(0).entity(0)), Some(Spawner::new(1, Spawner::DEFAULT_MAX_ALIVE)));
    let mut spawner = Spawner::new(1, 1);
    spawner.despawned();
    assert_eq!(spawner.alive, 0, "despawning with none alive stays at 0");
}

// Declarations.

#[test]
fn declarations_are_numbered_in_order_with_unique_ids() {
    for (index, declared) in DECLARATIONS.iter().enumerate() {
        assert_eq!(declared.number as usize, index, "{}", declared.id);
        assert_eq!(declaration(declared.id), Some(*declared));
        assert!(declared.id.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'), "{}", declared.id);
        for (i, prop) in declared.props.iter().enumerate() {
            assert_eq!(declared.prop(prop.name).map(|(at, _)| at), Some(i), "{} declares {} twice", declared.id, prop.name);
            assert!(prop.default.is_none_or(|value| prop.accepts(value)), "{}: the default of {} is out of its range", declared.id, prop.name);
        }
    }
    assert_eq!(declaration("patroll"), None);
}

/// The names a behaviour declares are the ones it reads: an entity with every declared
/// property (the default, or the lowest allowed value when there is none) gets it.
#[test]
fn every_behaviour_reads_what_it_declares() {
    fn props_of(declaration: &declare::Declaration) -> Vec<(&'static str, Prop<'static>)> {
        declaration
            .props
            .iter()
            .map(|prop| {
                let value = match (prop.default, prop.ty) {
                    (Some(declare::PropValue::Int(value)), _) => Prop::Int(value),
                    (Some(declare::PropValue::Bool(value)), _) => Prop::Bool(value),
                    (None, declare::PropType::Int { min, .. }) => Prop::Int(min),
                    (None, declare::PropType::Bool) => Prop::Bool(false),
                };
                (prop.name, value)
            })
            .collect()
    }
    fn reads<B: Behaviour>() -> bool {
        let world = world_with(&[&[&B::DECLARATION]], vec![entity(0, 0, props_of(&B::DECLARATION))]);
        B::from_entity(&world.room(0).entity(0)).is_some()
    }
    assert!(reads::<Patrol>() && reads::<Collectible>() && reads::<Hazard>() && reads::<Projectile>() && reads::<Shooter>());
    assert!(reads::<MovingPlatform>() && reads::<Door>() && reads::<Checkpoint>() && reads::<AbilityPickup>() && reads::<Spawner>());
}

#[test]
fn a_property_accepts_values_of_its_type_in_range() {
    let pace = Patrol::DECLARATION.prop("patrol_pace").unwrap().1;
    assert!(pace.accepts(declare::PropValue::Int(1)) && pace.accepts(declare::PropValue::Int(255)));
    assert!(!pace.accepts(declare::PropValue::Int(0)) && !pace.accepts(declare::PropValue::Bool(true)));
    let flag = declare::PropDecl::bool("flag", "", false);
    assert!(flag.accepts(declare::PropValue::Bool(true)) && !flag.accepts(declare::PropValue::Int(0)));
}

// Reading by position.

/// The section says where a behaviour's properties start; their names are not looked at.
#[test]
fn settings_are_read_by_position_not_by_name() {
    let mut only = room(&["........"], Some((0, 0)));
    // The type's own property happens to be called `patrol`; the behaviour's two follow it
    // under names that mean nothing.
    only.entities = vec![entity(0, 0, vec![("patrol", Prop::Int(999)), ("x", Prop::Int(7)), ("y", Prop::Int(3))])];
    let mut data = world_data(vec![only]);
    data.behaviours = vec![vec![(Patrol::DECLARATION.number, 1)]];
    let (bytes, _) = write(&data, None);
    let world = World::new(Box::leak(bytes.into_boxed_slice()), &Limits::ANY).unwrap();
    assert_eq!(Patrol::from_entity(&world.room(0).entity(0)), Some(Patrol::new(7, 3)));
}

#[test]
fn a_type_that_does_not_list_a_behaviour_does_not_get_it_from_a_name() {
    let world = world_with(&[HAZARD], vec![entity(0, 0, vec![("value", Prop::Int(5)), ("patrol", Prop::Int(8))])]);
    let first = world.room(0).entity(0);
    assert_eq!(Collectible::from_entity(&first), None);
    assert_eq!(Patrol::from_entity(&first), None);
    assert_eq!(Checkpoint::from_entity(&first), None);
    assert_eq!(Hazard::from_entity(&first), Some(Hazard));
}

/// A section written before behaviours had their own section has eight; it reads, with none.
#[test]
fn a_section_from_before_behaviours_reads_with_none() {
    let world = world_with(&[COLLECTIBLE], vec![entity(0, 0, vec![("value", Prop::Int(5))])]);
    assert!(Collectible::from_entity(&world.room(0).entity(0)).is_some());
    let mut only = room(&["........"], Some((0, 0)));
    only.entities = vec![entity(0, 0, vec![("value", Prop::Int(5))])];
    let mut data = world_data(vec![only]);
    data.behaviours = vec![vec![(Collectible::DECLARATION.number, 0)]];
    let (mut bytes, _) = write(&data, None);
    bytes[crate::data::layout::H_SECTIONS] = crate::data::layout::MIN_SECTIONS as u8;
    let world = World::new(Box::leak(bytes.into_boxed_slice()), &Limits::ANY).unwrap();
    assert_eq!(Collectible::from_entity(&world.room(0).entity(0)), None);
}

#[test]
fn a_behaviour_starting_past_an_entitys_properties_is_refused() {
    let mut only = room(&["........"], Some((0, 0)));
    only.entities = vec![entity(0, 0, vec![("value", Prop::Int(5))])];
    let mut data = world_data(vec![only]);
    data.behaviours = vec![vec![(Collectible::DECLARATION.number, 2)]];
    let (bytes, _) = write(&data, None);
    assert_eq!(World::new(&bytes, &Limits::ANY).err(), Some(crate::data::DataError::Entity(0)));
}
