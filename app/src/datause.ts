// The level data reserve field in Project settings and the section use line in the
// Build panel: see design/US-006.md. Kept apart from the panels so they can be tested.

/** The largest reserve the project format takes (core/src/schema.ts). */
export const MAX_RESERVE = 1024 * 1024

/** Above this share of the capacity, a small edit may need a full build. */
const NEARLY_FULL = 0.9

/** Reads the reserve field: empty is the default, otherwise whole bytes in the schema's range. */
export function parseReserve(text: string): { ok: true; value: number | undefined } | { ok: false; problem: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN
  if (!Number.isSafeInteger(value) || value > MAX_RESERVE) return { ok: false, problem: `The reserve is a whole number of bytes, 0 to ${MAX_RESERVE}, or empty for the default.` }
  return { ok: true, value }
}

const count = (n: number) => n.toLocaleString('en-GB')

/** One line for a built ROM: how much of its level data section is used. */
export function dataUseLine(mode: 'dev' | 'release', data: { used: number; capacity: number } | null): { text: string; warning: boolean } {
  if (!data) return { text: `${mode} ROM · no level data section: the game does not read its level data from the ROM`, warning: false }
  const share = data.capacity ? data.used / data.capacity : 1
  return {
    text: `${mode} ROM · level data ${count(data.used)} of ${count(data.capacity)} bytes (${Math.round(share * 100)}%), ${count(data.capacity - data.used)} free`,
    warning: share > NEARLY_FULL,
  }
}
