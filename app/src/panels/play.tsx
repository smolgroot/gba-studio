// Build and Play: run the project's build, read its log, and play the ROM it made in
// the browser on the Pecten emulator core.
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import StopIcon from '@mui/icons-material/Stop'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyLive, indexSection, liveTaken, pickAt, planLiveApply, readDebugMap, readLive, rowBox, rowKey, startAt } from '@pecten-studio/core'
import type { DebugMap, LiveView, SectionIndex, StartSpot } from '@pecten-studio/core'
import { api, fileUrl } from '../api.ts'
import type { PatchResult, RomInfo, ToolchainReport } from '../api.ts'
import { dataUseLine } from '../datause.ts'
import { Checkbox } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { EntityList } from './inspector.tsx'
import type { RowKey } from './inspector.tsx'
import { Message } from './views.tsx'

/** What the entity list reads a ROM with: its debug map and level data, or why it cannot. */
interface Inspectable {
  map: DebugMap | null
  section: SectionIndex | null
  message: string | null
}

function inspectable(bytes: Uint8Array): Inspectable {
  const found = readDebugMap(bytes)
  if (!found) return { map: null, section: null, message: 'This ROM has no debug map, as release builds do not: play the dev ROM to see its entities.' }
  if ('problem' in found) return { map: null, section: null, message: `The entity list cannot read this ROM: ${found.problem}.` }
  return { map: found.map, section: indexSection(bytes), message: null }
}

/** Says what this folder still needs before it can build, and offers to set up its crate. */
function BuildSetup() {
  const [report, setReport] = useState<ToolchainReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => api.toolchain().then(setReport).catch(() => undefined), [])
  useEffect(() => void refresh(), [refresh])

  const missing = report?.items.filter((item) => !item.ok) ?? []
  if (!report || (report.hasCrate && missing.length === 0)) return null
  const setUp = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.setupCrate()
      await refresh()
      await useStudio.getState().load()
    } catch (problem) {
      setError((problem as Error).message)
    }
    setBusy(false)
  }
  return (
    <Box sx={{ px: 2, py: 1, display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '1px solid #111' }}>
      {!report.hasCrate && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">This folder has no game crate yet, so there is nothing to build.</Typography>
          {report.canSetUp && <Button variant="outlined" disabled={busy} onClick={() => void setUp()}>Set up game crate</Button>}
        </Box>
      )}
      {missing.map((item) => (
        <Typography key={item.name} variant="body2" color="warning.main">
          {item.name} is missing. Install it with: <Box component="code" sx={{ userSelect: 'all', color: 'text.primary' }}>{item.install}</Box>
        </Typography>
      ))}
      {missing.length > 0 && <Box><Button variant="text" onClick={() => void refresh()}>Check again</Button></Box>}
      {error && <Typography variant="body2" color="error" role="alert">{error}</Typography>}
    </Box>
  )
}

/** How much of each built ROM's level data section is used: see design/US-006.md. */
function DataUse({ roms }: { roms: Partial<Record<'dev' | 'release', RomInfo>> }) {
  const lines = (['dev', 'release'] as const).flatMap((mode) => (roms[mode] ? [{ mode, ...dataUseLine(mode, roms[mode].data) }] : []))
  if (!lines.length) return null
  return (
    <Box sx={{ px: 2, py: 0.75, borderBottom: '1px solid #111' }}>
      {lines.map((line) => (
        <Typography key={line.mode} variant="body2" color={line.warning ? 'warning.main' : 'text.secondary'} title={line.warning ? 'Little room is left: an edit that adds data may need a full build. Raise the level data reserve in Project settings, then build.' : undefined}>
          {line.text}
        </Typography>
      ))}
    </Box>
  )
}

/** Build buttons, status line and the streamed log. */
export function BuildPanel() {
  const build = useStudio((s) => s.build)
  const runBuild = useStudio((s) => s.runBuild)
  const stopBuild = useStudio((s) => s.stopBuild)
  const select = useStudio((s) => s.select)
  const ready = useStudio((s) => !!s.bundle?.docs.project)
  const log = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Follow the output, unless it was scrolled up to read.
  useEffect(() => {
    const element = log.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [build?.log.length])

  const status = !build
    ? ''
    : build.running
      ? `Building (${build.mode})…`
      : build.stopped
        ? 'Build stopped'
        : build.exitCode === null
          ? ''
          : build.exitCode === 0
            ? `Build finished in ${build.seconds}s`
            : `Build failed (exit ${build.exitCode}) after ${build.seconds}s`
  const failed = !!build && !build.running && !build.stopped && build.exitCode !== null && build.exitCode !== 0
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, flexWrap: 'wrap', borderBottom: '1px solid #111' }}>
        <Button variant="contained" disabled={!ready || build?.running} onClick={() => void runBuild('dev')}>Build dev</Button>
        <Button variant="outlined" disabled={!ready || build?.running} onClick={() => void runBuild('release')}>Build release</Button>
        <Button variant="outlined" color="error" startIcon={<StopIcon />} disabled={!build?.running} onClick={() => void stopBuild()}>Stop</Button>
        <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => select({ kind: 'play' })}>Play…</Button>
        <Typography color={failed ? 'error' : 'text.secondary'} noWrap sx={{ flex: 1, minWidth: 0 }}>{status}</Typography>
      </Box>
      <BuildSetup />
      <DataUse roms={build?.roms ?? {}} />
      <Box
        ref={log}
        onScroll={(event) => {
          const el = event.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: ui(11), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', bgcolor: '#161616' }}
      >
        {build?.command && <Box sx={{ color: 'text.secondary' }}>$ {build.command}</Box>}
        {build?.log.map((line, i) => (
          <Box key={i} sx={{ color: /^\s*(error|\x1b\[31)/.test(line) ? 'error.main' : /^\s*warning/.test(line) ? 'warning.main' : 'text.primary' }}>{line}</Box>
        ))}
        {!build?.command && <Typography variant="body2" color="text.secondary">No build has run in this session. The commands are set in Project settings.</Typography>}
      </Box>
    </Box>
  )
}

const GBA_FRAME_MS = (1000 * 280_896) / 16_777_216
const KEYS: Record<string, number> = { KeyX: 1, KeyZ: 2, ShiftLeft: 4, ShiftRight: 4, Enter: 8, ArrowRight: 16, ArrowLeft: 32, ArrowUp: 64, ArrowDown: 128, KeyS: 256, KeyA: 512 }
const WORKLET = `
class P extends AudioWorkletProcessor {
  constructor() { super(); this.q = []; this.pos = 0; this.n = 0
    this.port.onmessage = (e) => { this.q.push(e.data); this.n += e.data.length / 2; while (this.n > 12000) { this.n -= this.q.shift().length / 2; this.pos = 0 } } }
  process(_i, outputs) {
    const [l, r] = outputs[0]
    for (let i = 0; i < l.length; i++) {
      const b = this.q[0]
      if (!b) { l[i] = 0; if (r) r[i] = 0; continue }
      l[i] = b[this.pos]; if (r) r[i] = b[this.pos + 1]
      this.pos += 2; this.n--
      if (this.pos >= b.length) { this.q.shift(); this.pos = 0 }
    }
    return true
  }
}
registerProcessor('gba-audio', P)
`

interface Emulator {
  step_frame: () => Uint8Array
  set_pressed_keys: (keys: number) => void
  take_audio_samples: () => Int16Array
  audio_sample_rate: () => number
  read_ram: (addr: number, len: number) => Uint8Array
  write_ram: (addr: number, data: Uint8Array) => void
  patch_rom: (offset: number, data: Uint8Array) => void
  free: () => void
}

/** Frames a game has to take a live change before it is restarted with the new ROM instead. */
const LIVE_PATIENCE = 30
type PectenModule = { default: () => Promise<unknown>; WasmEmulator: new (rom: Uint8Array, bootIntro: boolean) => Emulator }

let pecten: Promise<PectenModule> | undefined
function loadPecten(): Promise<PectenModule> {
  pecten ??= (async () => {
    const mod = (await import(/* @vite-ignore */ new URL('/wasm/pecten.js', location.origin).href)) as PectenModule
    await mod.default()
    return mod
  })()
  pecten.catch(() => (pecten = undefined))
  return pecten
}

function TouchButton({ label, bit, keys, update, round }: { label: string; bit: number; keys: React.RefObject<number>; update: () => void; round?: boolean }) {
  const hold = (down: boolean) => {
    keys.current = down ? keys.current | bit : keys.current & ~bit
    update()
  }
  return (
    <Box
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); hold(true) }}
      onPointerUp={() => hold(false)}
      onPointerCancel={() => hold(false)}
      onContextMenu={(event) => event.preventDefault()}
      sx={{ touchAction: 'none', userSelect: 'none', display: 'grid', placeItems: 'center', minWidth: 48, height: 48, px: 1.5, bgcolor: '#333', border: '1px solid #555', borderRadius: round ? '50%' : '6px', fontSize: 13, color: 'text.primary', '&:active': { bgcolor: '#4c9ffe' } }}
    >
      {label}
    </Box>
  )
}

/**
 * The emulator: runs a ROM from the game folder, restarting it when the file is
 * rebuilt. When only level data changed (a patch), Live apply puts it into the game
 * that is running instead: see design/US-003.md.
 */
export function PlayView() {
  const build = useStudio((s) => s.build)
  const roms = build?.roms ?? {}
  const [mode, setMode] = useState<'dev' | 'release'>('dev')
  const rom: RomInfo | undefined = roms[mode] ?? roms.dev ?? roms.release
  const revision = useStudio((s) => s.revision)
  const canvas = useRef<HTMLCanvasElement>(null)
  const keys = useRef(0)
  const emulator = useRef<Emulator | null>(null)
  const audio = useRef<{ context: AudioContext; node: AudioWorkletNode } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [restarts, setRestarts] = useState(0)
  const [autoRestart, setAutoRestart] = useState(true)
  const [patchOnChange, setPatchOnChange] = useState(true)
  const [liveApply, setLiveApply] = useState(true)
  /** What became of the last ROM change: applied live, or why the game restarted. */
  const [applied, setApplied] = useState<string | null>(null)
  /** The ROM the emulator is running, as live apply changed it. */
  const loadedBytes = useRef<Uint8Array | null>(null)
  /** A live change the game has not taken yet, and the frames it has left to. */
  const pendingLive = useRef<{ map: DebugMap; generation: number; frames: number; rom: RomInfo } | null>(null)
  /** Where the game was asked to start ("Play from here"), kept for restarts the studio makes itself. */
  const startSpot = useRef<StartSpot | null>(null)
  const [startNote, setStartNote] = useState<string | null>(null)
  const playFrom = useStudio((s) => s.playFrom)
  const clearPlayFrom = useStudio((s) => s.clearPlayFrom)
  const [patch, setPatch] = useState<PatchResult | null>(null)
  const patchedRevision = useRef(revision)
  const building = build?.running ?? false
  const [sound, setSound] = useState(false)
  const loadedModified = useRef(0)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  // The entity list: what the running ROM can be read with, and the last frame read.
  const inspecting = useRef<Inspectable>({ map: null, section: null, message: null })
  const [inspectMessage, setInspectMessage] = useState<string | null>(null)
  const [live, setLive] = useState<LiveView | null>(null)
  const liveRef = useRef<LiveView | null>(null)
  const [selected, setSelected] = useState<RowKey | null>(null)
  const selectedRef = useRef<RowKey | null>(null)
  selectedRef.current = selected
  const [showEntities, setShowEntities] = useState(true)
  const showEntitiesRef = useRef(showEntities)
  showEntitiesRef.current = showEntities
  const readWith = (bytes: Uint8Array) => {
    inspecting.current = inspectable(bytes)
    setInspectMessage(inspecting.current.message)
  }

  // Start on request, and again when the ROM file changes while following builds.
  const start = useCallback(async (info: RomInfo) => {
    setError(null)
    try {
      const [mod, response] = await Promise.all([loadPecten(), fetch(fileUrl(info.path, info.modified))])
      if (!response.ok) throw new Error(`cannot read ${info.path}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      emulator.current?.free()
      emulator.current = new mod.WasmEmulator(bytes, false)
      loadedBytes.current = bytes
      readWith(bytes)
      liveRef.current = null
      setLive(null)
      pendingLive.current = null
      loadedModified.current = info.modified
      // Before the first frame, so the game reads the spot as it begins.
      const spot = startSpot.current
      if (spot) {
        const found = readDebugMap(bytes)
        const problem = startAt(emulator.current, found && 'map' in found ? found.map : null, Object.keys(useStudio.getState().bundle?.docs.rooms ?? {}), spot)
        if (problem) {
          startSpot.current = null
          setStartNote(null)
          throw new Error(`Cannot play from here: ${problem.problem}.`)
        }
        setStartNote(`Started in room “${spot.room}” at ${spot.x}, ${spot.y}.`)
      } else setStartNote(null)
      setRunning(true)
    } catch (e) {
      setError((e as Error).message)
      setRunning(false)
    }
  }, [])
  // A changed ROM goes into the running game when only its level data changed;
  // anything else restarts it. Runs between frames, as every callback here does.
  const update = useCallback(async (info: RomInfo) => {
    const core = emulator.current
    const running = loadedBytes.current
    if (!core || !running) return start(info)
    try {
      loadedModified.current = info.modified
      const response = await fetch(fileUrl(info.path, info.modified))
      if (!response.ok) throw new Error(`cannot read ${info.path}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (emulator.current !== core) return
      const plan = planLiveApply(running, bytes)
      if (plan.kind === 'same') return
      if (plan.kind === 'restart') {
        setApplied(`Restarted: ${plan.reason}.`)
        return start(info)
      }
      const generation = applyLive(core, plan)
      loadedBytes.current = bytes
      // Entities may have new numbers, types or properties: name them from the new data.
      readWith(bytes)
      pendingLive.current = { map: plan.map, generation, frames: LIVE_PATIENCE, rom: info }
      setApplied(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [start])
  // "Play from here" in the map editor: start again at its spot.
  useEffect(() => {
    if (!playFrom || !rom) return
    startSpot.current = playFrom.spot
    clearPlayFrom()
    void start(rom)
  }, [playFrom, rom, start, clearPlayFrom])
  const romPath = rom?.path
  const romModified = rom?.modified
  useEffect(() => {
    if (running && autoRestart && rom && rom.modified !== loadedModified.current) void (liveApply ? update(rom) : start(rom))
  }, [rom, running, autoRestart, liveApply, start, update, revision])

  // While the game runs, each saved change puts the level data into the ROM, which
  // restarts it as above. What cannot go in that way says why and offers a build.
  useEffect(() => {
    if (!running || !patchOnChange || building || revision === patchedRevision.current) return
    const timer = setTimeout(() => {
      patchedRevision.current = revision
      api.patch(mode).then(
        (result) => setPatch((last) => (result.status === 'unchanged' && last?.status === 'patched' ? last : result)),
        (e: Error) => setError(e.message),
      )
    }, 150)
    return () => clearTimeout(timer)
  }, [revision, running, patchOnChange, building, mode])
  useEffect(() => {
    if (building) setPatch(null)
  }, [building])

  // The frame loop, paced by the display clock at the console's 59.73 Hz.
  useEffect(() => {
    if (!running) return
    const context2d = canvas.current!.getContext('2d')!
    let next = performance.now()
    let request = 0
    const tick = (now: number) => {
      const core = emulator.current
      if (core) {
        try {
          let stepped = 0
          for (let n = 0; n < 4 && now >= next - 2; n++) {
            stepped++
            core.set_pressed_keys(keys.current)
            const pixels = core.step_frame()
            const pending = pendingLive.current
            if (pending) {
              if (liveTaken(core, pending.map, pending.generation)) {
                pendingLive.current = null
                setApplied('Applied live.')
              } else if (--pending.frames <= 0) {
                // The game does not read its inbox (made before live apply, or it does
                // not call debug::Live::poll): it would go on with the old data.
                pendingLive.current = null
                setApplied('Restarted: the game did not take the change live.')
                void start(pending.rom)
                break
              }
            }
            context2d.putImageData(new ImageData(new Uint8ClampedArray(pixels), 240, 160), 0, 0)
            const samples = core.take_audio_samples()
            if (audio.current && samples.length) {
              const floats = new Float32Array(samples.length)
              for (let i = 0; i < samples.length; i++) floats[i] = samples[i]! / 32768
              audio.current.node.port.postMessage(floats, [floats.buffer])
            }
            next += GBA_FRAME_MS
          }
          if (now - next > 250) next = now
          // The list, read once the frames due are done: one read a frame at the
          // console's pace, and React sees only the last of a catch-up.
          const { map, section } = inspecting.current
          if (stepped && map && showEntitiesRef.current && emulator.current === core) {
            const view = readLive(core, map, section)
            liveRef.current = view
            setLive(view)
            const row = view.state === 'running' ? view.rows.find((r) => rowKey(r) === selectedRef.current) : undefined
            if (row && view.state === 'running') {
              // The selected one's box, outlined on the screen so a pick can be seen.
              const [x, y, w, h] = rowBox(row)
              context2d.strokeStyle = '#4c9ffe'
              context2d.strokeRect(x - view.camera.x + 0.5, y - view.camera.y + 0.5, Math.max(w - 1, 1), Math.max(h - 1, 1))
            }
          }
        } catch (e) {
          setError(`The emulator stopped: ${(e as Error).message}`)
          setRunning(false)
          return
        }
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [running, restarts])

  useEffect(() => {
    const down = (event: KeyboardEvent, on: boolean) => {
      const bit = KEYS[event.code]
      if (bit === undefined || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return
      keys.current = on ? keys.current | bit : keys.current & ~bit
      event.preventDefault()
    }
    const onDown = (event: KeyboardEvent) => down(event, true)
    const onUp = (event: KeyboardEvent) => down(event, false)
    const release = () => (keys.current = 0)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', release)
      emulator.current?.free()
      emulator.current = null
      void audio.current?.context.close()
      audio.current = null
    }
  }, [])

  const enableSound = async () => {
    const core = emulator.current
    if (!core || audio.current) return
    try {
      const context = new AudioContext({ sampleRate: core.audio_sample_rate() })
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
      await context.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const node = new AudioWorkletNode(context, 'gba-audio', { outputChannelCount: [2] })
      node.connect(context.destination)
      audio.current = { context, node }
      setSound(true)
    } catch (e) {
      setError(`Sound is not available here: ${(e as Error).message}`)
    }
  }
  const forceUpdate = () => undefined

  if (!rom) {
    return <Message>No ROM has been built yet. Run “Build dev” in the Build panel; the ROM path is set in Project settings.</Message>
  }
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, p: 2, overflow: 'auto', bgcolor: '#161616' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => { startSpot.current = null; void start(rom) }}>{running ? 'Restart' : 'Play'}</Button>
        <Button variant="outlined" startIcon={<RestartAltIcon />} disabled={!running} onClick={() => { startSpot.current = null; setRestarts((n) => n + 1); void start(rom) }}>Reset</Button>
        {roms.dev && roms.release && (
          <Button variant="outlined" onClick={() => { setMode(mode === 'dev' ? 'release' : 'dev'); setRunning(false) }}>ROM: {mode}</Button>
        )}
        <Button variant="outlined" disabled={!running || sound} onClick={() => void enableSound()}>{sound ? 'Sound on' : 'Sound'}</Button>
        <Checkbox checked={autoRestart} onChange={setAutoRestart}>Restart on rebuild</Checkbox>
        <Checkbox checked={patchOnChange} onChange={setPatchOnChange}>Patch on change</Checkbox>
        <Checkbox checked={liveApply} onChange={setLiveApply}>Live apply</Checkbox>
        <Checkbox checked={showEntities} onChange={setShowEntities}>Entities</Checkbox>
      </Box>
      <Typography variant="body2" color="text.secondary">{romPath} · {(rom.size / 1024).toFixed(0)} KB · built {new Date(romModified ?? 0).toLocaleTimeString()}</Typography>
      {startNote && <Typography variant="body2" color="text.secondary">{startNote} Play or Reset starts from the start room.</Typography>}
      {error && <Typography color="error" role="alert">{error}</Typography>}
      {patch?.status === 'patched' && (
        <Typography variant="body2" color="text.secondary">Patched in {patch.ms} ms · level data {patch.used.toLocaleString()} of {patch.capacity.toLocaleString()} bytes{applied ? ` · ${applied}` : ''}</Typography>
      )}
      {patch?.status === 'needs-build' && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Typography variant="body2" color="warning.main">Needs a build: {patch.reasons.join('; ')}.</Typography>
          <Button size="small" variant="contained" disabled={building} onClick={() => void api.build(mode).catch((e: Error) => setError(e.message))}>Build {mode}</Button>
        </Box>
      )}
      {patch?.status === 'invalid' && <Typography variant="body2" color="error" role="alert">Not patched: {patch.problems.join('; ')}</Typography>}
      {/* The list sits beside the screen when the panel is wide enough, else under it. */}
      <Box sx={{ width: '100%', display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 360px', maxWidth: 720, aspectRatio: '3 / 2', bgcolor: '#000', border: '1px solid #333' }}>
          <canvas
            ref={canvas}
            width={240}
            height={160}
            className="pixelated"
            aria-label="Game screen: click a thing to select it in the entity list"
            onClick={(event) => {
              if (!showEntitiesRef.current || !liveRef.current) return
              const box = event.currentTarget.getBoundingClientRect()
              const row = pickAt(liveRef.current, Math.floor(((event.clientX - box.left) / box.width) * 240), Math.floor(((event.clientY - box.top) / box.height) * 160))
              setSelected(row ? rowKey(row) : null)
            }}
            style={{ width: '100%', height: '100%', display: 'block', cursor: showEntities ? 'crosshair' : undefined }}
          />
        </Box>
        {showEntities && <EntityList view={live} selected={selected} onSelect={setSelected} message={inspectMessage} />}
      </Box>
      <Typography variant="body2" color="text.secondary">Arrows move · X is A · Z is B · Enter is Start · Shift is Select · A and S are L and R</Typography>
      {touch && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          {([['◀', 32], ['▲', 64], ['▼', 128], ['▶', 16]] as const).map(([label, bit]) => <TouchButton key={bit} label={label} bit={bit} keys={keys} update={forceUpdate} />)}
          <TouchButton label="B" bit={2} keys={keys} update={forceUpdate} round />
          <TouchButton label="A" bit={1} keys={keys} update={forceUpdate} round />
          <TouchButton label="Start" bit={8} keys={keys} update={forceUpdate} />
        </Box>
      )}
    </Box>
  )
}
