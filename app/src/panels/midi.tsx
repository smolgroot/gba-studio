// A MIDI file as a piano roll: its tracks, notes, velocities, bars, tempo and markers.
// Read only. The roll is one canvas the size of the view, redrawn as the page scrolls
// behind it, so a long file costs no more than what is on screen.
import AddIcon from '@mui/icons-material/Add'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import RemoveIcon from '@mui/icons-material/Remove'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { DRUM_CHANNEL, MidiError, midiBarAt, midiFirstNoteAt, midiInstrumentName, midiIsBlackKey, midiNoteName, midiSeconds, parseMidi } from '@pecten-studio/core'
import type { MidiFile, MidiNote, MidiTrack } from '@pecten-studio/core'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fileUrl } from '../api.ts'
import { useStudio } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { Divider, Message, ToolButton } from './views.tsx'

const KEYS_WIDTH = ui(44)
const BARS_HEIGHT = ui(16)
const FLAGS_HEIGHT = ui(15)
const RULER_HEIGHT = BARS_HEIGHT + FLAGS_HEIGHT
const VELOCITY_HEIGHT = ui(40)
const END_MARGIN = 12
const PITCHES = 128
const MIN_ROW = 3
const MAX_ROW = 24
const MAX_QUARTER = 480
/** Browsers stop laying out elements somewhere past this width. */
const MAX_CONTENT_WIDTH = 16_000_000
const ZOOM_STEP = 1.25
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

const TRACK_COLOURS = ['#4c9ffe', '#f5a524', '#46c37b', '#e5637a', '#a78bfa', '#2fc6c6', '#e8d44d', '#f0803c', '#7bd14f', '#e879c9', '#7f9cf5', '#c9a27a']
const trackColour = (index: number) => TRACK_COLOURS[index % TRACK_COLOURS.length]!
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function formatTime(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function trackDetail(track: MidiTrack): string {
  if (track.notes.length === 0) return 'No notes'
  const channels = track.channels.length === 1 ? `Ch ${track.channels[0]! + 1}` : `${track.channels.length} channels`
  const [first, ...others] = track.programs
  const melodic = first === undefined ? null : midiInstrumentName(0, first) + (others.length ? ` +${others.length}` : '')
  const instrument = melodic ?? midiInstrumentName(DRUM_CHANNEL, 0)
  return `${channels} · ${instrument} · ${track.notes.length.toLocaleString()} ${track.notes.length === 1 ? 'note' : 'notes'}`
}

function summary(midi: MidiFile): string {
  const bpm = midi.tempos.map((t) => Math.round(t.bpm))
  const low = Math.min(...bpm)
  const high = Math.max(...bpm)
  const first = midi.meters[0]!
  return [
    midi.title,
    `${midi.tracks.length} ${midi.tracks.length === 1 ? 'track' : 'tracks'}`,
    `${midi.noteCount.toLocaleString()} ${midi.noteCount === 1 ? 'note' : 'notes'}`,
    midi.smpte ? 'frame timing' : low === high ? `${low} BPM` : `${low}–${high} BPM`,
    `${first.numerator}/${first.denominator}`,
    formatTime(midi.durationSeconds),
    midi.pitchRange && `${midiNoteName(midi.pitchRange.low)}–${midiNoteName(midi.pitchRange.high)}`,
  ].filter(Boolean).join(' · ')
}

/** Tempo, time signature and marker labels, one per tick that has any. */
function flagsOf(midi: MidiFile): Array<{ tick: number; label: string }> {
  const byTick = new Map<number, string[]>()
  const add = (tick: number, label: string) => byTick.set(tick, [...(byTick.get(tick) ?? []), label])
  if (!midi.smpte) for (const t of midi.tempos) add(t.tick, `♩${Math.round(t.bpm)}`)
  for (const m of midi.meters) add(m.tick, `${m.numerator}/${m.denominator}`)
  for (const m of midi.markers) add(m.tick, m.text)
  return [...byTick].sort(([a], [b]) => a - b).map(([tick, labels]) => ({ tick, label: labels.join(' · ') }))
}

/** Calls `visit` for each bar and beat line in the ticks shown, thinning them when they would crowd. */
function eachGridLine(midi: MidiFile, from: number, to: number, pxPerTick: number, visit: (tick: number, bar: number | null, labelled: boolean) => void) {
  midi.meters.forEach((meter, index) => {
    const start = Math.max(from, meter.tick)
    const end = Math.min(to, midi.meters[index + 1]?.tick ?? Infinity)
    if (start > end) return
    const barPx = meter.ticksPerBar * pxPerTick
    let lineStep = 1
    while (lineStep * barPx < 8) lineStep *= 2
    let labelStep = lineStep
    while (labelStep * barPx < ui(34)) labelStep *= 2
    const showBeats = lineStep === 1 && meter.ticksPerBeat * pxPerTick >= 10
    const first = Math.floor((start - meter.tick) / meter.ticksPerBar / lineStep) * lineStep
    for (let bar = first; meter.tick + bar * meter.ticksPerBar <= end; bar += lineStep) {
      const tick = meter.tick + bar * meter.ticksPerBar
      visit(tick, meter.bar + bar, bar % labelStep === 0)
      if (showBeats) for (let beat = 1; beat < meter.numerator; beat++) visit(tick + beat * meter.ticksPerBeat, null, false)
    }
  })
}

/** The file parsed; the last result stays while a changed file loads. */
function useMidi(path: string): { midi: MidiFile } | { error: string } | null {
  const revision = useStudio((s) => s.revision)
  const url = fileUrl(path, revision)
  const [result, setResult] = useState<{ midi: MidiFile } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new MidiError('the file could not be loaded')
        const midi = parseMidi(new Uint8Array(await response.arrayBuffer()))
        if (live) setResult({ midi })
      } catch (error) {
        if (live) setResult({ error: error instanceof MidiError ? error.message : 'the file could not be loaded' })
      }
    })()
    return () => {
      live = false
    }
  }, [url])
  return result
}

export function MidiView({ path }: { path: string }) {
  const result = useMidi(path)
  if (!result) return <Message>Reading {path}…</Message>
  if ('error' in result) return <Message>{path} cannot be shown: {result.error}.</Message>
  return <PianoRoll path={path} midi={result.midi} />
}

interface Zoom {
  /** Width of a quarter note, in pixels. */
  quarter: number
  /** Height of a key, in pixels. */
  row: number
}
interface Hover {
  track: number
  note: MidiNote
  x: number
  y: number
}

function PianoRoll({ path, midi }: { path: string; midi: MidiFile }) {
  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoomState] = useState<Zoom>({ quarter: 24, row: 10 })
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  // What the next wheel step builds on: several can arrive before React renders.
  const latestZoom = useRef(zoom)
  const pendingScroll = useRef<{ left?: number; top?: number } | null>(null)
  const fitted = useRef(false)
  const paint = useRef(() => {})
  const frame = useRef(0)
  const flags = useMemo(() => flagsOf(midi), [midi])

  const ppq = midi.ticksPerQuarter
  const length = Math.max(midi.lengthTicks, midi.meters[0]!.ticksPerBar)
  const quarters = length / ppq
  const maxQuarter = Math.min(MAX_QUARTER, MAX_CONTENT_WIDTH / quarters)
  const fitQuarter = Math.min(maxQuarter, Math.max(1, size.width - KEYS_WIDTH - END_MARGIN) / quarters)
  const contentWidth = Math.ceil(KEYS_WIDTH + quarters * zoom.quarter + END_MARGIN)
  const contentHeight = RULER_HEIGHT + PITCHES * zoom.row + VELOCITY_HEIGHT
  const rollHeight = size.height - RULER_HEIGHT - VELOCITY_HEIGHT

  const applyZoom = (next: Zoom, scroll: { left?: number; top?: number }) => {
    latestZoom.current = next
    pendingScroll.current = { ...pendingScroll.current, ...scroll }
    setZoomState(next)
  }
  const scrollNow = () => {
    const element = scroller.current!
    return { left: pendingScroll.current?.left ?? element.scrollLeft, top: pendingScroll.current?.top ?? element.scrollTop }
  }
  /** Changes the time scale, keeping the moment under `x` in place. */
  const zoomTime = (factor: number, x = KEYS_WIDTH + (size.width - KEYS_WIDTH) / 2) => {
    const current = latestZoom.current
    const quarter = clamp(current.quarter * factor, fitQuarter, maxQuarter)
    const at = (scrollNow().left + x - KEYS_WIDTH) / current.quarter
    applyZoom({ ...current, quarter }, { left: at * quarter - (x - KEYS_WIDTH) })
  }
  /** Changes the key height, keeping the key under `y` in place. */
  const zoomKeys = (step: number, y = RULER_HEIGHT + rollHeight / 2) => {
    const current = latestZoom.current
    const row = clamp(current.row + step, MIN_ROW, MAX_ROW)
    const at = (scrollNow().top + y - RULER_HEIGHT) / current.row
    applyZoom({ ...current, row }, { top: at * row - (y - RULER_HEIGHT) })
  }
  /** The whole length across the view, and the keys in use filling its height. */
  const fit = () => {
    const low = midi.pitchRange?.low ?? 48
    const high = midi.pitchRange?.high ?? 72
    const row = clamp(Math.floor(rollHeight / (high - low + 5)), MIN_ROW, MAX_ROW)
    const middle = PITCHES - 1 - (low + high) / 2 + 0.5
    applyZoom({ quarter: fitQuarter, row }, { left: 0, top: middle * row - rollHeight / 2 })
  }

  useLayoutEffect(() => {
    const element = scroller.current!
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The first fit waits for a size: a panel in a hidden tab has none.
  useLayoutEffect(() => {
    if (fitted.current || size.width === 0 || size.height === 0) return
    fitted.current = true
    fit()
  })

  useLayoutEffect(() => {
    const scroll = pendingScroll.current
    if (!scroll) return
    pendingScroll.current = null
    if (scroll.left !== undefined) scroller.current!.scrollLeft = scroll.left
    if (scroll.top !== undefined) scroller.current!.scrollTop = scroll.top
  }, [zoom])

  const order = midi.tracks.map((_, index) => index).filter((index) => !hidden.has(index) && index !== selected)
  if (selected !== null && midi.tracks[selected] && !hidden.has(selected)) order.push(selected)

  const noteAt = (x: number, y: number): Hover | null => {
    if (x < KEYS_WIDTH || y < RULER_HEIGHT || y >= size.height - VELOCITY_HEIGHT) return null
    const element = scroller.current!
    const pxPerTick = zoom.quarter / ppq
    const pitch = PITCHES - 1 - Math.floor((y - RULER_HEIGHT + element.scrollTop) / zoom.row)
    const tick = (x - KEYS_WIDTH + element.scrollLeft) / pxPerTick
    const slack = 2 / pxPerTick
    for (const index of [...order].reverse()) {
      const track = midi.tracks[index]!
      const first = midiFirstNoteAt(track, tick - slack)
      for (let i = first; i < track.notes.length && track.notes[i]!.tick <= tick; i++) {
        const note = track.notes[i]!
        if (note.pitch === pitch && tick <= note.tick + Math.max(note.duration, slack)) return { track: index, note, x, y }
      }
    }
    return null
  }

  useLayoutEffect(() => {
    paint.current = () => {
      const element = scroller.current
      const context = canvas.current?.getContext('2d')
      const { width, height } = size
      if (!element || !context || width === 0 || height === 0) return
      const ratio = window.devicePixelRatio || 1
      const target = canvas.current!
      if (target.width !== Math.round(width * ratio) || target.height !== Math.round(height * ratio)) {
        target.width = Math.round(width * ratio)
        target.height = Math.round(height * ratio)
      }
      const g = context
      g.setTransform(ratio, 0, 0, ratio, 0, 0)
      g.globalAlpha = 1
      g.textBaseline = 'middle'
      g.font = `${ui(9)}px ${FONT}`

      const left = element.scrollLeft
      const top = element.scrollTop
      const row = zoom.row
      const pxPerTick = zoom.quarter / ppq
      const rollBottom = height - VELOCITY_HEIGHT
      const xOf = (tick: number) => KEYS_WIDTH + tick * pxPerTick - left
      const yOf = (pitch: number) => RULER_HEIGHT + (PITCHES - 1 - pitch) * row - top
      const fromTick = left / pxPerTick
      const toTick = Math.min(length, (left + width - KEYS_WIDTH) / pxPerTick)
      const highestPitch = clamp(PITCHES - 1 - Math.floor(top / row), 0, PITCHES - 1)
      const lowestPitch = clamp(PITCHES - 1 - Math.floor((top + rollBottom - RULER_HEIGHT - 1) / row), 0, PITCHES - 1)
      const clip = (x: number, y: number, w: number, h: number, draw: () => void) => {
        g.save()
        g.beginPath()
        g.rect(x, y, w, h)
        g.clip()
        draw()
        g.restore()
      }

      g.fillStyle = '#161616'
      g.fillRect(0, 0, width, height)

      // Key rows, then the bar and beat lines over the roll and the velocity lane.
      clip(KEYS_WIDTH, RULER_HEIGHT, width - KEYS_WIDTH, rollBottom - RULER_HEIGHT, () => {
        for (let pitch = lowestPitch; pitch <= highestPitch; pitch++) {
          const y = yOf(pitch)
          g.fillStyle = midiIsBlackKey(pitch) ? '#1b1b1b' : '#222222'
          g.fillRect(KEYS_WIDTH, y, width, row)
          g.fillStyle = pitch % 12 === 0 ? '#3d3d3d' : '#191919'
          g.fillRect(KEYS_WIDTH, y + row - 1, width, 1)
        }
      })
      g.fillStyle = '#1c1c1c'
      g.fillRect(KEYS_WIDTH, rollBottom, width, VELOCITY_HEIGHT)
      const barLabels: Array<{ x: number; bar: number }> = []
      clip(KEYS_WIDTH, RULER_HEIGHT, width - KEYS_WIDTH, height - RULER_HEIGHT, () => {
        eachGridLine(midi, fromTick, toTick, pxPerTick, (tick, bar, labelled) => {
          const x = Math.round(xOf(tick))
          g.fillStyle = bar === null ? '#2a2a2a' : '#454545'
          g.fillRect(x, RULER_HEIGHT, 1, height - RULER_HEIGHT)
          if (bar !== null && labelled) barLabels.push({ x, bar })
        })
        // The end of the file.
        g.fillStyle = '#6a6a6a'
        g.fillRect(Math.round(xOf(length)), RULER_HEIGHT, 1, height - RULER_HEIGHT)
      })

      // Notes and their velocities; a selected track stays bright and the others step back.
      const alphaOf = (index: number, note: MidiNote) => (selected !== null && index !== selected ? 0.22 : 1) * (0.5 + (0.5 * note.velocity) / 127)
      const eachVisibleNote = (visit: (note: MidiNote, index: number) => void) => {
        for (const index of order) {
          const track = midi.tracks[index]!
          g.fillStyle = trackColour(index)
          for (let i = midiFirstNoteAt(track, fromTick); i < track.notes.length; i++) {
            const note = track.notes[i]!
            if (note.tick > toTick) break
            if (note.tick + note.duration >= fromTick) visit(note, index)
          }
        }
      }
      clip(KEYS_WIDTH, RULER_HEIGHT, width - KEYS_WIDTH, rollBottom - RULER_HEIGHT, () => {
        eachVisibleNote((note, index) => {
          if (note.pitch < lowestPitch || note.pitch > highestPitch) return
          g.globalAlpha = alphaOf(index, note)
          g.fillRect(xOf(note.tick), yOf(note.pitch), Math.max(2, note.duration * pxPerTick - 1), Math.max(2, row - 1))
        })
        g.globalAlpha = 1
        if (hover) {
          g.strokeStyle = '#ffffff'
          g.lineWidth = 1
          g.strokeRect(xOf(hover.note.tick) - 0.5, yOf(hover.note.pitch) - 0.5, Math.max(2, hover.note.duration * pxPerTick - 1) + 1, Math.max(2, row - 1) + 1)
        }
      })
      clip(KEYS_WIDTH, rollBottom, width - KEYS_WIDTH, VELOCITY_HEIGHT, () => {
        const full = VELOCITY_HEIGHT - 5
        eachVisibleNote((note, index) => {
          const stem = (note.velocity / 127) * full
          g.globalAlpha = alphaOf(index, note)
          g.fillRect(xOf(note.tick), height - stem, 2, stem)
        })
        g.globalAlpha = 1
      })
      g.fillStyle = '#000000'
      g.fillRect(0, rollBottom, width, 1)

      // The keyboard.
      clip(0, RULER_HEIGHT, KEYS_WIDTH, rollBottom - RULER_HEIGHT, () => {
        g.fillStyle = '#d6d6d6'
        g.fillRect(0, RULER_HEIGHT, KEYS_WIDTH, rollBottom - RULER_HEIGHT)
        g.textAlign = 'right'
        for (let pitch = lowestPitch; pitch <= highestPitch; pitch++) {
          const y = yOf(pitch)
          const lit = hover?.note.pitch === pitch
          if (midiIsBlackKey(pitch)) {
            g.fillStyle = lit ? trackColour(hover.track) : '#2b2b2b'
            g.fillRect(0, y, KEYS_WIDTH * 0.6, row)
          } else {
            if (lit) {
              g.fillStyle = trackColour(hover.track)
              g.fillRect(0, y, KEYS_WIDTH, row)
            }
            g.fillStyle = '#9c9c9c'
            g.fillRect(0, y + row - 1, KEYS_WIDTH, 1)
          }
          if (pitch % 12 === 0 || lit) {
            g.fillStyle = '#202020'
            g.fillText(midiNoteName(pitch), KEYS_WIDTH - 3, y + row / 2)
          }
        }
      })
      g.fillStyle = '#000000'
      g.fillRect(KEYS_WIDTH - 1, RULER_HEIGHT, 1, height - RULER_HEIGHT)

      // The ruler: bar numbers above; tempo, time signature and markers below.
      g.fillStyle = '#262626'
      g.fillRect(0, 0, width, RULER_HEIGHT)
      g.fillStyle = '#000000'
      g.fillRect(0, RULER_HEIGHT - 1, width, 1)
      clip(KEYS_WIDTH, 0, width - KEYS_WIDTH, RULER_HEIGHT, () => {
        g.textAlign = 'left'
        for (const { x, bar } of barLabels) {
          g.fillStyle = '#5a5a5a'
          g.fillRect(x, 0, 1, BARS_HEIGHT)
          g.fillStyle = '#c4c4c4'
          g.fillText(String(bar), x + 3, BARS_HEIGHT / 2)
        }
        let free = -Infinity
        for (const { tick, label } of flags) {
          const x = xOf(tick)
          const end = x + g.measureText(label).width + 8
          if (end < KEYS_WIDTH || x > width || x < free) continue
          g.fillStyle = '#f5a524'
          g.fillRect(x, BARS_HEIGHT, 1, FLAGS_HEIGHT - 1)
          g.fillText(label, x + 3, BARS_HEIGHT + FLAGS_HEIGHT / 2)
          free = end
        }
      })
      g.fillStyle = '#1c1c1c'
      g.fillRect(0, 0, KEYS_WIDTH - 1, RULER_HEIGHT - 1)
      g.fillRect(0, rollBottom + 1, KEYS_WIDTH - 1, VELOCITY_HEIGHT)
      g.fillStyle = '#9a9a9a'
      g.textAlign = 'left'
      g.fillText('Bar', 5, BARS_HEIGHT / 2)
      g.fillText('Vel', 5, rollBottom + VELOCITY_HEIGHT / 2)
    }
    paint.current()
  })

  // Ctrl + wheel zooms time, and with Shift the keys, around the pointer.
  const onWheel = useRef<(event: WheelEvent) => void>(() => {})
  useLayoutEffect(() => {
    onWheel.current = (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const box = canvas.current!.getBoundingClientRect()
      const delta = event.deltaY || event.deltaX
      if (event.shiftKey) zoomKeys(delta < 0 ? 1 : -1, clamp(event.clientY - box.top, RULER_HEIGHT, size.height - VELOCITY_HEIGHT))
      else zoomTime(delta < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, clamp(event.clientX - box.left, KEYS_WIDTH, size.width))
    }
  })
  useEffect(() => {
    const element = scroller.current!
    const listener = (event: WheelEvent) => onWheel.current(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => {
      element.removeEventListener('wheel', listener)
      cancelAnimationFrame(frame.current)
    }
  }, [])

  const toggleHidden = (index: number) => {
    setHover(null)
    setHidden((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }
  const hoverTrack = hover && midi.tracks[hover.track]

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, minHeight: BAR.tool, flexShrink: 0, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        <ToolButton title="Fit the whole file" onClick={fit}><FitScreenIcon /></ToolButton>
        <Divider />
        <Typography variant="body2" color="text.secondary">Time</Typography>
        <ToolButton title="Narrower (Ctrl + wheel)" disabled={zoom.quarter <= fitQuarter} onClick={() => zoomTime(1 / ZOOM_STEP)}><RemoveIcon /></ToolButton>
        <ToolButton title="Wider (Ctrl + wheel)" disabled={zoom.quarter >= maxQuarter} onClick={() => zoomTime(ZOOM_STEP)}><AddIcon /></ToolButton>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>Keys</Typography>
        <ToolButton title="Shorter keys (Ctrl + Shift + wheel)" disabled={zoom.row <= MIN_ROW} onClick={() => zoomKeys(-1)}><RemoveIcon /></ToolButton>
        <ToolButton title="Taller keys (Ctrl + Shift + wheel)" disabled={zoom.row >= MAX_ROW} onClick={() => zoomKeys(1)}><AddIcon /></ToolButton>
        <Typography variant="body2" color="text.secondary" noWrap title={summary(midi)} sx={{ ml: 2, flex: 1, minWidth: 0 }}>{summary(midi)}</Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
        <Box sx={{ flexShrink: 0, overflow: 'auto', width: { xs: 'auto', md: ui(200) }, maxHeight: { xs: '30%', md: 'none' }, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: { xs: 'divider', md: 'divider' } }}>
          <List aria-label="Tracks">
            {midi.tracks.map((track, index) => {
              const empty = track.notes.length === 0
              const off = hidden.has(index)
              return (
                <Box component="li" key={index} sx={{ display: 'flex', alignItems: 'center', listStyle: 'none', opacity: off || empty ? 0.5 : 1 }}>
                  <ListItemButton
                    selected={selected === index}
                    disabled={empty}
                    aria-pressed={selected === index}
                    title={`${track.name}: ${trackDetail(track)}`}
                    onClick={() => setSelected(selected === index ? null : index)}
                    sx={{ flex: 1, minWidth: 0, gap: 1, px: 1, '&.Mui-disabled': { opacity: 1 } }}
                  >
                    <Box sx={{ width: ui(8), height: ui(8), borderRadius: '2px', flexShrink: 0, bgcolor: empty ? 'transparent' : trackColour(index), border: empty ? '1px solid #5a5a5a' : 'none' }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap>{track.name}</Typography>
                      <Typography variant="caption" component="div" color="text.secondary" noWrap>{trackDetail(track)}</Typography>
                    </Box>
                  </ListItemButton>
                  {!empty && (
                    <IconButton aria-label={`${off ? 'Show' : 'Hide'} ${track.name}`} aria-pressed={off} onClick={() => toggleHidden(index)} sx={{ mr: 0.5 }}>
                      {off ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
                    </IconButton>
                  )}
                </Box>
              )
            })}
          </List>
          {midi.warnings.map((warning) => <Typography key={warning} variant="body2" color="warning.main" sx={{ px: 1.5, py: 0.75 }}>{warning}</Typography>)}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
          <Box
            ref={scroller}
            tabIndex={0}
            aria-label={`Piano roll of ${path}. Scroll to move through it.`}
            onScroll={() => {
              setHover(null)
              cancelAnimationFrame(frame.current)
              frame.current = requestAnimationFrame(() => paint.current())
            }}
            sx={{ position: 'absolute', inset: 0, overflow: 'auto', bgcolor: '#161616', '&:focus-visible': { outline: '1px solid', outlineColor: 'primary.main', outlineOffset: -1 } }}
          >
            <Box sx={{ width: contentWidth, height: contentHeight, minWidth: '100%', minHeight: '100%' }}>
              <canvas
                ref={canvas}
                role="img"
                aria-label={summary(midi)}
                onPointerMove={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  const found = noteAt(event.clientX - box.left, event.clientY - box.top)
                  if (found?.note !== hover?.note) setHover(found)
                }}
                onPointerLeave={() => setHover(null)}
                style={{ position: 'sticky', left: 0, top: 0, display: 'block', width: size.width, height: size.height }}
              />
            </Box>
          </Box>
          {midi.noteCount === 0 && (
            <Typography color="text.secondary" sx={{ position: 'absolute', top: '50%', left: KEYS_WIDTH, right: 0, textAlign: 'center', pointerEvents: 'none' }}>This file has no notes.</Typography>
          )}
          {hover && hoverTrack && (
            <Box
              role="status"
              sx={{
                position: 'absolute',
                pointerEvents: 'none',
                maxWidth: ui(230),
                px: 1.5,
                py: 0.75,
                borderRadius: 1,
                border: '1px solid #3a3a3a',
                bgcolor: 'background.paper',
                ...(hover.x > size.width - ui(240) ? { right: size.width - hover.x + 12 } : { left: hover.x + 12 }),
                ...(hover.y > size.height - ui(90) ? { bottom: size.height - hover.y + 12 } : { top: hover.y + 14 }),
              }}
            >
              <Typography noWrap>{midiNoteName(hover.note.pitch)} · velocity {hover.note.velocity}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>{hoverTrack.name} · {hover.note.channel === DRUM_CHANNEL ? 'Drums' : midiInstrumentName(hover.note.channel, hover.note.program)} · ch {hover.note.channel + 1}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                Bar {midiBarAt(midi, hover.note.tick).bar}.{midiBarAt(midi, hover.note.tick).beat} · {(midiSeconds(midi, hover.note.tick + hover.note.duration) - midiSeconds(midi, hover.note.tick)).toFixed(2)} s long
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
