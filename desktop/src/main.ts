// The desktop app: one window, a tab strip, and a tab for each open game folder.
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { BaseWindow, Menu, WebContentsView, app, ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'
import { buildEnvironment, readLoginPath } from './env.ts'
import { menuTemplate } from './menu.ts'
import { Projects } from './projects.ts'
import type { Paths } from './projects.ts'
import { loadState } from './state.ts'

app.setName('pecten-studio')

/**
 * Whether to start again under XWayland instead of as a native Wayland client. On Wayland, Electron
 * draws the window frame itself from the GTK theme, which fails on GNOME 50 and leaves a transparent
 * window with no title bar; Wayland also ignores the window icon, so an AppImage with no installed
 * .desktop file shows none. Under X11 the window manager draws the frame and uses the icon.
 * The platform is chosen before this script runs, so the switch has to be on the command line.
 * Starting with `--ozone-platform=wayland` keeps Wayland.
 */
function relaunchUnderX11(): boolean {
  const { DISPLAY, WAYLAND_DISPLAY, XDG_SESSION_TYPE } = process.env
  const wayland = Boolean(WAYLAND_DISPLAY) || XDG_SESSION_TYPE === 'wayland'
  // Not app.commandLine.hasSwitch: Electron adds the switch itself once it has picked the platform.
  const chosen = process.argv.some((arg) => arg.startsWith('--ozone-platform'))
  if (process.platform !== 'linux' || !DISPLAY || !wayland || chosen) return false
  // An AppImage's files go away when this process exits, so start the AppImage itself again.
  app.relaunch({ execPath: process.env.APPIMAGE ?? process.execPath, args: [...process.argv.slice(1), '--ozone-platform=x11'] })
  app.exit(0)
  return true
}

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
  const template = menuTemplate(
    {
      openFolder: () => void projects.chooseFolder(),
      closeDocument: () => projects.closeDocument(),
      closeProject: () => projects.closeActive(),
      nextProject: () => projects.cycle(1),
      previousProject: () => projects.cycle(-1),
      copyEndpoint: () => projects.copyEndpoint(),
      reloadPages: () => projects.reloadPages(),
    },
    { devTools: !app.isPackaged },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function start(): void {
  const paths: Paths = {
    host: path.join(__dirname, 'host.mjs'),
    pagePreload: path.join(__dirname, 'page-preload.cjs'),
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
  ipcMain.on('page-status', (event, status: unknown) => projects.pageStatus(event.sender, status))
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

if (relaunchUnderX11()) {
  // The new process takes over.
} else if (app.requestSingleInstanceLock()) void app.whenReady().then(start)
else app.quit()
