// Small, dense form controls. Text and number fields keep what is typed to themselves
// and hand it over on Enter or when focus leaves, so one edit is one undo step.
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { BAR, ui } from './theme.ts'

const controlSx = {
  width: '100%',
  minWidth: 0,
  height: BAR.input,
  px: 1.5,
  font: 'inherit',
  fontSize: ui(12),
  color: 'text.primary',
  bgcolor: '#191919',
  border: '1px solid #3a3a3a',
  borderRadius: '3px',
  outline: 'none',
  '&:focus': { borderColor: 'primary.main' },
  '&:disabled': { opacity: 0.5 },
} as const

export function TextInput({ value, onCommit, label, placeholder, disabled }: { value: string; onCommit: (value: string) => void; label: string; placeholder?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (next && next !== value) onCommit(next)
    else setDraft(value)
  }
  return (
    <Box
      component="input"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
      }}
      sx={controlSx}
    />
  )
}

export function NumberInput({ value, onCommit, label, min, max, disabled }: { value: number; onCommit: (value: number) => void; label: string; min?: number; max?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const parsed = Math.round(Number(draft))
    if (draft.trim() === '' || !Number.isFinite(parsed)) return setDraft(String(value))
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }
  return (
    <Box
      component="input"
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(String(value))
      }}
      sx={controlSx}
    />
  )
}

export function SelectInput<T extends string>({ value, onChange, options, label, disabled }: { value: T; onChange: (value: T) => void; options: ReadonlyArray<{ value: T; label: string }>; label: string; disabled?: boolean }) {
  return (
    <Box component="select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)} sx={{ ...controlSx, px: 1 }}>
      {/* A value that is not among the choices (a deleted tileset, say) still shows, marked. */}
      {!options.some((o) => o.value === value) && <option value={value}>{value ? `${value} (missing)` : 'Choose…'}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </Box>
  )
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  const id = useId()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: BAR.input }}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ margin: 0, width: ui(13), height: ui(13), accentColor: '#4c9ffe' }} />
      <Typography component="label" htmlFor={id}>{children}</Typography>
    </Box>
  )
}

/** Label and control rows, the label column as wide as its longest label. */
export function Fields({ children }: { children: ReactNode }) {
  return <Box sx={{ px: 2, py: 1.5, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 3, rowGap: 1, alignItems: 'center' }}>{children}</Box>
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Typography color="text.secondary" noWrap>{label}</Typography>
      <Box sx={{ minWidth: 0, display: 'flex', gap: 1, alignItems: 'center' }}>{children}</Box>
    </>
  )
}
