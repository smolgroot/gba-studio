//! The entities of a running game, each with its behaviours built once from the ROM
//! and kept: what `data::update_entities` (written by the build helper) runs every
//! frame. Behaviours are found by their numbers in the data section, not by entity
//! type in code, so a behaviour given to a type by a live apply runs without a build.

use super::{
    AbilityPickup, Actor, Behaviour, Checkpoint, Collectible, Context, Door, Event, Hazard, Hitbox, MovingPlatform, Patrol, Projectile, Shooter, Spawner,
};
use crate::data::{Settings, World};

/// The most behaviours an entity type can have. The studio and the build report a
/// type with more.
pub const MAX_BEHAVIOURS: usize = 4;

/// The most rooms active at once: the hero's room and those touching it.
pub const MAX_ACTIVE_ROOMS: usize = 16;

/// How many entities a game's table has room for, given how many the project has:
/// a quarter more, and at least 16 more, so entities placed while the game runs
/// still fit. Rounded up to 16.
pub const fn slots_for(entities: usize) -> usize {
    let spare = if entities / 4 > 16 { entities / 4 } else { 16 };
    (entities + spare).next_multiple_of(16)
}

/// Any one of the runtime's behaviours, with its settings and its state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attached {
    Patrol(Patrol),
    Collectible(Collectible),
    Hazard(Hazard),
    Projectile(Projectile),
    Shooter(Shooter),
    MovingPlatform(MovingPlatform),
    Door(Door),
    Checkpoint(Checkpoint),
    AbilityPickup(AbilityPickup),
    Spawner(Spawner),
}

impl Attached {
    /// The behaviour numbered `number`, built from its settings. `None` for a number
    /// this runtime does not have (a ROM from a newer studio) or settings that do not fit.
    pub fn from_settings(number: u16, settings: &Settings) -> Option<Self> {
        fn build<B: Behaviour>(settings: &Settings, wrap: fn(B) -> Attached) -> Option<Attached> {
            B::from_settings(settings).map(wrap)
        }
        match number {
            n if n == Patrol::DECLARATION.number => build(settings, Self::Patrol),
            n if n == Collectible::DECLARATION.number => build(settings, Self::Collectible),
            n if n == Hazard::DECLARATION.number => build(settings, Self::Hazard),
            n if n == Projectile::DECLARATION.number => build(settings, Self::Projectile),
            n if n == Shooter::DECLARATION.number => build(settings, Self::Shooter),
            n if n == MovingPlatform::DECLARATION.number => build(settings, Self::MovingPlatform),
            n if n == Door::DECLARATION.number => build(settings, Self::Door),
            n if n == Checkpoint::DECLARATION.number => build(settings, Self::Checkpoint),
            n if n == AbilityPickup::DECLARATION.number => build(settings, Self::AbilityPickup),
            n if n == Spawner::DECLARATION.number => build(settings, Self::Spawner),
            _ => None,
        }
    }

    /// Its number, as [`Behaviour::DECLARATION`] gives it.
    pub const fn number(&self) -> u16 {
        match self {
            Self::Patrol(_) => Patrol::DECLARATION.number,
            Self::Collectible(_) => Collectible::DECLARATION.number,
            Self::Hazard(_) => Hazard::DECLARATION.number,
            Self::Projectile(_) => Projectile::DECLARATION.number,
            Self::Shooter(_) => Shooter::DECLARATION.number,
            Self::MovingPlatform(_) => MovingPlatform::DECLARATION.number,
            Self::Door(_) => Door::DECLARATION.number,
            Self::Checkpoint(_) => Checkpoint::DECLARATION.number,
            Self::AbilityPickup(_) => AbilityPickup::DECLARATION.number,
            Self::Spawner(_) => Spawner::DECLARATION.number,
        }
    }

    /// One frame of the behaviour.
    #[inline]
    pub fn update(&mut self, actor: &mut Actor, world: &World, cx: &Context) -> Event {
        match self {
            Self::Patrol(b) => b.update(actor, world, cx),
            Self::Collectible(b) => b.update(actor, world, cx),
            Self::Hazard(b) => b.update(actor, world, cx),
            Self::Projectile(b) => b.update(actor, world, cx),
            Self::Shooter(b) => b.update(actor, world, cx),
            Self::MovingPlatform(b) => b.update(actor, world, cx),
            Self::Door(b) => b.update(actor, world, cx),
            Self::Checkpoint(b) => b.update(actor, world, cx),
            Self::AbilityPickup(b) => b.update(actor, world, cx),
            Self::Spawner(b) => b.update(actor, world, cx),
        }
    }
}

/// A placed entity while the game runs: where it is, and its behaviours with their
/// settings and state. It holds nothing from the data section, so it never reads ROM.
///
/// Laid out as C does, with what a tool reads first, so the studio can find each
/// field in a running game's memory (`docs/reference/debug-map.md`). The behaviours
/// come last and are not described to tools: their layout is Rust's.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LiveEntity {
    pub actor: Actor,
    /// Index of its entity type; the generated `EntityKind` names them.
    pub kind: u16,
    /// The room it was placed in.
    pub room: u16,
    /// Its number in the world, as [`World::entity_index`] gives it and
    /// [`crate::data::Collected`] takes it.
    pub index: u16,
    /// Whether this slot of the table holds an entity. Kept here, in what would be
    /// padding, rather than as an `Option` around the entity, whose layout Rust does
    /// not fix: a tool reads it to tell a built slot from an empty one.
    built: bool,
    /// Its type's behaviours, in the type's order.
    pub behaviours: [Option<Attached>; MAX_BEHAVIOURS],
}

impl LiveEntity {
    /// Where the `built` flag is in a slot, in bytes: for tools that read the table
    /// (1 once the slot holds an entity, 0 while it is empty).
    pub const BUILT_AT: usize = core::mem::offset_of!(Self, built);

    /// An empty slot of the table.
    const EMPTY: Self = Self {
        actor: Actor { x: 0, y: 0, home: (0, 0), vx: 0, vy: 0, faces_left: false, alive: false, hitbox: Hitbox { x: 0, y: 0, w: 0, h: 0 } },
        kind: 0,
        room: 0,
        index: 0,
        built: false,
        behaviours: [None; MAX_BEHAVIOURS],
    };

    /// Its behaviours, in the order they run.
    pub fn behaviours(&self) -> impl Iterator<Item = &Attached> {
        self.behaviours.iter().flatten()
    }

    /// Its behaviours, to change.
    pub fn behaviours_mut(&mut self) -> impl Iterator<Item = &mut Attached> {
        self.behaviours.iter_mut().flatten()
    }
}

/// What the game's hook says about an entity before its behaviours run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dispatch {
    /// Run its behaviours, as its type lists them.
    Behaviours,
    /// The game has done this entity's frame itself: run none of them.
    Handled,
}

/// Every entity of the world, by [`World::entity_index`], each built from the ROM the
/// first time its room becomes active and then kept, so a room the hero left is as
/// it was when they come back. Only the active rooms' entities are updated. A fixed
/// array: nothing is allocated.
#[derive(Clone, Debug)]
pub struct LiveEntities<const N: usize> {
    slots: [LiveEntity; N],
    /// The active rooms' slots, as ranges `first..end`.
    active: [(u16, u16); MAX_ACTIVE_ROOMS],
    /// Each active room's left, top, width and height in world pixels.
    bounds: [(i32, i32, i32, i32); MAX_ACTIVE_ROOMS],
    active_count: usize,
    dropped_entities: usize,
    dropped_behaviours: usize,
}

impl<const N: usize> Default for LiveEntities<N> {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether two rooms' rectangles in world pixels overlap or share an edge or a corner.
const fn touch(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> bool {
    a.0 <= b.0 + b.2 && b.0 <= a.0 + a.2 && a.1 <= b.1 + b.3 && b.1 <= a.1 + a.3
}

/// Whether two rectangles share any pixel.
const fn overlaps(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> bool {
    a.0 < b.0 + b.2 && b.0 < a.0 + a.2 && a.1 < b.1 + b.3 && b.1 < a.1 + a.3
}

impl<const N: usize> LiveEntities<N> {
    const FITS: () = assert!(N <= u16::MAX as usize, "entity indices are 16 bits");

    pub const fn new() -> Self {
        let () = Self::FITS;
        Self {
            slots: [LiveEntity::EMPTY; N],
            active: [(0, 0); MAX_ACTIVE_ROOMS],
            bounds: [(0, 0, 0, 0); MAX_ACTIVE_ROOMS],
            active_count: 0,
            dropped_entities: 0,
            dropped_behaviours: 0,
        }
    }

    /// Forgets every entity, as after a live apply that may have moved them: each is
    /// built again from the ROM when its room is next entered.
    pub fn clear(&mut self) {
        self.slots = [LiveEntity::EMPTY; N];
        self.active_count = 0;
    }

    /// Makes `room` and the rooms touching it on the world map the active ones, and
    /// builds those of their entities not built yet: with their type's hitbox, unless
    /// `skip` says to leave one out (the game collected it before a [`Self::clear`]).
    pub fn enter(&mut self, world: &World, room: usize, hitbox_of: impl Fn(u16) -> Hitbox, skip: impl Fn(usize) -> bool) {
        self.active_count = 0;
        self.dropped_entities = 0;
        self.dropped_behaviours = 0;
        if room >= world.room_count() {
            return;
        }
        let bounds = |index: usize| {
            let (left, top) = world.origin(index)?;
            let other = world.room(index);
            Some((left, top, other.width(), other.height()))
        };
        self.activate(world, room, &hitbox_of, &skip);
        let Some(here) = bounds(room) else { return };
        for other in (0..world.room_count()).filter(|&other| other != room) {
            if bounds(other).is_some_and(|there| touch(here, there)) && self.active_count < MAX_ACTIVE_ROOMS {
                self.activate(world, other, &hitbox_of, &skip);
            }
        }
    }

    fn activate(&mut self, world: &World, room: usize, hitbox_of: &impl Fn(u16) -> Hitbox, skip: &impl Fn(usize) -> bool) {
        let entities = world.room(room);
        let first = entities.first_entity();
        let end = first + entities.entity_count();
        if end > N {
            self.dropped_entities += end - first.max(N);
        }
        let (left, top) = world.origin(room).unwrap_or((0, 0));
        self.active[self.active_count] = (first.min(N) as u16, end.min(N) as u16);
        self.bounds[self.active_count] = (left, top, entities.width(), entities.height());
        self.active_count += 1;
        for index in first..end.min(N) {
            if self.slots[index].built || skip(index) {
                continue;
            }
            let entity = entities.entity(index - first);
            let mut behaviours = [None; MAX_BEHAVIOURS];
            let mut count = 0;
            for (number, settings) in entity.behaviours() {
                let Some(attached) = Attached::from_settings(number, &settings) else { continue };
                if count == MAX_BEHAVIOURS {
                    self.dropped_behaviours += 1;
                    continue;
                }
                behaviours[count] = Some(attached);
                count += 1;
            }
            let actor = Actor::at(left + entity.x as i32, top + entity.y as i32, hitbox_of(entity.kind));
            self.slots[index] = LiveEntity { actor, kind: entity.kind, room: room as u16, index: index as u16, built: true, behaviours };
        }
    }

    /// One frame of every living entity in the active rooms that overlap `area` (left,
    /// top, width and height in world pixels: what the camera shows). The other active
    /// rooms' entities wait, as they are, until the camera comes to them. For each
    /// entity, `before` is the game's: it may change the entity, and answers whether
    /// its behaviours run. Then they run in the type's order, and every event other
    /// than [`Event::None`] goes to `event`.
    pub fn update(
        &mut self,
        world: &World,
        cx: &Context,
        area: (i32, i32, i32, i32),
        mut before: impl FnMut(&mut LiveEntity) -> Dispatch,
        mut event: impl FnMut(&mut LiveEntity, Event),
    ) {
        for (&(first, end), &bounds) in self.active[..self.active_count].iter().zip(&self.bounds) {
            if !overlaps(bounds, area) {
                continue;
            }
            for entity in &mut self.slots[first as usize..end as usize] {
                if !entity.built || !entity.actor.alive || before(entity) == Dispatch::Handled {
                    continue;
                }
                for at in 0..MAX_BEHAVIOURS {
                    let Some(behaviour) = &mut entity.behaviours[at] else { break };
                    let happened = behaviour.update(&mut entity.actor, world, cx);
                    if happened != Event::None {
                        event(entity, happened);
                    }
                }
            }
        }
    }

    /// The living entities of the active rooms, room by room.
    pub fn active(&self) -> impl Iterator<Item = &LiveEntity> {
        self.active[..self.active_count]
            .iter()
            .flat_map(|&(first, end)| self.slots[first as usize..end as usize].iter().filter(|entity| entity.built))
            .filter(|entity| entity.actor.alive)
    }

    /// The living entities of the active rooms that overlap `area`, as
    /// [`Self::update`] takes it: what to draw.
    pub fn visible(&self, area: (i32, i32, i32, i32)) -> impl Iterator<Item = &LiveEntity> {
        self.active[..self.active_count]
            .iter()
            .zip(&self.bounds)
            .filter(move |&(_, &bounds)| overlaps(bounds, area))
            .flat_map(|(&(first, end), _)| self.slots[first as usize..end as usize].iter().filter(|entity| entity.built))
            .filter(|entity| entity.actor.alive)
    }

    /// The living entities of the active rooms, to change.
    pub fn active_mut(&mut self) -> impl Iterator<Item = &mut LiveEntity> {
        let active = &self.active[..self.active_count];
        self.slots
            .iter_mut()
            .enumerate()
            .filter(move |(index, _)| active.iter().any(|&(first, end)| (first as usize..end as usize).contains(index)))
            .map(|(_, entity)| entity)
            .filter(|entity| entity.built && entity.actor.alive)
    }

    /// The entity numbered `index` in the world, if it has been built.
    pub fn get(&self, index: usize) -> Option<&LiveEntity> {
        self.slots.get(index).filter(|entity| entity.built)
    }

    pub fn get_mut(&mut self, index: usize) -> Option<&mut LiveEntity> {
        self.slots.get_mut(index).filter(|entity| entity.built)
    }

    /// Where the slots start in memory: what [`crate::debug::show_entities`] tells a
    /// tool. Slot `i` is `i * size_of::<LiveEntity>()` bytes on, built or not.
    pub fn slots_address(&self) -> *const LiveEntity {
        self.slots.as_ptr()
    }

    /// The active rooms, as ranges of entity numbers.
    pub fn active_rooms(&self) -> impl Iterator<Item = core::ops::Range<usize>> + '_ {
        self.active[..self.active_count].iter().map(|&(first, end)| first as usize..end as usize)
    }

    /// At the last [`Self::enter`]: entities past the table's end, and behaviours past
    /// [`MAX_BEHAVIOURS`] on one entity, that were left out. Both are zero unless the
    /// ROM was patched past what the studio allows.
    pub const fn dropped(&self) -> (usize, usize) {
        (self.dropped_entities, self.dropped_behaviours)
    }
}
