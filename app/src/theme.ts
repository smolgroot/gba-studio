import { createTheme } from '@mui/material/styles'

/** Neutral greys, small type, tight spacing: the look of an image editor's panels. */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4c9ffe' },
    error: { main: '#e5484d' },
    warning: { main: '#f5a524' },
    background: { default: '#1c1c1c', paper: '#262626' },
    text: { primary: '#e6e6e6', secondary: '#9a9a9a' },
    divider: '#111111',
  },
  shape: { borderRadius: 3 },
  spacing: 4,
  typography: {
    fontSize: 12,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    body1: { fontSize: 12 },
    body2: { fontSize: 11 },
    caption: { fontSize: 10 },
    button: { fontSize: 11, textTransform: 'none' },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: { defaultProps: { size: 'small', disableElevation: true } },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiList: { defaultProps: { dense: true, disablePadding: true } },
    MuiListItemButton: { styleOverrides: { root: { paddingTop: 1, paddingBottom: 1 } } },
    MuiTooltip: { defaultProps: { arrow: true, enterDelay: 400 } },
    MuiChip: { defaultProps: { size: 'small' }, styleOverrides: { root: { height: 18, fontSize: 10 } } },
  },
})
