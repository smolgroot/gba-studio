#!/usr/bin/env node
// gba-studio <game-folder> [--port 4517] [--lan]
import { existsSync, statSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { startServer } from './server.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '4517' },
    lan: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help || positionals.length !== 1) {
  console.log(`Usage: gba-studio <game-folder> [--port 4517] [--lan]

  --port  port to listen on (default 4517)
  --lan   listen on every interface, so a tablet on the same network can open
          the studio. Anyone on that network can then edit the game folder.`)
  process.exit(values.help ? 0 : 1)
}

const folder = positionals[0]!
if (!existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(`not a folder: ${folder}`)
  process.exit(1)
}
const port = Number(values.port)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`not a port: ${values.port}`)
  process.exit(1)
}

const { url, close } = await startServer({ folder, host: values.lan ? '0.0.0.0' : '127.0.0.1', port })
console.log(`GBA-Studio serving ${folder} at ${url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void close().then(() => process.exit(0)))
}
