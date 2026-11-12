#!/usr/bin/env bash
# Copies the Pecten emulator core's WASM build into the app, for the Play panel.
# Build it first in the Pecten repo: `pnpm wasm:build` (wasm-pack). Default location is ../gba-wasm.
set -euo pipefail
src="${1:-$(cd "$(dirname "$0")/../.." && pwd)/gba-wasm}/public/wasm"
dest="$(cd "$(dirname "$0")/.." && pwd)/app/public/wasm"
mkdir -p "$dest"
cp "$src/pecten.js" "$src/pecten_bg.wasm" "$dest/"
echo "copied Pecten core from $src"
