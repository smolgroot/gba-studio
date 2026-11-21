use super::declare::{Declaration, PropDecl};
use super::{Actor, Behaviour, Context, Event};
use crate::data::{Settings, World};

/// Walks back and forth along x around where it was placed. Where it is follows from
/// the clock alone, so the studio can tell where a patrol is from the frame count.
///
/// Properties, as [`Behaviour::DECLARATION`] lists them: `patrol`, how far it walks
/// each way in pixels, and `patrol_pace`, frames to walk a pixel (2 if not set).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Patrol {
    /// Pixels each way from home. Zero or less stands still.
    pub reach: i32,
    /// Frames to walk one pixel, at least 1.
    pub pace: u32,
}

impl Patrol {
    /// Frames a pixel when `patrol_pace` is not set.
    pub const DEFAULT_PACE: u32 = 2;

    pub const fn new(reach: i32, pace: u32) -> Self {
        Self { reach, pace: if pace == 0 { 1 } else { pace } }
    }

    /// Pixels from home after `clock` frames, and whether it is walking left. It starts
    /// at home walking right, turns at `reach`, walks to `-reach`, and comes back.
    pub const fn offset(&self, clock: u32) -> (i32, bool) {
        let reach = self.reach;
        if reach <= 0 {
            return (0, false);
        }
        let step = (clock / self.pace % (4 * reach as u32)) as i32;
        if step < reach {
            (step, false)
        } else if step < 3 * reach {
            (2 * reach - step, true)
        } else {
            (step - 4 * reach, false)
        }
    }
}

impl Behaviour for Patrol {
    const DECLARATION: Declaration = Declaration {
        id: "patrol",
        number: 0,
        summary: "Walks back and forth around where it was placed.",
        props: &[
            PropDecl::int("patrol", "How far it walks each way, in pixels", Some(32), 0, 4096),
            PropDecl::int("patrol_pace", "Frames it takes to walk a pixel", Some(Self::DEFAULT_PACE as i32), 1, 255),
        ],
    };

    fn from_settings(settings: &Settings) -> Option<Self> {
        // By position, in the order DECLARATION lists them: patrol, patrol_pace.
        Some(Self::new(settings.int(0)?, settings.int(1)?.max(1) as u32))
    }

    fn update(&mut self, actor: &mut Actor, _world: &World, cx: &Context) -> Event {
        if actor.alive {
            let (walked, left) = self.offset(cx.clock);
            actor.x = actor.home.0 + walked;
            actor.faces_left = left;
        }
        Event::None
    }
}
