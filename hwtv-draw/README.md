# HWTV-DRAW

HWTV-DRAW is an independently implemented, touch-first pixel-art editor designed to run as a static GitHub Pages application. It has no build step and no external runtime dependencies.

## Live foundation

Open https://claire-moon.github.io/clairemoon.github.io/hwtv-draw/.

## Current working slice

- Mobile-friendly Pencil, Eraser, and connected-region Fill tools
- 16×16 through 64×64 RGBA canvases
- Undo/redo, fast line interpolation, grid and zoom controls
- Device-local persistence through localStorage
- Transparent PNG export
- Android-friendly install/offline shell through a web manifest, app icon, and service worker

## Architecture decision

The current Aseprite source tree is under an EULA that prohibits public redistribution and limits source modification to personal use or upstream contributions. Do not put Aseprite source code, assets, or compiled binaries into this public project unless Igara Studio grants a written redistribution license.

For a legal full-feature foundation there are two paths:

1. Obtain an explicit commercial redistribution/WebAssembly license from Igara Studio, then build a separately licensed Emscripten port.
2. Base a GPLv2 project on LibreSprite's independently maintained GPL-era fork, retaining GPLv2 notices and releasing the whole derived application under GPLv2.

Until that decision is made, HWTV-DRAW remains clean-room code so it can grow independently.

## Roadmap

1. Add layer stack and multi-frame timeline data structures.
2. Move the pixel/document engine into C/C++ compiled with Emscripten/WASM while keeping touch UI in TypeScript.
3. Add import/export adapters, then brush, selection, transform, palette, and animation tooling.
4. Establish test fixtures and compatibility targets before describing the editor as feature-equivalent to another product.
