// A change to one document that has to change others with it (deleting a collision class
// reaches the tilesets and rooms that use it) is one undo step. Undo is per document, so
// the group is kept with the owner's history: moving the owner between two versions
// moves the others between theirs too, but only if they are still as the group left them.
// See design/US-015.md.

/** A document changed along with the owner: what it was and what the group made it, by identity. */
export interface Companion {
  kind: string
  id?: string
  /** What the author calls it, for the message: "Entry". */
  label: string
  before: unknown
  after: unknown
}

/** What to do to a companion when the owner moves one way: expect `from`, write `to`. */
interface Move {
  kind: string
  id?: string
  label: string
  from: unknown
  to: unknown
}

interface Edge {
  /** What happened, for the message: "the class was deleted". */
  what: string
  moves: Move[]
}

/** The groups, by the two versions of the owner they lie between. Nothing here is kept alive by it. */
export class GroupLinks {
  private edges = new WeakMap<object, WeakMap<object, Edge>>()

  private link(from: object, to: object, edge: Edge): void {
    let row = this.edges.get(from)
    if (!row) this.edges.set(from, (row = new WeakMap()))
    row.set(to, edge)
  }

  /** Remembers that the owner went from `previous` to `next` with these companions changed with it, undoing and redoing both ways. */
  record(previous: object, next: object, what: string, companions: readonly Companion[]): void {
    const move = (c: Companion, back: boolean): Move => ({ kind: c.kind, id: c.id, label: c.label, from: back ? c.after : c.before, to: back ? c.before : c.after })
    this.link(next, previous, { what, moves: companions.map((c) => move(c, true)) })
    this.link(previous, next, { what, moves: companions.map((c) => move(c, false)) })
  }

  /**
   * What moving the owner from `replaced` to `target` does to the others: nothing for a
   * plain step, the writes for a group whose companions are as it left them, or why not.
   * `current` reads a companion's document now.
   */
  step(replaced: unknown, target: unknown, current: (kind: string, id?: string) => unknown): { ok: true; writes: { kind: string; id?: string; doc: unknown }[] } | { ok: false; reason: string } {
    if (typeof replaced !== 'object' || replaced === null || typeof target !== 'object' || target === null) return { ok: true, writes: [] }
    const edge = this.edges.get(replaced)?.get(target)
    if (!edge) return { ok: true, writes: [] }
    const changed = edge.moves.filter((m) => current(m.kind, m.id) !== m.from)
    if (changed.length > 0) {
      const names = changed.map((m) => m.label)
      const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
      return { ok: false, reason: `${list} ${names.length === 1 ? 'was' : 'were'} changed after ${edge.what}. Undo that change first.` }
    }
    return { ok: true, writes: edge.moves.map((m) => ({ kind: m.kind, id: m.id, doc: m.to })) }
  }
}
