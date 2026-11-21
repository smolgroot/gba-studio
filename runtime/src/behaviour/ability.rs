use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event, ability_number};
use crate::data::{Settings, World};

/// Gives the player an ability when they touch it: answers [`Event::Grant`] once, and
/// the actor is no longer alive. The game adds it to its [`super::Abilities`].
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `grants_ability`, 0 to 31.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AbilityPickup {
    pub ability: u8,
}

impl Behaviour for AbilityPickup {
    const DECLARATION: Declaration = Declaration {
        id: "ability-pickup",
        number: 8,
        summary: "Gives the player an ability when they touch it.",
        props: &[PropDecl::int("grants_ability", "The ability it gives, 0 to 31", None, 0, 31)],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: grants_ability.
        Some(Self { ability: ability_number(settings.int(0)?)? })
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if !actor.alive || !actor.touches(cx.player) {
            return Event::None;
        }
        actor.alive = false;
        Event::Grant { ability: self.ability }
    }
}
