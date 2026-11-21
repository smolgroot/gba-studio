use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event};
use crate::data::{Settings, World};
use crate::physics::Body;

/// Goes back and forth in a straight line between where it was placed and `travel`
/// pixels from there, one pixel along its longer side every `pace` frames. Where it is
/// follows from the clock alone, like a [`super::Patrol`]. The top of its hitbox is a
/// one-way floor: [`MovingPlatform::carry`] lands a falling body on it and moves a
/// standing one along.
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `travel_x` and `travel_y`
/// (pixels) and `travel_pace` (frames a pixel, 2 if not set).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MovingPlatform {
    pub travel: (i32, i32),
    /// Frames a pixel, at least 1.
    pub pace: u32,
}

impl MovingPlatform {
    pub const DEFAULT_PACE: u32 = 2;

    pub const fn new(travel: (i32, i32), pace: u32) -> Self {
        Self { travel, pace: if pace == 0 { 1 } else { pace } }
    }

    /// Pixels from home after `clock` frames.
    pub const fn offset(&self, clock: u32) -> (i32, i32) {
        let (tx, ty) = self.travel;
        let length = if tx.abs() > ty.abs() { tx.abs() } else { ty.abs() };
        if length == 0 {
            return (0, 0);
        }
        let step = (clock / self.pace % (2 * length as u32)) as i32;
        let along = if step <= length { step } else { 2 * length - step };
        (tx * along / length, ty * along / length)
    }

    /// Lands a body on the platform's top or carries one standing there. Call it after
    /// the body has moved for the frame (`Body::step`), with the body as it was before
    /// that move. Returns whether the body is on the platform.
    ///
    /// A body going up passes through from below, as through a one-way platform.
    pub fn carry(&self, actor: &Actor, body: &mut Body, before: &Body) -> bool {
        if !actor.alive || body.vy < 0 {
            return false;
        }
        let (x, top, w, _) = actor.bounds();
        // Where the top was before this frame's move, which the body stood on or was above.
        let (was_left, was_top) = (x - actor.vx, top - actor.vy);
        let feet_before = before.y + before.h;
        let stood = feet_before == was_top && before.x < was_left + w && was_left < before.x + before.w;
        if stood {
            body.x += actor.vx;
        }
        let across = body.x < x + w && x < body.x + body.w;
        let landed = across && feet_before <= was_top && body.y + body.h >= top;
        if !(stood && across) && !landed {
            return false;
        }
        body.y = top - body.h;
        body.vy = 0;
        body.on_ground = true;
        true
    }
}

impl Behaviour for MovingPlatform {
    const DECLARATION: Declaration = Declaration {
        id: "moving-platform",
        number: 5,
        summary: "Goes back and forth along a line; the player can stand on it.",
        props: &[
            PropDecl::int("travel_x", "How far it goes across, in pixels; left if negative", Some(0), -4096, 4096),
            PropDecl::int("travel_y", "How far it goes down, in pixels; up if negative", Some(0), -4096, 4096),
            PropDecl::int("travel_pace", "Frames it takes to move a pixel", Some(Self::DEFAULT_PACE as i32), 1, 255),
        ],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: travel_x, travel_y, travel_pace.
        Some(Self::new((settings.int(0)?, settings.int(1)?), settings.int(2)?.max(1) as u32))
    }

    /// Moves the actor along its line, and sets its velocity to this frame's move, which
    /// [`MovingPlatform::carry`] gives to a body standing on it.
    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if actor.alive {
            let (x, y) = self.offset(cx.clock);
            let (was_x, was_y) = self.offset(cx.clock.wrapping_sub(1));
            (actor.x, actor.y) = (actor.home.0 + x, actor.home.1 + y);
            (actor.vx, actor.vy) = (x - was_x, y - was_y);
        }
        Event::None
    }
}
