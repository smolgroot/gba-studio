// A Model Context Protocol server over stdio: JSON-RPC messages, one per line.
// It offers the tools in tools.ts to coding agents.
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { Builder } from './build.ts'
import { HttpError, ProjectFolder } from './project.ts'
import { TOOLS } from './tools.ts'
import type { ToolContext } from './tools.ts'

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const INSTRUCTIONS = `This server edits a GBA-Studio project: the rooms, world map, tilesets, sprites and audio of a Game Boy Advance game, kept as JSON in the game folder's studio/ directory.

Start with project_overview. Look before you change: render_room and render_tileset return pictures, room_read_cells returns cells as text. Change rooms with room_fill, room_paint and the entity_ tools; they keep tile data valid. Run validate after a set of changes, then build and run_rom to see the game itself.

The PNG, MIDI, XM and WAV files under assets/ are made by hand by the game's author. Read them; never regenerate, replace or delete them. The same goes for rooms the author painted: change what was asked for and leave the rest.

Rooms are whole screens of 240x160 px (30x20 tiles of 8 px) on a world grid. Rooms that touch on that grid are connected in the game. Game behaviour is Rust code in the game crate, not in the project files.`

interface Request {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

export async function handle(request: Request, context: ToolContext): Promise<unknown> {
  switch (request.method) {
    case 'initialize': {
      const asked = String(request.params?.protocolVersion ?? '')
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'gba-studio', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.input, { io: 'input' }) })) }
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === request.params?.name)
      if (!tool) throw Object.assign(new Error(`unknown tool: ${String(request.params?.name)}`), { code: -32602 })
      // What goes wrong inside a tool is a result the model can read and act on, not a protocol error.
      try {
        const parsed = tool.input.safeParse(request.params?.arguments ?? {})
        if (!parsed.success) throw new HttpError(400, `bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`)
        const result = await tool.run(parsed.data as never, context)
        return {
          content: [{ type: 'text', text: result.text }, ...(result.images ?? []).map((image) => ({ type: 'image', data: image.toString('base64'), mimeType: 'image/png' }))],
        }
      } catch (error) {
        return { content: [{ type: 'text', text: (error as Error).message }], isError: true }
      }
    }
    default:
      throw Object.assign(new Error(`method not found: ${request.method}`), { code: -32601 })
  }
}

/** Serves one game folder to whatever is on the other end of stdin and stdout, until stdin closes. */
export async function serveMcp(folder: string): Promise<void> {
  const project = new ProjectFolder(folder)
  const context: ToolContext = { project, builder: new Builder(project, () => undefined) }
  const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n')
  // Requests are answered in the order they arrive: two edits to one room must not interleave.
  let queue = Promise.resolve()
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue
    let request: Request
    try {
      request = JSON.parse(line) as Request
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      continue
    }
    // Notifications carry no id and get no answer.
    if (request.id === undefined) continue
    queue = queue.then(async () => {
      try {
        send({ jsonrpc: '2.0', id: request.id, result: await handle(request, context) })
      } catch (error) {
        send({ jsonrpc: '2.0', id: request.id, error: { code: (error as { code?: number }).code ?? -32603, message: (error as Error).message } })
      }
    })
  }
  await queue
  context.builder.stop()
}
