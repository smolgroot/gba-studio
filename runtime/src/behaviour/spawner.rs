use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event};
use crate::data::{Settings, World};

/// Makes entities where it stands: every `every` frames, while fewer than `max_alive`
/// of its children are alive, answers [`Event::Spawn`] with its feet. The game makes the
/// child (in a [`super::Pool`]) and calls [`Spawner::despawned`] when one dies, or when it
/// could not make it. It counts its children, so the game keeps the struct.
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `spawn_every` (frames) and
/// `max_alive` (3 if not set).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spawner {
    /// Frames between spawns, at least 1.
    pub every: u32,
    pub max_alive: u8,
    /// Children alive now.
    pub alive: u8,
}

impl Spawner {
    pub const DEFAULT_MAX_ALIVE: u8 = 3;

    pub const fn new(every: u32, max_alive: u8) -> Self {
        Self { every: if every == 0 { 1 } else { every }, max_alive, alive: 0 }
    }

    /// One of its children died, or was never made.
    pub const fn despawned(&mut self) {
        self.alive = self.alive.saturating_sub(1);
    }
}

impl Behaviour for Spawner {
    const DECLARATION: Declaration = Declaration {
        id: "spawner",
        number: 9,
        summary: "Makes entities where it stands, a few at a time.",
        props: &[
            PropDecl::int("spawn_every", "Frames between spawns", Some(120), 1, 3600),
            PropDecl::int("max_alive", "How many of its entities may be alive at once", Some(Self::DEFAULT_MAX_ALIVE as i32), 0, 255),
        ],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: spawn_every, max_alive.
        Some(Self::new(settings.int(0)?.max(1) as u32, settings.int(1)?.clamp(0, u8::MAX as i32) as u8))
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if !actor.alive || self.alive >= self.max_alive || cx.clock % self.every != 0 {
            return Event::None;
        }
        self.alive += 1;
        Event::Spawn { x: actor.x, y: actor.y }
    }
}
