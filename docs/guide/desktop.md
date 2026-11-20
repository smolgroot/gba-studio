# Desktop app

The desktop app is the same studio in its own window. It opens any folder as a project and keeps several projects open at once, one tab each.

## Install it

The desktop app is available for Linux on x64. Download it from the [latest release](https://github.com/smolgroot/gba-studio/releases/latest).

**AppImage**, which needs no installation:

```sh
chmod +x pecten-studio-*.AppImage
./pecten-studio-*.AppImage
./pecten-studio-*.AppImage ../my-game     # and open a folder
```

If it stops with a FUSE error, start it with `APPIMAGE_EXTRACT_AND_RUN=1` set in the environment.

On a Wayland desktop the app runs through XWayland, so the window gets its title bar and icon from the desktop. To run it as a native Wayland window, start it with `--ozone-platform=wayland`. On GNOME 50 that window has no title bar.

**Debian or Ubuntu package**, which adds the app to the desktop menu:

```sh
sudo apt install ./pecten-studio-*.deb
pecten-studio-desktop ../my-game
```

Each release also has a `SHA256SUMS.txt`. To check a download, run `sha256sum --check --ignore-missing SHA256SUMS.txt` in the folder that holds both files.

Editing needs nothing else. [Building a game](#building-a-game) needs the Rust tools.

## Run it from a checkout

```sh
pnpm install
pnpm desktop:dev                # run the app; the studio page rebuilds as you edit it
pnpm desktop:dev ../my-game     # and open a folder
```

To make installable Linux packages:

```sh
pnpm desktop:dist
```

The AppImage and `.deb` are written to `desktop/release/`.

## Projects and tabs

| Action | How |
| --- | --- |
| Open a folder | **File > Open Folder** or Ctrl+O, the **+** in the tab bar, or a folder on the command line |
| Switch project | Click its tab, or Ctrl+Tab and Ctrl+Shift+Tab |
| Close a project | Its **x**, a middle click on the tab, or Ctrl+W |

Opening a folder that is already open shows its tab. Starting the app again with a folder adds it to the window that is already running. The tabs that were open come back the next time the app starts.

Each project runs on its own: its undo history, build and emulator are separate from the others. A build keeps running while you work in another tab, and a dot on the tab shows whether it is running, succeeded or failed. At the right of the tab row, the current project's errors and warnings and its [ROM state](./build-and-play#rom-state-in-the-top-bar) are shown, as the top bar does in the browser. The game in Play pauses while its tab is hidden.

Closing a tab writes any edit not yet saved. Closing a tab that is building asks first, because it stops the build.

## Building a game

A folder needs a Rust game crate before it can build. If it has none, the **Build** panel offers **Set up game crate**. This adds:

- `Cargo.toml`, `build.rs`, `rust-toolchain.toml`, `.cargo/config.toml`, `.gitignore` and a starter `src/main.rs` that shows the start room;
- a copy of the studio's Rust crates in `vendor/`, so the game builds wherever the folder is;
- build commands in Project settings, if they are still the defaults.

It never replaces a file that exists.

The Build panel also says when `rustup`, the pinned Rust nightly, `rust-src` or `agb-gbafix` is missing, with the command that installs it. Builds use the `PATH` of your login shell, so tools installed there are found even when the app is started from the desktop menu.

## Coding agents

Every open project has its own MCP endpoint. **Project > Copy MCP Endpoint** copies the one for the current tab. A project keeps its port between launches, so the address stays valid. The first project gets port 4517 when it is free, and later ones get the next free port.

The `pecten-studio mcp` command is not part of the packaged app. Use the endpoint, or run the command from a checkout.

## Publishing a release

Pushing a version tag builds the app and publishes it:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The **Release** GitHub Actions workflow runs the type checks and tests, builds the AppImage and `.deb` with the tag's version, and creates a GitHub Release with generated notes and checksums. A tag with a suffix, such as `v0.2.0-rc.1`, makes a pre-release. The same tag also publishes this documentation.
