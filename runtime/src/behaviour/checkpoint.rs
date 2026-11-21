use super::declare::Declaration;
use super::{Actor, Behaviour, Context, Event};
use crate::data::{Settings, World};

/// Where the player comes back to: the first time they touch it, answers
/// [`Event::Checkpoint`] with its feet. It keeps that it was reached, so the game keeps
/// the struct.
///
/// It has no properties: an entity is one when its type lists it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Checkpoint {
    pub reached: bool,
}

impl Behaviour for Checkpoint {
    const DECLARATION: Declaration =
        Declaration { id: "checkpoint", number: 7, summary: "Where the player comes back to, once they have touched it.", props: &[] };

    fn from_settings(_settings: &Settings) -> Option<Self> {
        Some(Self::default())
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if self.reached || !actor.alive || !actor.touches(cx.player) {
            return Event::None;
        }
        self.reached = true;
        Event::Checkpoint { x: actor.x, y: actor.y }
    }
}
