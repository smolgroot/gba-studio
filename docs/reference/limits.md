# Known limits

An honest list of what does not work yet.

- **Music in the studio:** MIDI, XM and MOD cannot be heard in the Audio list, only in the built game. There is no waveform or ROM-size estimate for audio.
- **Aseprite files** are accepted as sprite images, but not previewed, and the build helper only converts PNG sheets for now.
- **Entity properties:** the build does not check the values of a type's own properties yet. The [Problems panel](../guide/interface#problems) reports a stored value that does not fit its property (the wrong kind, an option the list does not have, a number outside its smallest and largest), but the build accepts it, and the game does not know the smallest and largest. Each own property costs 20 bytes on every placed entity of its type in the level data, and a text or list value adds its text, once. The [Build panel](../guide/build-and-play#level-data-use) counts it. See [Properties](../guide/project-settings#properties).
- **Collision classes:** a game has at most 255, and a build with more fails. Classes can be added at the end and edited in [Project settings](../guide/project-settings#collision-classes), but not moved, because rooms paint collision by a class's place in the list. The first class cannot be deleted. Adding, deleting or renaming one needs a build.
- **Map editor:** no selection, copy and paste, flip, or autotiling yet. Resizing a room keeps its top-left corner.
- **Backgrounds:** the map editor shows them still; only the built game moves them. A view shows one room's backgrounds at a time, so where two rooms with different ones meet, the backdrop changes as the player crosses rather than at the border on screen. A background's colours share the 16 background palettes with the tileset, 15 colours a tile: a photo will not convert, pixel art with few colours will.
- **Darkening:** one level for all of a room's dimmed layers, set per room. Each layer is dimmed or not; two layers cannot have different amounts. Sprites are never dimmed. A change to dimming counts as a change to the rooms for live apply: the game must make a new `WorldView` to show it.
- **Behaviours:** an entity type has at most 4. The game keeps room for 4 on every entity, whatever its type.
- **Live entities:** the game keeps every entity of the world in a table in EWRAM, 108 bytes a slot. A build makes room for the project's entities and a quarter more, at least 16 more, rounded up to 16: the sample's 32 slots take 3,532 bytes, and 500 entities would get 640 slots, about 69 KB of the 256 KB. When the project has more entities than that, patching the ROM or applying live needs a build.
- **Budgets:** the tileset, pixel and map editors show background tiles and palettes against the 1024 and 16 as you paint, and Problems lists a room or tileset over them. Sprite tile memory and the 128 sprites are not counted yet; the build helper reports sprite sheets with too many colours when it runs.
- **Tilesets** are one 16-colour-palette set per tile (up to 16 palettes). The runtime uses 4 bits a pixel throughout.
- **One ROM at a time**, and the game logic in the sample is a skeleton: coins and diamonds to collect and one kind of enemy, but no health, combat, doors or saving. Those are the game's job, built on the runtime.
- **Deleting** a room, tileset or sprite removes its file and cannot be undone from the studio.
- **Desktop app:** Linux on x64 only for now. The packaged app does not include the `pecten-studio` command, so agents connect to [each project's endpoint](../guide/desktop#coding-agents).
- Tested with the sample project and generated test files, in Chrome. Touch input, other browsers and larger real projects have not been tried.
