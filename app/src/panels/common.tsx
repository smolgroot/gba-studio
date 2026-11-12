// Bits shared by the editors: importing files, and the undo buttons.
import RedoIcon from '@mui/icons-material/Redo'
import UndoIcon from '@mui/icons-material/Undo'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import Button from '@mui/material/Button'
import { useRef } from 'react'
import { useHistoryDepth, useStudio } from '../store.ts'
import { ToolButton } from './views.tsx'

/** Picks files on this device and stores them in a folder of the game; reports the paths that were stored. */
export function ImportButton({ label, accept, folder, multiple, onImported }: { label: string; accept: string; folder: string; multiple?: boolean; onImported?: (paths: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const upload = useStudio((s) => s.upload)
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          const stored: string[] = []
          for (const file of files) {
            const path = await upload(file, folder)
            if (path) stored.push(path)
          }
          if (stored.length) onImported?.(stored)
        }}
      />
      <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => input.current?.click()}>{label}</Button>
    </>
  )
}

export function UndoButtons() {
  const undo = useStudio((s) => s.undo)
  const redo = useStudio((s) => s.redo)
  const depth = useHistoryDepth()
  return (
    <>
      <ToolButton title="Undo (Ctrl+Z)" disabled={depth.undo === 0} onClick={undo}><UndoIcon /></ToolButton>
      <ToolButton title="Redo (Ctrl+Shift+Z)" disabled={depth.redo === 0} onClick={redo}><RedoIcon /></ToolButton>
    </>
  )
}

/** A display name for a new item from a file path: "assets/hero-run.png" gives "hero run". */
export function nameFromPath(path: string): string {
  return path.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Untitled'
}
