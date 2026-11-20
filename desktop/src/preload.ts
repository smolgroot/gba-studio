// The only desktop abilities the shell page gets. Project pages get page-preload.ts.
import { contextBridge, ipcRenderer } from 'electron'
import type { ShellBridge, ShellState } from './protocol.ts'

const bridge: ShellBridge = {
  onState: (listener) => {
    ipcRenderer.on('state', (_event, state: ShellState) => listener(state))
    ipcRenderer.send('shell-ready')
  },
  openFolder: () => ipcRenderer.send('open-folder'),
  open: (root) => ipcRenderer.send('open', root),
  activate: (root) => ipcRenderer.send('activate', root),
  close: (root) => ipcRenderer.send('close', root),
  restart: (root) => ipcRenderer.send('restart', root),
  forget: (root) => ipcRenderer.send('forget', root),
}
contextBridge.exposeInMainWorld('pecten', bridge)
