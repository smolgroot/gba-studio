// Music and sound effects: import the files, name them, and say what a MIDI plays through.
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { slugify, uniqueId } from '@gba-studio/core'
import type { Audio } from '@gba-studio/core'
import { useRef } from 'react'
import { fileUrl } from '../api.ts'
import { SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { ImportButton, UndoButtons, nameFromPath } from './common.tsx'
import { Heading } from './room.tsx'
import { Message } from './views.tsx'

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase()
const FORMATS: Record<string, 'midi' | 'xm' | 'mod'> = { mid: 'midi', midi: 'midi', xm: 'xm', mod: 'mod' }

/** The audio document with these files added: WAV as sound effects, MIDI, XM and MOD as tracks. */
function withFiles(audio: Audio, paths: string[], soundfonts: string[]): { audio: Audio; skipped: string[] } {
  const next: Audio = { ...audio, tracks: [...audio.tracks], sfx: [...audio.sfx] }
  const skipped: string[] = []
  for (const path of paths) {
    const kind = extension(path)
    const used = [...next.tracks.map((t) => t.file), ...next.sfx.map((s) => s.file)]
    if (used.includes(path) || kind === 'sf2') continue
    const name = nameFromPath(path)
    if (kind === 'wav') {
      next.sfx.push({ id: uniqueId(slugify(name), next.sfx.map((s) => s.id)), name, file: path })
    } else if (FORMATS[kind]) {
      const format = FORMATS[kind]
      // A MIDI file has notes but no instruments: it needs a soundfont to make sound.
      if (format === 'midi' && soundfonts.length === 0) {
        skipped.push(path)
        continue
      }
      next.tracks.push({ id: uniqueId(slugify(name), next.tracks.map((t) => t.id)), name, file: path, format, ...(format === 'midi' ? { soundfont: soundfonts[0]! } : {}) })
    }
  }
  return { audio: next, skipped }
}

export function AudioEditor() {
  const audio = useStudio((s) => s.bundle?.docs.audio)
  const assets = useStudio((s) => s.bundle?.assets)
  const revision = useStudio((s) => s.revision)
  const commit = useStudio((s) => s.commit)
  const player = useRef<HTMLAudioElement | null>(null)
  if (!audio || !assets) return <Message>The audio file is missing or has errors. See Problems.</Message>

  const soundfonts = assets.filter((a) => extension(a.path) === 'sf2').map((a) => a.path)
  const used = new Set([...audio.tracks.map((t) => t.file), ...audio.sfx.map((s) => s.file)])
  const unused = assets.filter((a) => (extension(a.path) === 'wav' || FORMATS[extension(a.path)]) && !used.has(a.path))
  const add = (paths: string[]) => {
    // Read the store again: the import has just refreshed the file list.
    const state = useStudio.getState().bundle!
    const fonts = state.assets.filter((a) => extension(a.path) === 'sf2').map((a) => a.path)
    const result = withFiles(state.docs.audio ?? audio, paths, fonts)
    if (result.audio.tracks.length !== audio.tracks.length || result.audio.sfx.length !== audio.sfx.length) commit('audio', undefined, result.audio)
  }
  const play = (path: string) => {
    player.current?.pause()
    player.current = new window.Audio(fileUrl(path, revision))
    void player.current.play()
  }
  const cell = { px: 2, py: 0.75, borderBottom: '1px solid #1c1c1c', minWidth: 0 } as const

  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, flexWrap: 'wrap' }}>
        <ImportButton label="Import music or sounds" accept=".mid,.midi,.sf2,.xm,.mod,.wav" folder="assets/audio" multiple onImported={add} />
        <UndoButtons />
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: ui(200) }}>
          MIDI (with an SF2 soundfont), XM and MOD become music tracks; WAV becomes a sound effect. Files go to assets/audio/.
        </Typography>
      </Box>

      <Heading>Music tracks</Heading>
      {audio.tracks.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No tracks yet.</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1.2fr) max-content minmax(0, 2fr) minmax(0, 1.5fr) max-content', alignItems: 'center' }}>
        {audio.tracks.map((track, index) => {
          const update = (patch: Partial<Audio['tracks'][number]>) => commit('audio', undefined, { ...audio, tracks: audio.tracks.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
          return (
            <Box key={track.id} sx={{ display: 'contents' }}>
              <Box sx={cell}><TextInput label="Track name" value={track.name} onCommit={(name) => update({ name })} /></Box>
              <Typography variant="body2" color="text.secondary" sx={cell}>{track.format.toUpperCase()}</Typography>
              <Typography noWrap title={track.file} sx={cell}>{track.file}</Typography>
              <Box sx={cell}>
                {track.format === 'midi' ? (
                  <SelectInput label="Soundfont" value={track.soundfont ?? ''} onChange={(soundfont) => update({ soundfont })} options={soundfonts.map((path) => ({ value: path, label: path.split('/').pop()! }))} />
                ) : (
                  <Typography variant="body2" color="text.secondary">instruments in the file</Typography>
                )}
              </Box>
              <Box sx={cell}>
                <IconButton aria-label={`Remove ${track.name} from the project`} onClick={() => commit('audio', undefined, { ...audio, tracks: audio.tracks.filter((_, i) => i !== index) })}><DeleteOutlinedIcon /></IconButton>
              </Box>
            </Box>
          )
        })}
      </Box>

      <Heading>Sound effects</Heading>
      {audio.sfx.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No sound effects yet.</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(90px, 1.2fr) minmax(0, 3fr) max-content', alignItems: 'center' }}>
        {audio.sfx.map((sound, index) => (
          <Box key={sound.id} sx={{ display: 'contents' }}>
            <Box sx={cell}><IconButton aria-label={`Play ${sound.name}`} onClick={() => play(sound.file)}><PlayArrowIcon /></IconButton></Box>
            <Box sx={cell}><TextInput label="Sound name" value={sound.name} onCommit={(name) => commit('audio', undefined, { ...audio, sfx: audio.sfx.map((s, i) => (i === index ? { ...s, name } : s)) })} /></Box>
            <Typography noWrap title={sound.file} sx={cell}>{sound.file}</Typography>
            <Box sx={cell}>
              <IconButton aria-label={`Remove ${sound.name} from the project`} onClick={() => commit('audio', undefined, { ...audio, sfx: audio.sfx.filter((_, i) => i !== index) })}><DeleteOutlinedIcon /></IconButton>
            </Box>
          </Box>
        ))}
      </Box>

      {unused.length > 0 && (
        <>
          <Heading>Audio files not in the project</Heading>
          {unused.map((asset) => {
            const needsFont = FORMATS[extension(asset.path)] === 'midi' && soundfonts.length === 0
            return (
              <Box key={asset.path} sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 0.5 }}>
                <Button variant="text" startIcon={<AddIcon />} disabled={needsFont} onClick={() => add([asset.path])}>Add</Button>
                <Typography noWrap sx={{ flex: 1, minWidth: 0 }}>{asset.path}</Typography>
                {needsFont && <Typography variant="body2" color="warning.main">import an SF2 soundfont first</Typography>}
              </Box>
            )
          })}
        </>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
        Sound effects play here. MIDI, XM and MOD are converted when the ROM is built and cannot be heard in the studio yet. Removing an item leaves its file in the game folder.
      </Typography>
    </Box>
  )
}
