import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the page comes from Vite and everything else from the studio server.
const server = `http://127.0.0.1:${process.env.PECTEN_STUDIO_PORT ?? 4517}`

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': server,
      '/files': server,
      '/ws': { target: server, ws: true },
    },
  },
})
