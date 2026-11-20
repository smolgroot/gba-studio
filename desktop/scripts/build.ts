// Bundles the main process, the preload scripts and the project server, then the shell page.
import { rmSync } from 'node:fs'
import path from 'node:path'
import { build as bundle } from 'esbuild'
import { build as buildPage } from 'vite'

const here = path.join(import.meta.dirname, '..')
const out = path.join(here, 'dist')

export async function buildDesktop(): Promise<void> {
  rmSync(out, { recursive: true, force: true })
  const common = { bundle: true, platform: 'node', target: 'node24', sourcemap: true, logLevel: 'warning' } as const
  await bundle({ ...common, entryPoints: [path.join(here, 'src/main.ts')], outfile: path.join(out, 'main.cjs'), format: 'cjs', external: ['electron'] })
  await bundle({ ...common, entryPoints: [path.join(here, 'src/preload.ts')], outfile: path.join(out, 'preload.cjs'), format: 'cjs', external: ['electron'] })
  await bundle({ ...common, entryPoints: [path.join(here, 'src/page-preload.ts')], outfile: path.join(out, 'page-preload.cjs'), format: 'cjs', external: ['electron'] })
  await bundle({
    ...common,
    entryPoints: [path.join(here, '../server/src/host.ts')],
    outfile: path.join(out, 'host.mjs'),
    format: 'esm',
    // Some of the server's dependencies are CommonJS and ask for `require`.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  })
  await buildPage({ configFile: path.join(here, 'vite.config.ts'), logLevel: 'warn' })
}

if (process.argv[1] === import.meta.filename) await buildDesktop()
