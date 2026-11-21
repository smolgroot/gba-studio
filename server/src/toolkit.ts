// Helpers the tool definitions share.
import { z } from 'zod'
import { docPath } from '@pecten-studio/core'
import type { DocKind, Documents, Problem } from '@pecten-studio/core'
import { HttpError } from './project.ts'
import type { Tool, ToolContext, ToolResult } from './tools.ts'

export function tool<S extends z.ZodType>(name: string, description: string, input: S, run: (args: z.infer<S>, context: ToolContext) => Promise<ToolResult>): Tool {
  return { name, description, input, run: run as Tool['run'] }
}

export function problemLines(problems: Problem[], file?: string): string {
  const shown = file ? problems.filter((p) => p.file === file) : problems
  if (shown.length === 0) return file ? `No problems in ${file}.` : 'No problems in the project.'
  return shown.map((p) => `${p.severity}: ${p.file}: ${p.message}`).join('\n')
}

export async function documents(context: ToolContext): Promise<{ docs: Documents; problems: Problem[] }> {
  const bundle = await context.project.load()
  if (!bundle.initialised) throw new HttpError(409, 'this folder has no studio project (no studio/project.json)')
  return bundle
}

export /** Saves a document and says what the project's checks make of it. */
async function saveAndReport(context: ToolContext, kind: DocKind, id: string | undefined, doc: unknown, done: string): Promise<ToolResult> {
  await context.project.save(kind, id, doc)
  const { problems } = await context.project.load()
  return { text: `${done}\n${problemLines(problems, docPath(kind, id))}` }
}
