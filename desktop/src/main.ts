// The desktop app: one window, a tab strip, and a tab for each open game folder.
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { BaseWindow, Menu, WebContentsView, app, ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'
import { buildEnvironment, readLoginPath } from './env.ts'
import { Projects } from './projects.ts'
import type { Paths } from './projects.ts'
import { loadState } from './state.ts'

app.setName('pecten-studio')

const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../..')
const appDist = path.join(resources, app.isPackaged ? 'studio-page' : 'app/dist')
// Set on the window too: an AppImage run directly has no installed .desktop file to supply it.
const icon = path.join(resources, app.isPackaged ? 'icon.png' : 'desktop/build/icon.png')

/** Folders named on a command line. */
function foldersIn(argv: string[], cwd: string): string[] {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => path.resolve(cwd, arg))
    .filter((folder) => existsSync(folder) && statSync(folder).isDirectory())
}

function buildMenu(projects: Projects): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => void projects.chooseFolder() },
        { label: 'Close Project', accelerator: 'CmdOrCtrl+W', click: () => projects.closeActive() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Project',
      submenu: [
        { label: 'Next Project', accelerator: 'Ctrl+Tab', click: () => projects.cycle(1) },
        { label: 'Previous Project', accelerator: 'Ctrl+Shift+Tab', click: () => projects.cycle(-1) },
        { type: 'separator' },
        { label: 'Copy MCP Endpoint', click: () => projects.copyEndpoint() },
      ],
    },
    {
      label: 'View',
      // No Edit menu: its Undo would take Ctrl+Z away from the editors.
      submenu: [
        { label: 'Reload Projects', click: () => projects.reloadPages() },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function start(): void {
  const paths: Paths = {
    host: path.join(__dirname, 'host.mjs'),
    appDist,
    crates: app.isPackaged ? path.join(resources, 'crates') : resources,
    emulatorCore: path.join(appDist, 'wasm/pecten.js'),
    stateFile: path.join(app.getPath('userData'), 'projects.json'),
  }
  const window = new BaseWindow({ width: 1440, height: 900, minWidth: 720, minHeight: 480, title: 'Pecten Studio', icon, backgroundColor: '#1c1c1c' })
  const shellView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  shellView.setBackgroundColor('#141414')
  window.contentView.addChildView(shellView)

  const buildEnv = readLoginPath().then((loginPath) => buildEnvironment(process.env, loginPath, homedir()))
  const projects = new Projects(window, shellView, paths, loadState(paths.stateFile), buildEnv)
  buildMenu(projects)

  const contents = shellView.webContents
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const fromShell = (listener: (root: string) => void) => (event: IpcMainEvent, root: unknown) => {
    if (event.sender === contents && typeof root === 'string') listener(root)
  }
  ipcMain.on('shell-ready', (event) => {
    if (event.sender === contents) projects.publish()
  })
  ipcMain.on('open-folder', (event) => {
    if (event.sender === contents) void projects.chooseFolder()
  })
  ipcMain.on('open', fromShell((root) => projects.open(root)))
  ipcMain.on('activate', fromShell((root) => projects.activate(root)))
  ipcMain.on('close', fromShell((root) => void projects.close(root)))
  ipcMain.on('restart', fromShell((root) => void projects.restart(root)))
  ipcMain.on('forget', fromShell((root) => projects.forget(root)))
  void contents.loadFile(path.join(__dirname, 'shell/index.html'))

  app.on('second-instance', (_event, argv, cwd) => {
    for (const folder of foldersIn(argv, cwd)) projects.open(folder)
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  // Closing waits until every project has saved and its server has stopped.
  let closed = false
  const quit = () => {
    if (closed) return
    closed = true
    void projects.shutdown().finally(() => app.exit(0))
  }
  window.on('close', (event) => {
    event.preventDefault()
    quit()
  })
  app.on('before-quit', (event) => {
    event.preventDefault()
    quit()
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, quit)

  projects.restore()
  for (const folder of foldersIn(process.argv, process.cwd())) projects.open(folder)
  if (process.env.PECTEN_DESKTOP_DEV) projects.watchPage()
}

if (app.requestSingleInstanceLock()) void app.whenReady().then(start)
else app.quit()
