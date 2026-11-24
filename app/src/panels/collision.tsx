// Collision classes in Project settings (US-015): add, rename, recolour and set the kind
// of each, with the floor heights of a slope. A class's own fields are one undo step on
// the project. Deleting one, or changing its id, reaches the tilesets and rooms that use
// it, so those go in one grouped step: see design/US-015.md.
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { MAX_COLLISION_CLASSES, TILE, classDeleteBlocker, classIdProblem, classUsage, newClass, renameClass, withKind, withoutClass } from '@pecten-studio/core'
import type { ClassChange, ClassDocs, CollisionClass } from '@pecten-studio/core'
import { useState } from 'react'
import { useEditor } from '../editor.ts'
import { NumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'
import { ui } from '../theme.ts'
import { Heading } from './room.tsx'

const KINDS: ReadonlyArray<{ value: CollisionClass['kind']; label: string }> = [
  { value: 'empty', label: 'Empty' },
  { value: 'solid', label: 'Solid' },
  { value: 'oneway', label: 'One-way' },
  { value: 'slope', label: 'Slope' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'custom', label: 'Custom' },
]

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function CollisionClasses() {
  const project = useStudio((s) => s.bundle?.docs.project)
  const tilesets = useStudio((s) => s.bundle?.docs.tilesets)
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const commit = useStudio((s) => s.commit)
  const commitGroup = useStudio((s) => s.commitGroup)
  const notice = useStudio((s) => s.notice)
  /** The class a delete is waiting on an answer for. */
  const [asking, setAsking] = useState<string | null>(null)
  /** Why an id was not taken, by the class it was typed for. */
  const [idProblem, setIdProblem] = useState<{ id: string; problem: string } | null>(null)
  if (!project || !tilesets || !rooms) return null
  const classes = project.collisionClasses
  const docs: ClassDocs = { project, tilesets, rooms }
  const setClasses = (next: CollisionClass[]) => commit('project', undefined, { ...project, collisionClasses: next })
  const edit = (index: number, next: CollisionClass) => setClasses(classes.map((c, i) => (i === index ? next : c)))

  /** A change that reached tilesets and rooms: one step, undone together. */
  const apply = (what: string, change: ClassChange) =>
    commitGroup(what, { kind: 'project' }, change.project, [
      ...Object.entries(change.tilesets).map(([id, doc]) => ({ kind: 'tileset' as const, id, label: doc.name, doc })),
      ...Object.entries(change.rooms).map(([id, doc]) => ({ kind: 'room' as const, id, label: doc.name, doc })),
    ])
  const rename = (index: number, next: string) => {
    const from = classes[index]!
    const problem = classIdProblem(classes, index, next)
    if (problem) return setIdProblem({ id: from.id, problem })
    setIdProblem(null)
    apply(`the id “${from.id}” was changed`, renameClass(docs, from.id, next))
  }
  const remove = (id: string) => {
    const at = classes.findIndex((c) => c.id === id)
    const change = withoutClass(docs, id)
    if ('problem' in change) return
    apply(`the class “${classes[at]!.name}” was deleted`, change)
    // The room editor paints with a class by its place in the list: keep it on the same class.
    const editor = useEditor.getState()
    const selected = editor.collisionClass
    editor.set({ collisionClass: selected > at + 1 ? selected - 1 : selected === at + 1 ? 0 : selected })
    setAsking(null)
  }
  const askOrRemove = (id: string) => {
    const usage = classUsage(docs, id)
    if (usage.tilesets.length === 0 && usage.rooms.length === 0) remove(id)
    else setAsking(id)
  }

  const cell = { px: 1, py: 0.75, minWidth: 0 } as const
  const asked = asking === null ? undefined : classes.find((c) => c.id === asking)
  const usage = asked ? classUsage(docs, asked.id) : null
  return (
    <>
      <Heading>Collision classes</Heading>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(90px, 1.2fr) minmax(90px, 1fr) minmax(90px, 0.9fr) minmax(0, 1.2fr) max-content', alignItems: 'center', px: 1 }}>
        {['', 'Name', 'Id', 'Kind', 'Floor height, left and right', ''].map((title, i) => (
          <Typography key={i} variant="caption" color="text.secondary" sx={{ px: 1 }}>{title}</Typography>
        ))}
        {classes.map((c, index) => {
          const blocker = classDeleteBlocker(classes, c.id)
          return (
            <Box key={c.id} sx={{ display: 'contents' }}>
              <Box sx={cell}>
                <input type="color" aria-label={`Colour of ${c.name}`} value={c.colour} onChange={(event) => edit(index, { ...c, colour: event.target.value })} style={{ width: ui(22), height: ui(22), padding: 0, border: '1px solid #3a3a3a', background: 'none' }} />
              </Box>
              <Box sx={cell}><TextInput label={`Name of collision class ${c.name}`} value={c.name} onCommit={(name) => edit(index, { ...c, name })} /></Box>
              <Box sx={cell}><TextInput label={`Id of ${c.name}`} value={c.id} onCommit={(next) => rename(index, next)} /></Box>
              <Box sx={cell}>
                <SelectInput label={`Kind of ${c.name}`} value={c.kind} onChange={(kind) => edit(index, withKind(c, kind))} options={KINDS} />
              </Box>
              <Box sx={{ ...cell, display: 'flex', gap: 1 }}>
                {c.slope ? (
                  <>
                    <NumberInput label={`Floor height at the left edge of ${c.name}`} value={c.slope.left} min={0} max={TILE} onCommit={(left) => edit(index, { ...c, slope: { ...c.slope!, left } })} />
                    <NumberInput label={`Floor height at the right edge of ${c.name}`} value={c.slope.right} min={0} max={TILE} onCommit={(right) => edit(index, { ...c, slope: { ...c.slope!, right } })} />
                  </>
                ) : null}
              </Box>
              <Box sx={cell}>
                <IconButton aria-label={`Delete collision class ${c.name}`} title={blocker ?? `Delete ${c.name}`} disabled={blocker !== null} onClick={() => askOrRemove(c.id)}><DeleteOutlinedIcon /></IconButton>
              </Box>
              {idProblem?.id === c.id && <Typography variant="body2" color="error" role="alert" sx={{ gridColumn: '2 / -1', px: 1, pb: 0.5 }}>{idProblem.problem}</Typography>}
            </Box>
          )
        })}
      </Box>
      <Box sx={{ px: 2, py: 1 }}>
        <Button variant="outlined" startIcon={<AddIcon />} disabled={classes.length >= MAX_COLLISION_CLASSES} onClick={() => setClasses([...classes, newClass(classes)])}>
          Add collision class
        </Button>
      </Box>
      {notice && <Typography variant="body2" color="warning.main" role="status" sx={{ px: 2, py: 0.5 }}>{notice}</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
        Tiles take their class from their tileset, and a room can paint over them. The order matters: the first class is what a tile with no class has, and a room paints with a class by its place in this list, so new classes go at the end and cannot be moved. The id is how tilesets name the class and what it is called in the game&rsquo;s code (<code>data::class::SOLID</code> for <code>solid</code>), so game code that uses an old id must change with it. Adding or deleting a class, or changing its id, needs a build; a new kind or floor height is patched into the game.
      </Typography>
      {asked && usage && (
        <Dialog open onClose={() => setAsking(null)} fullWidth maxWidth="xs" aria-label={`Delete the collision class ${asked.name}`}>
          <DialogTitle>Delete “{asked.name}”?</DialogTitle>
          <DialogContent sx={{ px: 3, py: 1 }}>
            <Typography>It is used by:</Typography>
            <Box component="ul" sx={{ m: 0, my: 1, pl: 3 }}>
              {usage.tilesets.map((t) => <li key={`t-${t.id}`}>Tileset {t.name}: {plural(t.tiles, 'tile', 'tiles')}</li>)}
              {usage.rooms.map((r) => <li key={`r-${r.id}`}>Room {r.name}: {plural(r.cells, 'cell', 'cells')}{r.painted > 0 ? `, ${r.painted} painted` : ''}</li>)}
            </Box>
            <Typography variant="body2" color="text.secondary">
              Its tiles will have the first class, “{classes[0]!.name}”, and cells painted with it will follow their tile again. Cells painted with the classes after it are renumbered and stay as they are. You can undo this here. The game needs a build.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAsking(null)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={() => remove(asked.id)}>Delete class</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  )
}
