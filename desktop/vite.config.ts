import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The tab strip and welcome screen. They load from disk, so their URLs are relative.
export default defineConfig({
  root: path.join(import.meta.dirname, 'shell'),
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled', '@mui/material'] },
  build: { outDir: path.join(import.meta.dirname, 'dist/shell'), emptyOutDir: true },
})
