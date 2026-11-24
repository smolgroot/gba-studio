// The open projects: for each, a server process and a page, one page on screen at a time.
import { existsSync, realpathSync, statSync, watch } from 'node:fs'
import { BaseWindow, WebContentsView, clipboard, dialog, shell, utilityProcess } from 'electron'
import type { UtilityProcess, WebContents } from 'electron'
import type { HostMessage, HostRequest, HostStart } from '../../server/src/host.ts'
import { CLOSE_DOCUMENT, TAB_BAR_HEIGHT } from './protocol.ts'
import type { BuildMarker, PageStatus, ShellState, TabState } from './protocol.ts'
import { portCandidates, saveState, withRecent } from './state.ts'
import type { DesktopState } from './state.ts'

export interface Paths {
  host: string
  /** The preload script for project pages. */
  pagePreload: string
  appDist: string
  crates: string
  emulatorCore: string
  stateFile: string
}

interface Tab extends TabState {
  child: UtilityProcess | null
  view: WebContentsView | null
  url: string | null
  closing: boolean
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const isWeb = (url: string) => /^https?:\/\//i.test(url)

const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0)
const text = (value: unknown, max = 500) => (typeof value === 'string' ? value.slice(0, max) : null)

/** A page's status, kept to the expected shape: it comes from the page, which the project controls. */
function readPageStatus(value: unknown): PageStatus | null {
  if (!value || typeof value !== 'object') return null
  const status = value as Record<string, unknown>
  const agent = status.agent && typeof status.agent === 'object' ? (status.agent as Record<string, unknown>) : null
  const rom = status.rom && typeof status.rom === 'object' ? (status.rom as Record<string, unknown>) : null
  const tone = rom?.tone === 'ok' || rom?.tone === 'warning' ? rom.tone : 'quiet'
  return {
    initialised: status.initialised === true,
    errors: count(status.errors),
    warnings: count(status.warnings),
    saveError: text(status.saveError),
    agent: agent ? { tool: text(agent.tool, 100) ?? '', summary: text(agent.summary) ?? '', failed: agent.failed === true } : null,
    offline: text(status.offline, 100),
    rom: rom ? { text: text(rom.text, 200) ?? '', detail: text(rom.detail, 2000) ?? '', tone } : null,
  }
}

export class Projects {
  private readonly tabs = new Map<string, Tab>()
  private readonly window: BaseWindow
  private readonly shellView: WebContentsView
  private readonly paths: Paths
  private readonly state: DesktopState
  private readonly buildEnv: Promise<NodeJS.ProcessEnv>
  private active: string | null = null
  private missing: string[] = []
  private stopping = false

  constructor(window: BaseWindow, shellView: WebContentsView, paths: Paths, state: DesktopState, buildEnv: Promise<NodeJS.ProcessEnv>) {
    this.window = window
    this.shellView = shellView
    this.paths = paths
    this.state = state
    this.buildEnv = buildEnv
    window.on('resize', () => this.layout())
  }

  /** Reopens what was open when the app last closed. */
  restore(): void {
    const { open, active } = this.state
    this.missing = open.filter((root) => !this.isFolder(root))
    for (const root of open) if (this.isFolder(root)) this.open(root, false)
    const wanted = active && this.tabs.has(active) ? active : ([...this.tabs.keys()][0] ?? null)
    if (wanted) this.activate(wanted)
    this.publish()
  }

  private isFolder(root: string): boolean {
    try {
      return statSync(root).isDirectory()
    } catch {
      return false
    }
  }

  async chooseFolder(): Promise<void> {
    const result = await dialog.showOpenDialog(this.window, { title: 'Open a game folder', properties: ['openDirectory', 'createDirectory'] })
    if (!result.canceled && result.filePaths[0]) this.open(result.filePaths[0])
  }

  /** Opens a folder in a new tab, or shows the tab it already has. */
  open(folder: string, show = true): void {
    if (!this.isFolder(folder)) {
      dialog.showErrorBox('Cannot open this folder', `${folder} is not a folder that exists.`)
      return
    }
    const root = realpathSync(folder)
    if (!this.tabs.has(root)) {
      const tab: Tab = { root, name: root.split('/').pop() || root, status: 'starting', error: null, build: 'idle', port: null, page: null, child: null, view: null, url: null, closing: false }
      this.tabs.set(root, tab)
      this.state.recent = withRecent(this.state.recent, root)
      this.missing = this.missing.filter((item) => item !== root)
      void this.start(tab)
    }
    if (show) this.activate(root)
    this.changed()
  }

  activate(root: string): void {
    if (!this.tabs.has(root)) return
    this.active = root
    this.changed()
    this.tabs.get(root)!.view?.webContents.focus()
  }

  /** Moves to the next tab, or by -1 to the previous one. */
  cycle(step: 1 | -1): void {
    const roots = [...this.tabs.keys()]
    if (roots.length < 2) return
    const index = roots.indexOf(this.active ?? '')
    this.activate(roots[(index + step + roots.length) % roots.length]!)
  }

  closeActive(): void {
    if (this.active) void this.close(this.active)
  }

  /** Asks the active project's page to close its document tab in front. A project with no page yet ignores it. */
  closeDocument(): void {
    const contents = this.active ? this.tabs.get(this.active)?.view?.webContents : undefined
    if (contents && !contents.isDestroyed()) contents.send(CLOSE_DOCUMENT)
  }

  forget(root: string): void {
    this.state.recent = this.state.recent.filter((item) => item !== root)
    this.missing = this.missing.filter((item) => item !== root)
    delete this.state.ports[root]
    this.changed()
  }

  copyEndpoint(): void {
    const tab = this.active ? this.tabs.get(this.active) : undefined
    if (tab?.url) clipboard.writeText(`${tab.url}/mcp`)
  }

  hasReadyTab(): boolean {
    return !!(this.active && this.tabs.get(this.active)?.url)
  }

  reloadPages(): void {
    for (const tab of this.tabs.values()) tab.view?.webContents.reload()
  }

  /** In development, shows a rebuilt page as soon as it is there. */
  watchPage(): void {
    let timer: NodeJS.Timeout | undefined
    watch(this.paths.appDist, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (existsSync(`${this.paths.appDist}/index.html`)) this.reloadPages()
      }, 400)
    })
  }

  async restart(root: string): Promise<void> {
    const tab = this.tabs.get(root)
    if (!tab || tab.status === 'starting' || tab.status === 'ready') return
    await this.start(tab)
  }

  async close(root: string): Promise<void> {
    const tab = this.tabs.get(root)
    if (!tab || tab.closing) return
    if (tab.build === 'running') {
      const { response } = await dialog.showMessageBox(this.window, {
        type: 'warning',
        message: `${tab.name} is still building`,
        detail: 'Closing this project stops its build.',
        buttons: ['Stop build and close', 'Keep open'],
        defaultId: 1,
        cancelId: 1,
      })
      if (response !== 0) return
    }
    tab.closing = true
    await this.stopTab(tab)
    const roots = [...this.tabs.keys()]
    const index = roots.indexOf(root)
    this.tabs.delete(root)
    if (this.active === root) {
      const rest = roots.filter((item) => item !== root)
      this.active = rest[Math.min(index, rest.length - 1)] ?? null
    }
    this.changed()
    if (this.active) this.tabs.get(this.active)?.view?.webContents.focus()
  }

  /** Saves everything and stops every server. The tabs are remembered for next time. */
  async shutdown(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.persist()
    await Promise.all([...this.tabs.values()].map((tab) => {
      tab.closing = true
      return this.stopTab(tab)
    }))
  }

  private async stopTab(tab: Tab): Promise<void> {
    const contents = tab.view?.webContents
    if (contents && !contents.isDestroyed()) {
      // Edits made in the last moments may not have been written yet.
      await Promise.race([contents.executeJavaScript('window.pectenFlushSaves?.()', true).catch(() => undefined), delay(3000)])
    }
    this.removeView(tab)
    const child = tab.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 4000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.postMessage({ type: 'close' } satisfies HostRequest)
    })
  }

  private removeView(tab: Tab): void {
    const view = tab.view
    if (!view) return
    tab.view = null
    tab.url = null
    tab.page = null
    this.window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private async start(tab: Tab): Promise<void> {
    tab.status = 'starting'
    tab.error = null
    tab.build = 'idle'
    this.changed()
    const buildEnv = await this.buildEnv
    const taken = (port: number) => [...this.tabs.values()].some((other) => other !== tab && other.port === port)
    for (const port of portCandidates(tab.root, this.state, taken)) {
      if (tab.closing) return
      tab.port = port
      const outcome = await this.launch(tab, port, buildEnv)
      if (outcome !== 'port-busy') return
    }
    this.fail(tab, 'No free port was found for this project.')
  }

  /** One attempt at starting the project's server on a port. */
  private launch(tab: Tab, port: number, buildEnv: NodeJS.ProcessEnv): Promise<'ready' | 'failed' | 'port-busy'> {
    return new Promise((resolve) => {
      const child = utilityProcess.fork(this.paths.host, [], { serviceName: `Pecten Studio: ${tab.name}` })
      tab.child = child
      let started = false
      let settled = false
      const settle = (outcome: 'ready' | 'failed' | 'port-busy') => {
        if (settled) return
        settled = true
        resolve(outcome)
      }
      child.on('spawn', () => {
        const start: HostStart = { type: 'start', folder: tab.root, port, appDist: this.paths.appDist, crates: this.paths.crates, emulatorCore: this.paths.emulatorCore, buildEnv }
        child.postMessage(start)
      })
      child.on('message', (message: HostMessage) => {
        if (message.type === 'ready') {
          started = true
          this.ready(tab, message.url, message.port, message.name)
          settle('ready')
        } else if (message.type === 'failed') {
          child.kill()
          if (message.code === 'EADDRINUSE') {
            settle('port-busy')
          } else {
            this.fail(tab, message.message)
            settle('failed')
          }
        } else if (message.type === 'name') {
          tab.name = message.name
          this.changed()
        } else if (message.type === 'event') {
          this.buildEvent(tab, message.event)
        }
      })
      child.once('exit', (code) => {
        if (tab.child === child) tab.child = null
        if (settled && !started) return
        if (tab.closing) return settle('failed')
        if (started) {
          // The server is gone, so the page could no longer save anything.
          this.removeView(tab)
          this.fail(tab, `The project's server stopped unexpectedly (exit code ${code}).`, 'stopped')
        } else {
          this.fail(tab, `The project's server could not start (exit code ${code}).`)
        }
        settle('failed')
      })
    })
  }

  private fail(tab: Tab, message: string, status: 'failed' | 'stopped' = 'failed'): void {
    tab.status = status
    tab.error = message
    tab.build = 'idle'
    this.changed()
  }

  private buildEvent(tab: Tab, event: { type: string; status?: { exitCode: number | null; stopped: boolean } }): void {
    let build: BuildMarker = tab.build
    if (event.type === 'build-started') build = 'running'
    else if (event.status) build = event.status.stopped ? 'idle' : event.status.exitCode === 0 ? 'ok' : 'failed'
    tab.build = build
    this.publish()
  }

  private ready(tab: Tab, url: string, port: number, name: string): void {
    tab.url = url
    tab.port = port
    tab.name = name
    tab.status = 'ready'
    this.state.ports[tab.root] = port
    const view = new WebContentsView({ webPreferences: { preload: this.paths.pagePreload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    view.setBackgroundColor('#1c1c1c')
    tab.view = view
    this.guard(view.webContents, url, tab)
    this.window.contentView.addChildView(view)
    void view.webContents.loadURL(url)
    this.changed()
    if (this.active === tab.root) view.webContents.focus()
  }

  /** A project's page stays on its own server; links to the web open in the browser. */
  private guard(contents: WebContents, url: string, tab: Tab): void {
    const { origin } = new URL(url)
    const external = (target: string) => {
      if (isWeb(target)) void shell.openExternal(target)
    }
    contents.on('will-navigate', (event, target) => {
      if (new URL(target).origin === origin) return
      event.preventDefault()
      external(target)
    })
    contents.setWindowOpenHandler(({ url: target }) => {
      external(target)
      return { action: 'deny' }
    })
    contents.session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
    contents.on('render-process-gone', () => {
      if (!tab.closing && !contents.isDestroyed()) contents.reload()
    })
  }

  /** A project page's top bar status, which the tab strip shows on its line. */
  pageStatus(sender: WebContents, status: unknown): void {
    const tab = [...this.tabs.values()].find((t) => t.view?.webContents === sender)
    const page = tab && readPageStatus(status)
    if (!tab || !page) return
    tab.page = page
    this.publish()
  }

  private layout(): void {
    const [width, height] = this.window.getContentSize() as [number, number]
    const shown = this.active ? this.tabs.get(this.active) : undefined
    const hasPage = !!shown?.view
    // Without a page on screen, the shell shows the welcome or status screen.
    this.shellView.setBounds({ x: 0, y: 0, width, height: this.active && hasPage ? TAB_BAR_HEIGHT : height })
    for (const tab of this.tabs.values()) {
      if (!tab.view) continue
      const visible = tab === shown
      tab.view.setVisible(visible)
      if (visible) tab.view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) })
    }
  }

  private persist(): void {
    if (this.stopping && this.tabs.size === 0) return
    this.state.open = [...this.tabs.keys()]
    this.state.active = this.active
    try {
      saveState(this.paths.stateFile, this.state)
    } catch (error) {
      console.error('could not save the list of open projects:', error)
    }
  }

  snapshot(): ShellState {
    return {
      tabs: [...this.tabs.values()].map(({ root, name, status, error, build, port, page }) => ({ root, name, status, error, build, port, page })),
      active: this.active,
      recent: this.state.recent.map((root) => ({ root, exists: this.isFolder(root) })),
      missing: this.missing,
    }
  }

  publish(): void {
    const contents = this.shellView.webContents
    if (!contents.isDestroyed()) contents.send('state', this.snapshot())
  }

  private changed(): void {
    if (this.stopping) return
    this.layout()
    this.persist()
    this.publish()
    const name = this.active ? this.tabs.get(this.active)?.name : undefined
    this.window.setTitle(name ? `${name} - Pecten Studio` : 'Pecten Studio')
  }
}
