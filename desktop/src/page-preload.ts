// What a project page gets from the desktop app: telling the tab strip what its top bar would show,
// and hearing the menu's Close Document.
import { contextBridge, ipcRenderer } from 'electron'
import { CLOSE_DOCUMENT } from './protocol.ts'
import type { PageBridge } from './protocol.ts'

const bridge: PageBridge = {
  status: (status) => ipcRenderer.send('page-status', status),
  onCloseDocument: (listener) => {
    // The page gets no IPC event object, only the call.
    const handler = () => listener()
    ipcRenderer.on(CLOSE_DOCUMENT, handler)
    return () => void ipcRenderer.off(CLOSE_DOCUMENT, handler)
  },
}
contextBridge.exposeInMainWorld('pectenPage', bridge)
