---
name: screenshots
description: Take, add or retake the documentation's screenshots of Pecten-Studio with scripts/screenshots.ts. Use when a docs page needs a new picture, a change altered a page that has one, or when asked to check or refresh screenshots.
---

# Screenshots

The docs' pictures are listed in `docs/screenshots.json` and taken by
`scripts/screenshots.ts` from a running studio. Read the root `AGENTS.md` first; its
rules on commits and authorship apply.

## Set up (once per checkout)

```sh
pnpm install
pnpm exec playwright install chromium
pnpm build            # the script serves app/dist; rebuild after any change under app/
```

The list's project is Diamond Hands, at `../diamond-hands/project` (a checkout of
its own repository next to this one), so routes name its rooms and sprites
(`room:badlands`, `sprite:wassie`). A shot can name another project with
`"project"`: the three about patching use `sample`, because Diamond Hands never
reads its level data from the ROM and so can't be patched, and the behaviour shots
use it because its entity types have behaviours. Each project is copied
and served in turn. The play shots need the project's dev ROM. The build-panel shot
runs the project's real build command.

## How the script works

- It serves a **copy** of the project in a temporary folder, with everything beside
  the project linked beside the copy, so paths that leave it (`../runtime`,
  `include_bytes!("../../game/…")`) still resolve. The copy keeps file times and
  links `target/`, so the ROM still counts as up to date and a build reuses what has
  already been compiled. The copy is removed at the end. A shot may edit files,
  patch or build; the project itself is never touched, except `target/`, which a
  build updates.
- After a shot that edits or clicks **Build…**, **Patch** or **Create…**, the copy is
  made again, so the next shot starts clean.
- `--out <dir>` writes the pictures somewhere else than
  `docs/public/screenshots/`. Use it to look before replacing anything.

```sh
node scripts/screenshots.ts --list                    # every shot, with its route
node scripts/screenshots.ts play build-panel          # just these
node scripts/screenshots.ts --all --out /tmp/shots    # all of them, to look at
```

Take shots with `--out` first and look at them. `--all` without `--out` replaces
every published picture: do that only when the change touches them all, or when the
author asks.

## Add a shot

Add one line to `docs/screenshots.json`:

| Field | What it is |
| --- | --- |
| `name` | Kebab-case; also the file name. |
| `description` | What it shows. This is the image's alt text in the docs. |
| `route` | The studio's hash: `room:entry`, `world`, `play`, `tileset:tiles`, `sprite:hero`, `asset:assets/hero.png`, `project`, `audio`. |
| `viewport` | Only when it isn't the default wide screen (for example phone width). |
| `waitFor` | A selector to wait for before acting, such as `canvas`. |
| `actions` | Steps to reach the state, in order (see below). |
| `delay` | Milliseconds to settle before the picture (default 300; 3000 for a running game). |
| `clip` | A selector to picture only part of the page, such as `header`. |
| `project` | Another game folder than the list's, relative to the repository, for a state its project can't show. |
| `build` | `"dev"` or `"release"`: build the copy first, through the studio, for shots that need a ROM made by this studio. |
| `manual` | `true` only when it really can't be scripted. Say why in the story. |

Actions:

| Action | Does |
| --- | --- |
| `{ "click": "Show collision" }` | Clicks by accessible name (aria-label or label), then button name, then visible text. Add `"within": "<css>"` when the name is used twice: the Play panel's own button is `{ "click": "Play", "within": ".dv-content-container:has(canvas)" }`. |
| `{ "hover": "…" }` | Hovers, matched the same way. |
| `{ "clickAt": { "x": 632, "y": 370 } }` | Clicks at a point of the page, in CSS pixels, for what has no name, such as a placed entity on the map. With `"within": "<css>"`, the point is from the top-left of the first element that matches. Points change with the viewport and layout, so give the shot a fixed `viewport` and check the picture. |
| `{ "press": "Control+z" }` | A key, as Playwright names it. |
| `{ "fill": "Name", "text": "door" }` | Types into a field. |
| `{ "select": "Image", "option": "assets/tiles.png" }` | Picks in a drop-down. |
| `{ "edit": "src/main.rs", "append": "\n// tuned\n" }` | Changes a file in the copy, as an author or agent would. `"set": { "entities.1.y": 120 }` sets dotted JSON paths instead. |
| `{ "waitForText": "Patched in", "timeout": 15000 }` | Waits until the text is on the page. Builds need a long timeout. |
| `{ "wait": 500 }` | Waits, in milliseconds. Prefer `waitForText`. |

To find a control's accessible name, look in the panel's source for its
`aria-label`, its `title` or the `Tooltip` around it. Or open the studio with
`pnpm dev` and inspect it.

## Check every picture

Open each PNG you wrote. It must show what its description says, with nothing
half loaded (a black game screen, a spinner, an empty panel), no error the shot
isn't about, and no personal paths. If it falls short, add a `waitForText` or a
`delay` and take it again.

Then put it in its page as `![<description>](/screenshots/<name>.png)` and run
`pnpm --filter @pecten-studio/docs build` to check for dead links.

## Report

List the shots written, the shots that failed with the script's message, and any
left `manual` with the reason. Don't commit.
