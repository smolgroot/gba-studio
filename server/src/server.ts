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
import { HttpError, ProjectFolder } from './project.ts'
import type { DocKind } from '@gba-studio/core'

const APP_DIST = fileURLToPath(new URL('../../app/dist', import.meta.url))
const WATCH_IGNORED = /(^|[/\\])(node_modules|target|dist|\.git)([/\\]|$)|\.tmp$/

export interface ServerOptions {
  folder: string
  host: string
  port: number
}

export async function startServer(options: ServerOptions): Promise<{ app: FastifyInstance; url: string; close: () => Promise<void> }> {
  const project = new ProjectFolder(options.folder)
  const app = fastify({ bodyLimit: 32 * 1024 * 1024 })

  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof HttpError ? error.status : ((error as { statusCode?: number }).statusCode ?? 500)
    if (status >= 500) console.error(error)
    void reply.status(status).send({ error: (error as Error).message })
  })

  // The page may be opened from another device, but only this server's own pages may
  // write: a web page elsewhere must not be able to post to localhost.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return
    const origin = request.headers.origin
    if (origin && new URL(origin).host !== request.headers.host) throw new HttpError(403, 'cross-origin request refused')
    if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'send JSON')
  })

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

  // Raw files of the game folder, for image and audio previews.
  app.get<{ Params: { '*': string } }>('/files/*', async (request, reply) => {
    const abs = project.resolve(request.params['*'])
    const info = await stat(abs).catch(() => null)
    if (!info?.isFile()) throw new HttpError(404, 'no such file')
    return reply.header('cache-control', 'no-store').sendFile(path.relative(project.root, abs), project.root)
  })

  await app.register(fastifyStatic, { root: project.root, serve: false })
  if (existsSync(APP_DIST)) {
    await app.register(fastifyStatic, { root: APP_DIST, decorateReply: false })
    // Any other page address is the app's; a missing script or image stays a 404.
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0]!
      if (request.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/files/') && !path.extname(pathname)) {
        return reply.sendFile('index.html', APP_DIST)
      }
      return reply.status(404).send({ error: 'not found' })
    })
  }

  const sockets = new WebSocketServer({ noServer: true })
  app.server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') return socket.destroy()
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
      const message = JSON.stringify({ type: 'changed', paths: [...pending] })
      pending.clear()
      for (const ws of sockets.clients) ws.send(message)
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
      await watcher.close()
      for (const ws of sockets.clients) ws.terminate()
      sockets.close()
      await app.close()
    },
  }
}
