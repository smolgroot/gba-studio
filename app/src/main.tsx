import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { flushSaves } from './store.ts'
import { theme } from './theme.ts'
import 'dockview-react/dist/styles/dockview.css'
import './styles.css'

// The desktop app calls this before it closes a project's tab.
Object.assign(window, { pectenFlushSaves: flushSaves })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
