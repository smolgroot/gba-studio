// Build and Play: run the project's build, read its log, and play the ROM it made in
// the browser on the Pecten emulator core.
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import StopIcon from '@mui/icons-material/Stop'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fileUrl } from '../api.ts'
import type { PatchResult, RomInfo, ToolchainReport } from '../api.ts'
import { Checkbox } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { Message } from './views.tsx'

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
  free: () => void
}
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

/** The emulator: runs a ROM from the game folder, restarting it when the file is rebuilt. */
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
  const [patch, setPatch] = useState<PatchResult | null>(null)
  const patchedRevision = useRef(revision)
  const building = build?.running ?? false
  const [sound, setSound] = useState(false)
  const loadedModified = useRef(0)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  // Start on request, and again when the ROM file changes while following builds.
  const start = useCallback(async (info: RomInfo) => {
    setError(null)
    try {
      const [mod, response] = await Promise.all([loadPecten(), fetch(fileUrl(info.path, info.modified))])
      if (!response.ok) throw new Error(`cannot read ${info.path}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      emulator.current?.free()
      emulator.current = new mod.WasmEmulator(bytes, false)
      loadedModified.current = info.modified
      setRunning(true)
    } catch (e) {
      setError((e as Error).message)
      setRunning(false)
    }
  }, [])
  const romPath = rom?.path
  const romModified = rom?.modified
  useEffect(() => {
    if (running && autoRestart && rom && rom.modified !== loadedModified.current) void start(rom)
  }, [rom, running, autoRestart, start, revision])

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
          for (let n = 0; n < 4 && now >= next - 2; n++) {
            core.set_pressed_keys(keys.current)
            const pixels = core.step_frame()
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
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void start(rom)}>{running ? 'Restart' : 'Play'}</Button>
        <Button variant="outlined" startIcon={<RestartAltIcon />} disabled={!running} onClick={() => { setRestarts((n) => n + 1); void start(rom) }}>Reset</Button>
        {roms.dev && roms.release && (
          <Button variant="outlined" onClick={() => { setMode(mode === 'dev' ? 'release' : 'dev'); setRunning(false) }}>ROM: {mode}</Button>
        )}
        <Button variant="outlined" disabled={!running || sound} onClick={() => void enableSound()}>{sound ? 'Sound on' : 'Sound'}</Button>
        <Checkbox checked={autoRestart} onChange={setAutoRestart}>Restart on rebuild</Checkbox>
        <Checkbox checked={patchOnChange} onChange={setPatchOnChange}>Patch on change</Checkbox>
      </Box>
      <Typography variant="body2" color="text.secondary">{romPath} · {(rom.size / 1024).toFixed(0)} KB · built {new Date(romModified ?? 0).toLocaleTimeString()}</Typography>
      {error && <Typography color="error" role="alert">{error}</Typography>}
      {patch?.status === 'patched' && (
        <Typography variant="body2" color="text.secondary">Patched in {patch.ms} ms · level data {patch.used.toLocaleString()} of {patch.capacity.toLocaleString()} bytes</Typography>
      )}
      {patch?.status === 'needs-build' && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Typography variant="body2" color="warning.main">Needs a build: {patch.reasons.join('; ')}.</Typography>
          <Button size="small" variant="contained" disabled={building} onClick={() => void api.build(mode).catch((e: Error) => setError(e.message))}>Build {mode}</Button>
        </Box>
      )}
      {patch?.status === 'invalid' && <Typography variant="body2" color="error" role="alert">Not patched: {patch.problems.join('; ')}</Typography>}
      <Box sx={{ width: 'min(100%, 720px)', aspectRatio: '3 / 2', bgcolor: '#000', border: '1px solid #333' }}>
        <canvas ref={canvas} width={240} height={160} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
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
