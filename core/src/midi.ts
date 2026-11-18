// Reads Standard MIDI Files for display: tracks, notes, tempo and metre. A damaged track
// keeps what could be read, with a warning, so a file agb may still accept can be looked at.

export interface MidiNote {
  /** 0 to 127; 60 is middle C. */
  pitch: number
  /** 1 to 127. */
  velocity: number
  /** 0 to 15; 9 is the General MIDI drum channel. */
  channel: number
  /** The program (instrument number) of the channel when the note starts. */
  program: number
  tick: number
  duration: number
}

export interface MidiTrack {
  name: string
  channels: number[]
  /** Programs of the track's notes on melodic channels, in order of first use. */
  programs: number[]
  /** Sorted by start tick, then pitch. */
  notes: MidiNote[]
  /** Longest duration among the notes, for finding what still sounds at a tick. */
  longestNote: number
}

export interface MidiTempo {
  tick: number
  bpm: number
  /** Time from the start of the file to this change. */
  seconds: number
  secondsPerTick: number
}

/** A stretch of the file in one time signature. It starts a bar at `tick`. */
export interface MidiMeter {
  tick: number
  /** Number of the bar at `tick`, counting from 1. */
  bar: number
  numerator: number
  denominator: number
  ticksPerBeat: number
  ticksPerBar: number
}

export interface MidiMarker {
  tick: number
  text: string
}

export interface MidiFile {
  format: number
  /** The title in the first track's name, if it has one. */
  title: string
  ticksPerQuarter: number
  /** Timed in frames: tempo events do not apply, and bars are only nominal. */
  smpte: boolean
  tracks: MidiTrack[]
  /** Never empty; the first starts at tick 0. */
  tempos: MidiTempo[]
  /** Never empty; the first starts at tick 0. */
  meters: MidiMeter[]
  markers: MidiMarker[]
  lengthTicks: number
  durationSeconds: number
  noteCount: number
  pitchRange: { low: number; high: number } | null
  warnings: string[]
}

/** The bytes are not a MIDI file that can be read at all. */
export class MidiError extends Error {}

/** A track could not be read past this point. */
class TrackDamage extends Error {}

interface RawNote extends Omit<MidiNote, 'program'> {}
interface RawTrack {
  name: string
  instrument: string
  notes: RawNote[]
  endTick: number
}
interface ProgramChange {
  tick: number
  program: number
}
interface FileEvents {
  tempos: Array<{ tick: number; microsPerQuarter: number }>
  meters: Array<{ tick: number; numerator: number; denominator: number }>
  markers: MidiMarker[]
  programs: ProgramChange[][]
  warnings: string[]
}

const DEFAULT_MICROS_PER_QUARTER = 500_000
const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)
const u16 = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!
const u32 = (bytes: Uint8Array, at: number) => bytes[at]! * 0x1000000 + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!)
/** MIDI text has no declared encoding: Latin-1 shows every byte as something. */
const clean = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('').replace(/\0/g, '').trim()

/** The last item starting at or before `tick`, in a list sorted by tick. */
function lastAt<T extends { tick: number }>(items: readonly T[], tick: number): T | undefined {
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (items[middle]!.tick <= tick) low = middle + 1
    else high = middle
  }
  return items[low - 1]
}

function readTrack(bytes: Uint8Array, start: number, end: number, index: number, events: FileEvents): RawTrack {
  const track: RawTrack = { name: '', instrument: '', notes: [], endTick: 0 }
  const sounding = new Map<number, Array<{ tick: number; velocity: number }>>()
  let at = start
  let tick = 0
  let running = 0

  const byte = () => {
    if (at >= end) throw new TrackDamage('it ends in the middle of an event')
    return bytes[at++]!
  }
  const data = () => {
    const value = byte()
    if (value > 127) throw new TrackDamage(`a data byte is out of range at offset ${at - 1}`)
    return value
  }
  const length = () => {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const next = byte()
      value = value * 128 + (next & 0x7f)
      if (next < 0x80) return value
    }
    throw new TrackDamage(`a variable-length number is too long at offset ${at - 1}`)
  }
  const block = () => {
    const size = length()
    if (at + size > end) throw new TrackDamage('it ends in the middle of an event')
    at += size
    return bytes.subarray(at - size, at)
  }
  const noteOff = (channel: number, pitch: number) => {
    // The same key held twice on a channel: the first to start is the first to end.
    const started = sounding.get((channel << 7) | pitch)?.shift()
    if (started) track.notes.push({ pitch, velocity: started.velocity, channel, tick: started.tick, duration: tick - started.tick })
  }
  const meta = (type: number, body: Uint8Array) => {
    if (type === 0x03 && !track.name) track.name = clean(body)
    else if (type === 0x04 && !track.instrument) track.instrument = clean(body)
    else if (type === 0x06) events.markers.push({ tick, text: clean(body) })
    else if (type === 0x51 && body.length === 3) {
      const microsPerQuarter = (body[0]! << 16) | (body[1]! << 8) | body[2]!
      if (microsPerQuarter > 0) events.tempos.push({ tick, microsPerQuarter })
    } else if (type === 0x58 && body.length >= 2 && body[0]! > 0 && body[1]! <= 7) {
      events.meters.push({ tick, numerator: body[0]!, denominator: 2 ** body[1]! })
    }
  }

  try {
    while (at < end) {
      tick += length()
      let status = bytes[at] ?? 0
      if (status >= 0x80) at++
      else if (running) status = running
      else throw new TrackDamage(`an event has no status at offset ${at}`)

      if (status === 0xff) {
        running = 0
        const type = data()
        meta(type, block())
        if (type === 0x2f) break
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0
        block()
      } else if (status >= 0xf0) {
        throw new TrackDamage(`event ${status.toString(16)} does not belong in a file, at offset ${at - 1}`)
      } else {
        running = status
        const kind = status & 0xf0
        const channel = status & 0x0f
        const first = data()
        const second = kind === 0xc0 || kind === 0xd0 ? 0 : data()
        if (kind === 0x90 && second > 0) {
          const key = (channel << 7) | first
          const held = sounding.get(key)
          if (held) held.push({ tick, velocity: second })
          else sounding.set(key, [{ tick, velocity: second }])
        } else if (kind === 0x80 || kind === 0x90) {
          noteOff(channel, first)
        } else if (kind === 0xc0) {
          events.programs[channel]!.push({ tick, program: first })
        }
      }
    }
  } catch (error) {
    if (!(error instanceof TrackDamage)) throw error
    events.warnings.push(`Track ${index + 1} is damaged: ${error.message}. The rest of it is not shown.`)
  }

  let unfinished = 0
  for (const [key, held] of sounding) {
    for (const { tick: started, velocity } of held) {
      unfinished++
      track.notes.push({ pitch: key & 0x7f, velocity, channel: key >> 7, tick: started, duration: tick - started })
    }
  }
  if (unfinished) events.warnings.push(`Track ${index + 1}: ${unfinished} ${unfinished === 1 ? 'note has' : 'notes have'} no end and ${unfinished === 1 ? 'runs' : 'run'} to the end of the track.`)
  track.endTick = tick
  return track
}

/** Sorted by tick; when several land on one tick, the last in the file is the one that holds. */
function settle<T extends { tick: number }>(items: T[]): T[] {
  const sorted = items.map((item, order) => ({ item, order })).sort((a, b) => a.item.tick - b.item.tick || a.order - b.order).map((e) => e.item)
  return sorted.filter((item, i) => sorted[i + 1]?.tick !== item.tick)
}

function buildTempos(events: FileEvents, ticksPerQuarter: number, secondsPerSmpteTick: number | null): MidiTempo[] {
  if (secondsPerSmpteTick !== null) return [{ tick: 0, bpm: 60 / (secondsPerSmpteTick * ticksPerQuarter), seconds: 0, secondsPerTick: secondsPerSmpteTick }]
  const changes = settle(events.tempos)
  if (changes[0]?.tick !== 0) changes.unshift({ tick: 0, microsPerQuarter: DEFAULT_MICROS_PER_QUARTER })
  const tempos: MidiTempo[] = []
  for (const { tick, microsPerQuarter } of changes) {
    const previous = tempos.at(-1)
    tempos.push({
      tick,
      bpm: 60_000_000 / microsPerQuarter,
      seconds: previous ? previous.seconds + (tick - previous.tick) * previous.secondsPerTick : 0,
      secondsPerTick: microsPerQuarter / 1_000_000 / ticksPerQuarter,
    })
  }
  return tempos
}

function buildMeters(events: FileEvents, ticksPerQuarter: number): MidiMeter[] {
  const changes = settle(events.meters)
  if (changes[0]?.tick !== 0) changes.unshift({ tick: 0, numerator: 4, denominator: 4 })
  const meters: MidiMeter[] = []
  for (const { tick, numerator, denominator } of changes) {
    const previous = meters.at(-1)
    const ticksPerBeat = (ticksPerQuarter * 4) / denominator
    meters.push({
      tick,
      // A change in the middle of a bar cuts that bar short and starts the next.
      bar: previous ? previous.bar + Math.ceil((tick - previous.tick) / previous.ticksPerBar) : 1,
      numerator,
      denominator,
      ticksPerBeat,
      ticksPerBar: ticksPerBeat * numerator,
    })
  }
  return meters
}

function finishTrack(name: string, notes: RawNote[], programs: ProgramChange[][]): MidiTrack {
  const full = notes
    .map((note): MidiNote => ({ ...note, program: lastAt(programs[note.channel]!, note.tick)?.program ?? 0 }))
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch)
  return {
    name,
    channels: [...new Set(full.map((n) => n.channel))].sort((a, b) => a - b),
    programs: [...new Set(full.filter((n) => n.channel !== DRUM_CHANNEL).map((n) => n.program))],
    notes: full,
    longestNote: full.reduce((longest, n) => Math.max(longest, n.duration), 0),
  }
}

export function parseMidi(bytes: Uint8Array): MidiFile {
  if (bytes.length < 14 || tag(bytes, 0) !== 'MThd') throw new MidiError('it does not start with a MIDI header')
  const headerLength = u32(bytes, 4)
  if (headerLength < 6 || 8 + headerLength > bytes.length) throw new MidiError('its header is damaged')
  const format = u16(bytes, 8)
  if (format > 2) throw new MidiError(`format ${format} is not a known MIDI format`)
  const declaredTracks = u16(bytes, 10)
  const division = u16(bytes, 12)

  let ticksPerQuarter: number
  let secondsPerSmpteTick: number | null = null
  if (division & 0x8000) {
    const frames = 256 - (division >> 8)
    const perFrame = division & 0xff
    if (![24, 25, 29, 30].includes(frames) || perFrame === 0) throw new MidiError('its timing is damaged')
    const ticksPerSecond = (frames === 29 ? 29.97 : frames) * perFrame
    secondsPerSmpteTick = 1 / ticksPerSecond
    // No quarter note exists in frame time: draw the grid as if at 120 BPM.
    ticksPerQuarter = ticksPerSecond / 2
  } else {
    if (division === 0) throw new MidiError('its timing is damaged')
    ticksPerQuarter = division
  }

  const events: FileEvents = { tempos: [], meters: [], markers: [], programs: Array.from({ length: 16 }, () => []), warnings: [] }
  const raw: RawTrack[] = []
  let at = 8 + headerLength
  while (at + 8 <= bytes.length) {
    const kind = tag(bytes, at)
    const size = u32(bytes, at + 4)
    const start = at + 8
    let end = start + size
    if (end > bytes.length) {
      events.warnings.push(`The file stops before the end of ${kind === 'MTrk' ? `track ${raw.length + 1}` : `a ${kind} block`}.`)
      end = bytes.length
    }
    if (kind === 'MTrk') raw.push(readTrack(bytes, start, end, raw.length, events))
    at = end
  }
  if (raw.length === 0) throw new MidiError('it has no tracks')
  if (raw.length !== declaredTracks) events.warnings.push(`The header announces ${declaredTracks} tracks, but the file has ${raw.length}.`)
  if (format === 2) events.warnings.push('This is a format 2 file: its tracks are separate patterns, drawn here from the same start.')

  for (const list of events.programs) list.splice(0, list.length, ...settle(list))
  const tempos = buildTempos(events, ticksPerQuarter, secondsPerSmpteTick)
  const meters = buildMeters(events, ticksPerQuarter)

  let tracks: MidiTrack[]
  if (format === 0) {
    // One track holds everything: its channels are the parts a reader wants to tell apart.
    const notes = raw[0]!.notes
    const channels = [...new Set(notes.map((n) => n.channel))].sort((a, b) => a - b)
    tracks = channels.map((channel) => finishTrack(`Channel ${channel + 1}`, notes.filter((n) => n.channel === channel), events.programs))
  } else {
    tracks = raw.map((track, i) => finishTrack(track.name || track.instrument || `Track ${i + 1}`, track.notes, events.programs))
  }

  const lengthTicks = Math.max(0, ...raw.map((t) => t.endTick), ...tracks.map((t) => t.notes.reduce((last, n) => Math.max(last, n.tick + n.duration), 0)))
  const pitches = tracks.flatMap((t) => t.notes.length ? [t.notes.reduce((low, n) => Math.min(low, n.pitch), 127), t.notes.reduce((high, n) => Math.max(high, n.pitch), 0)] : [])
  const lastTempo = lastAt(tempos, lengthTicks)!
  return {
    format,
    title: raw[0]!.name,
    ticksPerQuarter,
    smpte: secondsPerSmpteTick !== null,
    tracks,
    tempos,
    meters,
    markers: events.markers.filter((m) => m.text).sort((a, b) => a.tick - b.tick),
    lengthTicks,
    durationSeconds: lastTempo.seconds + (lengthTicks - lastTempo.tick) * lastTempo.secondsPerTick,
    noteCount: tracks.reduce((sum, t) => sum + t.notes.length, 0),
    pitchRange: pitches.length ? { low: Math.min(...pitches), high: Math.max(...pitches) } : null,
    warnings: events.warnings,
  }
}

/** Seconds from the start of the file to `tick`. */
export function midiSeconds(file: MidiFile, tick: number): number {
  const tempo = lastAt(file.tempos, tick) ?? file.tempos[0]!
  return tempo.seconds + (tick - tempo.tick) * tempo.secondsPerTick
}

/** The bar and beat at `tick`, both counting from 1. */
export function midiBarAt(file: MidiFile, tick: number): { bar: number; beat: number } {
  const meter = lastAt(file.meters, tick) ?? file.meters[0]!
  const bars = Math.floor((tick - meter.tick) / meter.ticksPerBar)
  const inBar = tick - meter.tick - bars * meter.ticksPerBar
  return { bar: meter.bar + bars, beat: Math.floor(inBar / meter.ticksPerBeat) + 1 }
}

/** Where to start reading `track.notes` to meet every note still sounding at `tick`. */
export function midiFirstNoteAt(track: MidiTrack, tick: number): number {
  const earliest = tick - track.longestNote
  let low = 0
  let high = track.notes.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (track.notes[middle]!.tick < earliest) low = middle + 1
    else high = middle
  }
  return low
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
/** "C4" for 60, the convention where middle C is C4. */
export const midiNoteName = (pitch: number): string => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
export const midiIsBlackKey = (pitch: number): boolean => [1, 3, 6, 8, 10].includes(pitch % 12)

/** The General MIDI drum channel, 10 when counting from 1. */
export const DRUM_CHANNEL = 9

const GENERAL_MIDI = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Sawtooth Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead',
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  'Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-fi',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
]

/** What a note plays by General MIDI numbering. A soundfont may map programs differently. */
export const midiInstrumentName = (channel: number, program: number): string => (channel === DRUM_CHANNEL ? 'Drums' : (GENERAL_MIDI[program] ?? `Program ${program + 1}`))
