use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event, ability_number};
use crate::data::{Settings, World};
use crate::physics::Body;

/// A door that blocks until the player opens it. It opens when the player touches it
/// (or stands right against it) while holding the ability it needs, or, if it needs
/// none, while pressing Up. Opening answers [`Event::Opened`] once. It keeps whether it
/// is open, so the game keeps the struct, or records the opening in a
/// [`crate::data::Collected`] to keep it open for good.
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `needs_ability`, 0 to 31, or
/// −1 for none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Door {
    pub needs: Option<u8>,
    pub open: bool,
}

impl Door {
    pub const fn new(needs: Option<u8>) -> Self {
        Self { needs, open: false }
    }

    /// Stops a body going through the closed door: pushes it back out on the side it
    /// came from. Call it after the body has moved for the frame, with the body as it
    /// was before that move. Returns whether it pushed.
    pub fn block(&self, actor: &Actor, body: &mut Body, before: &Body) -> bool {
        let (x, y, w, h) = actor.bounds();
        if self.open || !actor.alive || !body.overlaps(x, y, w, h) {
            return false;
        }
        if before.x + before.w <= x {
            body.x = x - body.w;
            body.vx = 0;
            body.hit_wall = true;
        } else if before.x >= x + w {
            body.x = x + w;
            body.vx = 0;
            body.hit_wall = true;
        } else if before.y + before.h <= y {
            body.y = y - body.h;
            body.vy = 0;
            body.on_ground = true;
        } else {
            body.y = y + h;
            body.vy = 0;
            body.hit_ceiling = true;
        }
        true
    }
}

impl Behaviour for Door {
    const DECLARATION: Declaration = Declaration {
        id: "door",
        number: 6,
        summary: "Blocks the way until the player opens it.",
        props: &[PropDecl::int("needs_ability", "The ability that opens it, 0 to 31; -1 opens it with Up", Some(-1), -1, 31)],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: needs_ability.
        Some(Self::new(ability_number(settings.int(0)?)))
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if self.open || !actor.alive {
            return Event::None;
        }
        // A closed door keeps the player out, so against it counts as touching.
        let (x, y, w, h) = actor.bounds();
        if !cx.player.overlaps(x - 1, y, w + 2, h) {
            return Event::None;
        }
        let may = match self.needs {
            Some(ability) => cx.abilities.has(ability),
            None => cx.held.has(super::Buttons::UP),
        };
        if !may {
            return Event::None;
        }
        self.open = true;
        Event::Opened
    }
}
