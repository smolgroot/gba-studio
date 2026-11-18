import { describe, expect, it } from 'vitest'
import { MidiError, midiBarAt, midiFirstNoteAt, midiInstrumentName, midiNoteName, midiSeconds, parseMidi } from '../src/index.ts'

const vlq = (value: number): number[] => {
  const out = [value & 0x7f]
  for (let rest = value >> 7; rest > 0; rest >>= 7) out.unshift((rest & 0x7f) | 0x80)
  return out
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const chunk = (name: string, body: number[]) => [...ascii(name), ...u32(body.length), ...body]
const END = [0, 0xff, 0x2f, 0]
const track = (...events: number[][]) => chunk('MTrk', [...events.flat(), ...END])
const meta = (delta: number, type: number, body: number[]) => [...vlq(delta), 0xff, type, ...vlq(body.length), ...body]
const on = (delta: number, pitch: number, velocity = 100, channel = 0) => [...vlq(delta), 0x90 | channel, pitch, velocity]
const off = (delta: number, pitch: number, channel = 0) => [...vlq(delta), 0x80 | channel, pitch, 0]
const file = (format: number, tracks: number[][], division = 96, declared = tracks.length) =>
  new Uint8Array([...chunk('MThd', [0, format, declared >> 8, declared & 255, division >> 8, division & 255]), ...tracks.flat()])

describe('parseMidi', () => {
  it('reads names, notes and the length of a multi-track file', () => {
    const midi = parseMidi(file(1, [
      track(meta(0, 3, ascii('Song'))),
      track(meta(0, 3, ascii('Lead')), [0, 0xc0, 80], on(0, 60), off(96, 60), on(0, 64, 50), off(48, 64)),
    ]))
    expect(midi.title).toBe('Song')
    expect(midi.tracks.map((t) => t.name)).toEqual(['Song', 'Lead'])
    expect(midi.tracks[1]!.notes).toEqual([
      { pitch: 60, velocity: 100, channel: 0, program: 80, tick: 0, duration: 96 },
      { pitch: 64, velocity: 50, channel: 0, program: 80, tick: 96, duration: 48 },
    ])
    expect(midi.tracks[1]!.programs).toEqual([80])
    expect(midi.lengthTicks).toBe(144)
    expect(midi.noteCount).toBe(2)
    expect(midi.pitchRange).toEqual({ low: 60, high: 64 })
    expect(midi.warnings).toEqual([])
  })

  it('follows running status and treats velocity 0 as a note off', () => {
    const midi = parseMidi(file(1, [track([0, 0x90, 60, 90], [10, 62, 80], [10, 60, 0], [10, 62, 0])]))
    expect(midi.tracks[0]!.notes.map((n) => [n.pitch, n.tick, n.duration])).toEqual([[60, 0, 20], [62, 10, 20]])
  })

  it('pairs a key held twice first in, first out', () => {
    const midi = parseMidi(file(1, [track(on(0, 60, 10), on(10, 60, 20), off(10, 60), off(10, 60))]))
    expect(midi.tracks[0]!.notes.map((n) => [n.velocity, n.tick, n.duration])).toEqual([[10, 0, 20], [20, 10, 20]])
  })

  it('splits a format 0 file by channel', () => {
    const midi = parseMidi(file(0, [track(on(0, 36, 100, 9), on(0, 60, 100, 2), off(10, 36, 9), off(0, 60, 2))]))
    expect(midi.tracks.map((t) => [t.name, t.channels])).toEqual([['Channel 3', [2]], ['Channel 10', [9]]])
  })

  it('gives a program change across tracks to the notes after it', () => {
    const midi = parseMidi(file(1, [track([0, 0xc0, 5], [96, 0xc0, 6]), track(on(0, 60), off(10, 60), on(86, 62), off(10, 62))]))
    expect(midi.tracks[1]!.notes.map((n) => n.program)).toEqual([5, 6])
  })

  it('times a file through its tempo changes', () => {
    const midi = parseMidi(file(1, [track(meta(0, 0x51, [0x07, 0xa1, 0x20]), meta(96, 0x51, [0x03, 0xd0, 0x90]), meta(96, 1, ascii('x')))]))
    expect(midi.tempos.map((t) => t.bpm)).toEqual([120, 240])
    expect(midiSeconds(midi, 96)).toBeCloseTo(0.5)
    expect(midiSeconds(midi, 192)).toBeCloseTo(0.75)
    expect(midi.durationSeconds).toBeCloseTo(0.75)
  })

  it('assumes 120 BPM and 4/4 when the file says nothing', () => {
    const midi = parseMidi(file(1, [track(on(0, 60), off(192, 60))]))
    expect(midi.durationSeconds).toBeCloseTo(1)
    expect(midi.meters[0]).toMatchObject({ tick: 0, bar: 1, numerator: 4, denominator: 4, ticksPerBar: 384 })
  })

  it('counts bars through a change of time signature', () => {
    // Two bars of 3/4 (576 ticks), then 6/8.
    const midi = parseMidi(file(1, [track(meta(0, 0x58, [3, 2, 24, 8]), meta(576, 0x58, [6, 3, 24, 8]))]))
    expect(midiBarAt(midi, 0)).toEqual({ bar: 1, beat: 1 })
    expect(midiBarAt(midi, 96 * 4)).toEqual({ bar: 2, beat: 2 })
    expect(midiBarAt(midi, 576)).toEqual({ bar: 3, beat: 1 })
    expect(midiBarAt(midi, 576 + 48 * 7)).toEqual({ bar: 4, beat: 2 })
  })

  it('starts a new bar after a time signature in the middle of one', () => {
    const midi = parseMidi(file(1, [track(meta(96, 0x58, [3, 2, 24, 8]))]))
    expect(midi.meters[1]).toMatchObject({ tick: 96, bar: 2 })
  })

  it('reads frame-based timing', () => {
    const midi = parseMidi(file(1, [track(on(0, 60), off(100, 60))], 0xe728)) // 25 fps, 40 ticks a frame
    expect(midi.smpte).toBe(true)
    expect(midi.durationSeconds).toBeCloseTo(0.1)
  })

  it('keeps what it can of a cut-off file, and closes its open notes', () => {
    const whole = file(1, [track(on(0, 60), off(10, 60), on(0, 62), [20, 0x80])])
    const cut = whole.slice(0, whole.length - END.length - 1)
    const midi = parseMidi(cut)
    expect(midi.tracks[0]!.notes.map((n) => [n.pitch, n.duration])).toEqual([[60, 10], [62, 20]])
    expect(midi.warnings.length).toBeGreaterThan(0)
  })

  it('skips blocks it does not know and reports a wrong track count', () => {
    const midi = parseMidi(file(1, [chunk('XFIH', [1, 2, 3]), track(on(0, 60), off(1, 60))], 96, 2))
    expect(midi.tracks).toHaveLength(1)
    expect(midi.warnings[0]).toMatch(/announces 2 tracks/)
  })

  it('refuses what is not MIDI', () => {
    expect(() => parseMidi(new Uint8Array(ascii('RIFF and then some bytes')))).toThrow(MidiError)
    expect(() => parseMidi(file(1, [track()], 0))).toThrow(MidiError)
    expect(() => parseMidi(file(1, []))).toThrow(/no tracks/)
  })
})

describe('midi helpers', () => {
  it('finds notes still sounding at a tick', () => {
    const midi = parseMidi(file(1, [track(on(0, 60), on(10, 62), off(10, 62), off(80, 60), on(100, 64), off(5, 64))]))
    const lead = midi.tracks[0]!
    expect(lead.longestNote).toBe(100)
    expect(midiFirstNoteAt(lead, 50)).toBe(0)
    expect(midiFirstNoteAt(lead, 150)).toBe(2)
  })

  it('names notes and instruments', () => {
    expect(midiNoteName(60)).toBe('C4')
    expect(midiNoteName(21)).toBe('A0')
    expect(midiNoteName(127)).toBe('G9')
    expect(midiInstrumentName(0, 0)).toBe('Acoustic Grand Piano')
    expect(midiInstrumentName(0, 127)).toBe('Gunshot')
    expect(midiInstrumentName(9, 0)).toBe('Drums')
  })
})
