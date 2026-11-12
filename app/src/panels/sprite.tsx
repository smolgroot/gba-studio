// The sprite editor: cuts a sheet into frames, builds animations from them, and
// plays them back at the GBA's 60 frames a second.
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { SPRITE_SIZES, uniqueId } from '@gba-studio/core'
import type { Sprite } from '@gba-studio/core'
import { useEffect, useRef, useState } from 'react'
import { Checkbox, Field, Fields, NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { UndoButtons } from './common.tsx'
import { Heading, rowSx } from './room.tsx'
import { GridOverlay, Message, ToolButton, Viewport, useImage } from './views.tsx'

type Animation = Sprite['animations'][number]

/** Where frame `index` sits in the sheet, frames being numbered row by row. */
function frameRect(sprite: Sprite, image: HTMLImageElement, index: number) {
  const cols = Math.max(1, Math.floor(image.width / sprite.frame.width))
  return { x: (index % cols) * sprite.frame.width, y: Math.floor(index / cols) * sprite.frame.height }
}
function frameCount(sprite: Sprite, image: HTMLImageElement): number {
  return Math.floor(image.width / sprite.frame.width) * Math.floor(image.height / sprite.frame.height)
}

/** One frame of the sheet drawn at a scale, as a CSS background. */
function FrameThumb({ sprite, image, index, scale }: { sprite: Sprite; image: HTMLImageElement; index: number; scale: number }) {
  const at = frameRect(sprite, image, index)
  return (
    <Box
      className="pixelated checker"
      sx={{
        width: sprite.frame.width * scale,
        height: sprite.frame.height * scale,
        flexShrink: 0,
        backgroundImage: `url("${image.src}")`,
        backgroundSize: `${image.width * scale}px ${image.height * scale}px`,
        backgroundPosition: `-${at.x * scale}px -${at.y * scale}px`,
        // The checkerboard of .checker is replaced by the frame; keep a plain backdrop.
        bgcolor: '#2f2f2f',
      }}
    />
  )
}

/** Plays an animation, or shows one still frame, with the anchor and hitbox drawn over it. */
function Preview({ sprite, image, animation, still, playing, showGuides }: { sprite: Sprite; image: HTMLImageElement; animation: Animation | undefined; still: number; playing: boolean; showGuides: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(() => Math.max(1, Math.min(6, Math.floor(ui(160) / Math.max(sprite.frame.width, sprite.frame.height)))))
  const [shown, setShown] = useState({ step: 0, frame: still })
  const { width, height } = sprite.frame

  useEffect(() => {
    const draw = (frame: number, step: number) => {
      const context = canvas.current?.getContext('2d')
      if (!context) return
      const at = frameRect(sprite, image, frame)
      context.clearRect(0, 0, width, height)
      context.drawImage(image, at.x, at.y, width, height, 0, 0, width, height)
      setShown((previous) => (previous.frame === frame && previous.step === step ? previous : { step, frame }))
    }
    if (!animation || !playing) {
      draw(animation ? animation.frames[0]!.index : still, 0)
      return
    }
    // Count 60 Hz ticks from the clock, so a slow display plays at the right speed.
    let request = 0
    let step = 0
    let ticksLeft = animation.frames[0]!.duration
    let last = performance.now()
    let owed = 0
    let done = false
    draw(animation.frames[0]!.index, 0)
    const tick = (now: number) => {
      owed += Math.min(250, now - last) * 0.06
      last = now
      while (owed >= 1 && !done) {
        owed -= 1
        if (--ticksLeft > 0) continue
        if (step === animation.frames.length - 1 && !animation.loop) {
          done = true
          break
        }
        step = (step + 1) % animation.frames.length
        ticksLeft = animation.frames[step]!.duration
        draw(animation.frames[step]!.index, step)
      }
      if (!done) request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [sprite, image, animation, still, playing, width, height])

  const hitbox = sprite.hitbox
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: ui(120), bgcolor: '#161616', border: '1px solid #111', overflow: 'auto', p: 2 }}>
        <Box className="checker" sx={{ position: 'relative', width: width * zoom, height: height * zoom, flexShrink: 0 }}>
          <canvas ref={canvas} width={width} height={height} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
          {showGuides && hitbox && (
            <Box sx={{ position: 'absolute', left: hitbox.x * zoom, top: hitbox.y * zoom, width: hitbox.width * zoom, height: hitbox.height * zoom, border: '1px solid #46a758', bgcolor: 'rgba(70,167,88,0.2)' }} />
          )}
          {showGuides && (
            <>
              <Box sx={{ position: 'absolute', left: sprite.anchor.x * zoom - 6, top: sprite.anchor.y * zoom, width: 13, height: '1px', bgcolor: '#f5d90a' }} />
              <Box sx={{ position: 'absolute', left: sprite.anchor.x * zoom, top: sprite.anchor.y * zoom - 6, width: '1px', height: 13, bgcolor: '#f5d90a' }} />
            </>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} noWrap>
          {animation ? `step ${shown.step + 1} of ${animation.frames.length} · frame ${shown.frame}` : `frame ${shown.frame}`}
        </Typography>
        <Button variant="text" onClick={() => setZoom(zoom >= 8 ? 1 : zoom + 1)} sx={{ minWidth: 0, py: 0 }}>{zoom}×</Button>
      </Box>
    </Box>
  )
}

export function SpriteEditor({ id }: { id: string }) {
  const sprite = useStudio((s) => s.bundle?.docs.sprites[id])
  const commit = useStudio((s) => s.commit)
  const image = useImage(sprite?.image)
  const [current, setCurrent] = useState(0)
  const [still, setStill] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [showGuides, setShowGuides] = useState(true)
  if (!sprite) return <Message>This sprite is missing or its file has errors. See Problems.</Message>
  if (!sprite.image.toLowerCase().endsWith('.png')) {
    return <Message>{sprite.image} is converted when the ROM is built. To cut frames and preview animations here, export the sheet as a PNG and choose it in Properties.</Message>
  }
  if (image === 'error') return <Message>Cannot load {sprite.image}. Choose another image in Properties.</Message>
  if (!image) return null

  const { width, height } = sprite.frame
  const total = frameCount(sprite, image)
  const animation = sprite.animations[Math.min(current, sprite.animations.length - 1)]
  const index = sprite.animations.indexOf(animation!)
  const update = (animations: Animation[]) => commit('sprite', id, { ...sprite, animations })
  const updateAnimation = (patch: Partial<Animation>) => update(sprite.animations.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  const addAnimation = () => {
    const name = uniqueId('anim', sprite.animations.map((a) => a.name)).replace(/-/g, '_')
    update([...sprite.animations, { name, frames: [{ index: still, duration: 8 }], loop: true }])
    setCurrent(sprite.animations.length)
  }
  const misfit = image.width % width !== 0 || image.height % height !== 0

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: { xs: 200, md: 0 } }}>
        <Viewport
          initialZoom={3}
          tools={<UndoButtons />}
          info={`${total} frames of ${width}×${height}${misfit ? ' · the sheet is not a whole number of frames' : ''}${animation ? ' · click a frame to add it to the animation' : ' · click a frame to look at it'}`}
        >
          {(zoom) => (
            <Box
              className="checker"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                const cols = Math.floor(image.width / width)
                const x = Math.floor((event.clientX - box.left) / (width * zoom))
                const y = Math.floor((event.clientY - box.top) / (height * zoom))
                const frame = y * cols + x
                if (x < 0 || x >= cols || frame < 0 || frame >= total) return
                setStill(frame)
                if (animation) updateAnimation({ frames: [...animation.frames, { index: frame, duration: animation.frames[animation.frames.length - 1]?.duration ?? 8 }] })
              }}
              sx={{ position: 'relative', width: image.width * zoom, height: image.height * zoom, cursor: 'pointer' }}
            >
              <img src={image.src} alt={sprite.name} draggable={false} className="pixelated" style={{ width: '100%', height: '100%', display: 'block' }} />
              <GridOverlay stepX={width * zoom} stepY={height * zoom} colour="rgba(76,159,254,0.6)" />
              {!animation && (() => {
                const at = frameRect(sprite, image, still)
                return <Box sx={{ position: 'absolute', pointerEvents: 'none', left: at.x * zoom, top: at.y * zoom, width: width * zoom, height: height * zoom, outline: '2px solid #fff' }} />
              })()}
            </Box>
          )}
        </Viewport>
      </Box>

      <Box sx={{ width: { xs: '100%', md: ui(300) }, flexShrink: 0, overflow: 'auto', borderLeft: { md: '1px solid #111' }, borderTop: { xs: '1px solid #111', md: 'none' }, maxHeight: { xs: '55%', md: 'none' } }}>
        <Heading>Preview</Heading>
        <Preview sprite={sprite} image={image} animation={animation} still={still} playing={playing} showGuides={showGuides} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, pb: 1 }}>
          <ToolButton title={playing ? 'Pause' : 'Play'} disabled={!animation} onClick={() => setPlaying(!playing)}>{playing ? <PauseIcon /> : <PlayArrowIcon />}</ToolButton>
          <Checkbox checked={showGuides} onChange={setShowGuides}>Anchor and hitbox</Checkbox>
        </Box>

        <Heading>Animations</Heading>
        <Box role="listbox" aria-label="Animations">
          {sprite.animations.map((a, i) => (
            <Box key={i} role="option" aria-selected={i === index} sx={rowSx(i === index)} onClick={() => setCurrent(i)}>
              <Typography noWrap sx={{ flex: 1 }}>{a.name}</Typography>
              <Typography variant="body2" color="text.secondary">{a.frames.length} frames · {a.frames.reduce((sum, f) => sum + f.duration, 0)} ticks</Typography>
            </Box>
          ))}
        </Box>
        {sprite.animations.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No animations yet. Add one, then click frames in the sheet in the order they play.</Typography>}
        <Box sx={{ display: 'flex', gap: 1, px: 2, py: 1 }}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={addAnimation}>Add animation</Button>
          {animation && (
            <Button
              color="error"
              startIcon={<DeleteOutlinedIcon />}
              onClick={() => {
                update(sprite.animations.filter((_, i) => i !== index))
                setCurrent(Math.max(0, index - 1))
              }}
            >
              Delete
            </Button>
          )}
        </Box>

        {animation && (
          <>
            <Fields>
              <Field label="Name">
                <TextInput label="Animation name" value={animation.name} onCommit={(name) => updateAnimation({ name: name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '') || animation.name })} />
              </Field>
              <Field label="Repeat"><Checkbox checked={animation.loop} onChange={(loop) => updateAnimation({ loop })}>Loop</Checkbox></Field>
            </Fields>
            <Heading>Frames, in playing order</Heading>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {animation.frames.map((frame, step) => {
                const setFrames = (frames: Animation['frames']) => updateAnimation({ frames })
                const swap = (to: number) => {
                  const frames = [...animation.frames]
                  ;[frames[step], frames[to]] = [frames[to]!, frames[step]!]
                  setFrames(frames)
                }
                return (
                  <Box key={step} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.5 }}>
                    <FrameThumb sprite={sprite} image={image} index={frame.index} scale={Math.max(1, Math.floor(ui(28) / height))} />
                    <Typography variant="body2" color="text.secondary" sx={{ width: '2.4em' }}>#{frame.index}</Typography>
                    <Box sx={{ width: ui(48) }}>
                      <NumberInput label={`Ticks for step ${step + 1}`} value={frame.duration} min={1} max={255} onCommit={(duration) => setFrames(animation.frames.map((f, i) => (i === step ? { ...f, duration } : f)))} />
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>ticks</Typography>
                    <IconButton aria-label="Play earlier" disabled={step === 0} onClick={() => swap(step - 1)}><ChevronLeftIcon sx={{ transform: 'rotate(90deg)' }} /></IconButton>
                    <IconButton aria-label="Play later" disabled={step === animation.frames.length - 1} onClick={() => swap(step + 1)}><ChevronRightIcon sx={{ transform: 'rotate(90deg)' }} /></IconButton>
                    <IconButton aria-label="Remove from animation" disabled={animation.frames.length === 1} onClick={() => setFrames(animation.frames.filter((_, i) => i !== step))}><CloseIcon /></IconButton>
                  </Box>
                )
              })}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>A tick is one GBA frame, 1/60 of a second.</Typography>
          </>
        )}
      </Box>
    </Box>
  )
}

export function SpriteProperties({ id }: { id: string }) {
  const sprite = useStudio((s) => s.bundle?.docs.sprites[id])
  const assets = useStudio((s) => s.bundle?.assets)
  const commit = useStudio((s) => s.commit)
  if (!sprite) return null
  const update = (patch: Partial<Sprite>) => commit('sprite', id, { ...sprite, ...patch })
  const images = (assets ?? []).filter((a) => /\.(png|aseprite|ase)$/i.test(a.path))
  const size = `${sprite.frame.width}x${sprite.frame.height}`
  const { width, height } = sprite.frame
  const hitbox = sprite.hitbox
  return (
    <Fields>
      <Field label="Name"><TextInput label="Name" value={sprite.name} onCommit={(name) => update({ name })} /></Field>
      <Field label="Image"><SelectInput label="Image" value={sprite.image} onChange={(image) => update({ image })} options={images.map((a) => ({ value: a.path, label: a.path }))} /></Field>
      <Field label="Frame size">
        <SelectInput
          label="Frame size"
          value={size}
          onChange={(next) => {
            const [w, h] = next.split('x').map(Number) as [number, number]
            update({ frame: { width: w, height: h } })
          }}
          options={SPRITE_SIZES.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h}` }))}
        />
      </Field>
      <Field label="Anchor">
        <NumberInput label="Anchor X" value={sprite.anchor.x} min={0} max={width} onCommit={(x) => update({ anchor: { ...sprite.anchor, x } })} />
        <NumberInput label="Anchor Y" value={sprite.anchor.y} min={0} max={height} onCommit={(y) => update({ anchor: { ...sprite.anchor, y } })} />
      </Field>
      <Field label="Hitbox">
        <Checkbox checked={!!hitbox} onChange={(on) => update({ hitbox: on ? { x: 0, y: 0, width, height } : undefined })}>Has a hitbox</Checkbox>
      </Field>
      {hitbox && (
        <>
          <Field label="Hitbox corner">
            <NumberInput label="Hitbox X" value={hitbox.x} min={0} max={width - 1} onCommit={(x) => update({ hitbox: { ...hitbox, x } })} />
            <NumberInput label="Hitbox Y" value={hitbox.y} min={0} max={height - 1} onCommit={(y) => update({ hitbox: { ...hitbox, y } })} />
          </Field>
          <Field label="Hitbox size">
            <NumberInput label="Hitbox width" value={hitbox.width} min={1} max={width} onCommit={(w) => update({ hitbox: { ...hitbox, width: w } })} />
            <NumberInput label="Hitbox height" value={hitbox.height} min={1} max={height} onCommit={(h) => update({ hitbox: { ...hitbox, height: h } })} />
          </Field>
        </>
      )}
    </Fields>
  )
}
