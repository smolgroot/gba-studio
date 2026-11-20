// The tab strip, and the screens shown when no project page is: welcome, starting, failed.
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import FolderOpenIcon from '@mui/icons-material/FolderOpenOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CssBaseline from '@mui/material/CssBaseline'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { ThemeProvider } from '@mui/material/styles'
import { StrictMode, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import logo from '../../app/public/logo.png'
import { theme } from '../../app/src/theme.ts'
import { TAB_BAR_HEIGHT } from '../src/protocol.ts'
import type { BuildMarker, PageStatus, ShellBridge, ShellState, TabState } from '../src/protocol.ts'

const pecten = (window as unknown as { pecten: ShellBridge }).pecten

const MARKERS: Record<Exclude<BuildMarker, 'idle'>, { colour: string; label: string }> = {
  running: { colour: 'primary.main', label: 'Building' },
  ok: { colour: 'success.main', label: 'Last build succeeded' },
  failed: { colour: 'error.main', label: 'Last build failed' },
}

function ProjectTab({ tab, active }: { tab: TabState; active: boolean }) {
  const marker = tab.status === 'failed' || tab.status === 'stopped' ? MARKERS.failed : tab.build === 'idle' ? null : MARKERS[tab.build]
  const label = tab.status === 'ready' ? marker?.label : (tab.error ?? 'Starting')
  return (
    <Tooltip title={tab.root} enterDelay={700}>
      <Box
        role="tab"
        tabIndex={0}
        aria-selected={active}
        onClick={() => pecten.activate(tab.root)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') pecten.activate(tab.root)
        }}
        onAuxClick={(event) => {
          if (event.button === 1) pecten.close(tab.root)
        }}
        sx={{
          height: '100%', minWidth: 110, maxWidth: 220, flex: '0 1 auto', display: 'flex', alignItems: 'center', gap: 1, pl: 2, pr: 1, cursor: 'default', userSelect: 'none',
          bgcolor: active ? 'background.default' : 'transparent', color: active ? 'text.primary' : 'text.secondary',
          borderRight: 1, borderColor: 'divider', boxShadow: active ? 'inset 0 2px 0 #4c9ffe' : 'none',
          '&:hover': { color: 'text.primary' }, '&:focus-visible': { outline: '1px solid #4c9ffe', outlineOffset: -1 },
        }}
      >
        {marker && <Box aria-label={label} role="img" sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: marker.colour }} />}
        <Typography noWrap color="inherit" sx={{ flex: 1, minWidth: 0 }}>{tab.name}</Typography>
        <IconButton
          aria-label={`Close ${tab.name}`}
          onClick={(event) => {
            event.stopPropagation()
            pecten.close(tab.root)
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </Tooltip>
  )
}

function Count({ icon, count, colour, label }: { icon: ReactNode; count: number; colour: string; label: string }) {
  return (
    <Box aria-label={`${count} ${label}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: count ? colour : 'text.secondary' }}>
      {icon}
      <Typography variant="body2" color="inherit">{count}</Typography>
    </Box>
  )
}

/** What the active project's page would show in its own top bar. */
function PageStatusBar({ page }: { page: PageStatus }) {
  return (
    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, px: 2, flexShrink: 1, minWidth: 0 }}>
      {page.agent && (
        <Typography variant="body2" color={page.agent.failed ? 'warning.main' : 'primary.main'} role="status" noWrap title={page.agent.summary} sx={{ minWidth: 0 }}>
          Agent · {page.agent.tool}: {page.agent.summary}
        </Typography>
      )}
      {page.saveError && (
        <Typography variant="body2" color="error" role="alert" noWrap title={page.saveError} sx={{ minWidth: 0 }}>
          Not saved: {page.saveError}
        </Typography>
      )}
      {page.initialised && (
        <>
          <Count icon={<ErrorOutlineIcon />} count={page.errors} colour="error.main" label="errors" />
          <Count icon={<WarningAmberIcon />} count={page.warnings} colour="warning.main" label="warnings" />
        </>
      )}
      {page.offline && <Typography variant="body2" color="warning.main" role="status" noWrap sx={{ flexShrink: 0 }}>{page.offline}</Typography>}
    </Box>
  )
}

/** One line: the app's name, the open projects, and the active project's status. */
function TabBar({ state }: { state: ShellState }) {
  const page = state.tabs.find((tab) => tab.root === state.active)?.page
  return (
    <Box component="header" sx={{ height: TAB_BAR_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'stretch', bgcolor: '#141414', borderBottom: 1, borderColor: 'divider', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, flexShrink: 0, borderRight: 1, borderColor: 'divider' }}>
        <Box component="img" src={logo} alt="" sx={{ height: TAB_BAR_HEIGHT - 16, width: 'auto', imageRendering: 'pixelated' }} />
        <Typography noWrap sx={{ fontWeight: 700, letterSpacing: 0.4 }}>Pecten Studio</Typography>
      </Box>
      <Box role="tablist" aria-label="Open projects" sx={{ display: 'flex', alignItems: 'stretch', flex: '0 1 auto', minWidth: 0, overflow: 'hidden' }}>
        {state.tabs.map((tab) => <ProjectTab key={tab.root} tab={tab} active={tab.root === state.active} />)}
      </Box>
      <Tooltip title="Open folder (Ctrl+O)">
        <IconButton aria-label="Open folder" onClick={() => pecten.openFolder()} sx={{ alignSelf: 'center', mx: 1, flexShrink: 0 }}><AddIcon /></IconButton>
      </Tooltip>
      {page && <PageStatusBar page={page} />}
    </Box>
  )
}

function Welcome({ state }: { state: ShellState }) {
  return (
    <Box sx={{ width: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box component="img" src={logo} alt="" sx={{ height: 44, imageRendering: 'pixelated' }} />
        <Typography variant="h6" component="h1">Pecten Studio</Typography>
      </Box>
      <Typography color="text.secondary">Open a game folder to edit it. A folder without a studio project can become one.</Typography>
      <Box><Button variant="contained" startIcon={<FolderOpenIcon />} onClick={() => pecten.openFolder()}>Open folder</Button></Box>
      {state.missing.length > 0 && (
        <Typography color="warning.main" role="status">
          {state.missing.length === 1 ? 'A project from last time is' : `${state.missing.length} projects from last time are`} no longer on disk: {state.missing.join(', ')}
        </Typography>
      )}
      {state.recent.length > 0 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Recent</Typography>
          <List>
            {state.recent.map(({ root, exists }) => (
              <Box key={root} sx={{ display: 'flex', alignItems: 'center' }}>
                <ListItemButton disabled={!exists} onClick={() => pecten.open(root)} sx={{ minWidth: 0, display: 'block' }}>
                  <Typography noWrap>{root.split('/').pop()}</Typography>
                  <Typography noWrap variant="caption" component="div" color="text.secondary">{exists ? root : `${root} (not found)`}</Typography>
                </ListItemButton>
                <Tooltip title="Remove from this list">
                  <IconButton aria-label={`Remove ${root} from recent folders`} onClick={() => pecten.forget(root)}><CloseIcon /></IconButton>
                </Tooltip>
              </Box>
            ))}
          </List>
        </Box>
      )}
    </Box>
  )
}

function TabStatus({ tab }: { tab: TabState }) {
  if (tab.status === 'failed' || tab.status === 'stopped') {
    return (
      <Box sx={{ width: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="h6" component="h1">{tab.name} is not running</Typography>
        <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{tab.error}</Typography>
        <Typography color="text.secondary">Edits already saved are safe in the folder.</Typography>
        <Box><Button variant="contained" onClick={() => pecten.restart(tab.root)}>Restart project</Button></Box>
      </Box>
    )
  }
  return <Typography color="text.secondary" role="status">Opening {tab.name}…</Typography>
}

function Shell() {
  const [state, setState] = useState<ShellState | null>(null)
  useEffect(() => pecten.onState(setState), [])
  if (!state) return null
  const active = state.tabs.find((tab) => tab.root === state.active)
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {state.tabs.length > 0 && <TabBar state={state} />}
      {(!active || active.status !== 'ready') && (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', placeItems: 'center', p: 4 }}>
          {active ? <TabStatus tab={active} /> : <Welcome state={state} />}
        </Box>
      )}
    </Box>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Shell />
    </ThemeProvider>
  </StrictMode>,
)
