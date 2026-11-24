import { describe, expect, it, vi } from 'vitest'
import { menuTemplate } from '../src/menu.ts'
import type { MenuActions } from '../src/menu.ts'

type Item = Electron.MenuItemConstructorOptions

function actions(): MenuActions {
  return {
    openFolder: vi.fn(),
    closeDocument: vi.fn(),
    closeProject: vi.fn(),
    nextProject: vi.fn(),
    previousProject: vi.fn(),
    copyEndpoint: vi.fn(),
    reloadPages: vi.fn(),
  }
}

function fileItem(template: Item[], label: string): Item {
  const file = template.find((item) => item.label === 'File')
  const item = (file?.submenu as Item[] | undefined)?.find((entry) => entry.label === label)
  if (!item) throw new Error(`no ${label} in the File menu`)
  return item
}

const click = (item: Item) => (item.click as () => void)()

describe('the File menu', () => {
  it('closes the document with Ctrl+W and the project with Ctrl+Shift+W', () => {
    const acts = actions()
    const template = menuTemplate(acts, { devTools: false })
    const doc = fileItem(template, 'Close Document')
    const project = fileItem(template, 'Close Project')
    expect(doc.accelerator).toBe('CmdOrCtrl+W')
    expect(project.accelerator).toBe('CmdOrCtrl+Shift+W')
    click(doc)
    expect(acts.closeDocument).toHaveBeenCalledOnce()
    expect(acts.closeProject).not.toHaveBeenCalled()
    click(project)
    expect(acts.closeProject).toHaveBeenCalledOnce()
  })
  it('gives no other item Ctrl+W', () => {
    const all = (items: Item[]): Item[] => items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? all(item.submenu) : [])])
    const owners = all(menuTemplate(actions(), { devTools: true })).filter((item) => item.accelerator === 'CmdOrCtrl+W')
    expect(owners.map((item) => item.label)).toEqual(['Close Document'])
  })
  it('shows developer tools only when asked', () => {
    const roles = (devTools: boolean) => JSON.stringify(menuTemplate(actions(), { devTools })).includes('toggleDevTools')
    expect(roles(false)).toBe(false)
    expect(roles(true)).toBe(true)
  })
})
