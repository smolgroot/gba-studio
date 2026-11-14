import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { DockviewReact, themeDark } from 'dockview-react'
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import { useEffect, useRef, useState } from 'react'
import { DocumentPanel, ProblemsPanel, ProjectPanel, PropertiesPanel } from './panels/panels.tsx'
import { BuildPanel } from './panels/play.tsx'
import { PalettePanel } from './panels/room.tsx'
import { BAR } from './theme.ts'
import { api } from './api.ts'
import { useEditor } from './editor.ts'
import { selectionFromHash, selectionKey, selectionTitle, useStudio } from './store.ts'
import type { Selection } from './store.ts'

export function App() {
  const bundle = useStudio((s) => s.bundle)
  const error = useStudio((s) => s.error)
  // Docked panels need room; a phone or a narrow window gets one panel at a time.
  const wide = useMediaQuery('(min-width:900px)')

  useEffect(() => {
    // Load at once; do not wait for the websocket to come up.
    void useStudio.getState().load()
    return useStudio.getState().watch()
  }, [])

  // Tell the server what is open, so a coding agent can be pointed at "this room".
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const post = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const { selection } = useStudio.getState()
        const { tool, layer, entity } = useEditor.getState()
        void api.context({ selection, ...(selection.kind === 'room' ? { editor: { tool, layer, entity } } : {}) }).catch(() => undefined)
      }, 250)
    }
    const stopStudio = useStudio.subscribe((now, before) => {
      if (now.selection !== before.selection || (now.connected && !before.connected)) post()
    })
    const stopEditor = useEditor.subscribe((now, before) => {
      if (now.tool !== before.tool || now.layer !== before.layer || now.entity !== before.entity) post()
    })
    return () => {
      clearTimeout(timer)
      stopStudio()
      stopEditor()
    }
  }, [])

  // A link pasted into the address bar, or edited there, opens its item.
  useEffect(() => {
    const onHash = () => useStudio.getState().select(selectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Undo and redo for the open document, unless a field is being typed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(event.target.tagName))) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) useStudio.getState().undo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') useStudio.getState().redo()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {!bundle ? (
          <Centre>{error ? `Cannot reach the studio server: ${error}` : 'Loading…'}</Centre>
        ) : !bundle.initialised ? (
          <NewProject />
        ) : wide ? (
          <DockLayout />
        ) : (
          <StackLayout />
        )}
      </Box>
    </Box>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  )
}

function TopBar() {
  const bundle = useStudio((s) => s.bundle)
  const connected = useStudio((s) => s.connected)
  const error = useStudio((s) => s.error)
  const saveError = useStudio((s) => s.saveError)
  const agent = useStudio((s) => s.agent)
  // What an agent just did stays up for a few seconds.
  const [agentShown, setAgentShown] = useState(false)
  useEffect(() => {
    if (!agent) return
    setAgentShown(true)
    const timer = setTimeout(() => setAgentShown(false), 8000)
    return () => clearTimeout(timer)
  }, [agent])
  const errors = bundle?.problems.filter((p) => p.severity === 'error').length ?? 0
  const warnings = (bundle?.problems.length ?? 0) - errors
  return (
    <Box component="header" sx={{ height: BAR.top, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, px: 3, bgcolor: '#141414', borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="img" src="/logo.png" alt="" sx={{ height: BAR.top - 14, width: 'auto', imageRendering: 'pixelated' }} />
        <Typography sx={{ fontWeight: 700, letterSpacing: 0.4 }}>Pecten-Studio</Typography>
      </Box>
      {bundle && (
        <Typography color="text.secondary" noWrap sx={{ flex: 1 }}>
          {bundle.docs.project?.name ?? bundle.folder}
        </Typography>
      )}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {agent && agentShown && (
          <Typography variant="body2" color={agent.failed ? 'warning.main' : 'primary.main'} role="status" noWrap title={agent.summary} sx={{ maxWidth: '45vw' }}>
            Agent · {agent.tool}: {agent.summary}
          </Typography>
        )}
        {saveError && (
          <Typography variant="body2" color="error" role="alert" noWrap title={saveError} sx={{ maxWidth: '40vw' }}>
            Not saved: {saveError}
          </Typography>
        )}
        {bundle?.initialised && (
          <>
            <Count icon={<ErrorOutlineIcon />} count={errors} colour="error.main" label="errors" />
            <Count icon={<WarningAmberIcon />} count={warnings} colour="warning.main" label="warnings" />
          </>
        )}
        {/* Shown only when something is wrong: the folder on disk is not being followed. */}
        {bundle && (!connected || error) && (
          <Typography variant="body2" color="warning.main" role="status">
            {error ? 'Server unreachable' : 'Reconnecting…'}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

function Count({ icon, count, colour, label }: { icon: React.ReactNode; count: number; colour: string; label: string }) {
  return (
    <Box aria-label={`${count} ${label}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: count ? colour : 'text.secondary' }}>
      {icon}
      <Typography variant="body2" color="inherit">{count}</Typography>
    </Box>
  )
}

function NewProject() {
  const folder = useStudio((s) => s.bundle!.folder)
  const error = useStudio((s) => s.error)
  const init = useStudio((s) => s.init)
  const [name, setName] = useState(folder)
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4 }}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) void init(name)
        }}
        sx={{ width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <Typography variant="h6" component="h1">New project</Typography>
        <Typography color="text.secondary">
          The folder “{folder}” has no studio project yet. Creating one adds a studio/ folder with three small JSON files; nothing else is touched.
        </Typography>
        <TextField label="Project name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        {error && <Typography color="error">{error}</Typography>}
        <Button type="submit" variant="contained" disabled={!name.trim()}>Create project</Button>
      </Box>
    </Box>
  )
}

const DOC_PREFIX = 'doc:'
const dockComponents = {
  project: () => <ProjectPanel />,
  properties: () => <PropertiesPanel />,
  palette: () => <PalettePanel />,
  problems: () => <ProblemsPanel />,
  build: () => <BuildPanel />,
  document: (props: IDockviewPanelProps<Selection>) => <DocumentPanel selection={props.params} />,
}

/** Desktop: panels dock, split and tab like an image editor's. Every opened item is a tab in the middle. */
function DockLayout() {
  const selection = useStudio((s) => s.selection)
  const bundle = useStudio((s) => s.bundle)
  const [api, setApi] = useState<DockviewApi | null>(null)
  const firstDoc = useRef(selection)

  // Open the selected item's tab, or bring it forward.
  useEffect(() => {
    if (!api) return
    const id = DOC_PREFIX + selectionKey(selection)
    const existing = api.getPanel(id)
    if (existing) {
      if (!existing.api.isActive) existing.api.setActive()
      return
    }
    const sibling = api.panels.find((p) => p.id.startsWith(DOC_PREFIX))
    api.addPanel({
      id,
      component: 'document',
      title: selectionTitle(selection, useStudio.getState().bundle),
      params: selection,
      position: sibling ? { referencePanel: sibling.id, direction: 'within' } : { referencePanel: 'project', direction: 'right' },
    })
  }, [api, selection])

  // Tabs follow renames on disk.
  useEffect(() => {
    if (!api) return
    for (const panel of api.panels) {
      if (panel.id.startsWith(DOC_PREFIX)) panel.api.setTitle(selectionTitle(panel.params as Selection, bundle))
    }
  }, [api, bundle])

  return (
    <DockviewReact
      theme={themeDark}
      components={dockComponents}
      onReady={(event) => {
        const dock = event.api
        const first = firstDoc.current
        const docId = DOC_PREFIX + selectionKey(first)
        dock.addPanel({ id: docId, component: 'document', title: selectionTitle(first, useStudio.getState().bundle), params: first })
        dock.addPanel({ id: 'project', component: 'project', title: 'Project', position: { referencePanel: docId, direction: 'left' }, initialWidth: 290 })
        dock.addPanel({ id: 'properties', component: 'properties', title: 'Properties', position: { referencePanel: docId, direction: 'right' }, initialWidth: 330 })
        dock.addPanel({ id: 'palette', component: 'palette', title: 'Tiles & Layers', position: { referencePanel: 'properties', direction: 'below' } })
        dock.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: docId, direction: 'below' }, initialHeight: 190 })
        dock.addPanel({ id: 'build', component: 'build', title: 'Build', position: { referencePanel: 'problems', direction: 'within' } })
        dock.getPanel('problems')?.api.setActive()
        dock.getPanel(docId)?.api.setActive()
        // Clicking a document tab selects it, so Properties describes what is in front.
        dock.onDidActivePanelChange(({ panel }) => {
          if (panel?.id.startsWith(DOC_PREFIX)) useStudio.getState().select(panel.params as Selection)
        })
        setApi(dock)
      }}
    />
  )
}

/** Narrow screens: one panel at a time, switched by tabs along the bottom. */
function StackLayout() {
  const selection = useStudio((s) => s.selection)
  const bundle = useStudio((s) => s.bundle)
  const problems = bundle?.problems.length ?? 0
  const [tab, setTab] = useState<'project' | 'document' | 'palette' | 'properties' | 'problems' | 'build'>('document')
  // Picking an item in the project list shows it.
  const shown = useRef(selectionKey(selection))
  useEffect(() => {
    if (shown.current !== selectionKey(selection)) {
      shown.current = selectionKey(selection)
      setTab('document')
    }
  }, [selection])

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, minHeight: 0, bgcolor: 'background.paper' }}>
        {tab === 'project' && <ProjectPanel />}
        {tab === 'document' && <DocumentPanel key={selectionKey(selection)} selection={selection} />}
        {tab === 'palette' && <PalettePanel />}
        {tab === 'properties' && <PropertiesPanel />}
        {tab === 'problems' && <ProblemsPanel />}
        {tab === 'build' && <BuildPanel />}
      </Box>
      <Tabs
        value={tab}
        onChange={(_event, value: typeof tab) => setTab(value)}
        variant="scrollable"
        scrollButtons={false}
        sx={{ flexShrink: 0, minHeight: 44, bgcolor: '#141414', borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)' }}
      >
        <Tab value="project" label="Project" sx={{ minHeight: 44, minWidth: 0 }} />
        <Tab value="document" label={selectionTitle(selection, bundle)} sx={{ minHeight: 44, minWidth: 0 }} />
        {selection.kind === 'room' && <Tab value="palette" label="Tiles" sx={{ minHeight: 44, minWidth: 0 }} />}
        <Tab value="properties" label="Properties" sx={{ minHeight: 44, minWidth: 0 }} />
        <Tab value="build" label="Build" sx={{ minHeight: 44, minWidth: 0 }} />
        <Tab value="problems" label={problems ? `Problems (${problems})` : 'Problems'} sx={{ minHeight: 44, minWidth: 0 }} />
      </Tabs>
    </Box>
  )
}
