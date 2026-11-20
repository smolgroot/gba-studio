// The only desktop ability a project page gets: telling the tab strip what its top bar would show.
import { contextBridge, ipcRenderer } from 'electron'
import type { PageBridge } from './protocol.ts'

const bridge: PageBridge = {
  status: (status) => ipcRenderer.send('page-status', status),
}
contextBridge.exposeInMainWorld('pectenPage', bridge)
