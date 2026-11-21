use super::declare::Declaration;
use super::{Actor, Behaviour, Context, Event};
use crate::data::{Settings, World};

/// Hurts the player that touches it: answers [`Event::Hurt`] every frame they overlap.
/// Put it after a behaviour that moves the actor, so it hurts where the actor is now.
///
/// It has no properties: an entity is one when its type lists it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Hazard;

impl Behaviour for Hazard {
    const DECLARATION: Declaration = Declaration { id: "hazard", number: 2, summary: "Hurts the player that touches it.", props: &[] };

    fn from_settings(_settings: &Settings) -> Option<Self> {
        Some(Self)
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if actor.alive && actor.touches(cx.player) { Event::Hurt } else { Event::None }
    }
}
