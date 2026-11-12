// Tile layers are stored as run-length pairs `[count, cell, count, cell, ...]`:
// compact for big rooms and still diffable in git.

export function rleEncode(cells: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < cells.length; ) {
    const cell = cells[i]!
    let run = 1
    while (i + run < cells.length && cells[i + run] === cell) run++
    out.push(run, cell)
    i += run
  }
  return out
}

/** Total cells an encoded layer holds, or null if it is not well formed. */
export function rleLength(data: readonly number[]): number | null {
  if (data.length % 2 !== 0) return null
  let total = 0
  for (let i = 0; i < data.length; i += 2) {
    const run = data[i]!
    if (!Number.isInteger(run) || run < 1) return null
    total += run
  }
  return total
}

export function rleDecode(data: readonly number[]): Uint16Array {
  const length = rleLength(data)
  if (length === null) throw new Error('malformed run-length data')
  const out = new Uint16Array(length)
  let at = 0
  for (let i = 0; i < data.length; i += 2) {
    out.fill(data[i + 1]!, at, at + data[i]!)
    at += data[i]!
  }
  return out
}
