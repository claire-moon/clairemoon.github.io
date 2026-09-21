# HWTV-DRAW v0.0.2

HWTV-DRAW is an independently implemented Android-first pixel-animation editor that runs as a static GitHub Pages app.

Open https://claire-moon.github.io/clairemoon.github.io/hwtv-draw/.

## v0.0.2

- Material-style dark interface with an icon shelf and always-reachable right drawer
- Portrait overlay drawer and a permanent landscape inspector
- One-finger drawing; two-finger pinch-to-zoom and pan; a dedicated hand tool
- Editable width and height, canvas presets, grid, fullscreen, and FPS settings
- Frames, timeline thumbnails, playback, duplicate/delete, and prior/next-frame onion skinning
- Rectangle, ellipse, lasso, and magic-wand selection modes with replace/add/subtract/intersect
- PNG, WEBP, horizontal sprite-sheet PNG, and editable project JSON exports
- Local project persistence and migration from the v0.0.1 single-frame save

## License boundary

Do not add current Aseprite source code, assets, or compiled binaries to this public project without written redistribution permission from Igara Studio. The source EULA restricts public redistribution and limits modifications to personal use or upstream contribution.

For a lawful full compatibility project, either obtain an explicit commercial redistribution/WebAssembly license from Igara Studio, or base the work on LibreSprite and release the entire derivative under GPLv2. Until then HWTV-DRAW remains clean-room code.

## Next engine work

Layer stacks, transforms, importers, animation timing per frame, non-destructive selection operations, pressure input, and a C/C++ WebAssembly document engine are the next technical milestones.
