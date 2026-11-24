/** Dock panel ids of document tabs start with this; the fixed panels (Project, Problems…) do not. */
export const DOC_PREFIX = 'doc:'

/**
 * The document tab that "close document" (Ctrl+W in the desktop app) closes: the active panel if it is a
 * document, else the tab of the selected item, which is the one in front while Project or Properties has
 * focus. Null when no document tab is open, so the key then does nothing.
 */
export function documentToClose({ active, selected, open }: { active: string | null; selected: string; open: string[] }): string | null {
  const isDoc = (id: string | null): id is string => !!id && id.startsWith(DOC_PREFIX) && open.includes(id)
  if (isDoc(active)) return active
  return isDoc(selected) ? selected : null
}
