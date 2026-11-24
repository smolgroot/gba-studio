// The application menu. Only Electron's types are used here, so the template can be tested without it.

/** What the menu's items do. */
export interface MenuActions {
  openFolder: () => void
  /** Closes the document tab in front in the active project, as in a code editor. */
  closeDocument: () => void
  closeProject: () => void
  nextProject: () => void
  previousProject: () => void
  copyEndpoint: () => void
  reloadPages: () => void
}

export function menuTemplate(actions: MenuActions, options: { devTools: boolean }): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: actions.openFolder },
        { type: 'separator' },
        // Ctrl+W closes a document because that is what it does in a code editor; the project needs Shift.
        { label: 'Close Document', accelerator: 'CmdOrCtrl+W', click: actions.closeDocument },
        { label: 'Close Project', accelerator: 'CmdOrCtrl+Shift+W', click: actions.closeProject },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Project',
      submenu: [
        { label: 'Next Project', accelerator: 'Ctrl+Tab', click: actions.nextProject },
        { label: 'Previous Project', accelerator: 'Ctrl+Shift+Tab', click: actions.previousProject },
        { type: 'separator' },
        { label: 'Copy MCP Endpoint', click: actions.copyEndpoint },
      ],
    },
    {
      label: 'View',
      // No Edit menu: its Undo would take Ctrl+Z away from the editors.
      submenu: [
        { label: 'Reload Projects', click: actions.reloadPages },
        { role: 'togglefullscreen' },
        ...(options.devTools ? [{ role: 'toggleDevTools' } as const] : []),
      ],
    },
  ]
}
