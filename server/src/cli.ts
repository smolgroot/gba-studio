#!/usr/bin/env node
// The gba-studio command: the studio itself, and the same project code for scripts and agents.
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Builder } from './build.ts'
import { serveMcp } from './mcp.ts'
import { ProjectFolder } from './project.ts'
import { startServer } from './server.ts'
import { documentSchemas } from './tools.ts'

const USAGE = `Usage:
  gba-studio <game-folder> [--port 4517] [--lan]    open the studio on a game folder
  gba-studio validate <game-folder> [--json]        check the project; exit 1 if it has errors
  gba-studio build <game-folder> [--release] [--json]  run the project's build command
  gba-studio mcp <game-folder>                      serve the project to a coding agent (MCP over stdio)
  gba-studio agents <game-folder> [--claude] [--force]  write AGENTS.md, the note for coding agents;
                                                    --claude also adds a Claude Code skill and .mcp.json
  gba-studio schema                                 print the JSON Schema of every document kind

  --lan   listen on every interface, so a tablet on the same network can open
          the studio. Anyone on that network can then edit the game folder and
          run its build command.`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '4517' },
    lan: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    release: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    claude: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}
function folderArgument(value: string | undefined): string {
  if (!value) fail(USAGE)
  if (!existsSync(value) || !statSync(value).isDirectory()) fail(`not a folder: ${value}`)
  return value
}

const COMMANDS = ['validate', 'build', 'mcp', 'agents', 'schema']
// A folder that happens to be called like a command is still opened as a folder.
const command = COMMANDS.includes(positionals[0] ?? '') && (positionals.length > 1 || positionals[0] === 'schema') ? positionals[0] : 'serve'

if (values.help || positionals.length === 0) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 2)
} else if (command === 'schema') {
  console.log(JSON.stringify(documentSchemas(), null, 2))
} else if (command === 'validate') {
  const bundle = await new ProjectFolder(folderArgument(positionals[1])).load()
  if (!bundle.initialised) fail('this folder has no studio project (no studio/project.json)')
  const errors = bundle.problems.filter((p) => p.severity === 'error').length
  if (values.json) {
    console.log(JSON.stringify({ ok: errors === 0, errors, warnings: bundle.problems.length - errors, problems: bundle.problems }, null, 2))
  } else {
    for (const problem of bundle.problems) console.log(`${problem.severity}: ${problem.file}: ${problem.message}`)
    console.log(bundle.problems.length ? `${errors} errors, ${bundle.problems.length - errors} warnings` : 'No problems.')
  }
  process.exit(errors ? 1 : 0)
} else if (command === 'build') {
  const builder = new Builder(new ProjectFolder(folderArgument(positionals[1])), () => undefined)
  process.on('SIGINT', () => builder.stop())
  const mode = values.release ? 'release' : 'dev'
  // With --json the output is one JSON object on stdout; the build's own output goes to stderr.
  const status = await builder.run(mode, (line) => (values.json ? console.error(line) : console.log(line))).catch((error: Error) => fail(error.message))
  if (values.json) {
    console.log(JSON.stringify({ ok: status.exitCode === 0, mode, command: status.command, exitCode: status.exitCode, seconds: status.seconds, rom: status.roms[mode] ?? null, log: status.log }, null, 2))
  } else {
    const rom = status.roms[mode]
    console.log(status.exitCode === 0 ? `Built ${rom ? `${rom.path} (${rom.size} bytes)` : 'with no ROM at the configured path'} in ${status.seconds}s` : `Build failed with exit code ${status.exitCode}`)
  }
  process.exit(status.exitCode === 0 ? 0 : 1)
} else if (command === 'mcp') {
  await serveMcp(folderArgument(positionals[1]))
} else if (command === 'agents') {
  const project = new ProjectFolder(folderArgument(positionals[1]))
  const bundle = await project.load()
  if (!bundle.initialised) fail('this folder has no studio project (no studio/project.json)')
  const written = await project.writeAgentsGuide(bundle.docs.project?.name ?? bundle.folder, values.force)
  console.log(written ? 'Wrote AGENTS.md' : 'AGENTS.md already exists; pass --force to replace it')
  if (values.claude) {
    const files = await project.writeClaudeSetup(bundle.docs.project?.name ?? bundle.folder, fileURLToPath(import.meta.url), values.force).catch((error: Error) => fail(error.message))
    console.log(files.length ? `Wrote ${files.join(' and ')}` : 'The Claude Code skill and .mcp.json entry already exist; pass --force to replace them')
  }
} else {
  if (positionals.length !== 1) fail(USAGE)
  const folder = folderArgument(positionals[0])
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`not a port: ${values.port}`)
  const { url, close } = await startServer({ folder, host: values.lan ? '0.0.0.0' : '127.0.0.1', port })
  console.log(`GBA-Studio serving ${folder} at ${url}\nMCP endpoint for coding agents: ${url}/mcp`)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void close().then(() => process.exit(0)))
  }
}
