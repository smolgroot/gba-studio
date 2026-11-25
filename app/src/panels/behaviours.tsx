// Behaviours in the interface: an entity type's list on the Entities page, and the
// values a placed entity sets differently from its type in the room panel. The forms
// come from the runtime's declarations (core/src/behaviourschema.ts); every change is
// one commit, so one undo step.
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import {
  BEHAVIOURS, behaviourBlocker, behaviourDeclaration, behaviourFields, behaviourLabel, entityOverride, moveBehaviour, setBehaviourValue, shownEntityValue, withBehaviour, withoutBehaviour,
} from '@pecten-studio/core'
import type { BehaviourField, EntityType } from '@pecten-studio/core'
import { Checkbox, Field, Fields, NumberInput, OptionalNumberInput, SelectInput } from '../fields.tsx'

type Value = number | boolean | string

/** The type's behaviours in words, for its row when closed. */
export function behaviourNames(type: EntityType): string {
  return type.behaviours.map((b) => behaviourLabel(b.id)).join(', ') || 'No behaviours'
}

/** Reads a required whole number: empty is none, else a number in the field's range. */
function parseRequired(field: BehaviourField) {
  return (text: string): { ok: true; value: number | undefined } | { ok: false; problem: string } => {
    const trimmed = text.trim()
    if (trimmed === '') return { ok: true, value: undefined }
    const value = Number(trimmed)
    if (Number.isInteger(value) && value >= field.min! && value <= field.max!) return { ok: true, value }
    return { ok: false, problem: `${field.name} is a whole number from ${field.min} to ${field.max}` }
  }
}

/** The control for one behaviour property: `undefined` is no value (only a required one has none). */
function Control({ field, value, label, onCommit }: { field: BehaviourField; value: Value | undefined; label: string; onCommit: (value: number | boolean | undefined) => void }) {
  if (field.kind === 'bool') return <Checkbox checked={value === true} onChange={onCommit}>{field.summary}</Checkbox>
  if (field.required || value === undefined) {
    return <OptionalNumberInput label={label} value={typeof value === 'number' ? value : undefined} parse={parseRequired(field)} placeholder={`Required: ${field.min} to ${field.max}`} onCommit={onCommit} />
  }
  return <NumberInput label={label} value={Number(value)} min={field.min} max={field.max} onCommit={onCommit} />
}

/** An entity type's behaviours, each with a form, in the order the game runs them, and a list to add one. */
export function TypeBehaviours({ type, onChange }: { type: EntityType; onChange: (type: EntityType) => void }) {
  return (
    <Box sx={{ display: 'grid', gap: 1, px: 2, pb: 1.5 }}>
      {type.behaviours.map((use, index) => {
        const declaration = behaviourDeclaration(use.id)
        const fields = behaviourFields(use.id)
        const name = behaviourLabel(use.id)
        return (
          <Box key={use.id} sx={{ border: '1px solid #333', borderRadius: '3px', bgcolor: '#1c1c1c' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pt: 0.75, pb: fields.length ? 0 : 0.75 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography>{name}</Typography>
                <Typography variant="body2" color="text.secondary">{declaration?.summary ?? 'Not a behaviour the runtime has: see Problems.'}</Typography>
              </Box>
              <IconButton aria-label={`Run ${name} earlier`} title="Run earlier" disabled={index === 0} onClick={() => onChange(moveBehaviour(type, use.id, -1))}><ArrowUpwardIcon /></IconButton>
              <IconButton aria-label={`Run ${name} later`} title="Run later" disabled={index === type.behaviours.length - 1} onClick={() => onChange(moveBehaviour(type, use.id, 1))}><ArrowDownwardIcon /></IconButton>
              <IconButton aria-label={`Remove ${name} from ${type.name}`} title="Remove" onClick={() => onChange(withoutBehaviour(type, use.id))}><DeleteOutlinedIcon /></IconButton>
            </Box>
            {fields.length > 0 && (
              <Fields>
                {fields.map((field) => (
                  <Field key={field.name} label={field.name}>
                    <Box title={field.summary} sx={{ flex: 1, minWidth: 0 }}>
                      <Control field={field} value={use.props[field.name] ?? field.default} label={`${field.name} of ${name}: ${field.summary}`} onCommit={(value) => onChange(setBehaviourValue(type, use.id, field.name, value))} />
                    </Box>
                  </Field>
                ))}
              </Fields>
            )}
          </Box>
        )
      })}
      <SelectInput
        label={`Add a behaviour to ${type.name}`}
        value=""
        onChange={(id) => id && onChange(withBehaviour(type, id))}
        options={[
          { value: '', label: 'Add a behaviour…' },
          ...BEHAVIOURS.filter((b) => !type.behaviours.some((u) => u.id === b.id)).map((b) => {
            const blocker = behaviourBlocker(type, b.id)
            return { value: b.id, label: blocker ? `${behaviourLabel(b.id)} (${blocker})` : `${behaviourLabel(b.id)}: ${b.summary}`, disabled: blocker !== undefined }
          }),
        ]}
      />
    </Box>
  )
}

/**
 * A placed entity's behaviour properties: the type's value until the entity sets its
 * own, which is marked and can be reset. A value equal to the type's is not kept.
 */
export function BehaviourOverrides({ type, props, onChange }: { type: EntityType; props: Record<string, Value>; onChange: (props: Record<string, Value>) => void }) {
  const used = type.behaviours.filter((b, i) => behaviourDeclaration(b.id) && behaviourFields(b.id).length > 0 && type.behaviours.findIndex((o) => o.id === b.id) === i)
  if (used.length === 0) return null
  return (
    <>
      {used.map((use) => {
        const name = behaviourLabel(use.id)
        return (
          <Box key={use.id}>
            <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block' }}>{name}</Typography>
            <Fields>
              {behaviourFields(use.id).map((field) => {
                const shown = shownEntityValue(type, props, field.name)
                const set = (value: number | boolean | undefined) => onChange(entityOverride(type, props, field.name, value))
                return (
                  <Field key={field.name} label={field.name} marked={shown.overridden} mark={`Set on this entity; ${type.name} has ${shown.inherited ?? 'no value'}`}>
                    <Box title={field.summary} sx={{ flex: 1, minWidth: 0 }}>
                      <Control field={field} value={shown.value} label={`${field.name} of ${name} on this entity: ${field.summary}`} onCommit={set} />
                    </Box>
                    {shown.overridden && (
                      <IconButton
                        aria-label={`Reset ${field.name} to the type's value`}
                        title={`Reset to ${type.name}'s value${shown.inherited === undefined ? '' : `, ${shown.inherited}`}`}
                        onClick={() => onChange(entityOverride(type, props, field.name, undefined))}
                        sx={{ p: 0.5, color: 'text.secondary' }}
                      >
                        <RestartAltIcon />
                      </IconButton>
                    )}
                  </Field>
                )
              })}
            </Fields>
          </Box>
        )
      })}
    </>
  )
}
