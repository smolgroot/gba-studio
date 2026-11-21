//! Darkening a room's layers: the room's own settings and the level the game steps
//! while it runs. The console darkens with its brightness-decrease effect, which takes
//! one level (0 to 16 sixteenths of the way to black) for the layers it is told to
//! affect, so a room has a set of dimmed layers and one level, not a level per layer.
//! Plain code with no dependencies, so it tests on the host; `gfx` applies it.

/// The level that is black.
pub const MAX_DIM: u8 = 16;

/// How a room is darkened: which layers, and by how much.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct RoomDim {
    /// 0 (no change) to [`MAX_DIM`] (black).
    pub level: u8,
    /// Bit n is set when the room's tile layer n (back to front) is darkened.
    pub tiles: u8,
    /// Bit n is set when the room's background n (back to front) is darkened.
    pub backgrounds: u8,
}

impl RoomDim {
    /// Reads the dim bits of a room's flag word.
    pub const fn from_flags(flags: u16) -> Self {
        Self {
            tiles: ((flags >> super::layout::FLAG_DIM_TILES_SHIFT) & 0b111) as u8,
            backgrounds: ((flags >> super::layout::FLAG_DIM_BACKGROUNDS_SHIFT) & 0b11) as u8,
            level: ((flags >> super::layout::FLAG_DIM_LEVEL_SHIFT) & 0b1_1111) as u8,
        }
    }

    /// The dim bits of a room's flag word; the other bits are zero.
    pub const fn to_flags(self) -> u16 {
        ((self.tiles as u16 & 0b111) << super::layout::FLAG_DIM_TILES_SHIFT)
            | ((self.backgrounds as u16 & 0b11) << super::layout::FLAG_DIM_BACKGROUNDS_SHIFT)
            | ((self.level as u16 & 0b1_1111) << super::layout::FLAG_DIM_LEVEL_SHIFT)
    }

    /// Whether anything is darkened: a level above 0 and at least one layer.
    pub const fn is_on(self) -> bool {
        self.level > 0 && (self.tiles | self.backgrounds) != 0
    }
}

/// The level on screen now, which the game may set or fade while it runs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Dim {
    level: u8,
    from: u8,
    to: u8,
    frames: u16,
    done: u16,
    /// The room whose own level was last put back by [`Dim::enter`].
    room: Option<usize>,
}

impl Dim {
    /// At a level, not fading. Levels above [`MAX_DIM`] are black.
    pub const fn new(level: u8) -> Self {
        let level = if level > MAX_DIM { MAX_DIM } else { level };
        Self { level, from: level, to: level, frames: 0, done: 0, room: None }
    }

    /// The level to draw this frame.
    #[inline]
    pub const fn level(&self) -> u8 {
        self.level
    }

    /// Whether a fade is still running.
    #[inline]
    pub const fn fading(&self) -> bool {
        self.done < self.frames
    }

    /// Jumps to a level, ending any fade.
    pub fn set(&mut self, level: u8) {
        *self = Self { room: self.room, ..Self::new(level) };
    }

    /// Puts a room's own level back when the player enters it. Entering the room it
    /// already is in changes nothing, so a level the game set stays.
    pub fn enter(&mut self, room: usize, level: u8) {
        if self.room != Some(room) {
            self.set(level);
            self.room = Some(room);
        }
    }

    /// Moves to a level in a straight line over `frames` 60 Hz frames: call [`Dim::step`]
    /// once per frame. With 0 frames it jumps. Asking for the level it is already
    /// moving to changes nothing, so this can be called every frame.
    pub fn fade(&mut self, level: u8, frames: u16) {
        let to = level.min(MAX_DIM);
        if frames == 0 {
            return self.set(to);
        }
        if (self.fading() && self.to == to) || (!self.fading() && self.level == to) {
            return;
        }
        *self = Self { level: self.level, from: self.level, to, frames, done: 0, room: self.room };
    }

    /// Advances a running fade by a frame. Returns whether the level changed.
    pub fn step(&mut self) -> bool {
        if !self.fading() {
            return false;
        }
        self.done += 1;
        let before = self.level;
        let (from, to, done, frames) = (self.from as i32, self.to as i32, self.done as i32, self.frames as i32);
        // Rounded to the nearest level, and exactly the target at the end.
        self.level = (from + ((to - from) * done * 2 + frames * if to >= from { 1 } else { -1 }) / (frames * 2)) as u8;
        if self.done == self.frames {
            self.level = self.to;
        }
        self.level != before
    }
}

/// A BGR555 colour darkened the way the console does: each 5-bit channel loses
/// `channel * level / 16`, rounded down. The game never needs this (the hardware does
/// it); it is the reference the studio's preview is checked against.
pub const fn darken_bgr555(colour: u16, level: u8) -> u16 {
    let level = if level > MAX_DIM { MAX_DIM } else { level } as u16;
    channel(colour & 31, level) | channel((colour >> 5) & 31, level) << 5 | channel((colour >> 10) & 31, level) << 10
}

const fn channel(c: u16, level: u16) -> u16 {
    c - c * level / 16
}
