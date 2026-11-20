---
name: implement-story
description: Implement one story from UserStories.md in Pecten-Studio, spec first. Use when asked to work on a story ID (US-NNN), pick the next story, or plan, build or finish a backlog item.
---

# Implement a story

One story per run. The story's acceptance criteria are the spec: the work is done
when each one is shown to hold, not when the code looks finished. Read the root
`AGENTS.md` first; its rules on commits and authorship apply throughout.

## 1. Pick and read

- If the author named a story, use it. Otherwise take the highest-priority story
  (P0 before P1, then the order in the summary table) whose status is `Proposed` or
  `Planned` and whose **Depends on** stories are all `Done`. Say which one and why
  before going on.
- Read the whole story, its epic's introduction, and every story it depends on.
- Read the files in its **Touches** list that the work will change, and the tests
  next to them.
- If a dependency is not `Done`, stop and say so. Do not build on top of missing
  work.

## 2. Plan

Write `design/US-NNN.md` (create the folder if needed):

```md
# US-NNN · Title

## Approach
What changes and why this way. Alternatives considered, in a line each.

## Format changes
Schema fields added or changed (core/src/schema.ts, codegen/src/model.rs),
FORMAT_VERSION bump or not, how old projects load.

## Hardware cost
ROM, IWRAM, EWRAM, VRAM, CPU per frame. Measured or estimated, and how.

## Tests
One line per acceptance criterion: the test that proves it, and where it lives.

## Open questions
```

Then set the story's **Status** to `Planned` in both the story and the summary
table. If the plan changes what a criterion means, or a criterion cannot be met as
written, stop and ask the author before building. Never weaken a criterion to make
it pass.

For a story the author has not seen a plan for, show the design note and wait for a
go-ahead before step 3, unless they asked for the whole story in one go.

## 3. Build

- Set the status to `In progress`.
- Write the tests from the design note first, and see them fail for the right
  reason.
- Implement the smallest change that makes them pass. Keep to the story: anything
  else found on the way becomes a new `Proposed` story at the end of the right epic
  (next free ID) and a line in the summary table, not extra work now.
- Format changes go in the schema, Rust model, validation and
  `docs/reference/project-format.md` together.
- Runtime code stays `no_std`, allocation-free in the frame loop, and host-testable
  where it can be.

## 4. Verify

Run, and report the result of each:

```sh
pnpm test
pnpm typecheck
cargo test
cd sample && cargo build      # if codegen/, runtime/ or sample/ changed
```

When the story changes what the game does on screen, also run the built sample
headless with `pecten-studio` (the `run_rom` tool, or
`node server/src/cli.ts mcp sample` and call it) with button presses that exercise
the change, and look at the pictures it returns.

Then go through the acceptance criteria one by one. For each, name the test or the
check that shows it holds. Tick a box (`- [x]`) only for a criterion shown to hold.

## 5. Document and close

- Update the page in `docs/guide/` the change belongs to, and `README.md` and
  `docs/reference/limits.md` if a limit was lifted or added.
- If every box is ticked and every check passes, set the status to `Done` in the
  story and the summary table. Otherwise leave it `In progress` and list what is
  left.
- Do not commit or push. End with a short summary for the author: what changed (by
  file), what each criterion's evidence is, anything left open, and any new stories
  added.

## Review (optional, for P0 stories)

When asked to review a finished story, work without the build history: read only
the story, its design note and the diff. For each acceptance criterion, check that
a test or check really shows it, run the commands in step 4 again, and report each
criterion as met, not met, or not shown. Do not fix anything while reviewing.
