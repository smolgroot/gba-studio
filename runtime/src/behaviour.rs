//! Ready-made behaviours for placed entities: what a Metroidvania's enemies, pickups
//! and props do, so a game only writes what is special about it.
//!
//! Every behaviour has the same shape, the [`Behaviour`] trait: a plain struct built
//! from the properties of an entity whose type lists it in `project.json`, and an update for one frame that moves an [`Actor`]
//! and answers with an [`Event`]. Behaviours never change the game's own state (the
//! score, the player, what is collected): the game decides what an event means. That
//! keeps them testable on the host and lets one entity have several, as a sentry bot
//! is a [`Patrol`] and a [`Hazard`].
//!
//! Like [`crate::data`] and [`crate::physics`], this module has no dependencies and
//! does not allocate.

mod ability;
mod checkpoint;
mod collectible;
pub mod declare;
mod door;
mod hazard;
pub mod live;
mod patrol;
mod platform;
mod pool;
mod projectile;
mod spawner;

pub use ability::AbilityPickup;
pub use checkpoint::Checkpoint;
pub use collectible::Collectible;
pub use door::Door;
pub use hazard::Hazard;
pub use live::{Attached, Dispatch, LiveEntities, LiveEntity, MAX_BEHAVIOURS};
pub use patrol::Patrol;
pub use platform::MovingPlatform;
pub use pool::Pool;
pub use projectile::{Projectile, Shooter, Shot};
pub use spawner::Spawner;

use crate::data::{Entity, Settings, World};
use crate::physics::Body;
use declare::Declaration;

/// Every behaviour the runtime has, in the order of their numbers.
pub const DECLARATIONS: [&Declaration; 10] = [
    &<Patrol as Behaviour>::DECLARATION,
    &<Collectible as Behaviour>::DECLARATION,
    &<Hazard as Behaviour>::DECLARATION,
    &<Projectile as Behaviour>::DECLARATION,
    &<Shooter as Behaviour>::DECLARATION,
    &<MovingPlatform as Behaviour>::DECLARATION,
    &<Door as Behaviour>::DECLARATION,
    &<Checkpoint as Behaviour>::DECLARATION,
    &<AbilityPickup as Behaviour>::DECLARATION,
    &<Spawner as Behaviour>::DECLARATION,
];

/// A behaviour by its id in projects.
pub fn declaration(id: &str) -> Option<&'static Declaration> {
    DECLARATIONS.iter().copied().find(|declaration| declaration.id == id)
}

/// One behaviour of an entity type.
pub trait Behaviour: Sized {
    /// Its id, number and the properties it reads: what entity types list in
    /// `project.json` and the build checks.
    const DECLARATION: Declaration;

    /// The behaviour's settings on an entity, or `None` when the entity's type does not
    /// list it.
    #[inline]
    fn from_entity(entity: &Entity) -> Option<Self> {
        Self::from_settings(&entity.behaviour(Self::DECLARATION.number)?)
    }

    /// The behaviour's settings from its properties on an entity, read by position.
    fn from_settings(settings: &Settings) -> Option<Self>;

    /// One frame: moves the actor if the behaviour moves it, and says what happened.
    fn update(&mut self, actor: &mut Actor, world: &World, cx: &Context) -> Event;
}

/// What came of an entity's frame. The game decides what each one does.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// Nothing that concerns the game.
    None,
    /// The player touched something that hurts.
    Hurt,
    /// The player took a collectible worth this much. The actor is no longer alive.
    Collect { value: i32 },
    /// The player picked up an ability, numbered 0 to 31: add it to their [`Abilities`].
    Grant { ability: u8 },
    /// The player reached a checkpoint: where they come back to, their feet in world pixels.
    Checkpoint { x: i32, y: i32 },
    /// A shooter fired: put a [`Projectile`] for the shot in a [`Pool`].
    Fire(Shot),
    /// A spawner wants a new entity with its feet here, in world pixels. If the game
    /// cannot make one, it calls [`Spawner::despawned`] so the spawner does not count it.
    Spawn { x: i32, y: i32 },
    /// A door opened. It no longer blocks.
    Opened,
}

/// Which of 32 abilities the player has: double jump, a key, a dash. What each number
/// means is the game's to say.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Abilities(pub u32);

impl Abilities {
    pub const NONE: Self = Self(0);

    /// Whether the player has ability `ability`. A number past 31 is never had.
    pub const fn has(self, ability: u8) -> bool {
        ability < 32 && self.0 & (1 << ability) != 0
    }

    /// Gives the player ability `ability`. Returns whether that is news: false if they
    /// had it already, or if the number is past 31.
    pub const fn grant(&mut self, ability: u8) -> bool {
        if ability >= 32 || self.has(ability) {
            return false;
        }
        self.0 |= 1 << ability;
        true
    }
}

/// An ability number from a property: 0 to 31, or `None` for anything else (−1 is how
/// an author says "none").
fn ability_number(value: i32) -> Option<u8> {
    u8::try_from(value).ok().filter(|&ability| ability < 32)
}

/// An entity's box for touching, as an offset from its feet and a size: a sprite
/// sheet's hitbox, from `gfx::SpriteSheet::hitbox`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Hitbox {
    pub x: i16,
    pub y: i16,
    pub w: u16,
    pub h: u16,
}

/// A placed entity while the game runs: where it is now, which the data section,
/// being in ROM, cannot hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Actor {
    /// Its feet (the middle of its bottom edge) in world pixels.
    pub x: i32,
    pub y: i32,
    /// Where it was placed, in world pixels. Patrols move around it.
    pub home: (i32, i32),
    /// Pixels a frame, for behaviours that move by speed.
    pub vx: i32,
    pub vy: i32,
    pub faces_left: bool,
    /// False once it has been taken or destroyed. Behaviours leave a dead actor alone.
    pub alive: bool,
    pub hitbox: Hitbox,
}

impl Actor {
    /// An actor standing with its feet at a point of the world.
    pub const fn at(x: i32, y: i32, hitbox: Hitbox) -> Self {
        Self { x, y, home: (x, y), vx: 0, vy: 0, faces_left: false, alive: true, hitbox }
    }

    /// The actor for entity `number` of a room, where it was placed. `None` if the
    /// room has no such entity or is not on the world map.
    pub fn placed(world: &World, room: usize, number: usize, hitbox: Hitbox) -> Option<Self> {
        if room >= world.room_count() {
            return None;
        }
        let entities = world.room(room);
        if number >= entities.entity_count() {
            return None;
        }
        let entity = entities.entity(number);
        let (left, top) = world.origin(room)?;
        Some(Self::at(left + entity.x as i32, top + entity.y as i32, hitbox))
    }

    /// Its hitbox in world pixels, as left, top, width and height: what
    /// [`Body::overlaps`] takes.
    pub const fn bounds(&self) -> (i32, i32, i32, i32) {
        (self.x + self.hitbox.x as i32, self.y + self.hitbox.y as i32, self.hitbox.w as i32, self.hitbox.h as i32)
    }

    /// Whether a body overlaps the actor's hitbox.
    pub const fn touches(&self, body: &Body) -> bool {
        let (x, y, w, h) = self.bounds();
        body.overlaps(x, y, w, h)
    }
}

/// Buttons, one bit each, in the GBA's order (the bits of `KEYINPUT`, but set when
/// pressed). Plain bits keep the runtime free of agb: the game fills it once a frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Buttons(pub u16);

impl Buttons {
    pub const A: u16 = 1;
    pub const B: u16 = 1 << 1;
    pub const SELECT: u16 = 1 << 2;
    pub const START: u16 = 1 << 3;
    pub const RIGHT: u16 = 1 << 4;
    pub const LEFT: u16 = 1 << 5;
    pub const UP: u16 = 1 << 6;
    pub const DOWN: u16 = 1 << 7;
    pub const R: u16 = 1 << 8;
    pub const L: u16 = 1 << 9;

    /// Whether every button in `buttons` (one of the constants, or several or-ed) is in the set.
    pub const fn has(self, buttons: u16) -> bool {
        self.0 & buttons == buttons
    }
}

/// What a behaviour may look at besides its own actor and the world.
#[derive(Clone, Copy, Debug)]
pub struct Context<'a> {
    pub player: &'a Body,
    /// Frames since the game began. Behaviours that move by the clock follow it, so
    /// where they are can be worked out from the frame count alone.
    pub clock: u32,
    /// Buttons held this frame.
    pub held: Buttons,
    /// Buttons pressed this frame and not the one before.
    pub pressed: Buttons,
    /// The abilities the player has.
    pub abilities: Abilities,
}

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod tests;
