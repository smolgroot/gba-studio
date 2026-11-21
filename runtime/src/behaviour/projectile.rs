use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event, Hitbox};
use crate::data::{Cells, CollisionKind, Settings, World};

/// A shot as a [`Shooter`] fires it: where its feet start, in world pixels (the
/// shooter's middle, so shot sprites are best anchored in their middle), and its speed
/// in pixels a frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shot {
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
}

impl Shot {
    /// The actor and the projectile that fly this shot, with the shot sprite's hitbox:
    /// what goes in a [`super::Pool`].
    pub const fn launch(&self, hitbox: Hitbox) -> (Actor, Projectile) {
        let mut actor = Actor::at(self.x, self.y, hitbox);
        actor.vx = self.vx;
        actor.vy = self.vy;
        actor.faces_left = self.vx < 0;
        (actor, Projectile::new(self.vx, self.vy, Projectile::DEFAULT_LIFE))
    }
}

/// Flies at its speed. It dies when the middle of its hitbox reaches a solid cell, when
/// its time runs out, or when it hits the player, which answers [`Event::Hurt`].
///
/// Usually fired by a [`Shooter`] and made with [`Shot::launch`]. An entity whose type
/// lists it flies along x at its `shot_speed`, left if negative.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Projectile {
    /// Pixels a frame.
    pub vx: i32,
    pub vy: i32,
    /// Frames left to fly.
    pub life: u16,
}

impl Projectile {
    /// How long a projectile flies when nothing stops it: four seconds.
    pub const DEFAULT_LIFE: u16 = 240;

    pub const fn new(vx: i32, vy: i32, life: u16) -> Self {
        Self { vx, vy, life }
    }
}

impl Behaviour for Projectile {
    const DECLARATION: Declaration = Declaration {
        id: "projectile",
        number: 3,
        summary: "Flies along until it hits a wall or the player, or its time runs out.",
        props: &[PropDecl::int("shot_speed", "Pixels a frame; left if negative", Some(2), -16, 16)],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: shot_speed.
        Some(Self::new(settings.int(0)?, 0, Self::DEFAULT_LIFE))
    }

    fn update(&mut self, actor: &mut Actor, world: &World, cx: &Context) -> Event {
        if !actor.alive {
            return Event::None;
        }
        if self.life == 0 {
            actor.alive = false;
            return Event::None;
        }
        self.life -= 1;
        (actor.vx, actor.vy) = (self.vx, self.vy);
        actor.x += self.vx;
        actor.y += self.vy;
        if self.vx != 0 {
            actor.faces_left = self.vx < 0;
        }
        let (x, y, w, h) = actor.bounds();
        if world.class_at(x + w / 2, y + h / 2).kind == CollisionKind::Solid {
            actor.alive = false;
            return Event::None;
        }
        if actor.touches(cx.player) {
            actor.alive = false;
            return Event::Hurt;
        }
        Event::None
    }
}

/// Fires at the player: every `fire_every` frames, if the player is within `sight`
/// pixels both ways, answers [`Event::Fire`] with a shot from the middle of its hitbox
/// towards the player along x. It turns to face the player whenever they are in sight.
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `fire_every` (frames),
/// `shot_speed` (pixels a frame, 2 if not set) and `sight` (pixels, 96 if not set).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shooter {
    /// Frames between shots, at least 1.
    pub every: u32,
    pub speed: i32,
    pub sight: i32,
}

impl Shooter {
    pub const DEFAULT_SPEED: i32 = 2;
    pub const DEFAULT_SIGHT: i32 = 96;

    pub const fn new(every: u32, speed: i32, sight: i32) -> Self {
        Self { every: if every == 0 { 1 } else { every }, speed, sight }
    }
}

impl Behaviour for Shooter {
    const DECLARATION: Declaration = Declaration {
        id: "shooter",
        number: 4,
        summary: "Fires at the player when they are in sight.",
        props: &[
            PropDecl::int("fire_every", "Frames between shots", Some(60), 1, 3600),
            PropDecl::int("shot_speed", "Pixels a frame its shots fly", Some(Self::DEFAULT_SPEED), 1, 16),
            PropDecl::int("sight", "How near the player must be, in pixels", Some(Self::DEFAULT_SIGHT), 0, 1024),
        ],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: fire_every, shot_speed, sight.
        Some(Self::new(settings.int(0)?.max(1) as u32, settings.int(1)?, settings.int(2)?))
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if !actor.alive {
            return Event::None;
        }
        let (x, y, w, h) = actor.bounds();
        let (from_x, from_y) = (x + w / 2, y + h / 2);
        let player = cx.player;
        let dx = player.x + player.w / 2 - from_x;
        let dy = player.y + player.h / 2 - from_y;
        if dx.abs() > self.sight || dy.abs() > self.sight {
            return Event::None;
        }
        actor.faces_left = dx < 0;
        if cx.clock % self.every != 0 {
            return Event::None;
        }
        let vx = if dx < 0 { -self.speed } else { self.speed };
        Event::Fire(Shot { x: from_x, y: from_y, vx, vy: 0 })
    }
}
