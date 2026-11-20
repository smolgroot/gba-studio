# Working on Pecten-Studio with a coding agent

This file is for work on the studio itself. For work on a game made with the studio,
see the `AGENTS.md` that `pecten-studio agents <folder>` writes into the game folder
(an example is `sample/AGENTS.md`).

## What to work on

All planned work is in [`UserStories.md`](UserStories.md). Work on one story at a
time, picked by the author or the highest-priority story whose dependencies are
`Done`. Follow the `implement-story` skill in `.claude/skills/`. Do not start work
that has no story: write the story first and ask the author to accept it.

## Commits and authorship

- Do not commit, push, open pull requests or tag releases. Leave changes in the
  working tree (or on the branch you were given) for the author to review and
  commit.
- If the author asks you to commit, author it as the author's own git identity and
  add no `Co-Authored-By`, `Generated-by` or similar trailer, and no mention of a
  tool in the message, branch name or pull request text.
- Do not write tool names into code comments, docs or file headers.

## Layout

| Folder | What it is | Language |
| --- | --- | --- |
| `core/` | Schemas (`schema.ts`, the reference for the project format), validation, room and RLE helpers, pixel art, MIDI, physics preview, generators | TypeScript |
| `app/` | The web studio: panels in `app/src/panels/`, state in `store.ts` | TypeScript, React |
| `server/` | Local server, CLI (`cli.ts`), MCP server and tools (`mcp.ts`, `tools.ts`), builds, headless emulator | TypeScript |
| `desktop/` | Electron app around the studio | TypeScript |
| `codegen/` | `pecten_studio_build`: reads `studio/`, converts PNGs, writes Rust and data for the game | Rust |
| `runtime/` | `pecten_studio_rt`: `data` and `physics` (no dependencies, host-testable), `gfx` behind the `agb` feature | Rust, `no_std` |
| `sample/` | A complete game made from a studio project | Rust on agb, nightly |
| `docs/` | The VitePress site: `guide/`, `reference/` | Markdown |
| `scripts/` | Sample project and asset generators | TypeScript |

The project format is defined once in `core/src/schema.ts`. A change to the format
is a change there, in `codegen/src/model.rs`, in validation, and in
`docs/reference/project-format.md`, together, with `FORMAT_VERSION` raised when old
projects would not load.

## Commands

```sh
pnpm install
pnpm test          # TypeScript tests (vitest)
pnpm typecheck     # tsc across core, server, app, desktop
cargo test         # codegen and runtime host tests
pnpm build         # web app
pnpm dev           # server on sample/ + app with hot reload at http://localhost:5173
cd sample && cargo build   # the game; needs the pinned nightly and agb-gbafix
```

Before saying work is done, run `pnpm test`, `pnpm typecheck` and `cargo test`, and
build `sample/` if anything under `codegen/`, `runtime/` or `sample/` changed. Report
what ran and what failed; do not mark a story `Done` with failing checks.

## Rules

- **Hardware first.** Every feature respects the GBA's limits (240x160 screen, 4
  background layers, 16 palettes of 16 colours, 1024 background tiles in VRAM, 128
  sprites, 32 KB IWRAM, 256 KB EWRAM). When the studio cannot stop an author going
  over a limit, it reports it as a problem in the author's terms, not a build crash.
- **The runtime is `no_std` and does not allocate in the frame loop.** `data` and
  `physics` stay free of dependencies so they compile and test on the host.
- **Authors' files are theirs.** Nothing under a game's `assets/` is created,
  changed or deleted by the studio except PNGs drawn in the pixel editor. MCP tools
  never write under `assets/`.
- **Every write is validated.** New document kinds get a schema, validation that
  feeds the Problems panel, and MCP tools that answer with the problems they left.
- **Errors say what to do**, in the project's terms ("the tileset has 16 tiles,
  numbered 0 to 15; there is no tile 99").
- **Tests:** host tests for runtime logic, vitest for core and server, fixtures in
  `codegen/fixture/` shared between Rust and TypeScript where both compute the same
  thing (budgets, conversions).
- **Docs:** a user-visible change updates its page in `docs/guide/`, and
  `README.md` and `docs/reference/limits.md` when it adds or removes a limit. The
  `docs-writer` agent in `.claude/agents/` does this, with screenshots taken by
  `scripts/screenshots.ts` from the list in `docs/screenshots.json`.

## Style

- Plain, short English in docs, comments and messages. British spelling, as in the
  rest of the repo ("colour").
- Comments say why, not what. Doc comments on every public item in the runtime and
  codegen.
- TypeScript: ES modules with `.ts` extensions in imports, no default exports in
  `core/`. Rust: edition 2024, `cargo fmt`, no `unwrap` in the runtime outside
  tests.
- Keep files near the size they are; split a panel or module before it passes about
  1000 lines.
