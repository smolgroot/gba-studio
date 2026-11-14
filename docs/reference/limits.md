# Known limits

An honest list of what does not work yet.

- **Music in the studio:** MIDI, XM and MOD cannot be heard in the Audio list, only in the built game. There is no waveform or ROM-size estimate for audio.
- **Aseprite files** are accepted as sprite images, but not previewed, and the build helper only converts PNG sheets for now.
- **Collision classes and entity property definitions** are edited in `studio/project.json`, not in the interface. (Entity types can be added, renamed, recoloured and given a sprite in Project settings.)
- **Map editor:** no selection, copy and paste, flip, or autotiling yet. Resizing a room keeps its top-left corner.
- **Backgrounds:** the map editor shows them still; only the built game moves them. A view shows one room's backgrounds at a time, so where two rooms with different ones meet, the backdrop changes as the player crosses rather than at the border on screen. A background's colours share the 16 background palettes with the tileset, 15 colours a tile: a photo will not convert, pixel art with few colours will.
- **Budgets:** the studio does not yet show palette, tile or sprite budgets while you draw; the build helper reports them when it runs.
- **Tilesets** are one 16-colour-palette set per tile (up to 16 palettes). The runtime uses 4 bits a pixel throughout.
- **One ROM at a time**, and the game logic in the sample is a skeleton: coins and diamonds to collect and one kind of enemy, but no health, combat, doors or saving. Those are the game's job, built on the runtime.
- **Deleting** a room, tileset or sprite removes its file and cannot be undone from the studio.
- Tested with the sample project and generated test files, in Chrome. Touch input, other browsers and larger real projects have not been tried.
