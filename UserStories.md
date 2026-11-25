# User stories

The backlog for Pecten-Studio, written spec first: every piece of work starts as a
story here, with acceptance criteria that say when it is done, before any code is
written. The goal is a studio that is to the GBA what Godot or Unity is to the PC:
one place where a game's content, objects, behaviour, play and debugging come
together, with the console's limits shown rather than discovered.

## How to use this file

1. **Specify.** A new piece of work gets a story in the right epic, with an ID, a
   priority, the user it serves, and acceptance criteria. Open questions go under
   the story, not in code.
2. **Plan.** When a story is picked up, its status becomes `Planned` and a short
   design note is added in `design/US-NNN.md`: data format changes, crates and
   packages touched, tests to write.
3. **Build.** Status `In progress`. Each acceptance criterion becomes at least one
   test where it can be tested (`pnpm test`, `cargo test`, or a headless run on the
   Pecten core).
4. **Verify.** Status `Done` only when every criterion passes, the docs in `docs/`
   say how to use it, and `README.md` and `docs/reference/limits.md` no longer list
   it as missing.

A story is small enough to finish in one branch. If it is not, split it and give
the parts their own IDs (`US-031a`, `US-031b`).

### Priorities

| Priority | Meaning |
| --- | --- |
| **P0** | Needed for the studio to feel like an engine rather than a toolchain. Do these first. |
| **P1** | Expected of any engine; a real game will miss it quickly. |
| **P2** | Makes the studio pleasant and broad. |
| **P3** | Nice to have, or waiting on something else. |

### Status

`Proposed` → `Planned` → `In progress` → `Done`. Also `Blocked` (say on what) and
`Dropped` (say why).

### Size

`S` a day or two, `M` up to a week, `L` more than a week (consider splitting).

### Users

- **Author:** makes a game in the studio: art, levels, music, entity setup.
- **Programmer:** writes the game's Rust on agb and the runtime.
- **Player:** plays the ROM, on hardware, in an emulator, or in a browser.
- **Contributor:** works on the studio itself.
- **Agent:** a coding agent driving the CLI or MCP server for an author.

### Story template

```md
#### US-000 · Title
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** core, app, codegen, runtime, server, sample, docs

As a <user>, I want <capability>, so that <benefit>.

Acceptance criteria
- [ ] Given <state>, when <action>, then <result>.

Notes / open questions
```

## Summary

| ID | Title | Epic | Priority | Status | Size |
| --- | --- | --- | --- | --- | --- |
| US-001 | Fixed-layout data section in the ROM | E1 | P0 | Done | L |
| US-002 | Patch level data into a built ROM without compiling | E1 | P0 | Done | M |
| US-003 | Live-apply edits to the running game | E1 | P0 | Done | L |
| US-004 | Say when a change needs a full build | E1 | P0 | Done | S |
| US-005 | Play from the room and spot under the cursor | E1 | P1 | Done | M |
| US-006 | Data reserve and section use in Project settings | E1 | P2 | Done | S |
| US-007 | Redraw only the changed tiles on live apply | E1 | P2 | Proposed | S |
| US-008 | Patch test for data that no longer fits trips the entity limit first | E1 | P1 | Done | S |
| US-010 | Behaviour library in the runtime | E2 | P0 | Done | L |
| US-010a | Behaviour shape, patrol, collectible and hazard, used by the sample | E2 | P0 | Done | M |
| US-010b | Projectile, shooter, platform, door, checkpoint, ability pickup, spawner | E2 | P0 | Done | M |
| US-011 | Behaviours declare their properties to codegen | E2 | P0 | Done | M |
| US-011a | Behaviour declarations, the `behaviours` field and its problems | E2 | P0 | Done | M |
| US-011b | Behaviour properties read by position | E2 | P0 | Done | M |
| US-012 | Attach behaviours to entity types in the studio | E2 | P0 | Done | M |
| US-013 | Generated entity dispatch, no hand-written match | E2 | P0 | Done | M |
| US-014 | Prefabs with per-instance overrides | E2 | P1 | Done | M |
| US-015 | Edit collision classes in the interface | E2 | P1 | Done | S |
| US-016 | Edit entity property definitions in the interface | E2 | P1 | Done | S |
| US-017 | Entity references between entities | E2 | P1 | Proposed | M |
| US-018 | Custom behaviours written in the game | E2 | P1 | Proposed | M |
| US-131 | Codegen checks the values of an entity type's own properties | E2 | P2 | Proposed | S |
| US-019 | An Entities page for entity types, their properties and behaviours | E2 | P1 | Proposed | M |
| US-020 | Symbol map of game state | E3 | P0 | Done | M |
| US-021 | Live entity inspector in the Play panel | E3 | P0 | Done | L |
| US-021a | Live entity list and selecting on the game screen | E3 | P0 | Done | M |
| US-021b | Edit a live entity's numbers while the game runs | E3 | P0 | Done | M |
| US-022 | Debug overlays on the game screen | E3 | P0 | Done | M |
| US-023 | Pause, step a frame, rewind | E3 | P1 | Proposed | M |
| US-024 | VRAM, palette and OAM viewers | E3 | P1 | Proposed | M |
| US-025 | Game log in the studio | E3 | P1 | Proposed | S |
| US-026 | Frame time and CPU readout | E3 | P2 | Proposed | M |
| US-030 | Palette and tile budgets while painting | E4 | P0 | Done | M |
| US-031 | Sprite and OAM budget per room | E4 | P1 | Proposed | M |
| US-032 | ROM size breakdown | E4 | P1 | Proposed | S |
| US-033 | Build messages shown on the item they are about | E4 | P1 | Proposed | M |
| US-034 | Audio size estimate | E4 | P2 | Proposed | S |
| US-040 | Rectangular selection, copy, paste, flip | E5 | P1 | Proposed | M |
| US-041 | Autotile brushes | E5 | P1 | Proposed | L |
| US-042 | Room templates | E5 | P2 | Proposed | S |
| US-043 | Moving backgrounds in the map editor | E5 | P2 | Proposed | S |
| US-044 | Undo for deleting rooms, tilesets and sprites | E5 | P1 | Proposed | S |
| US-045 | Pinch zoom and finger painting | E5 | P3 | Proposed | M |
| US-046 | Darken layers and backgrounds for contrast | E5 | P1 | Done | M |
| US-047 | Theme colours on Typography that this MUI ignores | E5 | P2 | Proposed | S |
| US-050 | Font import and text drawing | E6 | P1 | Proposed | M |
| US-051 | Dialogue boxes and a dialogue file format | E6 | P1 | Proposed | L |
| US-052 | HUD layout editor | E6 | P2 | Proposed | L |
| US-053 | Menus | E6 | P2 | Proposed | M |
| US-060 | Save data for collected and opened things | E7 | P1 | Proposed | M |
| US-061 | Game states: title, play, pause, game over | E7 | P1 | Proposed | M |
| US-062 | Doors and ability gates | E7 | P1 | Proposed | M |
| US-063 | Camera helpers: bounds, transitions, shake | E7 | P1 | Proposed | M |
| US-064 | Entity activation near the camera | E7 | P1 | Proposed | S |
| US-070 | Hear MIDI, XM and MOD in the studio | E8 | P1 | Proposed | L |
| US-071 | Aseprite preview and conversion, tags as animations | E8 | P1 | Proposed | M |
| US-072 | Import Tiled maps | E8 | P2 | Proposed | M |
| US-073 | Import Diamond Hands ASCII levels | E8 | P1 | Proposed | M |
| US-080 | Project templates by genre | E9 | P1 | Proposed | L |
| US-081 | Affine and Mode 7 backgrounds | E9 | P2 | Proposed | L |
| US-082 | 8 bits per pixel tilesets | E9 | P3 | Proposed | M |
| US-090 | Reachability check on the runtime physics | E10 | P1 | Proposed | L |
| US-091 | Headless game tests from the project | E10 | P1 | Proposed | M |
| US-092 | Agent-visible selection in the map | E10 | P2 | Proposed | S |
| US-093 | Tune tool descriptions on a real game | E10 | P2 | Proposed | M |
| US-100 | Publish runtime and build helper as crates | E11 | P1 | Proposed | M |
| US-101 | `npx pecten-studio` | E11 | P1 | Proposed | S |
| US-102 | Desktop app on macOS and Windows | E11 | P1 | Proposed | M |
| US-103 | Export: flashcart ROM, web player, itch.io | E11 | P1 | Proposed | M |
| US-104 | Plugin API for panels and build steps | E11 | P2 | Proposed | L |
| US-105 | Tutorials from an empty folder to a game | E11 | P1 | Proposed | M |
| US-106 | Test on more browsers, touch and large projects | E11 | P2 | Proposed | M |
| US-107 | Fix the README's "left out on purpose" list | E11 | P0 | Done | S |
| US-108 | Scripted documentation screenshots | E11 | P1 | Done | S |
| US-109 | The sample's world map names a room it does not have | E11 | P2 | Proposed | S |
| US-110 | Game flags and variables | E12 | P1 | Proposed | M |
| US-111 | Trigger zones | E12 | P1 | Proposed | S |
| US-112 | Rule format: event, conditions, actions | E12 | P1 | Proposed | M |
| US-113 | Rules compiled to tables and run by the runtime | E12 | P1 | Proposed | L |
| US-114 | Built-in events, conditions and actions | E12 | P1 | Proposed | L |
| US-115 | Rule editor in the studio | E12 | P1 | Proposed | L |
| US-116 | Rules checked as problems | E12 | P1 | Proposed | M |
| US-117 | Flags and fired rules in the live inspector | E12 | P2 | Proposed | M |
| US-118 | Custom events, conditions and actions from Rust | E12 | P2 | Proposed | M |
| US-119 | Rule tools for agents | E12 | P2 | Proposed | S |
| US-120 | Template games built with rules only | E12 | P1 | Proposed | M |
| US-121 | Generator tools for agents | E10 | P1 | Done | M |
| US-122 | A visible focus ring on every control | E13 | P1 | Proposed | S |
| US-123 | Zoom the desktop app's interface | E13 | P1 | Proposed | S |
| US-124 | Project tabs that do not fit stay reachable | E13 | P1 | Proposed | S |
| US-125 | Ctrl+W closes the document, not the project | E13 | P1 | Done | S |
| US-126 | Act on build and save status from the desktop tab bar | E13 | P1 | Proposed | S |
| US-127 | Project tabs by keyboard, and F6 between tab bar and page | E13 | P2 | Proposed | S |
| US-128 | Status shown by shape as well as colour, and read aloud | E13 | P2 | Proposed | S |
| US-129 | A failed agent action stays until it is dismissed | E13 | P2 | Proposed | S |
| US-130 | Interface colours that pass contrast, from theme tokens | E13 | P2 | Proposed | M |

---

## E1 · Fast iteration

Godot and Unity feel immediate because a change shows up in the running game in a
moment. Here every change goes through a nightly `cargo build`. Most edits are to
data, not code, and the studio owns the emulator, so data edits should not need a
compile at all.

#### US-001 · Fixed-layout data section in the ROM
**Priority** P0 · **Status** Done · **Size** L · **Depends on** —
**Touches** codegen, runtime

As a programmer, I want level, entity and physics data to live in a ROM section
with a known, versioned layout instead of being baked into Rust constants, so that
tools can find and replace it without recompiling.

Acceptance criteria
- [x] Given a project, when it is built, then rooms, collision cells, entities,
  entity properties, world placement and physics settings are in one section that
  starts with a magic number, a format version and a table of offsets.
- [x] Given that section, when the runtime starts, then it reads everything from it
  and the sample plays exactly as before.
- [x] The section has room to grow (a configurable reserve) so a patched project
  that is a little larger still fits.
- [x] Reading data costs no more frames than today on the sample (measured).
- [x] The layout is documented in `docs/reference/`.

Notes / open questions
- Graphics (tiles, palettes) may stay compiled at first; decide in the design note
  whether tile data joins the section in this story or in US-002. Decided: tile
  layers are in the section; tile and picture pixels, palettes, sprites and audio
  stay compiled (see `design/US-001.md`).

#### US-002 · Patch level data into a built ROM without compiling
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-001
**Touches** codegen (as wasm or TS port), server, app

As an author, I want the Play panel to pick up a room edit in about a second,
so that trying a jump or a layout does not mean waiting for a build.

Acceptance criteria
- [x] Given a built ROM, when I change tiles, collision, entities, entity
  properties, world placement or physics, then the studio rewrites the data
  section and restarts the game in under 2 seconds on the sample.
- [x] The patched ROM is byte-for-byte what a full build would produce for the same
  data section.
- [x] If the new data does not fit the reserve, the studio says so and offers a
  full build.
- [x] The patch step is available from the CLI (`pecten-studio patch <folder>`) and
  MCP (`patch_rom`).

#### US-003 · Live-apply edits to the running game
**Priority** P0 · **Status** Done · **Size** L · **Depends on** US-002, US-020
**Touches** runtime, app (Play panel), Pecten core

As an author, I want an edit to appear in the game that is already running, with
the player where they are, so that I can tune a room while standing in it.

Acceptance criteria
- [x] Given the game running in the Play panel, when I paint tiles in the current
  room, then they appear on screen within a few frames and the player keeps their
  position and state.
- [x] Physics settings changes take effect on the next frame.
- [x] Entity edits respawn only the entities that changed.
- [x] A toggle turns live apply off; restart-on-change still works without it.

Notes / open questions
- Needs a small runtime hook the studio can signal through emulator memory (a
  "data changed" flag and the dirty ranges).

#### US-004 · Say when a change needs a full build
**Priority** P0 · **Status** Done · **Size** S · **Depends on** US-002
**Touches** app, server

As an author, I want the studio to tell me which changes it can patch and which
need a build, so that I am never playing a stale ROM without knowing it.

Acceptance criteria
- [x] The top bar shows one of: up to date, patched, needs build (with the reason,
  for example "Rust source changed" or "new sprite").
- [x] Changing a `.rs` file or a sprite sheet sets "needs build".

#### US-005 · Play from the room and spot under the cursor
**Priority** P1 · **Status** Done · **Size** M · **Depends on** US-002
**Touches** runtime, app

As an author, I want to start the game in the room I am editing, at the tile I
right-click, so that I do not walk from the start to test a late room.

Acceptance criteria
- [x] The map editor has "Play from here"; the game starts with the player at that
  point.
- [x] The start override is a debug-only setting that release builds ignore.

#### US-006 · Data reserve and section use in Project settings
**Priority** P2 · **Status** Done · **Size** S · **Depends on** US-001
**Touches** app, server

As an author, I want to see how much of the ROM's level data space my project uses
and set the reserve in Project settings, so that I know when an edit will need a
full build without editing JSON.

Acceptance criteria
- [x] Project settings has a field for `build.dataReserve`, empty for the default.
- [x] After a build, the Build panel shows the section's bytes used and capacity.

#### US-007 · Redraw only the changed tiles on live apply
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** US-003
**Touches** runtime, core

As an author, I want painting tiles while the game runs not to make it stutter, so
that tuning a room feels smooth.

Today a live tile change re-checks the whole section and redraws every tile in
view, which costs the sample about two frames (measured in
`server/test/liveapply.test.ts`).

Acceptance criteria
- [ ] The studio passes the changed cells (room and rectangle) through the inbox,
  and the game redraws only those.
- [ ] A one-tile change costs the sample no dropped frame.

#### US-008 · Patch test for data that no longer fits trips the entity limit first
**Priority** P1 · **Status** Done · **Size** S · **Depends on** —
**Touches** server

As a contributor, I want `pnpm test` to pass on a freshly built sample, so that a
failure means something.

`server/test/patch.test.ts` ("says when the data no longer fits") adds 400 coins
to make the level data too big. Since US-013 a dev ROM records its entity table's
size (32 slots for the sample), so the patch now stops at "the game has room for 32
entities" before it reaches the data size. The test passed only while
`sample/dist/` held a ROM built before US-013. Found in US-021a: it fails the same
way on a ROM built from the commit before it.

Acceptance criteria
- [x] The test makes the data too big without passing the entity table's size (a
  long text property or room name, say), and checks the "level data is now ...
  bytes" reason. (An 8,000-character room name; the sample's section has about 4 KB
  spare.)
- [x] A separate case checks the entity-table reason for too many entities. ("says
  when there are more entities than the game's table holds", with 400 coins.)

---

## E2 · Objects and behaviour

Godot has nodes with scripts, Unity has game objects with components. Here entities
are typed property bags and the game matches on `EntityKind` by hand. Behaviour
stays Rust, as the studio intends, but common behaviour should come ready-made and
be attached in the studio.

#### US-010 · Behaviour library in the runtime
**Priority** P0 · **Status** Done · **Size** L · **Depends on** —
**Touches** runtime, sample

As a programmer, I want the common Metroidvania behaviours in the runtime, so that
a game only writes what is special about it.

Acceptance criteria
- [x] The runtime has, each with host unit tests: patrol, collectible, hazard,
  projectile and shooter, moving platform, door, checkpoint, pickup that grants an
  ability, and spawner.
- [x] Each behaviour is a plain struct with an update function taking the entity,
  the world and a small context (player body, clock, input).
- [x] The sample's sentry bot and collectibles use the library and `main.rs` gets
  shorter.

Split into US-010a and US-010b, one branch each; this story is `Done` when both are.
The criteria above are shared out between them unchanged. Design:
`design/US-010.md`.

#### US-010a · Behaviour shape, patrol, collectible and hazard, used by the sample
**Priority** P0 · **Status** Done · **Size** M · **Depends on** —
**Touches** runtime, sample

As a programmer, I want the shape every behaviour shares and the three the sample
needs, so that the sample's sentry bot and coins come from the library.

Acceptance criteria
- [x] The runtime has patrol, collectible and hazard, each with host unit tests.
- [x] Each is a plain struct with an update function taking the entity (`Actor`),
  the world and a small context (player body, clock, input), through one
  `Behaviour` trait.
- [x] The sample's sentry bot and collectibles use the library and `main.rs` gets
  shorter. (374 to 364 lines; headless pictures identical before and after.)

#### US-010b · Projectile, shooter, platform, door, checkpoint, ability pickup, spawner
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-010a
**Touches** runtime

As a programmer, I want the rest of the common Metroidvania behaviours in the
runtime, so that a game only writes what is special about it.

Acceptance criteria
- [x] The runtime has, each with host unit tests: projectile and shooter, moving
  platform, door, checkpoint, pickup that grants an ability, and spawner, plus a
  fixed-size pool for what is made while the game runs.
- [x] Each implements the `Behaviour` trait from US-010a, and none allocates.

#### US-011 · Behaviours declare their properties to codegen
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-010
**Touches** runtime, codegen, core (schema)

As a programmer, I want each behaviour to declare the properties it reads, with
types, defaults and ranges, so that the studio can build an editor for them and
the build can check them.

Acceptance criteria
- [x] Declarations are written once (for example a `behaviour!` macro or a
  `behaviours.json` the crate ships) and exported as JSON Schema the studio reads.
- [x] A missing or wrong-typed property is a problem in the Problems panel, not a
  runtime surprise.
- [x] No property is looked up by name in the frame loop: behaviours read their
  properties by a position fixed per entity type. (The frame-time part, "no slower
  than before US-010a", moved to US-013 by the author's decision: reading settings
  from ROM every frame costs 301 against 296, and only keeping them between frames,
  as US-013's live table does, gets under it. See `design/US-011.md`.)

Split into US-011a and US-011b, one branch each; this story is `Done` when both are.
The criteria above are shared out between them unchanged. Design:
`design/US-011.md`.

#### US-011a · Behaviour declarations, the `behaviours` field and its problems
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-010
**Touches** runtime, codegen, core (schema), server

As a programmer, I want each behaviour to declare its properties once and entity
types to list their behaviours, so that the studio and the build check behaviour
settings.

Acceptance criteria
- [x] Declarations are written once, in the runtime next to each behaviour, and
  exported as JSON Schema the studio reads (`core/src/behaviourschema.ts`, checked up
  to date by a test).
- [x] An entity type lists its behaviours and their values in `project.json`; placed
  entities can override them; old projects load unchanged.
- [x] A missing, undeclared, wrong-typed or out-of-range behaviour property, an
  unknown or repeated behaviour, or a name clash with the type's own properties is
  a problem in the Problems panel and in the build, with the same words.

#### US-011b · Behaviour properties read by position
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-011a
**Touches** runtime, codegen, core (data section), sample

As a programmer, I want behaviours to read their properties by a position fixed
per entity type, so that they cost nothing to look up in the frame loop.

Acceptance criteria
- [x] The data section says which behaviours each entity type has and where their
  properties start; both writers give the same bytes (shared fixture).
- [x] `from_entity` reads no property by name, and gives a behaviour only to
  entities whose type lists it.
- [x] The sample's types list their behaviours and its loop no longer checks types
  for them. (Its average frame is 301 hundred cycles, from 312 after US-010a; the
  target of 296 moved to US-013, by the author's decision.)

#### US-012 · Attach behaviours to entity types in the studio
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-011
**Touches** app, core, server (MCP tools)

As an author, I want to give an entity type one or more behaviours and fill in
their properties in Properties, so that I can make a new enemy without opening
Rust.

Acceptance criteria
- [x] Project settings lists behaviours to add to an entity type; each shows a form
  generated from its declaration.
- [x] Placed entities show the behaviour properties and can override them.
- [x] MCP has `entity_type_add_behaviour` and `entity_type_remove_behaviour`.
- [x] A new patrolling enemy can be made from a PNG with no Rust change, and plays.

#### US-013 · Generated entity dispatch, no hand-written match
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-012
**Touches** codegen, runtime, sample

As a programmer, I want codegen to write the loop that updates every live entity
with its behaviours, so that adding a type never means editing a `match`.

Acceptance criteria
- [x] `include_data!()` gives an `update_entities` (or similar) that calls each
  entity's behaviours.
- [x] A game can still handle a kind itself before or instead of the generated code.
- [x] Behaviour settings are read from the ROM once and kept with each live entity,
  not every frame, and the sample's average frame is no slower than before US-010a
  (296 hundred cycles; moved here from US-011, see `design/US-011.md`). (287 on the
  US-010 run, from 302 for US-011b; headless pictures identical.)

Entities are built when their room is first entered or touches the one entered, and
kept, so a room left is as it was on coming back. A type has at most 4 behaviours.
Design: `design/US-013.md`.

#### US-014 · Prefabs with per-instance overrides
**Priority** P1 · **Status** Done · **Size** M · **Depends on** US-012
**Touches** core, app, server, docs

As an author, I want entity types to act as prefabs whose placed copies only store
what they change, so that changing the type's default updates every copy that
kept it.

Acceptance criteria
- [x] Room files store only overridden properties. (`core/src/prefab.ts`:
  `core/test/prefab.test.ts` for the rule on own and behaviour properties;
  `server/test/behaviours.test.ts`: `entity_add` and `entity_update` leave out a value
  equal to the type's and say so; the panel writes through the same `entityOverride`.
  Behaviour properties already did, since US-012.)
- [x] Properties marks overridden values and has "reset to type default". (Own
  properties of the type are marked and have a reset button like behaviour properties:
  `shownEntityValue` and reset in `core/test/prefab.test.ts`; the `entity-overrides-own`
  screenshot.)

Changing the type's default updates every copy that kept it: shown by
`core/test/prefab.test.ts`, which writes the data section for two entities of a type,
one storing a value and one not, raises the default, and reads the values back; and
which checks that a stored value equal to the type's builds to the same bytes as none.

Decided (the open question, settled when the story was built; see `design/US-014.md`)
- No Problems line for a stored value equal to the type's. Old rooms are left as they
  are, and cleaned when an entity's values are next written by the panel or a tool.

#### US-015 · Edit collision classes in the interface
**Priority** P1 · **Status** Done · **Size** S · **Depends on** —
**Touches** app, core, docs

As an author, I want to add, rename, recolour and set the kind of collision
classes in Project settings, so that I do not edit `project.json` by hand.

Acceptance criteria
- [x] Every field in the collision class schema can be edited, with undo. (Project
  settings → Collision classes: colour, name, id, kind and slope heights.
  `core/test/collision.test.ts`: `classIdProblem`, `withKind` (a slope gets heights, any
  other kind drops them, and every result parses with `CollisionClass`), `renameClass`
  (the tilesets that name the id change with it; the data section's cells are the same);
  `app/test/store-group.test.ts`: a field edit is one project undo step, and an id change
  is one step with the tilesets, undone and redone together; the `collision-classes`
  screenshot.)
- [x] Deleting a class in use asks first and says which tilesets and rooms use it.
  (`core/test/collision.test.ts`: `classUsage` lists tilesets with their tiles and rooms
  with their cells, painted or from a tile; `withoutClass` repoints tiles and painted
  cells, and a data section written before and after gives every other cell the same
  class; `app/test/store-group.test.ts` and `app/test/groupundo.test.ts`: the deletion is
  one undo step across the project, tileset and room, refused with its reason if one
  changed since; the `collision-delete` screenshot shows the question.)

Decided (the open questions, settled when the story was built; see `design/US-015.md`)
- A used class is deleted after the question: its tiles have the first class, cells
  painted with it follow their tile, and cells painted with later classes are renumbered.
  The first class cannot be deleted.
- The id is editable, and carried to the tilesets that name it, with a warning that game
  code naming the old constant must change.
- Undo across documents is grouped under the project, and refused with its reason when a
  document it changed has been changed since.
- Classes cannot be moved: a room paints collision by a class's place in the list.

#### US-016 · Edit entity property definitions in the interface
**Priority** P1 · **Status** Done · **Size** S · **Depends on** —
**Touches** app, core, codegen (model), server, docs

As an author, I want to add and change an entity type's properties (name, type,
default, range) in Project settings, so that the whole entity setup is in the
studio.

Acceptance criteria
- [x] Every property type in the schema can be defined from the interface. (Project
  settings → a type's Properties table: integer with optional min and max, boolean,
  text, one of a list; `core/test/properties.test.ts`: `withPropertyType` gives a valid
  definition from each kind to each other kind, options and limits parse and keep the
  default valid, `PropertyDef` takes `min` and `max` only on an int, in order, around
  the default; name checks; the `entity-properties` screenshot.)
- [x] Changing a property's type reports the placed entities whose values no longer
  fit. (`core/test/properties.test.ts`: `propertyMisfits`, `newMisfits` and
  `editProperty` list room, entity, value and reason for a change of kind, a removed
  option and a narrowed range, and nothing for what still fits or was already wrong;
  `validate` reports a stored value that does not fit as an error in the room's file;
  `app/test/store-group.test.ts`: the change and the dropped values are one undo step
  across the project and the rooms, refused with its reason if a room changed since;
  `server/test/behaviours.test.ts`: `entity_type_set` lists them; the
  `entity-property-misfit` screenshot shows the question.)

Decided (the open questions, settled when the story was built; see `design/US-016.md`)
- The range is int `min` and `max` on `PropertyDef` (additive; `FORMAT_VERSION` stays 1).
- A change that breaks stored values asks, lists them, and drops them on confirm, in one
  undo step with the project; Problems reports any that remain.
- Codegen does not check own properties' values yet: US-131.

#### US-017 · Entity references between entities
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-016
**Touches** core, app, codegen

As an author, I want a property that points at another placed entity (a switch to
its door, a door to its destination), picked by clicking it on the map, so that
connections are not typed by hand.

Acceptance criteria
- [ ] A `ref` property type, optionally limited to some entity types.
- [ ] The map draws a line from an entity to what it refers to.
- [ ] A reference to a deleted entity is a problem.

#### US-018 · Custom behaviours written in the game
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-011
**Touches** runtime, codegen, app

As a programmer, I want behaviours I write in my game crate to show up in the
studio like the built-in ones, so that my game's own objects are edited the same
way.

Acceptance criteria
- [ ] A behaviour declared in the game crate is listed in Project settings after a
  build.
- [ ] Documented with an example in `sample/`.

#### US-019 · An Entities page for entity types, their properties and behaviours
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-016
**Touches** app, docs

As an author, I want entity types on a page of their own, with one type shown at a
time, so that the things my game is made of are not hidden in a settings table
between the build commands and the collision classes.

Since US-012 and US-016, an entity type in Project settings opens in place inside a
five-column table, with its properties and every behaviour's form under it. With a
few types open the page is mostly entity forms, and it does not show the
sprite, where the type is used, or more than one type's settings side by side with
the list. Physics already has its own page that edits `studio/project.json`; this
does the same for `entityTypes`. The project format does not change.

Acceptance criteria
- [ ] Given a project, the sidebar's top items and the activity bar have
  **Entities**, after World, with the number of entity types as its detail. It opens
  a page with the list of types on the left and the selected type on the right.
- [ ] Each row in the list shows the type's colour, the first frame of its sprite
  (or the colour as a square when it has none), its name, its behaviours and number
  of properties, and how many entities of that type are placed in rooms. **Add
  entity type** is at the top of the list and selects the new type.
- [ ] The selected type shows, at the top, a large preview of its sprite at whole
  pixel scales, then its name, colour and sprite. Under them are its Properties and
  Behaviours, using the existing editors. They sit side by side when the page is
  wide enough and stack when it is not.
- [ ] The selected type lists the rooms that place it, with a count for each, and
  selecting one opens that room.
- [ ] Deleting a type that is placed in rooms asks first and names how many entities
  in how many rooms it would leave without a type; deleting an unplaced type does
  not ask.
- [ ] The selected type is part of the address (`entities/<type id>`), so reload,
  back and a link from elsewhere open the same type. An address with a type that no
  longer exists opens the page with the first type selected.
- [ ] The **Type** field of a placed entity in the room's panel, and a problem in
  Problems about an entity type, its properties or its behaviours, open the Entities
  page on that type.
- [ ] Undo and redo on the Entities page step the project as they do in Project
  settings, and the "Not undone" notice for a grouped property change shows on this
  page.
- [ ] Project settings keeps Project, Build and Collision classes, with one line
  saying entity types moved, linking to the Entities page. It no longer lists entity
  types.
- [ ] Keyboard: the list moves with the arrow keys, Enter or Space selects, and
  focus goes to the type's name field on **Add entity type**.
- [ ] `docs/guide/entities.md` takes the entity type, properties and behaviours
  sections from `docs/guide/project-settings.md`, with new screenshots. Links in
  `rooms.md`, `interface.md` and the rest of the guide go to the new page, and the
  old anchors in `project-settings.md` say where the sections went. US-018's
  criterion is changed to say the Entities page.

Notes / open questions
- Collision classes stay in Project settings: they belong to tiles, not entities.
  Should they get their own page too, or move next to Physics?
- Should entity types also be a section in the sidebar (like Rooms and Sprites),
  with each type a row, or is the list on the page enough?
- Today deleting a placed type does not ask, and what the placed entities become is
  whatever validation reports. If the delete should instead remove those entities,
  or be refused, that is a format and validation question for its own story.
- MCP tools edit `entityTypes` already and need no change; check that
  `docs/guide/agents.md` does not point at Project settings for entity types.

#### US-131 · Codegen checks the values of an entity type's own properties
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** US-016
**Touches** codegen, core, docs

As an author, I want a build to refuse an entity value that does not fit its property
(the wrong kind, an option the list does not have, a number outside its `min` and
`max`), so that a hand edit or a coding agent cannot put a value in the game that
disagrees with the property's definition.

The studio reports such values as errors in Problems since US-016 (`propertyMisfit` in
`core/src/properties.ts`), but codegen reads only a property's name and default
(`PropDef` in `codegen/src/model.rs`) and writes whatever kind of value is stored: a
number where the property is a boolean builds, and the game then reads nothing for it.
Behaviour properties are checked in both places, in the same words
(`codegen/src/behaviours.rs`, `core/src/behaviours.ts`, tested against
`codegen/fixture/bad-behaviours/expected.txt`).

Acceptance criteria
- [ ] `PropDef` reads a property's `type`, `options`, `min` and `max`, and codegen
  reports a stored value or default that does not fit, naming the entity, in the same
  words as `propertyMisfit`.
- [ ] A fixture of misfits with the expected messages is read by a Rust test and a
  vitest test, so the two cannot drift apart.
- [ ] A default past 32 bits is reported, not wrapped.

---

## E3 · Debugging the running game

Unity's inspector during play is the feature people miss most elsewhere. The studio
runs the game on its own emulator, so it can see everything.

#### US-020 · Symbol map of game state
**Priority** P0 · **Status** Done · **Size** M · **Depends on** —
**Touches** runtime, server, core

As a contributor, I want the build to write where the runtime keeps its state
(entity table, player body, camera, current room), so that the studio can read it
from emulator memory.

Acceptance criteria
- [x] Each build writes a `debug.json` next to the ROM with addresses and layouts.
  (Written as `<rom>.debug.json`, beside `<rom>.build.json`, so the dev and release
  ROMs in one folder each have their own: see `design/US-020.md`.)
- [x] Release builds can leave it out.

#### US-021 · Live entity inspector in the Play panel
**Priority** P0 · **Status** Done · **Size** L · **Depends on** US-020
**Touches** app, Pecten core

As an author, I want to see the live entities, their positions, velocities and
properties while the game runs, and change a value, so that I can find out why
something behaves wrongly.

Acceptance criteria
- [x] A panel lists live entities, updated every frame, with the player first. (US-021a)
- [x] Clicking one on the game screen selects it in the list. (US-021a)
- [x] Editing a number writes it to memory and the game uses it on the next frame. (US-021b)

Split into US-021a and US-021b, one branch each; this story is `Done` when both are.
The criteria above are shared out between them unchanged. Design:
`design/US-021.md`.

#### US-021a · Live entity list and selecting on the game screen
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-020
**Touches** runtime, codegen, core, server, app

As an author, I want to see the player and the live entities, with their positions,
speeds and properties, while the game runs, and pick one by clicking it on the game
screen, so that I can find out why something behaves wrongly.

Acceptance criteria
- [x] A panel lists live entities, updated every frame, with the player first.
  (The Entities list beside the Play screen; the sample's dev ROM run headless in
  `server/test/debugmap.test.ts`, and `server/test/inspect.test.ts`.)
- [x] Clicking one on the game screen selects it in the list. (`pickAt` in
  `core/test/inspect.test.ts`; the `play-entities` screenshot clicks a coin.)

Design: `design/US-021.md`.

#### US-021b · Edit a live entity's numbers while the game runs
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-021a
**Touches** runtime, core, app

As an author, I want to change a live entity's or the player's numbers while the
game runs, so that I can try a fix without rebuilding.

Acceptance criteria
- [x] Editing a number writes it to memory and the game uses it on the next frame.
  (`writeLive` in `server/test/inspect.test.ts`; the sample's dev ROM run headless in
  `server/test/debugmap.test.ts`: a coin moved onto the player is taken, a sentry's
  home moved 40 pixels moves it 40, `alive` cleared takes an entity out, and the
  player's x is where it was written, each on the next frame; the
  `play-entities-edit` screenshot.)

Decided (the open questions, settled when the story was built; see
`design/US-021.md`)
- The player's body is a local of the game's `main`, which the compiler may keep in
  registers, so the studio does not write it. It writes a player edit to RAM, found
  through the debug record (version 5), and the game takes it once a frame with
  `debug::apply_player_edit(&mut body)`.
- Properties as placed stay live apply's job (US-003): edit them in the room. This
  story edits an entity's position, speed, home (where a patrol walks around),
  facing and whether it is alive, and the player's position and speed.

#### US-022 · Debug overlays on the game screen
**Priority** P0 · **Status** Done · **Size** M · **Depends on** US-020
**Touches** core, app, docs

As an author, I want hitboxes, collision cells, the camera target and room borders
drawn over the game screen, so that I can see what the physics sees.

Acceptance criteria
- [x] Each overlay has its own toggle and draws at the game's scale. (Four check boxes
  in the Play panel. `core/test/overlays.test.ts`: each overlay alone gives only its
  shapes, and every shape lands at its world pixel minus the camera, at whole screens
  and between them, clipped and not wrapped; `server/test/overlays.test.ts`: on the
  sample's dev ROM the box's corner pixels are the overlay's and the pixel inside is
  the game's; the `play-overlays` screenshot.)
- [x] Overlays are drawn by the studio, not the ROM, so they cost the game nothing.
  (`server/test/overlays.test.ts`: two emulators run the dev ROM for 200 frames on the
  same buttons, one read and painted with all four overlays every frame through a
  reader that fails on any write; the pictures match frame by frame and the whole
  machine state is equal at the end. Nothing under `runtime/`, `codegen/` or
  `sample/` changed.)

Decided (the open questions, settled when the story was built; see `design/US-022.md`)
- The camera has no target. The console has scroll registers and no camera, and how a
  game aims its camera is its own code, so the Camera overlay shows only the middle of
  the view and the camera's position. A target can be its own story if projects get a
  camera setting.
- The overlays read the live view themselves: they do not need the Entities list open.

#### US-023 · Pause, step a frame, rewind
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** app, Pecten core

As an author, I want to pause, step one frame and rewind a few seconds, so that I
can study a jump or a collision frame by frame.

Acceptance criteria
- [ ] Pause and step buttons and shortcuts in the Play panel.
- [ ] Rewind at least 10 seconds using emulator save states.

#### US-024 · VRAM, palette and OAM viewers
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** app, Pecten core

As a programmer, I want to see tile memory, the 32 palettes, the four background
maps and the 128 sprites the game is using now, so that I can find graphics bugs.

Acceptance criteria
- [ ] One view per kind, updated while the game runs or paused.
- [ ] Hovering a tile or sprite shows its index, palette and which asset it came
  from where the debug map knows.

#### US-025 · Game log in the studio
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** runtime, app

As a programmer, I want `log!` lines from the game (mGBA debug output) to appear in
a Log panel, so that I can print-debug without another emulator.

Acceptance criteria
- [ ] Messages show with the frame number; the panel can filter and clear.
- [ ] The headless `run_rom` tool returns the log too.

#### US-026 · Frame time and CPU readout
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** US-020
**Touches** app, runtime

As a programmer, I want to see how much of each frame the game uses, so that I
know before hardware tells me.

Acceptance criteria
- [ ] A graph of scanlines used per frame, with dropped frames marked.

---

## E4 · Budgets while editing

On the GBA the limits are the engine settings. They should be visible while
working, not only when the build fails.

#### US-030 · Palette and tile budgets while painting
**Priority** P0 · **Status** Done · **Size** M · **Depends on** —
**Touches** core, app

As an author, I want to see palettes and tiles used against the 16 palettes and
1024 tiles, for a tileset and for each room with its backgrounds, as I paint, so
that I stay inside them.

Acceptance criteria
- [x] A readout in tileset, pixel and room editors updates within a second of a
  change.
- [x] Results match the build helper's for the same input (shared test fixtures).
- [x] Going over turns the readout red and adds a problem pointing at the item.

#### US-031 · Sprite and OAM budget per room
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** core, app

As an author, I want to see how much sprite tile memory and how many of the 128
sprites a room's entities need, so that a crowded room does not break.

Acceptance criteria
- [ ] Per-room readout, counting each sprite sheet once.

#### US-032 · ROM size breakdown
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** codegen, app

As an author, I want to see how much of the ROM goes to graphics, levels, music
and code, so that I know what to cut.

Acceptance criteria
- [ ] The Build panel shows a breakdown after each build.

#### US-033 · Build messages shown on the item they are about
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** codegen, server, app

As an author, I want a build error such as "tile 37 has 17 colours" to show up in
Problems and on that tile, so that I do not read build output to find it.

Acceptance criteria
- [ ] The build helper writes machine-readable diagnostics with the document and
  position.
- [ ] Problems lists them; clicking opens the item at the spot.

#### US-034 · Audio size estimate
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** core, app

As an author, I want each track and effect to show its size in the ROM, so that
music does not take the space by surprise.

Acceptance criteria
- [ ] The Audio list shows an estimate per item and a total.

---

## E5 · Level editing

#### US-040 · Rectangular selection, copy, paste, flip
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** app

As an author, I want to select an area of a room, copy it, paste it elsewhere or in
another room, and flip it, so that I can reuse pieces of level.

Acceptance criteria
- [ ] Select tool (`M`), `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, flip horizontally and
  vertically.
- [ ] A selection carries all tile layers, collision overrides and, optionally,
  entities.

#### US-041 · Autotile brushes
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** —
**Touches** core, app

As an author, I want to paint "ground" and have edges and corners chosen for me,
so that drawing rooms is fast.

Acceptance criteria
- [ ] A tileset can define terrain sets (47-tile blob and 16-tile simple).
- [ ] The brush updates neighbours as it paints and erases.

#### US-042 · Room templates
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** US-040
**Touches** core, app

As an author, I want to save a room or a selection as a template and start new
rooms from it.

Acceptance criteria
- [ ] Templates are files in `studio/templates/` and appear in the New room dialog.

#### US-043 · Moving backgrounds in the map editor
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** app

As an author, I want backgrounds in the map editor to scroll with parallax as I
pan, so that I see the room as the game will.

Acceptance criteria
- [ ] Panning moves each background by its parallax share.

#### US-044 · Undo for deleting rooms, tilesets and sprites
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** app, server

As an author, I want to undo deleting a document, so that a slip costs nothing.

Acceptance criteria
- [ ] Deleted documents go to a project trash and undo restores them.

#### US-045 · Pinch zoom and finger painting
**Priority** P3 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** app

As an author on a tablet, I want pinch zoom, two-finger pan and painting with a
finger or pen.

Acceptance criteria
- [ ] Tested on an iPad and an Android tablet.

#### US-046 · Darken layers and backgrounds for contrast
**Priority** P1 · **Status** Done · **Size** M · **Depends on** —
**Touches** core, app, codegen, runtime, server, docs

As an author, I want to darken a room's background pictures and tile layers, and
change the darkness while the game runs, so that what is in front (a dialogue box,
the player, a pause menu) stands out against the scene.

Acceptance criteria
- [x] Each background and tile layer of a room has a `dim` setting (off by
  default). Layers with it on are darkened; the others, and sprites, are not.
- [x] A room has a `dimLevel` from 0 (no change) to 16 (black). It is applied on
  the GBA by the hardware brightness-decrease effect, so it costs no palette
  slots, no tiles and no CPU per frame.
- [x] The runtime can set the level while the game runs (`set_dim(level)`) and
  fade it over a number of frames, so a dialogue can dim the scene when it opens
  and restore it when it closes. The level returns to the room's own on room
  change.
- [x] The map editor and the Play preview show the dimmed layers the way the game
  draws them, with the same rounding as the hardware.
- [x] The room panel has a toggle per layer and one level slider; the layer list
  says which layers are dimmed.
- [x] MCP tools can set `dim` and `dimLevel`, answer with the problems they left,
  and never write under `assets/`; the PNG itself is never changed.
- [x] A room with `dim` on a layer but level 0, or a level above 0 and no layer
  dimmed, is a problem in the author's terms ("no layer is dimmed, so the level
  does nothing").
- [x] Old projects load unchanged; `FORMAT_VERSION` is raised only if they would
  not.
- [x] Host test in `runtime` for the register values per level and layer set;
  vitest for the schema, validation and preview rounding; a fixture in
  `codegen/fixture/` shared by Rust and TypeScript for the darkened colours.
- [x] `docs/guide/rooms.md` and `docs/reference/project-format.md` describe it,
  with a screenshot from `docs/screenshots.json`.

Notes / open questions
- The GBA has one brightness level for all layers chosen as targets, not one per
  layer. Per-layer darkness *amounts* would need a second palette per layer (16
  palettes only) or the alpha blend, so this story offers on/off per layer and
  one level. Say so in the guide.
- Sprites and the layer a dialogue's text is drawn on must stay undimmed. If the
  text shares a layer with the scene (US-050, US-051), that layer cannot be
  dimmed; the story should report it as a problem once those exist.
- Brightness decrease and alpha blend share the blend registers; this story
  should leave a clear place for a later blend or fade story and not use the
  alpha blend itself.
- Alternative for authors who want a fixed look: darken the PNG in an image
  editor. The studio does not change files under `assets/`, so this stays outside.

Tasks
1. Schema: `dim` on `Background` and `TileLayer`, `dimLevel` on `Room`
   (`core/src/schema.ts`, `codegen/src/model.rs`, docs reference).
2. Validation and Problems panel entries (`core`).
3. Preview: darken in the map editor and Play preview (`core`, `app`).
4. Codegen: write the layer set and level into the room data.
5. Runtime: blend registers for the layer set, `set_dim` and a frame-stepped fade
   (`data` stays dependency-free; the register writes sit behind `agb`).
6. Room panel controls and MCP tool fields (`app`, `server`).
7. Sample: dim the scene behind a message in `sample/`.
8. Tests, docs and screenshot, then run `pnpm test`, `pnpm typecheck`,
   `cargo test` and build `sample/`.

---

#### US-047 · Theme colours on Typography that this MUI ignores
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** app

As an author, I want secondary labels and hints in the studio to be grey as
designed, so that labels and values are told apart at a glance.

Found in US-012: MUI 9.5 takes palette keys (`primary`, `textSecondary`) for
`Typography`'s `color` prop, not paths such as `text.secondary`. So every `Field`
label, and other text given `color="text.secondary"`, shows in the light text
colour. The marked label of US-012 sets its colour through `sx` and is not
affected.

Acceptance criteria
- [ ] Text meant to be secondary or primary in colour is, wherever `color=` is given
  a palette path (found by search, with a test or lint that keeps it so).
- [ ] The documentation screenshots that show changed text are retaken.

## E6 · Text and interface

#### US-050 · Font import and text drawing
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** core, codegen, runtime, app

As an author, I want to import a pixel font from a PNG and draw text with it, so
that the game can show words.

Acceptance criteria
- [ ] Fonts are a document kind with glyph size, character set and spacing.
- [ ] The runtime draws text on a background layer or with sprites.
- [ ] Accented Latin characters supported (French, Spanish).

#### US-051 · Dialogue boxes and a dialogue file format
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** US-050
**Touches** core, app, codegen, runtime

As an author, I want to write dialogue in the studio and attach it to an entity,
so that characters can talk.

Acceptance criteria
- [ ] A dialogue document with lines, speaker and simple choices.
- [ ] A runtime box that types text out, waits for A and pages.
- [ ] Text that does not fit the box is a problem.

#### US-052 · HUD layout editor
**Priority** P2 · **Status** Proposed · **Size** L · **Depends on** US-050
**Touches** app, codegen, runtime

As an author, I want to place counters, bars and icons on a 240x160 HUD, so that
the HUD is not positioned in code.

Acceptance criteria
- [ ] HUD elements bound to named game values the game sets each frame.

#### US-053 · Menus
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** US-050
**Touches** runtime

As a programmer, I want a menu helper (list, cursor, sounds), so that title and
pause menus are quick.

Acceptance criteria
- [ ] Used by the sample's title and pause screens.

---

## E7 · Game systems

#### US-060 · Save data for collected and opened things
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** runtime, sample

As a player, I want my progress kept when I turn the console off.

Acceptance criteria
- [ ] Runtime saves `Collected`, abilities, current room and position to SRAM or
  flash, with a version and checksum.
- [ ] A save from an older project version loads, or is refused cleanly.

#### US-061 · Game states: title, play, pause, game over
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** runtime, sample

As a programmer, I want a small state machine for game screens with fades between
them.

Acceptance criteria
- [ ] The sample has a title screen, pause and game over.

#### US-062 · Doors and ability gates
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-010, US-017
**Touches** runtime, sample

As an author, I want doors that lead to another room or spot, and gates that open
with an ability or a key, so that I can build the Metroidvania loop.

Acceptance criteria
- [ ] Door and gate behaviours, configured in the studio.
- [ ] Opened gates are saved (US-060).

#### US-063 · Camera helpers: bounds, transitions, shake
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** runtime

As a programmer, I want camera zones, a cut or slide between rooms that do not
touch, and shake, so that the camera is not rewritten per game.

Acceptance criteria
- [ ] Each one has a host test and is used in the sample.

#### US-064 · Entity activation near the camera
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** US-013
**Touches** runtime

As a programmer, I want entities to wake when they come near the screen and sleep
when far, so that large worlds stay within the CPU and sprite limits.

Acceptance criteria
- [ ] Margin configurable per entity type.

---

## E8 · Asset pipeline

#### US-070 · Hear MIDI, XM and MOD in the studio
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** —
**Touches** app

As an author, I want to play music in the Audio list as the GBA will sound, so
that I do not build to hear a track.

Acceptance criteria
- [ ] XM and MOD play through a browser tracker player at the GBA mixer's rate.
- [ ] MIDI plays with its SF2 soundfont.

#### US-071 · Aseprite preview and conversion, tags as animations
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** core, codegen, app

As an author, I want `.aseprite` files previewed and converted, with tags becoming
animations and frame durations kept.

Acceptance criteria
- [ ] Preview in the sprite editor; the build converts them.
- [ ] Tags become animations unless the sprite document overrides them.

#### US-072 · Import Tiled maps
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** core, app, server

As an author coming from Tiled, I want to import `.tmx` and `.tmj` maps as rooms.

Acceptance criteria
- [ ] Tile layers, object layers (as entities) and the tileset come across.
- [ ] What cannot be imported is listed.

#### US-073 · Import Diamond Hands ASCII levels
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** scripts, core

As the author of Diamond Hands, I want its ASCII levels imported as rooms, so that
the game can move to the studio one piece at a time.

Acceptance criteria
- [ ] A script maps characters to tiles, collision and entities from a small config.
- [ ] The game builds and plays from the imported rooms.

---

## E9 · Beyond one genre

#### US-080 · Project templates by genre
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** US-010
**Touches** server (scaffold), sample

As an author, I want to start from a platformer, top-down adventure, shoot 'em up
or puzzle template, so that the studio is for GBA games, not one kind of game.

Acceptance criteria
- [ ] The New project dialog offers templates; each builds and plays.
- [ ] Each template has a short guide in `docs/`.

#### US-081 · Affine and Mode 7 backgrounds
**Priority** P2 · **Status** Proposed · **Size** L · **Depends on** —
**Touches** core, codegen, runtime, app

As an author, I want rotating and scaling backgrounds, so that I can make racing,
world maps and boss effects.

Acceptance criteria
- [ ] An affine background kind with its 8bpp and 256-tile limits checked.

#### US-082 · 8 bits per pixel tilesets
**Priority** P3 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** codegen, runtime

As an author, I want a tileset to use one 256-colour palette, for art that needs
more than 15 colours in a tile.

Acceptance criteria
- [ ] Per-tileset setting; budgets account for double tile size.

---

## E10 · Agents and automated checks

#### US-090 · Reachability check on the runtime physics
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** —
**Touches** runtime, server, app

As an author, I want to ask whether the player can get from one point to another
with given abilities, so that I find soft locks before players do.

Acceptance criteria
- [ ] A search over the runtime's physics (compiled to wasm) answers yes with a
  path or no.
- [ ] Shown as a path on the map; available as an MCP tool.

#### US-091 · Headless game tests from the project
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-020
**Touches** server, runtime

As a programmer, I want tests that run the ROM on the Pecten core with scripted
input and check game state, so that CI catches broken rooms.

Acceptance criteria
- [ ] `pecten-studio test <folder>` runs test files and fails on a failed check.
- [ ] Runs in GitHub Actions.

#### US-092 · Agent-visible selection in the map
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** US-040
**Touches** app, server

As an author working with an agent, I want the area I select to be reported by
`studio_view`, so that "fill this" needs no coordinates.

Acceptance criteria
- [ ] `studio_view` includes the selection rectangle and room.

#### US-093 · Tune tool descriptions on a real game
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** US-073
**Touches** server

As a contributor, I want the MCP tools tried on a real project and their
descriptions fixed from what goes wrong.

Acceptance criteria
- [ ] A written list of failures and the changes made for each.

#### US-121 · Generator tools for agents
**Priority** P1 · **Status** Done · **Size** M · **Depends on** —
**Touches** core, server, docs

As an agent, I want MCP tools for the tileset generator, the room generator and the
pixel art converter, so that I can make my own tileset and room template without a
human drawing the art first.

The studio's generators are only reachable from its web panels. Their pictures go
in `generated/`, not `assets/`, so the rule that tools never write under `assets/`
stands: `generated/` holds what a tool made, and a tool never replaces a file there.

Acceptance criteria
- [x] `tileset_generate` makes a tileset from a preset or from options, writes its
  PNG under `generated/tilesets/`, saves the tileset document with collision set
  (adding the slope classes the project lacks) and answers with a picture of the
  sheet and the problems it left.
- [x] `room_generate` lays out a room on a generated tileset, sized to the project's
  jump, saves it, and answers with a picture of the room and the problems it left.
  It says what to do when the tileset is not a generator sheet.
- [x] `pixel_art_convert` converts a PNG from the game folder with the converter's
  options and writes the result under `generated/pixelart/`, answering with its
  size, colour count and a picture.
- [x] No tool writes outside `generated/` except documents under `studio/`, and none
  replaces an existing file: a taken name gets a numbered one.
- [x] A fresh project can go from nothing to a validated tileset and room using only
  MCP calls.
- [x] The studio's own tileset panel and the tools share one collision-class
  function.
- [x] `docs/guide/agents.md` lists the tools; AGENTS.md says what `generated/` is.

---

## E11 · Distribution, ecosystem and docs

#### US-100 · Publish runtime and build helper as crates
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-001
**Touches** runtime, codegen

As a programmer, I want `pecten_studio_rt` and `pecten_studio_build` on crates.io,
so that a game does not need a path to this repository.

Acceptance criteria
- [ ] Published with semver; the data format version is checked against the
  studio's.

#### US-101 · `npx pecten-studio`
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** server, app

As an author, I want to run the studio with one command and no checkout.

Acceptance criteria
- [ ] `npx pecten-studio <folder>` serves the studio; `pecten-studio` CLI included.

#### US-102 · Desktop app on macOS and Windows
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** desktop, .github

As an author, I want the desktop app on my system, with the CLI included.

Acceptance criteria
- [ ] Release builds for macOS (arm64, x64) and Windows x64.
- [ ] The packaged app includes the `pecten-studio` command.

#### US-103 · Export: flashcart ROM, web player, itch.io
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** server, app

As an author, I want one button to make a release ROM with a correct header and a
web page that plays it, so that I can share my game.

Acceptance criteria
- [ ] Export writes the `.gba` (fixed with gbafix) and a zip with a web player on
  the Pecten core, ready for itch.io.
- [ ] Title, game code and save type set in Project settings.

#### US-104 · Plugin API for panels and build steps
**Priority** P2 · **Status** Proposed · **Size** L · **Depends on** —
**Touches** app, server, core

As a contributor, I want to add a panel, a document kind or a build step from a
package, without forking the studio.

Acceptance criteria
- [ ] Documented extension points; one plugin in the repo as an example.

#### US-105 · Tutorials from an empty folder to a game
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-012
**Touches** docs

As a new author, I want a tutorial that takes me from nothing to a small game with
enemies, collectibles and a door.

Acceptance criteria
- [ ] Each step has a screenshot and the finished project is in the repo.

#### US-106 · Test on more browsers, touch and large projects
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** app

As an author, I want the studio to work in Firefox and Safari and on a project
with a hundred rooms.

Acceptance criteria
- [ ] Browser tests in CI for Chromium, Firefox and WebKit.
- [ ] A generated 100-room project opens and paints without lag.

#### US-107 · Fix the README's "left out on purpose" list
**Priority** P0 · **Status** Done · **Size** S · **Depends on** —
**Touches** README.md

As a reader, I want the README to match the studio, which now has a pixel editor.

Acceptance criteria
- [x] The pixel editor is removed from "Left out on purpose".
- [x] The roadmap points to this file.

#### US-108 · Scripted documentation screenshots
**Priority** P1 · **Status** Done · **Size** S · **Depends on** —
**Touches** scripts, docs, package.json

As a contributor, I want the docs' screenshots taken by a script from a list, so
that every new feature can be documented with up-to-date pictures without taking
them by hand.

Acceptance criteria
- [x] `docs/screenshots.json` lists every picture in `docs/public/screenshots/`,
  with its route, viewport and the steps to reach the state shown.
- [x] `node scripts/screenshots.ts <name>...` starts the studio on a project, takes
  the named shots and writes them; `--all` takes every shot not marked manual;
  `--list` lists them. With no names and no `--all` it refuses, so hand-taken
  pictures are not replaced by accident.
- [x] Playwright is a dev dependency in the lockfile and the script runs on a clean
  checkout after `pnpm install`, `pnpm exec playwright install chromium` and
  `pnpm build`.
- [x] Every non-manual shot in the list is taken successfully on `sample/`.
- [x] The shots marked manual (collision overlay, new tileset, new image, Build
  panel) get the actions that make them scriptable, or a note saying why not.
- [x] Decide which project the published pictures come from (the docs footer says
  Diamond Hands, the list defaults to `sample/`) and make the footer match.

Notes / open questions
- The `play` shots need a built dev ROM in the project first; a clean checkout has
  none until the sample is built.
- The script serves a temporary copy of the project, so shots can edit, patch and
  build. The Build panel shot runs a real build, with `target/` linked to the
  project's, so the project's next build of the game crate is not incremental.
- How to add a shot: the `screenshots` skill in `.claude/skills/`.
- Decided by the author: the pictures come from Diamond Hands
  (`../diamond-hands/project`). The three about patching come from `sample/`,
  because Diamond Hands does not read its level data from the ROM; the footer says
  so.

#### US-109 · The sample's world map names a room it does not have
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** sample

As an author opening the sample, I want it to have no problems, so that the first
problem I see is one I made.

`sample/studio/world.json` places a room `kitchen` at (3, 0), but there is no
`studio/rooms/kitchen.json`, so the Problems panel shows `unknown room "kitchen"`
(seen in the Play panel screenshots taken for US-021a).

Acceptance criteria
- [ ] The sample opens with no problems: the room is added or its place removed,
  whichever the sample's tour needs.
- [ ] The screenshots taken from `sample/` no longer show the problem.

---

## E12 · Triggers and game rules

Behaviours (E2) say what an object does on its own. Rules say how a game hangs
together: "when the player touches the lever, open the gate", "when all three gems
are taken, start the boss music", "if the player has the double jump, hide this
hint". With rules, a game that fits a template needs no Rust at all.

This is not visual scripting. A rule is one event, a list of conditions and a list
of actions, edited as a form, stored as JSON and compiled to tables. There are no
loops, no expressions beyond comparisons, and nothing that runs every frame unless
an event fires. Anything that needs more is a behaviour written in Rust (US-018),
which rules can then call (US-118).

#### US-110 · Game flags and variables
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-060
**Touches** core (schema), codegen, runtime, app

As an author, I want to declare named flags (on/off) and small counters in the
project, so that rules and behaviours can remember what has happened.

Acceptance criteria
- [ ] Flags and counters are declared in `studio/project.json` with a name, a
  scope (game, room) and, for counters, a range; they get constants in
  `include_data!()`.
- [ ] Game-scope values are saved with the rest of the save data (US-060); room
  scope is reset on leaving the room.
- [ ] Codegen packs them into bits and the smallest integers that hold their range,
  and reports the total size.
- [ ] Project settings lists, adds, renames and removes them; renaming updates every
  rule that uses them.

#### US-111 · Trigger zones
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** core, app, codegen, runtime

As an author, I want to draw a rectangle in a room that fires an event when the
player enters, stays in or leaves it, so that places can start things.

Acceptance criteria
- [ ] A zone tool in the map editor; zones have an id, a size in pixels and are
  shown in their own colour.
- [ ] Zones are entities of a built-in kind, so they can be referenced (US-017).
- [ ] The runtime reports enter and leave once each, not every frame.

#### US-112 · Rule format: event, conditions, actions
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-110
**Touches** core (schema), docs

As an author, I want rules stored as plain JSON next to the rooms, so that they
diff well in git and agents can read them.

Acceptance criteria
- [ ] Rules live in `studio/rules/<id>.json` (game-wide) and in a room's file
  (that room only).
- [ ] A rule has an event, zero or more conditions (all must hold), one or more
  actions run in order, and an option to fire once.
- [ ] Actions can wait a number of frames between steps (for cutscenes) without
  blocking the game.
- [ ] The format is in the JSON Schema output and in `docs/reference/`.

```json
{
  "on": { "event": "touch", "entity": "lever-1" },
  "if": [{ "flag": "gate-open", "is": false }],
  "do": [
    { "action": "set_flag", "flag": "gate-open", "to": true },
    { "action": "play_sound", "sound": "clunk" },
    { "action": "wait", "frames": 20 },
    { "action": "open", "entity": "gate-1" }
  ],
  "once": true
}
```

#### US-113 · Rules compiled to tables and run by the runtime
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** US-112, US-001
**Touches** codegen, runtime, sample

As a programmer, I want codegen to turn rules into compact tables and the runtime
to run them, so that rules cost little ROM and almost no CPU.

Acceptance criteria
- [ ] Rules are indexed by event, so a frame with no events does no rule work.
- [ ] Each rule is a few bytes of opcodes with no allocation at run time.
- [ ] The rule tables are part of the patchable data section (US-001), so editing a
  rule needs no compile (US-002).
- [ ] Host unit tests cover every condition and action; a bench on hardware speed
  shows 100 rules firing in one frame stay inside a frame.

#### US-114 · Built-in events, conditions and actions
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** US-113, US-010
**Touches** runtime, codegen

As an author, I want enough built-in pieces to make a whole game, so that I only
reach for Rust for something truly new.

Acceptance criteria
- [ ] **Events:** game start, room enter and leave, zone enter and leave, touch
  entity, entity taken, entity destroyed, button pressed near an entity, flag or
  counter changed, timer done, player hurt, player died, dialogue choice made.
- [ ] **Conditions:** flag is, counter compared to a number, player has ability,
  entity is alive or taken, player in room or zone, button held.
- [ ] **Actions:** set flag, add to or set counter, give or remove ability, open or
  close a door or gate, spawn, destroy, show or hide an entity, move an entity to a
  point, play sound, change music, start dialogue (US-051), move the player to a
  room and point, camera shake or pan to a point (US-063), start a timer, save the
  game, fade, wait, end the game.
- [ ] Each piece declares its parameters like behaviours do (US-011), so the
  studio builds its form from the same data.

#### US-115 · Rule editor in the studio
**Priority** P1 · **Status** Proposed · **Size** L · **Depends on** US-114
**Touches** app

As an author, I want to make and edit rules with forms and by picking things on the
map, so that I never write the JSON by hand.

Acceptance criteria
- [ ] A Rules panel lists rules for the game and for the open room, with search.
- [ ] Each rule reads as a sentence ("When the player touches Lever 1, if Gate open
  is off: set Gate open, play Clunk, wait 20 frames, open Gate 1").
- [ ] Entity, zone, room, sound and flag parameters are picked from lists or by
  clicking on the map.
- [ ] Selecting an entity shows the rules that mention it; the map draws arrows from
  a rule's trigger to the things it acts on.
- [ ] Undo and redo, like other documents.

#### US-116 · Rules checked as problems
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-112
**Touches** core (validate), app

As an author, I want mistakes in rules to show in the Problems panel, so that I
find them before playing.

Acceptance criteria
- [ ] Unknown or deleted entities, zones, rooms, sounds, flags and abilities are
  errors.
- [ ] A flag that is read but never set, or set but never read, is a warning.
- [ ] Two rules on the same event that set the same flag to different values are a
  warning.
- [ ] Clicking a problem opens the rule at the step at fault.

#### US-117 · Flags and fired rules in the live inspector
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** US-113, US-021
**Touches** app, codegen

As an author, I want to see flags and counters live while playing, change them, and
see which rules fired, so that I can find out why a door did not open.

Acceptance criteria
- [ ] The Play panel lists flags and counters, updated every frame, and editable.
- [ ] A log lists each rule that fired with its frame, and each rule whose event
  came but whose conditions failed, with the condition that failed.
- [ ] Clicking a log line opens the rule.

#### US-118 · Custom events, conditions and actions from Rust
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** US-113, US-018
**Touches** runtime, codegen, app

As a programmer, I want to add my own events, conditions and actions in the game
crate, so that authors can use my game's special mechanics from rules.

Acceptance criteria
- [ ] A custom piece is declared like a behaviour, with typed parameters, and shows
  in the rule editor after a build.
- [ ] Documented with an example in `sample/` (for example a "boss phase" event).

#### US-119 · Rule tools for agents
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** US-112
**Touches** server

As an agent, I want tools to list, add, change and remove rules and flags, checked
against the schema, so that I can wire up a level for an author.

Acceptance criteria
- [ ] MCP tools `rule_list`, `rule_set`, `rule_remove`, `flag_set`, `flag_remove`.
- [ ] Writes answer with the problems they left, like other tools.

#### US-120 · Template games built with rules only
**Priority** P1 · **Status** Proposed · **Size** M · **Depends on** US-114, US-080
**Touches** server (scaffold), sample, docs

As an author, I want the genre templates to use rules for their doors, gates,
pickups and story beats, so that I can see that a whole game needs no Rust.

Acceptance criteria
- [ ] The Metroidvania template has a lever and gate, an ability gate, a locked
  room opened by collecting items, and an ending, all done with rules and built-in
  behaviours.
- [ ] Its `main.rs` is not edited by the author at any point in the tutorial
  (US-105).

---

## E13 · Studio usability and accessibility

Found in a review of the desktop app and the studio page it shows (2026-11-24),
checked against common accessibility rules (WCAG 2.2 AA) and desktop editor habits.
The studio is used for hours at a time, often by keyboard, so a missing focus ring,
a shortcut that does something unexpected or a message that is cut off costs more
than it looks. These stories fix what the review found; each is small and stands
alone.

#### US-122 · A visible focus ring on every control
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** app, desktop, docs

As an author working by keyboard, I want to see which control has focus, so that I
know what Enter or Space will do.

The theme turns off the ripple on every button (`MuiButtonBase` `disableRipple` in
`app/src/theme.ts`), and in MUI that also removes the focus indicator. Only a few
controls draw their own, and the desktop tab strip's is 1 px.

Acceptance criteria
- [ ] Given any button, icon button, list row, tab or toggle in the studio or the
  desktop shell, when it gets focus from the keyboard, then a ring at least 2 px
  wide in the theme's primary colour is drawn around it, with at least 3:1 contrast
  against what is next to it.
- [ ] The ring is set once in the theme (`.Mui-focusVisible`), not per panel; the
  per-panel `:focus-visible` styles that only repeat it are removed.
- [ ] Clicking with the mouse does not show the ring.
- [ ] A test renders a themed button, focuses it from the keyboard and finds the
  focus style.

#### US-123 · Zoom the desktop app's interface
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** desktop, docs

As an author, I want to make the desktop app's text and controls larger or smaller,
so that I can work comfortably on my screen and at my eyesight.

The desktop app's own menu replaces Electron's default one, which had the zoom
commands, so Ctrl+= and Ctrl+- do nothing. The tab bar's height is fixed at 38 px
in the main process.

Acceptance criteria
- [ ] The View menu has Zoom In (Ctrl+=), Zoom Out (Ctrl+-) and Actual Size
  (Ctrl+0), from 50 % to 300 %.
- [ ] Zoom applies to the tab bar and to every open project, including projects
  opened later, and is remembered for the next start.
- [ ] Given a zoom of 200 %, when the window is resized, then the tab bar and the
  project page do not overlap or leave a gap: the bar's height follows the zoom.
- [ ] `docs/guide/desktop.md` and `docs/reference/shortcuts.md` list the shortcuts.

#### US-124 · Project tabs that do not fit stay reachable
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** desktop, docs

As an author with several games open, I want to see and reach every open project,
so that none is hidden without my knowing.

Tabs are at least 110 px wide and share their row with the status text, and the
tab list hides what overflows. At the smallest window width (720 px) about four
tabs fit; the rest can only be reached with Ctrl+Tab.

Acceptance criteria
- [ ] Given more tabs than fit, then the strip shows that there are more (a
  scroll or a "more tabs" button with a count), and every tab can be reached with
  the mouse.
- [ ] The active tab is always scrolled into view, including after Ctrl+Tab.
- [ ] The status text gives up its room before the tabs do: it shrinks to the
  error and warning counts first.
- [ ] A test with eight open projects in a 720 px window finds every tab reachable.

#### US-125 · Ctrl+W closes the document, not the project
**Priority** P1 · **Status** Done · **Size** S · **Depends on** —
**Touches** desktop, app, docs

As an author, I want Ctrl+W to close the document tab I am looking at, as in a code
editor, so that I do not close the whole project by habit.

The page has document tabs (rooms, sprites, tilesets) right under the project tabs.
Ctrl+W today closes the project and stops its server.

Acceptance criteria
- [x] Given a project with document tabs, when Ctrl+W is pressed, then the active
  document tab closes and the project stays open.
- [x] Ctrl+Shift+W closes the project; the File menu shows both commands with their
  shortcuts.
- [x] Given a project with no document tab open, Ctrl+W does nothing.
- [x] The browser studio is unchanged: there, the browser keeps Ctrl+W.
- [x] `docs/reference/shortcuts.md` and `docs/guide/desktop.md` are updated.

#### US-126 · Act on build and save status from the desktop tab bar
**Priority** P1 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** desktop, app, docs

As an author in the desktop app, I want to build, patch or read a full message from
the status in the tab bar, so that I can fix what it reports without hunting for the
right panel.

In the browser the top bar has Build and Patch buttons. In the desktop app, the
same status is shown as text in the tab bar, with no buttons. The reasons for "Needs
build" and the full "Not saved" message are only in a hover tooltip, which the
keyboard cannot reach, and the line is cut to fit a 38 px bar.

Acceptance criteria
- [ ] Given "Needs build" or "Level data not patched in", then a button next to it
  starts the build or the patch in that project, as in the browser.
- [ ] Given any status whose text is cut off or has more detail, when it is clicked
  or focused and Enter is pressed, then the full text is shown in a panel that stays
  until closed.
- [ ] "Not saved" is never cut to less than its first sentence; it takes the room
  of the other status items first.
- [ ] The page's bridge to the desktop app gains only the commands it needs (build,
  patch), checked in the main process like the existing status message.

#### US-127 · Project tabs by keyboard, and F6 between tab bar and page
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** US-122
**Touches** desktop, docs

As an author working by keyboard, I want to move through the project tabs with the
arrow keys and jump between the tab bar and the page, so that I do not need the
mouse to switch or close projects.

Each project tab is its own Tab stop and holds a focusable close button, which
screen readers do not expect inside a tab. The tab bar and the page are separate
views, so Tab never moves focus from one to the other.

Acceptance criteria
- [ ] The tab strip is one Tab stop; Left, Right, Home and End move between tabs,
  Enter or Space opens one, and Delete closes it.
- [ ] The close button is still there for the mouse but is not a Tab stop, and has
  no role inside the tab.
- [ ] F6 moves focus from the page to the active tab, and from the tab bar back to
  the page, keeping where focus was in the page.
- [ ] `docs/reference/shortcuts.md` lists the keys.

#### US-128 · Status shown by shape as well as colour, and read aloud
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** desktop, app

As an author, I want each project tab's build state and the error and warning counts
to be clear without relying on colour, so that I can read them if I do not see
colours well or use a screen reader.

A project tab's build state is a 7 px dot that is only blue, green or red, and a
starting project shows nothing. The error and warning counts are labelled with an
`aria-label` on a plain element, which screen readers ignore.

Acceptance criteria
- [ ] Each state has its own shape: a spinner while starting or building, a tick
  when the last build passed, a cross when it failed or the server stopped.
- [ ] The counts in the tab bar and in the browser's top bar are one status message
  that reads, for example, "3 errors, 1 warning", and a screen reader announces it
  when it changes, without moving focus.
- [ ] With motion reduced in the system settings, the spinner does not spin.

#### US-129 · A failed agent action stays until it is dismissed
**Priority** P2 · **Status** Proposed · **Size** S · **Depends on** —
**Touches** app

As an author working with a coding agent, I want a failed agent action to stay on
screen until I have read it, so that I do not miss that something went wrong.

Every agent action is shown for 8 seconds and then hidden, failed ones included.

Acceptance criteria
- [ ] Given an agent action that failed, then its message stays until it is
  dismissed or the next agent action comes, in the browser and in the desktop tab
  bar.
- [ ] Actions that succeed still disappear after a few seconds.
- [ ] The message can be dismissed with the mouse and the keyboard.

#### US-130 · Interface colours that pass contrast, from theme tokens
**Priority** P2 · **Status** Proposed · **Size** M · **Depends on** —
**Touches** app, desktop

As an author, I want text, errors and control edges to stand out from the panels
behind them, so that I can read them in any light.

Measured on the current theme:

| Colour | On | Ratio | Needed |
| --- | --- | --- | --- |
| Error red `#e5484d` | panel `#262626` / page `#1c1c1c` | 3.87 / 4.35 | 4.5 |
| Outlined button edge `#4a4a4a` | page `#1c1c1c` | 1.92 | 3 |
| Divider `#111111` | tab bar `#141414` | 1.02 | visible |

`#4c9ffe` and `#141414` are written out in the desktop shell, and about a hundred
other hex colours in the panels, so a fix in the theme does not reach them.

Acceptance criteria
- [ ] Text in the error colour is at least 4.5:1 on every background it is shown on
  (for example `#ff6369`, 5.2:1 on the panel colour).
- [ ] Edges of buttons and fields are at least 3:1 against what is behind them.
- [ ] The tab bar colour and the focus colour are theme tokens; the shell and panels
  use the tokens instead of hex values. Colours that are part of the game's art
  (palettes, tiles, checkerboard) stay as they are.
- [ ] A test checks the theme's text and edge colour pairs against these ratios.
- [ ] Documentation screenshots that change are retaken.

Notes / open questions
- US-047 fixes secondary text that shows in the wrong colour; doing both together
  avoids retaking the same screenshots twice.
