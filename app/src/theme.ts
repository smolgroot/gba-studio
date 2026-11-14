import { createTheme } from '@mui/material/styles'

/** The whole interface is drawn at this factor of its base size (12 px type, 4 px spacing). */
export const UI_SCALE = 1.25
/** A base-size measure in pixels at the interface scale. */
export const ui = (n: number): number => Math.round(n * UI_SCALE)
/** Heights of the bars and rows, and the icon size, at the interface scale. */
export const BAR = { top: ui(30), tool: ui(28), row: ui(22), touchRow: 40, icon: ui(15), input: ui(22) } as const

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
  shape: { borderRadius: 6 },
  spacing: 4 * UI_SCALE,
  typography: {
    fontSize: ui(12),
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    body1: { fontSize: ui(12) },
    body2: { fontSize: ui(11) },
    caption: { fontSize: ui(10) },
    button: { fontSize: ui(11), textTransform: 'none' },
    h6: { fontSize: ui(16) },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiIconButton: { defaultProps: { size: 'small' }, styleOverrides: { root: { borderRadius: 6, padding: ui(3) } } },
    MuiSvgIcon: { styleOverrides: { root: { fontSize: ui(15) } } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiList: { defaultProps: { dense: true, disablePadding: true } },
    MuiListItemButton: { styleOverrides: { root: { paddingTop: 1, paddingBottom: 1, borderRadius: 4 } } },
    MuiButton: { defaultProps: { size: 'small', disableElevation: true }, styleOverrides: { root: { borderRadius: 6 }, outlined: { borderColor: '#4a4a4a' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 10, border: '1px solid #3a3a3a', backgroundImage: 'none' } } },
    MuiTooltip: { defaultProps: { arrow: true, enterDelay: 400 }, styleOverrides: { tooltip: { fontSize: ui(10) } } },
    MuiTab: { styleOverrides: { root: { fontSize: ui(11) } } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: ui(14), padding: `${ui(12)}px ${ui(16)}px` } } },
  },
})
