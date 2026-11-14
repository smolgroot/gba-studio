// Reads and writes a game folder's studio documents. Everything stays inside that folder.
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AGENTS_FILE, SKILL_FILE, agentsGuide, claudeSkill, mcpServerEntry } from './agents.ts'
import { AssetPath, Id, MULTI_DOCS, SINGLE_DOCS, STUDIO_DIR, docPath, newProject, schemaFor, validateProject } from '@pecten-studio/core'
import type { DocKind, Documents, MultiKind, Problem, SingleKind } from '@pecten-studio/core'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface AssetFile {
  path: string
  size: number
}

export interface Bundle {
  /** The game folder's name, for the title bar. */
  folder: string
  /** False until `studio/project.json` exists. */
  initialised: boolean
  docs: Documents
  problems: Problem[]
  assets: AssetFile[]
}

/** Folders never listed as assets: build output, dependencies, version control, and the documents themselves. */
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', STUDIO_DIR])
const ASSET_EXTENSIONS = new Set(['.png', '.aseprite', '.ase', '.mid', '.midi', '.sf2', '.xm', '.mod', '.wav'])
const MAX_ASSETS = 5000

export class ProjectFolder {
  readonly root: string

  constructor(root: string) {
    this.root = realpathSync(path.resolve(root))
  }

  /** An absolute path for `rel`, refused if it leaves the game folder, directly or through a symlink. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel)
    if (!this.contains(abs)) throw new HttpError(400, 'path is outside the game folder')
    // A symlink inside the folder may point out of it: check where the nearest existing part really is.
    let existing = abs
    while (!existsSync(existing)) existing = path.dirname(existing)
    if (!this.contains(realpathSync(existing))) throw new HttpError(400, 'path is outside the game folder')
    return abs
  }

  private contains(abs: string): boolean {
    return abs === this.root || abs.startsWith(this.root + path.sep)
  }

  async load(): Promise<Bundle> {
    const problems: Problem[] = []
    const docs: Documents = { tilesets: {}, sprites: {}, rooms: {} }
    const initialised = existsSync(this.resolve(docPath('project')))

    const read = async (kind: DocKind, id?: string): Promise<unknown> => {
      const file = docPath(kind, id)
      let text: string
      try {
        text = await readFile(this.resolve(file), 'utf8')
      } catch {
        if (initialised && kind in SINGLE_DOCS) problems.push({ severity: 'error', file, message: 'file is missing' })
        return undefined
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch (error) {
        problems.push({ severity: 'error', file, message: `not valid JSON: ${(error as Error).message}` })
        return undefined
      }
      const parsed = schemaFor(kind).safeParse(json)
      if (parsed.success) return parsed.data
      for (const issue of parsed.error.issues) {
        problems.push({ severity: 'error', file, message: `${issue.path.join('.') || 'document'}: ${issue.message}` })
      }
      return undefined
    }

    for (const kind of Object.keys(SINGLE_DOCS) as SingleKind[]) {
      const doc = await read(kind)
      if (doc !== undefined) Object.assign(docs, { [kind]: doc })
    }
    for (const kind of Object.keys(MULTI_DOCS) as MultiKind[]) {
      const dir = this.resolve(`${STUDIO_DIR}/${kind}s`)
      const names = existsSync(dir) ? (await readdir(dir)).filter((n) => n.endsWith('.json')).sort() : []
      for (const name of names) {
        const id = name.slice(0, -'.json'.length)
        if (!Id.safeParse(id).success) {
          problems.push({ severity: 'error', file: `${STUDIO_DIR}/${kind}s/${name}`, message: 'file name is not a valid id' })
          continue
        }
        const doc = await read(kind, id)
        if (doc !== undefined) Object.assign(docs[`${kind}s`], { [id]: doc })
      }
    }

    const assets = await this.listAssets()
    const exists = (rel: string) => {
      try {
        return existsSync(this.resolve(rel))
      } catch {
        return false
      }
    }
    problems.push(...validateProject(docs, exists))
    return { folder: path.basename(this.root), initialised, docs, problems, assets }
  }

  private async listAssets(): Promise<AssetFile[]> {
    const out: AssetFile[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_ASSETS) return
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(abs)
        } else if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          out.push({ path: path.relative(this.root, abs).split(path.sep).join('/'), size: (await stat(abs)).size })
        }
      }
    }
    await walk(this.root)
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Validates a document against its schema and writes it; the stored form is what the schema parsed. */
  async save(kind: DocKind, id: string | undefined, json: unknown): Promise<void> {
    if (!(kind in SINGLE_DOCS) && !(kind in MULTI_DOCS)) throw new HttpError(404, `unknown document kind "${kind}"`)
    let file: string
    try {
      file = docPath(kind, id)
    } catch (error) {
      throw new HttpError(400, (error as Error).message)
    }
    const parsed = schemaFor(kind).safeParse(json)
    if (!parsed.success) {
      throw new HttpError(422, parsed.error.issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`).join('; '))
    }
    await this.writeJson(file, parsed.data)
  }

  /** Creates the documents of an empty project. Refuses to touch an existing one. */
  async init(name: string): Promise<void> {
    if (existsSync(this.resolve(docPath('project')))) throw new HttpError(409, 'this folder already has a studio project')
    const { project, world, audio } = newProject(name)
    await this.writeJson(docPath('project'), project)
    await this.writeJson(docPath('world'), world)
    await this.writeJson(docPath('audio'), audio)
    await this.writeAgentsGuide(name, false)
  }

  /** Writes the note for coding agents into the folder. An existing one is kept unless `replace` is set. */
  async writeAgentsGuide(name: string, replace: boolean): Promise<boolean> {
    const abs = this.resolve(AGENTS_FILE)
    if (existsSync(abs) && !replace) return false
    await writeFile(abs, agentsGuide(name))
    return true
  }

  /**
   * Sets a game folder up for Claude Code: a skill under .claude/skills, and the
   * studio's MCP server in .mcp.json. Other servers in .mcp.json are kept, and an
   * existing pecten-studio entry or skill is left alone unless `replace` is set.
   * Returns what it wrote.
   */
  async writeClaudeSetup(name: string, cliPath: string, replace: boolean): Promise<string[]> {
    const written: string[] = []
    const skill = this.resolve(SKILL_FILE)
    if (!existsSync(skill) || replace) {
      await mkdir(path.dirname(skill), { recursive: true })
      await writeFile(skill, claudeSkill(name))
      written.push(SKILL_FILE)
    }
    const file = this.resolve('.mcp.json')
    let config: { mcpServers?: Record<string, unknown> } = {}
    if (existsSync(file)) {
      try {
        config = JSON.parse(await readFile(file, 'utf8')) as typeof config
      } catch {
        throw new HttpError(409, '.mcp.json is not valid JSON; fix or remove it first')
      }
    }
    if (!config.mcpServers?.['pecten-studio'] || replace) {
      config.mcpServers = { ...config.mcpServers, 'pecten-studio': mcpServerEntry(cliPath) }
      await writeFile(file, JSON.stringify(config, null, 2) + '\n')
      written.push('.mcp.json')
    }
    return written
  }

  /** Deletes a room, tileset or sprite document. What refers to it shows up in Problems. */
  async remove(kind: DocKind, id: string | undefined): Promise<void> {
    if (!(kind in MULTI_DOCS)) throw new HttpError(400, `a ${kind} document cannot be deleted`)
    let file: string
    try {
      file = docPath(kind, id)
    } catch (error) {
      throw new HttpError(400, (error as Error).message)
    }
    await unlink(this.resolve(file)).catch(() => {
      throw new HttpError(404, 'no such document')
    })
  }

  /** Stores an imported asset file (image, music, sound). Never replaces a file unless asked to. */
  async upload(rel: string, data: Buffer, overwrite: boolean): Promise<void> {
    if (!AssetPath.safeParse(rel).success) throw new HttpError(400, 'not a path inside the game folder')
    const parts = rel.split('/')
    if (parts.some((part) => part.startsWith('.')) || parts.slice(0, -1).some((part) => SKIP_DIRS.has(part))) {
      throw new HttpError(400, 'assets cannot be stored in that folder')
    }
    if (!ASSET_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
      throw new HttpError(415, `not an asset type the studio handles (${[...ASSET_EXTENSIONS].join(' ')})`)
    }
    const abs = this.resolve(rel)
    if (existsSync(abs) && !overwrite) throw new HttpError(409, `${rel} already exists`)
    await mkdir(path.dirname(abs), { recursive: true })
    const temp = `${abs}.${process.pid}.tmp`
    await writeFile(temp, data)
    await rename(temp, abs)
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    const abs = this.resolve(file)
    await mkdir(path.dirname(abs), { recursive: true })
    // Write beside it and rename, so a crash never leaves half a document.
    const temp = `${abs}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n')
    await rename(temp, abs)
  }
}
