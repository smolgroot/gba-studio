// The Physics tab: how the game moves, with a pixel ball that moves that way. The ball
// runs the same integer steps as the game's runtime (`core/src/physics.ts`).
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ReplayIcon from '@mui/icons-material/Replay'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Slider from '@mui/material/Slider'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import {
  FRAMES_PER_SECOND, PLATFORMER_PRESETS, PlatformerPhysics as PlatformerSchema, SCREEN, SUB, TILE, TOP_DOWN_PRESETS, TopDownPhysics as TopDownSchema,
  newBody, newPlatformerState, newTopDownState, platformerFigures, stepBody, updatePlatformer, updateTopDown,
} from '@pecten-studio/core'
import type { Body, Physics, PlatformerPhysics, PlatformerState, SolidCells, TopDownPhysics, TopDownState } from '@pecten-studio/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Checkbox, Field, Fields, NumberInput, SelectInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { BAR, ui } from '../theme.ts'
import { UndoButtons } from './common.tsx'
import { Heading } from './room.tsx'
import { Message, ToolButton } from './views.tsx'

const perFrame = (value: number) => `${(value / SUB).toFixed(2)} px/f`
const perFrame2 = (value: number) => (value === 0 ? 'instant' : `${(value / SUB).toFixed(3)} px/f²`)
const gravityUnit = (value: number) => `${(value / SUB).toFixed(3)} px/f²`
const frames = (value: number) => `${Math.round((value * 1000) / FRAMES_PER_SECOND)} ms`
const times = (value: number) => (value === 0 ? 'none' : `${value} more`)

/** The range the project format allows for a number. */
function limits(schema: { unwrap: () => { minValue: number | null; maxValue: number | null } }): { min: number; max: number } {
  const number = schema.unwrap()
  return { min: number.minValue ?? 0, max: number.maxValue ?? 0 }
}

type PlatformerKey = { [K in keyof PlatformerPhysics]: PlatformerPhysics[K] extends number ? K : never }[keyof PlatformerPhysics]
interface Row<K> { key: K; label: string; format: (value: number) => string; min: number; max: number }
const p = (key: PlatformerKey, label: string, format: (value: number) => string): Row<PlatformerKey> => ({ key, label, format, ...limits(PlatformerSchema.shape[key]) })

const PLATFORMER_GROUPS: ReadonlyArray<{ title: string; rows: ReadonlyArray<Row<PlatformerKey>> }> = [
  { title: 'Gravity', rows: [p('gravity', 'Rising', gravityUnit), p('fallGravity', 'Falling', gravityUnit), p('maxFallSpeed', 'Top fall speed', perFrame)] },
  { title: 'Running', rows: [p('runSpeed', 'Run speed', perFrame), p('groundAcceleration', 'Acceleration', perFrame2), p('groundFriction', 'Friction', perFrame2), p('airAcceleration', 'Air control', perFrame2)] },
  { title: 'Jumping', rows: [p('jumpSpeed', 'Jump speed', perFrame), p('jumpCut', 'Short hop cap', perFrame), p('airJumps', 'Air jumps', times)] },
  { title: 'Jump timing', rows: [p('coyoteFrames', 'Coyote time', frames), p('jumpBufferFrames', 'Jump buffer', frames)] },
]

const topDownRow = (key: 'speed' | 'acceleration' | 'friction' | 'cornerSlide') => limits(TopDownSchema.shape[key])

/** A number set with a slider or typed. Dragging shows in the preview; letting go is one undo step. */
function Tune({ label, value, min, max, format, onDraft, onCommit }: { label: string; value: number; min: number; max: number; format: (value: number) => string; onDraft: (value: number) => void; onCommit: (value: number) => void }) {
  return (
    <Field label={label}>
      <Slider
        size="small"
        aria-label={label}
        aria-valuetext={format(value)}
        value={value}
        min={min}
        max={max}
        onChange={(_event, next) => onDraft(next as number)}
        onChangeCommitted={(_event, next) => onCommit(next as number)}
        sx={{ flex: 1, minWidth: ui(50), mx: 1 }}
      />
      <Box sx={{ width: ui(54), flexShrink: 0 }}><NumberInput label={label} value={value} min={min} max={max} onCommit={onCommit} /></Box>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ width: ui(62), flexShrink: 0, textAlign: 'right' }}>{format(value)}</Typography>
    </Field>
  )
}

function Presets<T extends object>({ presets, current, onPick }: { presets: ReadonlyArray<{ name: string; description: string; physics: T }>; current: T; onPick: (physics: T) => void }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2, py: 1.5 }}>
      {presets.map((preset) => {
        const active = (Object.keys(preset.physics) as Array<keyof T>).every((key) => preset.physics[key] === current[key])
        return (
          <Tooltip key={preset.name} title={preset.description}>
            <Button variant={active ? 'contained' : 'outlined'} aria-pressed={active} onClick={() => onPick(preset.physics)}>{preset.name}</Button>
          </Tooltip>
        )
      })}
    </Box>
  )
}

export function PhysicsEditor() {
  const project = useStudio((s) => s.bundle?.docs.project)
  const commit = useStudio((s) => s.commit)
  // While a slider is dragged the preview follows it; the project changes on release.
  const [draft, setDraft] = useState<Physics | null>(null)
  if (!project) return <Message>The project file is missing or has errors. See Problems.</Message>
  const physics = draft ?? project.physics
  const save = (next: Physics) => {
    setDraft(null)
    commit('project', undefined, { ...project, physics: next })
  }
  const withPlatformer = (patch: Partial<PlatformerPhysics>): Physics => ({ ...physics, platformer: { ...physics.platformer, ...patch } })
  const withTopDown = (patch: Partial<TopDownPhysics>): Physics => ({ ...physics, topDown: { ...physics.topDown, ...patch } })
  const topDown = physics.topDown
  const tuneTopDown = (key: 'speed' | 'acceleration' | 'friction' | 'cornerSlide', label: string, format: (value: number) => string) => (
    <Tune label={label} value={topDown[key]} {...topDownRow(key)} format={format} onDraft={(value) => setDraft(withTopDown({ [key]: value }))} onCommit={(value) => save(withTopDown({ [key]: value }))} />
  )
  return (
    <Box sx={{ height: '100%', overflow: 'auto', containerType: 'inline-size' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, minHeight: BAR.tool, borderBottom: '1px solid #111', bgcolor: 'background.default' }}><UndoButtons /></Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 340px', minWidth: 0, p: 2, '@container (min-width: 760px)': { position: 'sticky', top: 0 } }}>
          <Preview physics={physics} />
        </Box>
        <Box sx={{ flex: '1 1 380px', minWidth: 0 }}>
          <Heading>Game type</Heading>
          <Box sx={{ px: 2, py: 1.5 }}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              aria-label="Game type"
              value={physics.mode}
              onChange={(_event, mode: Physics['mode'] | null) => mode && save({ ...physics, mode })}
            >
              <ToggleButton value="platformer" sx={{ textTransform: 'none' }}>2D platformer</ToggleButton>
              <ToggleButton value="topdown" sx={{ textTransform: 'none' }}>Top-down</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {physics.mode === 'platformer' ? (
            <>
              <Heading>Presets</Heading>
              <Presets presets={PLATFORMER_PRESETS} current={physics.platformer} onPick={(platformer) => save({ ...physics, platformer })} />
              {PLATFORMER_GROUPS.map((group) => (
                <Box key={group.title}>
                  <Heading>{group.title}</Heading>
                  <Fields>
                    {group.rows.map(({ key, ...row }) => (
                      <Tune key={key} {...row} value={physics.platformer[key]} onDraft={(value) => setDraft(withPlatformer({ [key]: value }))} onCommit={(value) => save(withPlatformer({ [key]: value }))} />
                    ))}
                  </Fields>
                </Box>
              ))}
            </>
          ) : (
            <>
              <Heading>Presets</Heading>
              <Presets presets={TOP_DOWN_PRESETS} current={topDown} onPick={(next) => save({ ...physics, topDown: next })} />
              <Heading>Movement</Heading>
              <Fields>
                <Field label="Style">
                  <SelectInput
                    label="Movement style"
                    value={topDown.movement}
                    onChange={(movement) => save(withTopDown({ movement }))}
                    options={[{ value: 'free', label: 'Free, pixel by pixel' }, { value: 'grid', label: 'Grid, one step at a time' }]}
                  />
                </Field>
                {tuneTopDown('speed', 'Speed', perFrame)}
                {topDown.movement === 'grid' ? (
                  <Field label="Step size">
                    <SelectInput
                      label="Step size"
                      value={String(topDown.gridSize) as '8' | '16'}
                      onChange={(size) => save(withTopDown({ gridSize: Number(size) as 8 | 16 }))}
                      options={[{ value: '16', label: '16 pixels (2 tiles)' }, { value: '8', label: '8 pixels (1 tile)' }]}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Directions">
                      <SelectInput
                        label="Directions"
                        value={String(topDown.directions) as '4' | '8'}
                        onChange={(directions) => save(withTopDown({ directions: Number(directions) as 4 | 8 }))}
                        options={[{ value: '8', label: '8 directions' }, { value: '4', label: '4 directions' }]}
                      />
                    </Field>
                    {tuneTopDown('acceleration', 'Acceleration', perFrame2)}
                    {tuneTopDown('friction', 'Friction', perFrame2)}
                    {tuneTopDown('cornerSlide', 'Corner slide', (value) => (value === 0 ? 'off' : `${value} px`))}
                    {topDown.directions === 8 && (
                      <Field label="Diagonals">
                        <Checkbox checked={topDown.normalizeDiagonal} onChange={(normalizeDiagonal) => save(withTopDown({ normalizeDiagonal }))}>Same speed as straight lines</Checkbox>
                      </Field>
                    )}
                  </>
                )}
              </Fields>
            </>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            Games read these numbers from <code>data::PHYSICS</code> when they are built. Rebuild to feel them in the ROM.
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div" noWrap>{label}</Typography>
      <Typography noWrap>{children}</Typography>
    </Box>
  )
}

const seconds = (count: number) => `${(count / FRAMES_PER_SECOND).toFixed(2)} s`
const tiles = (pixels: number) => `${(pixels / TILE).toFixed(1)} tiles`

function PlatformerFigures({ physics }: { physics: PlatformerPhysics }) {
  const figures = useMemo(() => platformerFigures(physics), [physics])
  return (
    <>
      <Figure label="Jump height">{figures.jumpHeight} px · {tiles(figures.jumpHeight)}</Figure>
      <Figure label="Short hop">{figures.hopHeight} px · {tiles(figures.hopHeight)}</Figure>
      <Figure label="Time in the air">{figures.airFrames} frames · {seconds(figures.airFrames)}</Figure>
      <Figure label="Running jump">{figures.jumpDistance} px · {tiles(figures.jumpDistance)}</Figure>
      <Figure label="Reaches run speed">{figures.framesToRun ? `${figures.framesToRun} frames` : 'at once'}</Figure>
      <Figure label="Stops">{figures.framesToStop ? `${figures.framesToStop} frames` : 'at once'}</Figure>
    </>
  )
}

function TopDownFigures({ physics }: { physics: TopDownPhysics }) {
  const pixelsPerSecond = Math.round((physics.speed * FRAMES_PER_SECOND) / SUB)
  const stepFrames = Math.ceil((physics.gridSize * SUB) / physics.speed)
  return (
    <>
      <Figure label="Speed">{pixelsPerSecond} px/s · {tiles(pixelsPerSecond)}/s</Figure>
      <Figure label="Crosses a screen in">{seconds(Math.ceil((SCREEN.width * SUB) / physics.speed))}</Figure>
      {physics.movement === 'grid' && <Figure label="One step takes">{stepFrames} frames · {seconds(stepFrames)}</Figure>}
    </>
  )
}

const BALL = ['..dddd..', '.dmmmmd.', 'dmhhmmmd', 'dmhmmmmd', 'dmmmmmmd', 'dmmmmmsd', '.dmmssd.', '..dddd..']
const BALL_LANDED = [BALL[0]!, BALL[1]!, BALL[3]!, BALL[4]!, BALL[6]!, BALL[7]!]
const BALL_COLOURS: Record<string, string> = { d: '#7a3b12', m: '#f5a524', h: '#ffe9a8', s: '#c9761a' }
const BALL_SIZE = 8

const SIDE_ROOM: SolidCells = (col, row) =>
  col <= 0 || col >= SCREEN.cols - 1 || row <= 0 || row >= 17 || (row === 12 && col >= 6 && col <= 10) || (row === 8 && col >= 18 && col <= 23)

const TOP_ROOM = [
  '###############',
  '#.............#',
  '#..##.....#...#',
  '#..#......#...#',
  '#.......###...#',
  '#.............#',
  '#...##........#',
  '#...##.....#..#',
  '#.............#',
  '###############',
]
const TOP_CELL = 16
const TOP_SOLID: SolidCells = (col, row) => TOP_ROOM[row >> 1]?.[col >> 1] === '#'
const WANDER = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const
const KEY_HOLD_FRAMES = 240

interface Sim {
  body: Body
  platformer: PlatformerState
  topDown: TopDownState
  trail: Array<{ x: number; y: number }>
  clock: number
  /** Frames since the last key press; the demo plays itself when it is large. */
  sinceKey: number
  direction: number
  groundFrames: number
  jumps: number
  holdJump: number
  landed: number
  takeoff: number | null
}

function startSim(physics: Physics): Sim {
  const topDown = physics.mode === 'topdown'
  const inset = physics.topDown.movement === 'grid' && physics.topDown.gridSize === 8 ? 0 : (TOP_CELL - BALL_SIZE) / 2
  const body = topDown ? newBody(7 * TOP_CELL + inset, 5 * TOP_CELL + inset, BALL_SIZE, BALL_SIZE) : newBody(SCREEN.width / 2 - BALL_SIZE / 2, 16, BALL_SIZE, BALL_SIZE)
  return { body, platformer: newPlatformerState(), topDown: newTopDownState(), trail: [], clock: 0, sinceKey: KEY_HOLD_FRAMES, direction: 1, groundFrames: 0, jumps: 0, holdJump: 0, landed: 0, takeoff: null }
}

function tick(sim: Sim, physics: Physics, keys: Set<string>, pressed: Set<string>): void {
  const { body } = sim
  // A key pressed and let go between two frames still counts for one.
  const has = (...names: string[]) => names.some((name) => keys.has(name) || pressed.has(name))
  const manual = sim.sinceKey < KEY_HOLD_FRAMES
  sim.clock++
  sim.sinceKey++
  let dx = Number(has('ArrowRight', 'KeyD')) - Number(has('ArrowLeft', 'KeyA'))
  let dy = Number(has('ArrowDown', 'KeyS')) - Number(has('ArrowUp', 'KeyW'))
  if (physics.mode === 'topdown') {
    if (!manual) [dx, dy] = WANDER[Math.floor(sim.clock / 45) % WANDER.length]!
    updateTopDown(sim.topDown, body, TOP_SOLID, physics.topDown, dx, dy)
  } else {
    const jumpKeys = ['Space', 'KeyZ', 'ArrowUp', 'KeyW']
    let jumpPressed = jumpKeys.some((name) => pressed.has(name))
    let jumpHeld = has(...jumpKeys)
    if (!manual) {
      // The demo runs from wall to wall, mixing full jumps, short hops and air jumps.
      if (body.hitWall) sim.direction = -sim.direction
      dx = sim.groundFrames > 8 || !body.onGround ? sim.direction : 0
      sim.groundFrames = body.onGround ? sim.groundFrames + 1 : 0
      if (body.onGround && sim.groundFrames === 28) {
        jumpPressed = true
        sim.jumps++
        sim.holdJump = sim.jumps % 3 === 0 ? 3 : 90
      } else if (!body.onGround && body.vy > 0 && sim.platformer.airJumps > 0) {
        jumpPressed = true
        sim.holdJump = 90
      }
      jumpHeld = sim.holdJump > 0
      sim.holdJump = Math.max(0, sim.holdJump - 1)
    }
    const wasGround = body.onGround
    if (updatePlatformer(sim.platformer, body, physics.platformer, { direction: dx, jumpPressed, jumpHeld }) && wasGround) sim.takeoff = body.y + body.h
    stepBody(body, SIDE_ROOM)
    if (body.onGround && !wasGround) {
      sim.landed = 5
      sim.takeoff = null
    }
    sim.landed = Math.max(0, sim.landed - 1)
  }
  pressed.clear()
  if (sim.clock % 2 === 0) {
    sim.trail.push({ x: body.x + BALL_SIZE / 2, y: body.y + BALL_SIZE / 2 })
    if (sim.trail.length > 36) sim.trail.shift()
  }
}

function drawRoom(g: CanvasRenderingContext2D, solid: SolidCells, sky: string, top: string, fill: string, shade: string): void {
  g.fillStyle = sky
  g.fillRect(0, 0, SCREEN.width, SCREEN.height)
  for (let row = 0; row < SCREEN.rows; row++) {
    for (let col = 0; col < SCREEN.cols; col++) {
      if (!solid(col, row)) continue
      const [x, y] = [col * TILE, row * TILE]
      g.fillStyle = (col + row) % 2 ? fill : shade
      g.fillRect(x, y, TILE, TILE)
      if (!solid(col, row - 1)) {
        g.fillStyle = top
        g.fillRect(x, y, TILE, 2)
      }
    }
  }
}

function draw(g: CanvasRenderingContext2D, sim: Sim, physics: Physics, jumpHeight: number): void {
  const { body } = sim
  if (physics.mode === 'topdown') {
    drawRoom(g, TOP_SOLID, '#23402f', '#6d8a68', '#3c4f45', '#34463d')
    if (physics.topDown.movement === 'grid') {
      g.fillStyle = 'rgba(255,255,255,0.07)'
      const step = physics.topDown.gridSize
      for (let x = 0; x < SCREEN.width; x += step) g.fillRect(x, 0, 1, SCREEN.height)
      for (let y = 0; y < SCREEN.height; y += step) g.fillRect(0, y, SCREEN.width, 1)
    }
  } else {
    drawRoom(g, SIDE_ROOM, '#17212f', '#7fd18b', '#3b4a5c', '#334152')
    if (sim.takeoff !== null) {
      // How high this jump can go if the button stays down.
      g.fillStyle = 'rgba(255,233,168,0.55)'
      const y = sim.takeoff - jumpHeight
      for (let x = TILE; x < SCREEN.width - TILE; x += 4) g.fillRect(x, y, 2, 1)
    }
  }
  sim.trail.forEach((point, index) => {
    g.fillStyle = `rgba(245,165,36,${((index + 1) / sim.trail.length) * 0.5})`
    g.fillRect(point.x, point.y, 1, 1)
  })
  const rows = sim.landed > 0 ? BALL_LANDED : BALL
  const top = body.y + BALL_SIZE - rows.length
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const colour = BALL_COLOURS[row[x]!]
      if (!colour) continue
      g.fillStyle = colour
      g.fillRect(body.x + x, top + y, 1, 1)
    }
  })
}

const PREVIEW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyZ'])

function Preview({ physics }: { physics: Physics }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [paused, setPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [run, setRun] = useState(0)
  const jumpHeight = useMemo(() => platformerFigures(physics.platformer).jumpHeight, [physics.platformer])
  const latest = useRef({ physics, jumpHeight })
  latest.current = { physics, jumpHeight }
  const sim = useRef<Sim | null>(null)
  const keys = useRef(new Set<string>())
  const pressed = useRef(new Set<string>())
  // A different kind of movement is a different scene: start it over.
  const scene = `${physics.mode}:${physics.topDown.movement}:${physics.topDown.gridSize}`

  useEffect(() => {
    const element = canvas.current
    const g = element?.getContext('2d')
    if (!element || !g) return
    sim.current = startSim(latest.current.physics)
    draw(g, sim.current, latest.current.physics, latest.current.jumpHeight)
    if (paused) return
    let frame = 0
    let last = performance.now()
    let owed = 0
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      owed += Math.min(100, now - last) * (FRAMES_PER_SECOND / 1000)
      last = now
      // A tab that is not showing has no size: nothing to run or draw.
      if (element.clientWidth === 0) return
      let advanced = false
      while (owed >= 1) {
        tick(sim.current!, latest.current.physics, keys.current, pressed.current)
        owed -= 1
        advanced = true
      }
      if (advanced) draw(g, sim.current!, latest.current.physics, latest.current.jumpHeight)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [paused, run, scene])

  const topDown = physics.mode === 'topdown'
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Typography sx={{ flex: 1, fontWeight: 600 }}>Preview</Typography>
        <ToolButton title={paused ? 'Play' : 'Pause'} onClick={() => setPaused(!paused)}>{paused ? <PlayArrowIcon /> : <PauseIcon />}</ToolButton>
        <ToolButton title={topDown ? 'Start over' : 'Drop the ball again'} onClick={() => setRun(run + 1)}><ReplayIcon /></ToolButton>
      </Box>
      <Box
        component="canvas"
        ref={canvas}
        className="pixelated"
        width={SCREEN.width}
        height={SCREEN.height}
        tabIndex={0}
        role="img"
        aria-label={topDown ? 'A pixel ball walking around a room seen from above' : 'A pixel ball running and jumping in a side view'}
        onKeyDown={(event) => {
          if (!PREVIEW_KEYS.has(event.code)) return
          event.preventDefault()
          if (!event.repeat) pressed.current.add(event.code)
          keys.current.add(event.code)
          if (sim.current) sim.current.sinceKey = 0
        }}
        onKeyUp={(event) => keys.current.delete(event.code)}
        onBlur={() => keys.current.clear()}
        sx={{ display: 'block', width: '100%', aspectRatio: `${SCREEN.width} / ${SCREEN.height}`, border: '1px solid #3a3a3a', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {topDown ? 'Click it, then walk with the arrow keys.' : 'Click it, then play: arrow keys to run, Space to jump.'} The demo comes back when you stop.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.5, mt: 2 }}>
        {topDown ? <TopDownFigures physics={physics.topDown} /> : <PlatformerFigures physics={physics.platformer} />}
      </Box>
    </Box>
  )
}
