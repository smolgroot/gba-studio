//! Where the game's state is, for tools reading the emulator's memory: the studio's
//! debug map (see `docs/reference/debug-map.md`).
//!
//! The game keeps its state wherever it likes, usually in locals of `main`, whose
//! addresses no tool can know. Once a frame it hands a copy to [`publish`], which
//! writes it to one block at a fixed place in EWRAM. A record in the ROM, starting
//! `PECTDBUG`, holds that block's address, so a tool finds it from the `.gba` alone.
//!
//! The other way, the studio tells a running game that it has changed the ROM's
//! level data (live apply): it writes to an inbox, also found through the record,
//! and the game asks [`Live::poll`] once a frame.
//!
//! The block, the inbox and the record are only in builds with debug assertions (dev
//! builds), or with the `debug-map` feature. Otherwise [`publish`] does nothing,
//! [`Live::poll`] never sees a change, and the ROM has none of them.

use crate::data::Collected;
use crate::physics::Body;

/// The first word of a published block: `PSGS` in memory. A block that is still all
/// zeros has not been published yet.
pub const STAMP: u32 = u32::from_le_bytes(*b"PSGS");

/// The version of the ROM record and of the block and inbox layouts. Raised when any
/// changes, so a tool never reads one with the wrong layout. Version 2 added the inbox.
pub const VERSION: u32 = 2;

/// What a tool can see of the game each frame. Every field is a 32-bit word, so the
/// layout is the same on the console and on the host.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GameState {
    /// [`STAMP`] once published. [`GameState::new`] sets it.
    pub stamp: u32,
    /// Frames since the game began. Entities that move by the clock, such as patrols,
    /// follow it.
    pub frame: u32,
    /// Index of the room the player is in, in the data section's room table.
    pub room: u32,
    /// The camera's top-left corner in world pixels.
    pub camera_x: i32,
    pub camera_y: i32,
    /// The player's body. Its position is in world pixels.
    pub player: Body,
    /// Address of the collected bits, one per entity of the project, or 0.
    pub collected: u32,
    /// Words of 32 bits at [`GameState::collected`].
    pub collected_words: u32,
}

impl GameState {
    /// A state with the stamp set and everything else zero.
    pub const fn new() -> Self {
        Self { stamp: STAMP, frame: 0, room: 0, camera_x: 0, camera_y: 0, player: Body::new(0, 0, 0, 0), collected: 0, collected_words: 0 }
    }

    /// Points the state at what the game has collected. The bits must stay where they
    /// are while the game runs, as locals of `main` do.
    pub fn collected<const WORDS: usize>(&mut self, found: &Collected<WORDS>) {
        // Addresses are 32 bits on the console. On the host this is only a number.
        self.collected = found.words.as_ptr() as usize as u32;
        self.collected_words = WORDS as u32;
    }
}

/// What the studio writes to tell the game its data changed. The studio sets bits in
/// `changed` and adds one to `generation`; [`Live::poll`] copies `generation` to
/// `seen` and clears `changed`. All three are words, as in [`GameState`].
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Inbox {
    pub generation: u32,
    pub changed: u32,
    pub seen: u32,
}

/// What changed in the data section since the game last looked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Changes(pub u32);

impl Changes {
    /// Tile layers or collision of a room: redraw the tiles in view.
    pub const TILES: u32 = 1;
    /// The physics settings: read them again.
    pub const PHYSICS: u32 = 2;
    /// Entities or their properties. The studio has already moved the collected bits.
    pub const ENTITIES: u32 = 4;
    /// Rooms added, removed, resized, moved on the map or given another tileset, the
    /// collision classes, or the start room: make the view again.
    pub const ROOMS: u32 = 8;

    pub const fn tiles(self) -> bool {
        self.0 & Self::TILES != 0
    }
    pub const fn rooms(self) -> bool {
        self.0 & Self::ROOMS != 0
    }
    pub const fn physics(self) -> bool {
        self.0 & Self::PHYSICS != 0
    }
    pub const fn entities(self) -> bool {
        self.0 & Self::ENTITIES != 0
    }
}

/// Watches the inbox for live changes. After a change the level data's tables may
/// have moved, so make the `World` again from the generated `data::world()`, and any
/// view with it. Other state (the player, the camera, the score) stays the game's.
#[derive(Debug, Default)]
pub struct Live {
    seen: u32,
}

impl Live {
    pub const fn new() -> Self {
        Self { seen: 0 }
    }

    /// What the studio changed since the last call, once per change; `None` most
    /// frames, and always in a build without the debug map. Call it once a frame.
    #[inline]
    pub fn poll(&mut self) -> Option<Changes> {
        #[cfg(any(debug_assertions, feature = "debug-map"))]
        {
            // SAFETY: the record points at `INBOX`, which lives for the whole program.
            // The studio writes it only between frames, never while this runs.
            let inbox = unsafe { core::ptr::read_volatile(&map::RECORD.inbox) };
            let inbox = unsafe { (*inbox).0.get() };
            let generation = unsafe { core::ptr::read_volatile(&raw const (*inbox).generation) };
            if generation == self.seen {
                return None;
            }
            self.seen = generation;
            let changed = unsafe { core::ptr::read_volatile(&raw const (*inbox).changed) };
            unsafe {
                core::ptr::write_volatile(&raw mut (*inbox).changed, 0);
                core::ptr::write_volatile(&raw mut (*inbox).seen, generation);
            }
            Some(Changes(changed))
        }
        #[cfg(not(any(debug_assertions, feature = "debug-map")))]
        None
    }
}

#[cfg(any(debug_assertions, feature = "debug-map"))]
mod map {
    use super::{GameState, Inbox, VERSION};
    use core::cell::UnsafeCell;

    /// The block a tool reads. Only [`super::publish`] writes it.
    #[repr(transparent)]
    pub(super) struct Block(pub(super) UnsafeCell<GameState>);
    // SAFETY: the GBA has one core, and only `publish` writes the block, from the
    // game's main loop. Interrupt handlers do not touch it.
    unsafe impl Sync for Block {}

    pub(super) static BLOCK: Block = Block(UnsafeCell::new(GameState::new()));

    /// The inbox the studio writes. Only [`super::Live::poll`] writes it in the game.
    #[repr(transparent)]
    pub(super) struct InboxCell(pub(super) UnsafeCell<Inbox>);
    // SAFETY: as for `Block`: one core, written by the game only from its main loop,
    // and by the studio only between frames.
    unsafe impl Sync for InboxCell {}

    pub(super) static INBOX: InboxCell = InboxCell(UnsafeCell::new(Inbox { generation: 0, changed: 0, seen: 0 }));

    /// The ROM record: magic, version, then the address and size of the block and of
    /// the inbox. 28 bytes on the console.
    #[repr(C)]
    pub(super) struct Record {
        pub(super) magic: [u8; 8],
        pub(super) version: u32,
        pub(super) block: *const Block,
        pub(super) size: u32,
        pub(super) inbox: *const InboxCell,
        pub(super) inbox_size: u32,
    }
    // SAFETY: the record is never written; the pointer is only read back.
    unsafe impl Sync for Record {}

    #[used]
    pub(super) static RECORD: Record = Record {
        magic: *b"PECTDBUG",
        version: VERSION,
        block: &BLOCK,
        size: size_of::<GameState>() as u32,
        inbox: &INBOX,
        inbox_size: size_of::<Inbox>() as u32,
    };
}

/// Copies the game's state to the block a tool reads. Call it once a frame, after
/// everything has moved. In a build without the debug map it does nothing.
#[inline]
pub fn publish(state: &GameState) {
    #[cfg(any(debug_assertions, feature = "debug-map"))]
    {
        // Read through the record, so the linker keeps it and the copy goes where
        // the record says.
        let block = unsafe { core::ptr::read_volatile(&map::RECORD.block) };
        // SAFETY: the record points at `BLOCK`, which lives for the whole program and
        // is only written here.
        unsafe { core::ptr::write_volatile((*block).0.get(), GameState { stamp: STAMP, ..*state }) };
    }
    #[cfg(not(any(debug_assertions, feature = "debug-map")))]
    let _ = state;
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use core::mem::offset_of;
    use std::format;
    use std::string::String;

    /// The layout as the studio reads it, in the form of `codegen/fixture/debug-layout.json`.
    fn layout() -> String {
        let field = |name: &str, offset: usize, kind: &str| format!("    {{ \"name\": \"{name}\", \"offset\": {offset}, \"type\": \"{kind}\" }}");
        let state = [
            field("stamp", offset_of!(GameState, stamp), "u32"),
            field("frame", offset_of!(GameState, frame), "u32"),
            field("room", offset_of!(GameState, room), "u32"),
            field("cameraX", offset_of!(GameState, camera_x), "i32"),
            field("cameraY", offset_of!(GameState, camera_y), "i32"),
            field("player", offset_of!(GameState, player), "body"),
            field("collected", offset_of!(GameState, collected), "address"),
            field("collectedWords", offset_of!(GameState, collected_words), "u32"),
        ];
        let body = [
            field("x", offset_of!(Body, x), "i32"),
            field("y", offset_of!(Body, y), "i32"),
            field("w", offset_of!(Body, w), "i32"),
            field("h", offset_of!(Body, h), "i32"),
            field("vx", offset_of!(Body, vx), "i32"),
            field("vy", offset_of!(Body, vy), "i32"),
            field("onGround", offset_of!(Body, on_ground), "bool"),
            field("hitWall", offset_of!(Body, hit_wall), "bool"),
            field("hitCeiling", offset_of!(Body, hit_ceiling), "bool"),
        ];
        let inbox = [
            field("generation", offset_of!(Inbox, generation), "u32"),
            field("changed", offset_of!(Inbox, changed), "u32"),
            field("seen", offset_of!(Inbox, seen), "u32"),
        ];
        format!(
            "{{\n  \"version\": {VERSION},\n  \"stamp\": \"PSGS\",\n  \"size\": {},\n  \"fields\": [\n{}\n  ],\n  \"bodySize\": {},\n  \"body\": [\n{}\n  ],\n  \"inboxSize\": {},\n  \"inbox\": [\n{}\n  ]\n}}\n",
            size_of::<GameState>(),
            state.join(",\n"),
            size_of::<Body>(),
            body.join(",\n"),
            size_of::<Inbox>(),
            inbox.join(",\n"),
        )
    }

    /// The studio reads the block with the layout in the fixture. If this fails after
    /// a change to `GameState` or `Body`, raise `VERSION` and write the new layout to
    /// the fixture (the message has it).
    #[test]
    fn layout_matches_the_fixture() {
        let fixture = include_str!("../../codegen/fixture/debug-layout.json");
        let now = layout();
        assert!(fixture == now, "the debug layout changed; codegen/fixture/debug-layout.json should be:\n{now}");
    }

    #[test]
    fn publish_writes_the_block_with_the_stamp() {
        let mut state = GameState { frame: 7, room: 2, camera_x: -3, camera_y: 40, player: Body::new(10, 20, 8, 14), ..GameState::default() };
        let found = Collected::<2>::new();
        state.collected(&found);
        publish(&state);
        // SAFETY: tests read the block only here, after the write.
        let block = unsafe { core::ptr::read_volatile(map::BLOCK.0.get()) };
        assert_eq!(block, GameState { stamp: STAMP, ..state });
        assert_eq!(block.collected_words, 2);
    }

    #[test]
    fn the_record_points_at_the_block() {
        assert_eq!(&map::RECORD.magic, b"PECTDBUG");
        assert_eq!(map::RECORD.version, VERSION);
        assert_eq!(map::RECORD.size as usize, size_of::<GameState>());
        assert!(core::ptr::eq(map::RECORD.block, &map::BLOCK));
        assert!(core::ptr::eq(map::RECORD.inbox, &map::INBOX));
        assert_eq!(map::RECORD.inbox_size as usize, size_of::<Inbox>());
    }

    #[test]
    fn live_sees_each_change_once_and_answers_in_the_inbox() {
        let inbox = map::INBOX.0.get();
        let mut live = Live::new();
        assert_eq!(live.poll(), None, "nothing has changed yet");
        // The studio, between frames: physics and tiles changed.
        // SAFETY: only this test touches the inbox.
        unsafe { inbox.write(Inbox { generation: 1, changed: Changes::PHYSICS | Changes::TILES, seen: 0 }) };
        let changes = live.poll().expect("a change");
        assert!(changes.physics() && changes.tiles() && !changes.entities());
        assert_eq!(unsafe { inbox.read() }, Inbox { generation: 1, changed: 0, seen: 1 });
        assert_eq!(live.poll(), None, "seen once");
        unsafe { inbox.write(Inbox { generation: 2, changed: Changes::ENTITIES, seen: 1 }) };
        assert_eq!(live.poll(), Some(Changes(Changes::ENTITIES)));
        assert!(!Changes(Changes::ENTITIES).tiles());
        assert!(Changes(Changes::ROOMS).rooms() && !Changes(Changes::ROOMS).tiles());
    }
}
