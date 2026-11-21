use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event};
use crate::data::{Settings, World};

/// Taken when the player touches it: answers [`Event::Collect`] once, and the actor
/// is no longer alive. Whether it stays taken after the room is left is the game's
/// choice, kept in a [`crate::data::Collected`].
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `value`, what it is worth.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Collectible {
    pub value: i32,
}

impl Behaviour for Collectible {
    const DECLARATION: Declaration = Declaration {
        id: "collectible",
        number: 1,
        summary: "Taken when the player touches it, for what it is worth.",
        props: &[PropDecl::int("value", "What it is worth", Some(1), 0, 1_000_000)],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: value.
        Some(Self { value: settings.int(0)? })
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if !actor.alive || !actor.touches(cx.player) {
            return Event::None;
        }
        actor.alive = false;
        Event::Collect { value: self.value }
    }
}
