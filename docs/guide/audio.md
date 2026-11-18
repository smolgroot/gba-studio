# Audio

Open **Audio** in the Project panel.

![The Audio page listing five tracker music tracks](/screenshots/audio.png)

## Import

Press **Import music or sounds**. Files go to `assets/audio/`.

| Format | Becomes |
| --- | --- |
| **XM**, **MOD** (tracker music) | A music track |
| **MIDI** with an **SF2** soundfont | A music track (agb needs a soundfont to turn notes into sound) |
| **WAV** | A sound effect |

## Manage

- Name tracks and effects.
- Remove them from the project with the bin; **the file stays on disk**.
- For a MIDI track, pick which soundfont it uses. XM and MOD show "instruments in the file".
- Give a room a music track in the room's [Properties](./rooms#room-properties).

## Reading a MIDI file

Select a `.mid` file under **Asset files**, or press the piano button on a MIDI track, to see it as a piano roll. The view is read only.

- The track list gives each track's channel, instrument and note count. Click a track to pick it out, or use the eye to hide it. Instrument names follow General MIDI numbering, which your soundfont may not match.
- The ruler shows bars, tempo, time signature and markers. The lane under the notes shows velocity.
- Point at a note for its pitch, velocity, track, bar and length.
- **Ctrl + wheel** zooms time and **Ctrl + Shift + wheel** zooms the keys. The fit button shows the whole file again.

## Listening

Sound effects play in the studio. Music formats are converted when the ROM is built, so you hear them in the [Play](./build-and-play) panel, not in the Audio list. There is no waveform or ROM-size estimate for audio yet.

## In the game

The build helper generates `audio::TRACKS`, `SFX` and index constants; see [Making a game with it](./making-a-game).
