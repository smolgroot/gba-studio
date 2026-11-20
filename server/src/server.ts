// The local server: a JSON API over one game folder, its files for previews, and a
// websocket that says when something on disk changed.
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import { watch } from 'chokidar'
import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { WebSocketServer } from 'ws'
import { Builder } from './build.ts'
import type { BuildMode } from './build.ts'
import { handle } from './mcp.ts'
import { patchRom } from './patch.ts'
import { HttpError, ProjectFolder } from './project.ts'
import { checkToolchain, setupGameCrate } from './scaffold.ts'
import type { StudioView, ToolContext } from './tools.ts'
import type { DocKind } from '@pecten-studio/core'

const APP_DIST = fileURLToPath(new URL('../../app/dist', import.meta.url))
/** Where `runtime/` and `codegen/` are in a checkout. */
const CRATES = fileURLToPath(new URL('../..', import.meta.url))
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const WATCH_IGNORED = /(^|[/\\])(node_modules|target|dist|\.git)([/\\]|$)|\.tmp$/

export interface ServerOptions {
  folder: string
  host: string
  port: number
  /** The built page. By default, app/dist of this checkout. */
  appDist?: string
  /** The folder holding the `runtime` and `codegen` crates. By default, this checkout. */
  crates?: string
  /** The environment of build commands and toolchain checks. By default, this process's. */
  buildEnv?: NodeJS.ProcessEnv
  /** Hears everything sent to the page, for a host that shows it elsewhere. */
  onEvent?: (message: unknown) => void
}

const hostname = (host: string | undefined): string | null => {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}
/** A page may only act on the server it came from. Requests from outside a browser send no origin. */
const sameOrigin = (origin: string | undefined, host: string | undefined): boolean => {
  if (!origin) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function startServer(options: ServerOptions): Promise<{ app: FastifyInstance; url: string; close: () => Promise<void> }> {
  const project = new ProjectFolder(options.folder)
  const appDist = options.appDist ?? APP_DIST
  const crates = options.crates ?? CRATES
  // Bound to this machine, the server answers only to this machine's names, so a web
  // page cannot reach it through a domain of its own that resolves here.
  const loopbackOnly = LOOPBACK.has(options.host)
  const hostAllowed = (host: string | undefined) => !loopbackOnly || LOOPBACK.has(hostname(host) ?? '')
  const app = fastify({ bodyLimit: 32 * 1024 * 1024 })

  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof HttpError ? error.status : ((error as { statusCode?: number }).statusCode ?? 500)
    if (status >= 500) console.error(error)
    void reply.status(status).send({ error: (error as Error).message })
  })

  // The page may be opened from another device, but only this server's own pages may
  // write: a web page elsewhere must not be able to post to localhost.
  app.addHook('onRequest', async (request) => {
    if (!hostAllowed(request.headers.host)) throw new HttpError(403, 'unknown host refused')
    if (request.method === 'GET' || request.method === 'HEAD') return
    if (!sameOrigin(request.headers.origin, request.headers.host)) throw new HttpError(403, 'cross-origin request refused')
    if (request.method === 'DELETE') return
    const type = request.headers['content-type'] ?? ''
    const wanted = request.url.startsWith('/api/upload') ? 'application/octet-stream' : 'application/json'
    if (!type.startsWith(wanted)) throw new HttpError(415, `send ${wanted}`)
  })
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 256 * 1024 * 1024 }, (_request, body, done) => done(null, body))

  app.get('/api/project', () => project.load())

  app.post<{ Body: { name?: unknown } }>('/api/init', async (request) => {
    const name = request.body?.name
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'a project needs a name')
    await project.init(name.trim())
    return project.load()
  })

  app.put<{ Params: { kind: string; id?: string }; Body: unknown }>('/api/doc/:kind/:id?', async (request) => {
    await project.save(request.params.kind as DocKind, request.params.id, request.body)
    return { ok: true }
  })

  app.delete<{ Params: { kind: string; id: string } }>('/api/doc/:kind/:id', async (request) => {
    await project.remove(request.params.kind as DocKind, request.params.id)
    return { ok: true }
  })

  // An imported file's bytes as the body; `path` says where in the game folder it goes.
  app.post<{ Querystring: { path?: string; overwrite?: string }; Body: Buffer }>('/api/upload', async (request) => {
    if (!request.query.path || !Buffer.isBuffer(request.body)) throw new HttpError(400, 'a path and a file body are needed')
    await project.upload(request.query.path, request.body, request.query.overwrite === '1')
    return { ok: true, path: request.query.path }
  })

  // Raw files of the game folder, for image and audio previews.
  app.get<{ Params: { '*': string } }>('/files/*', async (request, reply) => {
    const abs = project.resolve(request.params['*'])
    const info = await stat(abs).catch(() => null)
    if (!info?.isFile()) throw new HttpError(404, 'no such file')
    return reply.header('cache-control', 'no-store').sendFile(path.relative(project.root, abs), project.root)
  })

  await app.register(fastifyStatic, { root: project.root, serve: false })
  if (existsSync(appDist)) {
    await app.register(fastifyStatic, { root: appDist, decorateReply: false })
    // Any other page address is the app's; a missing script or image stays a 404.
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0]!
      if (request.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/files/') && !path.extname(pathname)) {
        return reply.sendFile('index.html', appDist)
      }
      return reply.status(404).send({ error: 'not found' })
    })
  }

  const sockets = new WebSocketServer({ noServer: true })
  const broadcast = (message: unknown) => {
    options.onEvent?.(message)
    const text = JSON.stringify(message)
    for (const ws of sockets.clients) ws.send(text)
  }

  // Builds run the commands in studio/project.json, in the game folder.
  const builder = new Builder(project, broadcast, options.buildEnv)
  app.get('/api/build', () => builder.status())
  app.post<{ Body: { mode?: unknown } }>('/api/build', async (request) => {
    await builder.start(request.body?.mode as BuildMode)
    return builder.status()
  })
  // Level data into the built ROM without a build, when only data changed.
  app.post<{ Body: { mode?: unknown } }>('/api/patch', (request) => patchRom(project, builder, request.body?.mode === 'release' ? 'release' : 'dev'))
  app.post('/api/build/stop', async () => {
    builder.stop()
    return { ok: true }
  })

  // What building this folder still needs, and setting up a game crate in it.
  app.get('/api/toolchain', () => checkToolchain(project, crates, options.buildEnv))
  app.post('/api/setup-crate', async () => ({ written: await setupGameCrate(project, crates) }))

  // The studio's page says what is open in it, so an agent can be told "this room".
  let view: StudioView | null = null
  app.post<{ Body: StudioView }>('/api/context', async (request) => {
    const kind = request.body?.selection?.kind
    if (typeof kind === 'string') view = { selection: request.body.selection, editor: request.body.editor }
    return { ok: true }
  })

  // The same tools as `pecten-studio mcp`, over HTTP (MCP's streamable HTTP transport,
  // answering in plain JSON). Run from here they share the studio's build runner, and
  // can see and steer what the page shows.
  const tools: ToolContext = {
    project,
    builder,
    studio: {
      view: () => (sockets.clients.size ? view : null),
      open: (selection) => {
        broadcast({ type: 'open', selection })
        return sockets.clients.size
      },
    },
  }
  interface RpcMessage {
    jsonrpc: '2.0'
    id?: number | string
    method: string
    params?: Record<string, unknown>
  }
  const answer = async (message: RpcMessage): Promise<unknown> => {
    // Notifications carry no id and get no answer.
    if (message?.id === undefined) return undefined
    try {
      const result = await handle(message, tools)
      if (message.method === 'tools/call') {
        const called = result as { content: Array<{ text?: string }>; isError?: boolean }
        broadcast({ type: 'agent', tool: String(message.params?.name), summary: (called.content[0]?.text ?? '').split('\n')[0]!.slice(0, 160), failed: called.isError === true })
      }
      return { jsonrpc: '2.0', id: message.id, result }
    } catch (error) {
      return { jsonrpc: '2.0', id: message.id, error: { code: (error as { code?: number }).code ?? -32603, message: (error as Error).message } }
    }
  }
  // One request at a time: two edits to one room must not interleave.
  let queue: Promise<unknown> = Promise.resolve()
  app.post<{ Body: RpcMessage | RpcMessage[] }>('/mcp', async (request, reply) => {
    const body = request.body
    const run = queue.then(async () => {
      if (!Array.isArray(body)) return answer(body)
      const answers: unknown[] = []
      for (const message of body) answers.push(await answer(message))
      return answers.filter((a) => a !== undefined)
    })
    queue = run.catch(() => undefined)
    const result = await run
    if (result === undefined || (Array.isArray(result) && result.length === 0)) return reply.status(202).send()
    return result
  })
  // This server never opens a stream of its own, which the transport lets it say this way.
  app.get('/mcp', (_request, reply) => reply.status(405).header('allow', 'POST').send({ error: 'this MCP endpoint answers POST requests only' }))
  app.server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws' || !hostAllowed(request.headers.host) || !sameOrigin(request.headers.origin, request.headers.host)) return socket.destroy()
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit('connection', ws, request))
  })

  // Editors save often and art tools write in bursts: gather changes for a moment.
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | undefined
  const watcher = watch(project.root, { ignored: (p) => WATCH_IGNORED.test(p), ignoreInitial: true })
  watcher.on('all', (_event, file) => {
    pending.add(path.relative(project.root, file).split(path.sep).join('/'))
    clearTimeout(timer)
    timer = setTimeout(() => {
      broadcast({ type: 'changed', paths: [...pending] })
      pending.clear()
    }, 120)
  })

  await app.listen({ host: options.host, port: options.port })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  return {
    app,
    url: `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${port}`,
    close: async () => {
      clearTimeout(timer)
      builder.stop()
      await watcher.close()
      for (const ws of sockets.clients) ws.terminate()
      sockets.close()
      await app.close()
    },
  }
}
