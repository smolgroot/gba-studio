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
//! The game's table of live entities says where it is once, through
//! [`show_entities`], which the generated `data::entities()` calls; the record points
//! at that too.
//!
//! The studio changes the player through a request in RAM, which the game takes
//! once a frame with [`apply_player_edit`], and entities by writing their slots.
//!
//! The block, the inbox, the table's cell, the player edit and the record are only in builds with debug assertions (dev
//! builds), or with the `debug-map` feature. Otherwise [`publish`] does nothing,
//! [`Live::poll`] never sees a change, and the ROM has none of them.

use crate::behaviour::live::{LiveEntities, LiveEntity};
use crate::data::Collected;
use crate::physics::Body;

/// The first word of a published block: `PSGS` in memory. A block that is still all
/// zeros has not been published yet.
pub const STAMP: u32 = u32::from_le_bytes(*b"PSGS");

/// The version of the ROM record and of the block and inbox layouts. Raised when any
/// changes, so a tool never reads one with the wrong layout. Version 2 added the inbox,
/// version 3 the start override, version 4 the table of live entities, version 5 the
/// player edit and the entities' home in the table's layout.
pub const VERSION: u32 = 5;

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

/// Where the studio wants the game to start, written into the emulator's copy of the
/// ROM by "Play from here". Four words, all zero as built: `set` is 1 when the rest
/// counts. `x` and `y` are in room pixels, where an entity of that room would stand
/// (the middle of the bottom edge).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StartOverride {
    pub set: u32,
    pub room: u32,
    pub x: i32,
    pub y: i32,
}

/// Where the game's table of live entities is: the address of its first slot, how
/// many slots it has, and the size of each, all words. Slots that are not built are
/// there too, with `built` 0. See [`LiveEntity`] for what a slot holds.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EntityTable {
    pub address: u32,
    pub slots: u32,
    pub slot_size: u32,
}

impl EntityTable {
    /// Where `table` is. On the host the address is only a number.
    pub fn of<const N: usize>(table: &LiveEntities<N>) -> Self {
        Self { address: table.slots_address() as usize as u32, slots: N as u32, slot_size: size_of::<LiveEntity>() as u32 }
    }
}

/// Tells a tool where the game's table of live entities is. The generated
/// `data::entities()` calls it once, as it hands the table out; the table is a
/// `static`, so it never moves. In a build without the debug map it does nothing.
#[inline]
pub fn show_entities<const N: usize>(table: &LiveEntities<N>) {
    #[cfg(any(debug_assertions, feature = "debug-map"))]
    {
        let cell = unsafe { core::ptr::read_volatile(&map::RECORD.entities) };
        // SAFETY: the record points at `ENTITIES`, which lives for the whole program
        // and is only written here.
        unsafe { core::ptr::write_volatile((*cell).0.get(), EntityTable::of(table)) };
    }
    #[cfg(not(any(debug_assertions, feature = "debug-map")))]
    let _ = table;
}

/// A change to the player the studio asks for, while the game runs: the player's
/// position (top-left, world pixels) and speed (1/256 pixel a frame). `set` is 1
/// while the request waits; [`apply_player_edit`] takes it and sets it back to 0.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PlayerEdit {
    pub set: u32,
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
}

/// Puts a change the studio made to the player into `body`, once: true if there
/// was one. Call it once a frame, before the player moves. The player is a local of
/// the game, which the studio cannot safely write, so it asks instead. In a build
/// without the debug map it does nothing.
#[inline]
pub fn apply_player_edit(body: &mut Body) -> bool {
    #[cfg(any(debug_assertions, feature = "debug-map"))]
    {
        let cell = unsafe { core::ptr::read_volatile(&map::RECORD.player) };
        // SAFETY: the record points at `PLAYER`, which lives for the whole program.
        // The studio writes it only between frames, never while this runs.
        let edit = unsafe { (*cell).0.get() };
        if unsafe { core::ptr::read_volatile(&raw const (*edit).set) } != 1 {
            return false;
        }
        let wanted = unsafe { core::ptr::read_volatile(edit) };
        unsafe { core::ptr::write_volatile(&raw mut (*edit).set, 0) };
        (body.x, body.y, body.vx, body.vy) = (wanted.x, wanted.y, wanted.vx, wanted.vy);
        true
    }
    #[cfg(not(any(debug_assertions, feature = "debug-map")))]
    {
        let _ = body;
        false
    }
}

/// A place to start the game: a room and a point in it, in room pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartPoint {
    pub room: u32,
    pub x: i32,
    pub y: i32,
}

/// The start the studio asked for, if any. Only builds with the debug map can have
/// one: a release build has no record, so this is always `None` there. The caller
/// checks that the room exists in its data.
#[inline]
pub fn start_override() -> Option<StartPoint> {
    #[cfg(any(debug_assertions, feature = "debug-map"))]
    {
        // Volatile, so the compiler does not fold the zeros the ROM is built with:
        // the studio changes them afterwards.
        let o = unsafe { core::ptr::read_volatile(&map::RECORD.start) };
        if o.set == 1 { Some(StartPoint { room: o.room, x: o.x, y: o.y }) } else { None }
    }
    #[cfg(not(any(debug_assertions, feature = "debug-map")))]
    None
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
    use super::{EntityTable, GameState, Inbox, PlayerEdit, StartOverride, VERSION};
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

    /// Where the table of live entities is. Only [`super::show_entities`] writes it.
    #[repr(transparent)]
    pub(super) struct TableCell(pub(super) UnsafeCell<EntityTable>);
    // SAFETY: as for `Block`: one core, written once from the main loop.
    unsafe impl Sync for TableCell {}

    pub(super) static ENTITIES: TableCell = TableCell(UnsafeCell::new(EntityTable { address: 0, slots: 0, slot_size: 0 }));

    /// The player edit the studio writes. Only [`super::apply_player_edit`] writes it
    /// in the game.
    #[repr(transparent)]
    pub(super) struct PlayerCell(pub(super) UnsafeCell<PlayerEdit>);
    // SAFETY: as for `InboxCell`: one core, written by the game only from its main
    // loop, and by the studio only between frames.
    unsafe impl Sync for PlayerCell {}

    pub(super) static PLAYER: PlayerCell = PlayerCell(UnsafeCell::new(PlayerEdit { set: 0, x: 0, y: 0, vx: 0, vy: 0 }));

    /// The ROM record: magic, version, then the address and size of the block and of
    /// the inbox, then the start override, then the address and size of the entity
    /// table's cell and of the player edit. 60 bytes on the console.
    #[repr(C)]
    pub(super) struct Record {
        pub(super) magic: [u8; 8],
        pub(super) version: u32,
        pub(super) block: *const Block,
        pub(super) size: u32,
        pub(super) inbox: *const InboxCell,
        pub(super) inbox_size: u32,
        pub(super) start: StartOverride,
        pub(super) entities: *const TableCell,
        pub(super) entities_size: u32,
        pub(super) player: *const PlayerCell,
        pub(super) player_size: u32,
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
        start: StartOverride { set: 0, room: 0, x: 0, y: 0 },
        entities: &ENTITIES,
        entities_size: size_of::<EntityTable>() as u32,
        player: &PLAYER,
        player_size: size_of::<PlayerEdit>() as u32,
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
    use crate::behaviour::Actor;
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
        let start = [
            field("set", offset_of!(StartOverride, set), "u32"),
            field("room", offset_of!(StartOverride, room), "u32"),
            field("x", offset_of!(StartOverride, x), "i32"),
            field("y", offset_of!(StartOverride, y), "i32"),
        ];
        let table = [
            field("address", offset_of!(EntityTable, address), "address"),
            field("slots", offset_of!(EntityTable, slots), "u32"),
            field("slotSize", offset_of!(EntityTable, slot_size), "u32"),
        ];
        let actor = offset_of!(LiveEntity, actor);
        let hitbox = actor + offset_of!(Actor, hitbox);
        let slot = [
            field("x", actor + offset_of!(Actor, x), "i32"),
            field("y", actor + offset_of!(Actor, y), "i32"),
            field("vx", actor + offset_of!(Actor, vx), "i32"),
            field("vy", actor + offset_of!(Actor, vy), "i32"),
            field("homeX", actor + offset_of!(Actor, home.0), "i32"),
            field("homeY", actor + offset_of!(Actor, home.1), "i32"),
            field("facesLeft", actor + offset_of!(Actor, faces_left), "bool"),
            field("alive", actor + offset_of!(Actor, alive), "bool"),
            field("hitboxX", hitbox + offset_of!(crate::behaviour::Hitbox, x), "i16"),
            field("hitboxY", hitbox + offset_of!(crate::behaviour::Hitbox, y), "i16"),
            field("hitboxW", hitbox + offset_of!(crate::behaviour::Hitbox, w), "u16"),
            field("hitboxH", hitbox + offset_of!(crate::behaviour::Hitbox, h), "u16"),
            field("kind", offset_of!(LiveEntity, kind), "u16"),
            field("room", offset_of!(LiveEntity, room), "u16"),
            field("index", offset_of!(LiveEntity, index), "u16"),
            field("built", LiveEntity::BUILT_AT, "bool"),
        ];
        let player = [
            field("set", offset_of!(PlayerEdit, set), "u32"),
            field("x", offset_of!(PlayerEdit, x), "i32"),
            field("y", offset_of!(PlayerEdit, y), "i32"),
            field("vx", offset_of!(PlayerEdit, vx), "i32"),
            field("vy", offset_of!(PlayerEdit, vy), "i32"),
        ];
        format!(
            "{{\n  \"version\": {VERSION},\n  \"stamp\": \"PSGS\",\n  \"size\": {},\n  \"fields\": [\n{}\n  ],\n  \"bodySize\": {},\n  \"body\": [\n{}\n  ],\n  \"inboxSize\": {},\n  \"inbox\": [\n{}\n  ],\n  \"startSize\": {},\n  \"start\": [\n{}\n  ],\n  \"tableSize\": {},\n  \"table\": [\n{}\n  ],\n  \"slotSize\": {},\n  \"slot\": [\n{}\n  ],\n  \"playerEditSize\": {},\n  \"playerEdit\": [\n{}\n  ]\n}}\n",
            size_of::<GameState>(),
            state.join(",\n"),
            size_of::<Body>(),
            body.join(",\n"),
            size_of::<Inbox>(),
            inbox.join(",\n"),
            size_of::<StartOverride>(),
            start.join(",\n"),
            size_of::<EntityTable>(),
            table.join(",\n"),
            size_of::<LiveEntity>(),
            slot.join(",\n"),
            size_of::<PlayerEdit>(),
            player.join(",\n"),
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
        assert!(core::ptr::eq(map::RECORD.entities, &map::ENTITIES));
        assert_eq!(map::RECORD.entities_size, 12);
        // The studio reads the cell's address at byte 44 of the record, after the
        // start override, so versions 1 to 3 keep their offsets.
        #[cfg(target_pointer_width = "32")]
        assert_eq!(core::mem::offset_of!(map::Record, entities), 44);
        assert!(core::ptr::eq(map::RECORD.player, &map::PLAYER));
        assert_eq!(map::RECORD.player_size, 20);
        #[cfg(target_pointer_width = "32")]
        assert_eq!(core::mem::offset_of!(map::Record, player), 52);
    }

    #[test]
    fn a_player_edit_is_taken_once() {
        let mut body = Body::new(10, 20, 8, 14);
        body.vx = 300;
        let before = body;
        assert!(!apply_player_edit(&mut body), "no request yet");
        assert_eq!(body, before);
        // The studio, between frames.
        // SAFETY: only this test touches the player edit.
        unsafe { map::PLAYER.0.get().write(PlayerEdit { set: 1, x: 500, y: 40, vx: 0, vy: -256 }) };
        assert!(apply_player_edit(&mut body));
        assert_eq!((body.x, body.y, body.vx, body.vy), (500, 40, 0, -256));
        assert_eq!((body.w, body.h), (8, 14), "the size is the game's");
        assert_eq!(unsafe { map::PLAYER.0.get().read() }.set, 0, "taken");
        body.x = 501;
        assert!(!apply_player_edit(&mut body), "taken once");
        assert_eq!(body.x, 501);
    }

    #[test]
    fn show_entities_says_where_the_table_is() {
        let table = crate::behaviour::live::LiveEntities::<32>::new();
        show_entities(&table);
        // SAFETY: only this test writes the cell, and reads it after the write.
        let cell = unsafe { core::ptr::read_volatile(map::ENTITIES.0.get()) };
        assert_eq!(cell, EntityTable::of(&table));
        assert_eq!(cell.address, table.slots_address() as usize as u32);
        assert_eq!((cell.slots, cell.slot_size as usize), (32, size_of::<LiveEntity>()));
    }

    #[test]
    fn the_record_has_no_start_until_the_studio_sets_one() {
        assert_eq!(start_override(), None);
        assert_eq!(size_of::<StartOverride>(), 16);
        // The studio reads the override at byte 28 of the record, which holds on the
        // console, where addresses are 32 bits.
        #[cfg(target_pointer_width = "32")]
        assert_eq!(core::mem::offset_of!(map::Record, start), 28);
        // The studio writes the four words; the game reads them back.
        let word = |v: i32| v.to_le_bytes();
        let mut bytes = [0u8; 16];
        for (i, v) in [1, 2, 24, 40].into_iter().enumerate() {
            bytes[i * 4..i * 4 + 4].copy_from_slice(&word(v));
        }
        // SAFETY: only this test writes the record, on a copy it reads back from.
        let o: StartOverride = unsafe { core::mem::transmute(bytes) };
        assert_eq!(o, StartOverride { set: 1, room: 2, x: 24, y: 40 });
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
