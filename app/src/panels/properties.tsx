// An entity type's own properties in Project settings (US-016): add, rename, retype and
// delete them, with a default and the limits that go with the type. A field edit is one
// undo step on the project. A change that reaches placed entities (a rename, a delete,
// a value that no longer fits) goes in one grouped step with the rooms, after asking
// where it would drop values. See design/US-016.md.
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
import {
  I32_MAX, I32_MIN, PROPERTY_TYPES, editProperty, newProperty, propertyNameProblem, propertyUsage, renameProperty, withLimits, withOptions, withPropertyType, withoutProperty,
} from '@pecten-studio/core'
import type { EntityType, PropertyDef } from '@pecten-studio/core'
import { useState } from 'react'
import { NumberInput, OptionalNumberInput, SelectInput, TextInput } from '../fields.tsx'
import { useStudio } from '../store.ts'

/** A smallest or largest value: empty for none, else a whole number that fits in 32 bits. */
const parseLimit = (text: string): { ok: true; value: number | undefined } | { ok: false; problem: string } => {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  const value = Number(trimmed)
  if (Number.isInteger(value) && value >= I32_MIN && value <= I32_MAX) return { ok: true, value }
  return { ok: false, problem: 'A limit is a whole number that fits in 32 bits, or empty for none.' }
}

/** What a question waits on: what it says, and what happens when the author agrees. */
interface Question {
  title: string
  lead: string
  lines: string[]
  note: string
  action: string
  confirm: () => void
}

const where = (type: EntityType, m: { roomName: string; entity: number }) => `${m.roomName}: ${type.name} #${m.entity}`

export function TypeProperties({ type }: { type: EntityType }) {
  const project = useStudio((s) => s.bundle?.docs.project)
  const rooms = useStudio((s) => s.bundle?.docs.rooms)
  const commit = useStudio((s) => s.commit)
  const commitGroup = useStudio((s) => s.commitGroup)
  const [question, setQuestion] = useState<Question | null>(null)
  /** Why a field was not taken, by the row it was typed in. */
  const [problem, setProblem] = useState<{ row: number; text: string } | null>(null)
  /**
   * Counts the times the rows are made again: a field keeps what was typed until the
   * project says otherwise, so after a refusal, a Cancel or a deleted row the rows start
   * again from the project and show what it has.
   */
  const [fresh, setFresh] = useState(0)
  if (!project || !rooms) return null
  const refused = (row: number, text: string) => {
    setProblem({ row, text })
    setFresh((n) => n + 1)
  }
  const close = () => {
    setQuestion(null)
    setFresh((n) => n + 1)
  }

  const setProps = (props: PropertyDef[]) => commit('project', undefined, { ...project, entityTypes: project.entityTypes.map((t) => (t.id === type.id ? { ...t, props } : t)) })
  /** Companions of a grouped step: the rooms that changed. */
  const withRooms = (changed: Record<string, (typeof rooms)[string]>) => Object.entries(changed).map(([id, doc]) => ({ kind: 'room' as const, id, label: doc.name, doc }))
  /** The documents as they are when the author agrees, not when the question was asked. */
  const current = () => {
    const docs = useStudio.getState().bundle?.docs
    return docs?.project && docs.rooms ? { project: docs.project, rooms: docs.rooms } : null
  }

  /** A new definition for one row: made at once if it breaks nothing stored, else asked about first. */
  const edit = (index: number, next: PropertyDef) => {
    setProblem(null)
    const plan = editProperty(project, rooms, type.id, index, next)
    if (!plan) return
    const was = type.props[index]!.name
    if (plan.broken.length === 0) return setProps(plan.project.entityTypes.find((t) => t.id === type.id)!.props)
    setQuestion({
      title: `Change “${was}”?`,
      lead: 'These stored values no longer fit it:',
      lines: plan.broken.map((m) => `${where(type, m)}: ${m.problem}`),
      note: 'Changing it drops them, so those entities have the property\u2019s default again. You can undo this here.',
      action: 'Change and drop them',
      confirm: () => {
        const now = current()
        const again = now && editProperty(now.project, now.rooms, type.id, index, next)
        if (again) commitGroup(`the property “${was}” was changed`, { kind: 'project' }, again.project, withRooms(again.rooms))
        close()
      },
    })
  }

  const rename = (index: number, next: string) => {
    const from = type.props[index]!.name
    const text = propertyNameProblem(type, index, next)
    if (text) return refused(index, text)
    setProblem(null)
    const change = renameProperty(project, rooms, type.id, from, next)
    if (Object.keys(change.rooms).length === 0) return setProps(change.project.entityTypes.find((t) => t.id === type.id)!.props)
    commitGroup(`the property “${from}” was renamed`, { kind: 'project' }, change.project, withRooms(change.rooms))
  }

  const remove = (index: number) => {
    const name = type.props[index]!.name
    const used = propertyUsage(rooms, type.id, name)
    const make = () => {
      const now = current()
      if (now) {
        const change = withoutProperty(now.project, now.rooms, type.id, name)
        commitGroup(`the property “${name}” was deleted`, { kind: 'project' }, change.project, withRooms(change.rooms))
      }
      setProblem(null)
      close()
    }
    if (used.length === 0) return make()
    setQuestion({
      title: `Delete “${name}”?`,
      lead: 'These entities store a value for it:',
      lines: used.map((u) => `${where(type, u)}: ${JSON.stringify(u.value)}`),
      note: 'Deleting it drops their values. You can undo this here.',
      action: 'Delete property',
      confirm: make,
    })
  }

  const cell = { px: 1, py: 0.75, minWidth: 0 } as const
  return (
    <Box sx={{ px: 1, pt: 1 }}>
      <Typography variant="overline" color="text.secondary" sx={{ px: 1, display: 'block' }}>Properties of {type.name}</Typography>
      {type.props.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1, pb: 1 }}>No properties. Placed {type.name} entities have only their behaviours&rsquo; values.</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) minmax(90px, 0.8fr) minmax(80px, 0.8fr) minmax(0, 1.4fr) max-content', alignItems: 'center' }}>
          {['Name', 'Type', 'Default', 'Allowed', ''].map((title, i) => (
            <Typography key={i} variant="caption" color="text.secondary" sx={{ px: 1 }}>{title}</Typography>
          ))}
          {type.props.map((def, index) => (
            <Box key={`${index}:${fresh}`} sx={{ display: 'contents' }}>
              <Box sx={cell}><TextInput label={`Name of property ${def.name} in ${type.name}`} value={def.name} onCommit={(next) => rename(index, next)} /></Box>
              <Box sx={cell}>
                <SelectInput label={`Type of ${def.name} in ${type.name}`} value={def.type} onChange={(next) => edit(index, withPropertyType(def, next))} options={PROPERTY_TYPES} />
              </Box>
              <Box sx={cell}>
                {def.type === 'int' ? (
                  <NumberInput label={`Default of ${def.name} in ${type.name}`} value={Number(def.default)} min={def.min ?? I32_MIN} max={def.max ?? I32_MAX} onCommit={(next) => edit(index, { ...def, default: next })} />
                ) : def.type === 'bool' ? (
                  <SelectInput label={`Default of ${def.name} in ${type.name}`} value={def.default ? 'yes' : 'no'} onChange={(next) => edit(index, { ...def, default: next === 'yes' })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                ) : def.type === 'enum' ? (
                  <SelectInput label={`Default of ${def.name} in ${type.name}`} value={String(def.default)} onChange={(next) => edit(index, { ...def, default: next })} options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                ) : (
                  <TextInput label={`Default of ${def.name} in ${type.name}`} value={String(def.default)} placeholder="Empty" allowEmpty onCommit={(next) => edit(index, { ...def, default: next })} />
                )}
              </Box>
              <Box sx={{ ...cell, display: 'flex', gap: 1 }}>
                {def.type === 'int' ? (
                  <>
                    <OptionalNumberInput label={`Smallest value of ${def.name} in ${type.name}`} placeholder="Smallest" value={def.min} parse={parseLimit} onCommit={(min) => {
                      const next = withLimits(def, min, def.max)
                      if (next) edit(index, next)
                      else refused(index, 'The smallest is over the largest.')
                    }} />
                    <OptionalNumberInput label={`Largest value of ${def.name} in ${type.name}`} placeholder="Largest" value={def.max} parse={parseLimit} onCommit={(max) => {
                      const next = withLimits(def, def.min, max)
                      if (next) edit(index, next)
                      else refused(index, 'The smallest is over the largest.')
                    }} />
                  </>
                ) : def.type === 'enum' ? (
                  <TextInput label={`Options of ${def.name} in ${type.name}, separated by commas`} value={(def.options ?? []).join(', ')} onCommit={(text) => {
                    const next = withOptions(def, text)
                    if (next) edit(index, next)
                    else refused(index, 'A list needs at least one option.')
                  }} />
                ) : null}
              </Box>
              <Box sx={cell}>
                <IconButton aria-label={`Delete property ${def.name} in ${type.name}`} title={`Delete ${def.name}`} onClick={() => remove(index)}><DeleteOutlinedIcon /></IconButton>
              </Box>
              {problem?.row === index && <Typography variant="body2" color="error" role="alert" sx={{ gridColumn: '1 / -1', px: 1, pb: 0.5 }}>{problem.text}</Typography>}
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ px: 1, pb: 1 }}>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setProps([...type.props, newProperty(type)])}>Add property</Button>
      </Box>
      {question && (
        <Dialog open onClose={close} fullWidth maxWidth="sm" aria-label={question.title}>
          <DialogTitle>{question.title}</DialogTitle>
          <DialogContent sx={{ px: 3, py: 1 }}>
            <Typography>{question.lead}</Typography>
            <Box component="ul" sx={{ m: 0, my: 1, pl: 3, maxHeight: 240, overflow: 'auto' }}>
              {question.lines.map((line, i) => <li key={i}>{line}</li>)}
            </Box>
            <Typography variant="body2" color="text.secondary">{question.note}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button color="error" variant="contained" onClick={question.confirm}>{question.action}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
