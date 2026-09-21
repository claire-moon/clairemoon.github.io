(() => {
  "use strict";

  const STORAGE_KEY = "hwtv-draw-v2";
  const LEGACY_STORAGE_KEY = "hwtv-draw-v1";
  const MAX_HISTORY = 36;
  const PALETTE = [
    "#000000", "#ffffff", "#1e1f26", "#49454f", "#79747e", "#cac4d0",
    "#5b168a", "#dcb8ff", "#ef5a3c", "#ffb787", "#ffda69", "#c9ef92",
    "#54d3ae", "#42c4e8", "#8ba3ff", "#c58af9", "#f08fc2", "#af6673"
  ];

  const canvas = document.getElementById("draw-canvas");
  const stage = document.getElementById("canvas-stage");
  const context = canvas.getContext("2d", { alpha: true });
  const drawBuffer = document.createElement("canvas");
  const drawBufferContext = drawBuffer.getContext("2d", { alpha: true });

  const ui = {
    app: document.getElementById("app-root"),
    status: document.getElementById("status"),
    canvasStatus: document.getElementById("canvas-status"),
    projectReadout: document.getElementById("project-readout"),
    colorPicker: document.getElementById("color-picker"),
    colorReadout: document.getElementById("color-readout"),
    colorPreview: document.getElementById("color-preview"),
    palette: document.getElementById("palette"),
    rightDrawer: document.getElementById("right-drawer"),
    drawerScrim: document.getElementById("drawer-scrim"),
    frameReadout: document.getElementById("frame-readout"),
    frameStrip: document.getElementById("frame-strip"),
    width: document.getElementById("project-width"),
    height: document.getElementById("project-height"),
    fps: document.getElementById("fps-input"),
    grid: document.getElementById("grid-toggle"),
    onion: document.getElementById("onion-toggle"),
    play: document.getElementById("play-button")
  };

  const state = {
    project: createProject(32, 32),
    color: "#202020",
    tool: "pencil",
    panel: "color",
    drawerOpen: false,
    grid: true,
    onion: true,
    view: { zoom: 1, panX: 0, panY: 0 },
    selection: createSelection(32, 32),
    history: [],
    redo: [],
    pointers: new Map(),
    interaction: null,
    lastPointerEventAt: 0,
    lastCanvasInteractionAt: 0,
    mouseFallbackActive: false,
    playing: false,
    playTimer: 0,
    statusTimer: 0
  };

  function newFrameId() {
    return "frame-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function createFrame(width, height, pixels) {
    return {
      id: newFrameId(),
      pixels: pixels ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(width * height * 4)
    };
  }

  function createProject(width, height) {
    return {
      width: width,
      height: height,
      fps: 12,
      activeFrame: 0,
      frames: [createFrame(width, height)]
    };
  }

  function createSelection(width, height) {
    return {
      mask: new Uint8Array(width * height),
      active: false,
      shape: "rect",
      mode: "replace",
      draft: null
    };
  }

  function activeFrame() {
    return state.project.frames[state.project.activeFrame];
  }

  function clamp(value, lower, upper) {
    return Math.min(Math.max(value, lower), upper);
  }

  function cellIndex(x, y) {
    return y * state.project.width + x;
  }

  function pixelOffset(x, y) {
    return cellIndex(x, y) * 4;
  }

  function rgbaFromHex(hex) {
    const normalized = hex.replace("#", "");
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      255
    ];
  }

  function hexFromRgba(rgba) {
    if (rgba[3] === 0) {
      return "#000000";
    }
    return "#" + rgba.slice(0, 3).map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function cloneProject(project) {
    return {
      width: project.width,
      height: project.height,
      fps: project.fps,
      activeFrame: project.activeFrame,
      frames: project.frames.map((frame) => ({
        id: frame.id,
        pixels: new Uint8ClampedArray(frame.pixels)
      }))
    };
  }

  function snapshotProject() {
    return cloneProject(state.project);
  }

  function pushHistory(snapshot) {
    state.history.push(snapshot);
    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }
    state.redo.length = 0;
  }

  function resetSelection() {
    const shape = state.selection.shape;
    const mode = state.selection.mode;
    state.selection = createSelection(state.project.width, state.project.height);
    state.selection.shape = shape;
    state.selection.mode = mode;
  }

  function restoreProject(project) {
    state.project = cloneProject(project);
    state.project.activeFrame = clamp(state.project.activeFrame, 0, state.project.frames.length - 1);
    resetSelection();
    syncProjectControls();
    render();
    persist();
  }

  function undo() {
    const entry = state.history.pop();
    if (!entry) {
      showStatus("Nothing to undo");
      return;
    }
    state.redo.push(snapshotProject());
    restoreProject(entry);
    showStatus("Undone");
  }

  function redo() {
    const entry = state.redo.pop();
    if (!entry) {
      showStatus("Nothing to redo");
      return;
    }
    state.history.push(snapshotProject());
    restoreProject(entry);
    showStatus("Redone");
  }

  function showStatus(message) {
    window.clearTimeout(state.statusTimer);
    ui.status.textContent = message;
    ui.canvasStatus.textContent = message;
    ui.canvasStatus.classList.add("is-visible");
    state.statusTimer = window.setTimeout(() => {
      ui.canvasStatus.classList.remove("is-visible");
    }, 1800);
  }

  function isLandscapeLayout() {
    return window.matchMedia("(min-width: 760px) and (orientation: landscape)").matches;
  }

  function applyDrawerState() {
    ui.rightDrawer.classList.toggle("is-open", state.drawerOpen);
    ui.drawerScrim.classList.toggle("is-visible", state.drawerOpen && !isLandscapeLayout());
    document.querySelectorAll("[data-panel]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.panel === state.panel);
    });
    document.querySelectorAll("[data-panel-content]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panelContent === state.panel);
    });
  }

  function setPanel(panel) {
    if (!isLandscapeLayout() && state.panel === panel) {
      state.drawerOpen = !state.drawerOpen;
    } else {
      state.panel = panel;
      state.drawerOpen = true;
    }
    applyDrawerState();
  }

  function closeDrawer() {
    if (isLandscapeLayout()) {
      return;
    }
    state.drawerOpen = false;
    applyDrawerState();
  }

  function updateToolControls() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      const active = button.dataset.tool === state.tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-selection-shape]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.selectionShape === state.selection.shape);
    });
    document.querySelectorAll("[data-selection-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.selectionMode === state.selection.mode);
    });
  }

  function setTool(tool) {
    state.tool = tool;
    updateToolControls();
    if (tool === "select") {
      setPanel("selection");
    } else {
      closeDrawer();
    }
  }

  function setColor(color, silent) {
    state.color = color.toUpperCase();
    ui.colorPicker.value = state.color;
    ui.colorReadout.textContent = state.color;
    ui.colorPreview.style.background = state.color;
    document.querySelectorAll(".swatch").forEach((swatch) => {
      swatch.classList.toggle("is-current", swatch.dataset.color.toUpperCase() === state.color);
    });
    if (!silent) {
      persist();
    }
  }

  function createCheckerPattern(scale, targetContext) {
    const tile = document.createElement("canvas");
    const size = Math.max(Math.round(scale * 2), 8);
    tile.width = size;
    tile.height = size;
    const tileContext = tile.getContext("2d");
    tileContext.fillStyle = "#eceff3";
    tileContext.fillRect(0, 0, size, size);
    tileContext.fillStyle = "#bfc5ce";
    tileContext.fillRect(0, 0, size / 2, size / 2);
    tileContext.fillRect(size / 2, size / 2, size / 2, size / 2);
    return targetContext.createPattern(tile, "repeat");
  }

  function rawCanvasForFrame(frame) {
    const raw = document.createElement("canvas");
    raw.width = state.project.width;
    raw.height = state.project.height;
    raw.getContext("2d", { alpha: true }).putImageData(
      new ImageData(new Uint8ClampedArray(frame.pixels), state.project.width, state.project.height),
      0,
      0
    );
    return raw;
  }

  function fitScale() {
    const bounds = stage.getBoundingClientRect();
    const availableWidth = Math.max(bounds.width - 42, 90);
    const availableHeight = Math.max(bounds.height - 42, 90);
    return clamp(Math.floor(Math.min(availableWidth / state.project.width, availableHeight / state.project.height)), 3, 42);
  }

  function displayScale() {
    return clamp(Math.round(fitScale() * state.view.zoom), 2, 64);
  }

  function drawFrame(frame, scale, alpha) {
    const raw = rawCanvasForFrame(frame);
    context.save();
    context.globalAlpha = alpha;
    context.imageSmoothingEnabled = false;
    context.drawImage(raw, 0, 0, raw.width * scale, raw.height * scale);
    context.restore();
  }

  function hasSelectionAt(x, y) {
    return !state.selection.active || Boolean(state.selection.mask[cellIndex(x, y)]);
  }

  function drawSelection(scale) {
    if (state.selection.active) {
      context.save();
      context.fillStyle = "rgba(220, 184, 255, 0.13)";
      context.strokeStyle = "#f5d9ff";
      context.lineWidth = Math.max(1, scale > 7 ? 1.5 : 1);
      context.setLineDash([Math.max(2, scale / 3), Math.max(2, scale / 3)]);
      context.lineDashOffset = -Date.now() / 110;
      context.beginPath();
      for (let y = 0; y < state.project.height; y += 1) {
        for (let x = 0; x < state.project.width; x += 1) {
          const selected = Boolean(state.selection.mask[cellIndex(x, y)]);
          if (!selected) {
            continue;
          }
          context.fillRect(x * scale, y * scale, scale, scale);
          if (y === 0 || !state.selection.mask[cellIndex(x, y - 1)]) {
            context.moveTo(x * scale, y * scale);
            context.lineTo((x + 1) * scale, y * scale);
          }
          if (x === state.project.width - 1 || !state.selection.mask[cellIndex(x + 1, y)]) {
            context.moveTo((x + 1) * scale, y * scale);
            context.lineTo((x + 1) * scale, (y + 1) * scale);
          }
          if (y === state.project.height - 1 || !state.selection.mask[cellIndex(x, y + 1)]) {
            context.moveTo((x + 1) * scale, (y + 1) * scale);
            context.lineTo(x * scale, (y + 1) * scale);
          }
          if (x === 0 || !state.selection.mask[cellIndex(x - 1, y)]) {
            context.moveTo(x * scale, (y + 1) * scale);
            context.lineTo(x * scale, y * scale);
          }
        }
      }
      context.stroke();
      context.restore();
    }
    drawSelectionDraft(scale);
  }

  function drawSelectionDraft(scale) {
    const draft = state.selection.draft;
    if (!draft) {
      return;
    }
    context.save();
    context.strokeStyle = "#ffda69";
    context.lineWidth = Math.max(1, scale > 7 ? 2 : 1);
    context.setLineDash([4, 4]);
    const start = draft.start;
    const end = draft.end || start;
    if (draft.shape === "rect") {
      const left = Math.min(start.x, end.x) * scale;
      const top = Math.min(start.y, end.y) * scale;
      const width = (Math.abs(start.x - end.x) + 1) * scale;
      const height = (Math.abs(start.y - end.y) + 1) * scale;
      context.strokeRect(left, top, width, height);
    } else if (draft.shape === "ellipse") {
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.abs(start.x - end.x) + 1;
      const height = Math.abs(start.y - end.y) + 1;
      context.beginPath();
      context.ellipse((left + width / 2) * scale, (top + height / 2) * scale, width * scale / 2, height * scale / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else if (draft.shape === "lasso" && draft.points.length > 1) {
      context.beginPath();
      context.moveTo((draft.points[0].x + 0.5) * scale, (draft.points[0].y + 0.5) * scale);
      draft.points.slice(1).forEach((point) => context.lineTo((point.x + 0.5) * scale, (point.y + 0.5) * scale));
      context.stroke();
    }
    context.restore();
  }

  function drawGrid(scale, width, height) {
    if (!state.grid || scale < 6) {
      return;
    }
    context.save();
    context.beginPath();
    context.strokeStyle = "rgba(0, 0, 0, 0.34)";
    context.lineWidth = 1;
    for (let x = 0; x <= state.project.width; x += 1) {
      const point = x * scale + 0.5;
      context.moveTo(point, 0);
      context.lineTo(point, height);
    }
    for (let y = 0; y <= state.project.height; y += 1) {
      const point = y * scale + 0.5;
      context.moveTo(0, point);
      context.lineTo(width, point);
    }
    context.stroke();
    context.restore();
  }

  function syncProjectControls() {
    ui.projectReadout.textContent = state.project.width + " × " + state.project.height;
    ui.frameReadout.textContent = (state.project.activeFrame + 1) + " / " + state.project.frames.length;
    ui.width.value = String(state.project.width);
    ui.height.value = String(state.project.height);
    ui.fps.value = String(state.project.fps);
    ui.grid.setAttribute("aria-pressed", String(state.grid));
    ui.onion.setAttribute("aria-pressed", String(state.onion));
    ui.play.classList.toggle("is-active", state.playing);
    ui.play.setAttribute("aria-pressed", String(state.playing));
    canvas.setAttribute("aria-label", "Frame " + (state.project.activeFrame + 1) + " of " + state.project.frames.length + ", " + state.project.width + " by " + state.project.height + " pixel canvas");
  }

  function renderFrameStrip() {
    ui.frameStrip.replaceChildren();
    state.project.frames.forEach((frame, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "frame-thumb" + (index === state.project.activeFrame ? " is-active" : "");
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-label", "Frame " + (index + 1));
      button.title = "Frame " + (index + 1);
      const thumbnail = document.createElement("canvas");
      thumbnail.width = 48;
      thumbnail.height = 48;
      const thumbContext = thumbnail.getContext("2d", { alpha: true });
      thumbContext.fillStyle = createCheckerPattern(6, thumbContext);
      thumbContext.fillRect(0, 0, 48, 48);
      const raw = rawCanvasForFrame(frame);
      const ratio = Math.min(48 / state.project.width, 48 / state.project.height);
      const width = Math.max(1, Math.round(state.project.width * ratio));
      const height = Math.max(1, Math.round(state.project.height * ratio));
      thumbContext.imageSmoothingEnabled = false;
      thumbContext.drawImage(raw, Math.round((48 - width) / 2), Math.round((48 - height) / 2), width, height);
      const label = document.createElement("span");
      label.className = "frame-index";
      label.textContent = String(index + 1);
      button.append(thumbnail, label);
      button.addEventListener("click", () => {
        stopPlayback();
        state.project.activeFrame = index;
        resetSelection();
        render();
        persist();
      });
      ui.frameStrip.appendChild(button);
    });
  }

  function render() {
    const scale = displayScale();
    const width = state.project.width * scale;
    const height = state.project.height * scale;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.style.transform = "translate(-50%, -50%) translate(" + Math.round(state.view.panX) + "px, " + Math.round(state.view.panY) + "px)";
    context.fillStyle = createCheckerPattern(scale, context);
    context.fillRect(0, 0, width, height);

    if (state.onion) {
      const previous = state.project.frames[state.project.activeFrame - 1];
      const next = state.project.frames[state.project.activeFrame + 1];
      if (previous) {
        drawFrame(previous, scale, 0.16);
      }
      if (next) {
        drawFrame(next, scale, 0.12);
      }
    }
    drawFrame(activeFrame(), scale, 1);
    drawGrid(scale, width, height);
    drawSelection(scale);
    syncProjectControls();
    updateToolControls();
    renderFrameStrip();
    applyDrawerState();
  }

  function pointFromEvent(event) {
    const rectangle = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rectangle.left) * state.project.width / rectangle.width);
    const y = Math.floor((event.clientY - rectangle.top) * state.project.height / rectangle.height);
    return {
      x: clamp(x, 0, state.project.width - 1),
      y: clamp(y, 0, state.project.height - 1)
    };
  }

  function eventIsOnCanvas(event) {
    const rectangle = canvas.getBoundingClientRect();
    return event.clientX >= rectangle.left && event.clientX <= rectangle.right &&
      event.clientY >= rectangle.top && event.clientY <= rectangle.bottom;
  }

  function pixelsMatch(pixels, offset, rgba) {
    return pixels[offset] === rgba[0] &&
      pixels[offset + 1] === rgba[1] &&
      pixels[offset + 2] === rgba[2] &&
      pixels[offset + 3] === rgba[3];
  }

  function setPixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= state.project.width || y >= state.project.height || !hasSelectionAt(x, y)) {
      return false;
    }
    const pixels = activeFrame().pixels;
    const offset = pixelOffset(x, y);
    if (pixelsMatch(pixels, offset, rgba)) {
      return false;
    }
    pixels[offset] = rgba[0];
    pixels[offset + 1] = rgba[1];
    pixels[offset + 2] = rgba[2];
    pixels[offset + 3] = rgba[3];
    return true;
  }

  function drawLine(start, end, rgba) {
    let x = start.x;
    let y = start.y;
    const deltaX = Math.abs(end.x - start.x);
    const stepX = start.x < end.x ? 1 : -1;
    const deltaY = -Math.abs(end.y - start.y);
    const stepY = start.y < end.y ? 1 : -1;
    let error = deltaX + deltaY;
    let changed = false;

    while (true) {
      changed = setPixel(x, y, rgba) || changed;
      if (x === end.x && y === end.y) {
        break;
      }
      const errorDouble = error * 2;
      if (errorDouble >= deltaY) {
        error += deltaY;
        x += stepX;
      }
      if (errorDouble <= deltaX) {
        error += deltaX;
        y += stepY;
      }
    }
    return changed;
  }

  function floodFill(startX, startY, rgba) {
    const pixels = activeFrame().pixels;
    const startOffset = pixelOffset(startX, startY);
    const source = [
      pixels[startOffset],
      pixels[startOffset + 1],
      pixels[startOffset + 2],
      pixels[startOffset + 3]
    ];
    if (source[0] === rgba[0] && source[1] === rgba[1] && source[2] === rgba[2] && source[3] === rgba[3]) {
      return false;
    }
    const visited = new Uint8Array(state.project.width * state.project.height);
    const stack = [[startX, startY]];
    let changed = false;

    while (stack.length) {
      const point = stack.pop();
      const x = point[0];
      const y = point[1];
      if (x < 0 || y < 0 || x >= state.project.width || y >= state.project.height) {
        continue;
      }
      const cell = cellIndex(x, y);
      if (visited[cell] || !hasSelectionAt(x, y)) {
        continue;
      }
      visited[cell] = 1;
      const offset = cell * 4;
      if (!pixelsMatch(pixels, offset, source)) {
        continue;
      }
      pixels[offset] = rgba[0];
      pixels[offset + 1] = rgba[1];
      pixels[offset + 2] = rgba[2];
      pixels[offset + 3] = rgba[3];
      changed = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return changed;
  }

  function createRectMask(start, end) {
    const mask = new Uint8Array(state.project.width * state.project.height);
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        mask[cellIndex(x, y)] = 1;
      }
    }
    return mask;
  }

  function createEllipseMask(start, end) {
    const mask = new Uint8Array(state.project.width * state.project.height);
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const radiusX = Math.max((right - left + 1) / 2, 0.5);
    const radiusY = Math.max((bottom - top + 1) / 2, 0.5);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const distance = ((x - centerX) * (x - centerX)) / (radiusX * radiusX) + ((y - centerY) * (y - centerY)) / (radiusY * radiusY);
        if (distance <= 1) {
          mask[cellIndex(x, y)] = 1;
        }
      }
    }
    return mask;
  }

  function pointInsidePolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const first = points[i];
      const second = points[j];
      const intersects = ((first.y > y) !== (second.y > y)) &&
        (x < (second.x - first.x) * (y - first.y) / ((second.y - first.y) || 0.0001) + first.x);
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  function createLassoMask(points) {
    if (points.length < 3) {
      return createRectMask(points[0], points[points.length - 1] || points[0]);
    }
    const mask = new Uint8Array(state.project.width * state.project.height);
    const left = clamp(Math.min(...points.map((point) => point.x)), 0, state.project.width - 1);
    const right = clamp(Math.max(...points.map((point) => point.x)), 0, state.project.width - 1);
    const top = clamp(Math.min(...points.map((point) => point.y)), 0, state.project.height - 1);
    const bottom = clamp(Math.max(...points.map((point) => point.y)), 0, state.project.height - 1);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (pointInsidePolygon(x + 0.5, y + 0.5, points)) {
          mask[cellIndex(x, y)] = 1;
        }
      }
    }
    return mask;
  }

  function createWandMask(startX, startY) {
    const mask = new Uint8Array(state.project.width * state.project.height);
    const pixels = activeFrame().pixels;
    const startOffset = pixelOffset(startX, startY);
    const source = [
      pixels[startOffset],
      pixels[startOffset + 1],
      pixels[startOffset + 2],
      pixels[startOffset + 3]
    ];
    const stack = [[startX, startY]];
    while (stack.length) {
      const point = stack.pop();
      const x = point[0];
      const y = point[1];
      if (x < 0 || y < 0 || x >= state.project.width || y >= state.project.height) {
        continue;
      }
      const cell = cellIndex(x, y);
      if (mask[cell]) {
        continue;
      }
      const offset = cell * 4;
      if (!pixelsMatch(pixels, offset, source)) {
        continue;
      }
      mask[cell] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return mask;
  }

  function mergeSelection(mask) {
    const oldMask = state.selection.mask;
    const merged = new Uint8Array(mask.length);
    for (let index = 0; index < mask.length; index += 1) {
      if (state.selection.mode === "add") {
        merged[index] = oldMask[index] || mask[index] ? 1 : 0;
      } else if (state.selection.mode === "subtract") {
        merged[index] = oldMask[index] && !mask[index] ? 1 : 0;
      } else if (state.selection.mode === "intersect") {
        merged[index] = oldMask[index] && mask[index] ? 1 : 0;
      } else {
        merged[index] = mask[index];
      }
    }
    state.selection.mask = merged;
    state.selection.active = merged.some((value) => value === 1);
    state.selection.draft = null;
    render();
  }

  function finishInteraction() {
    const interaction = state.interaction;
    if (!interaction) {
      return;
    }
    if (interaction.type === "stroke") {
      if (interaction.changed) {
        pushHistory(interaction.before);
        persist();
      }
    } else if (interaction.type === "selection") {
      const draft = state.selection.draft;
      if (draft) {
        let mask;
        if (draft.shape === "ellipse") {
          mask = createEllipseMask(draft.start, draft.end || draft.start);
        } else if (draft.shape === "lasso") {
          mask = createLassoMask(draft.points);
        } else {
          mask = createRectMask(draft.start, draft.end || draft.start);
        }
        mergeSelection(mask);
      }
    }
    state.interaction = null;
  }

  function startPinch() {
    if (state.pointers.size < 2) {
      return;
    }
    finishInteraction();
    const points = Array.from(state.pointers.values()).slice(0, 2);
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    state.interaction = {
      type: "pinch",
      distance: Math.max(distance, 1),
      zoom: state.view.zoom,
      panX: state.view.panX,
      panY: state.view.panY,
      midpoint: {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2
      }
    };
  }

  function updatePinch() {
    if (!state.interaction || state.interaction.type !== "pinch" || state.pointers.size < 2) {
      return;
    }
    const points = Array.from(state.pointers.values()).slice(0, 2);
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const midpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
    state.view.zoom = clamp(state.interaction.zoom * distance / state.interaction.distance, 0.45, 8);
    state.view.panX = state.interaction.panX + midpoint.x - state.interaction.midpoint.x;
    state.view.panY = state.interaction.panY + midpoint.y - state.interaction.midpoint.y;
    render();
  }

  function onPointerDown(event) {
    if (!event.isFallbackMouse) {
      state.lastPointerEventAt = performance.now();
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (state.tool !== "pan" && !eventIsOnCanvas(event)) {
      return;
    }
    event.preventDefault();
    state.lastCanvasInteractionAt = performance.now();
    try {
      stage.setPointerCapture(event.pointerId);
    } catch (error) {
      /* The drawing logic still works when a browser declines pointer capture. */
    }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size >= 2) {
      startPinch();
      return;
    }

    const point = pointFromEvent(event);
    if (state.tool === "pan") {
      state.interaction = {
        type: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panX: state.view.panX,
        panY: state.view.panY
      };
      return;
    }

    if (state.tool === "select") {
      if (state.selection.shape === "wand") {
        mergeSelection(createWandMask(point.x, point.y));
        showStatus("Selection updated");
        return;
      }
      state.selection.draft = {
        shape: state.selection.shape,
        start: point,
        end: point,
        points: [point]
      };
      state.interaction = { type: "selection", pointerId: event.pointerId };
      render();
      return;
    }

    if (state.tool === "picker") {
      const pixels = activeFrame().pixels;
      const offset = pixelOffset(point.x, point.y);
      setColor(hexFromRgba([pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]]));
      showStatus("Color sampled");
      return;
    }

    if (state.tool === "fill") {
      const before = snapshotProject();
      if (floodFill(point.x, point.y, rgbaFromHex(state.color))) {
        pushHistory(before);
        persist();
        render();
        showStatus("Filled");
      }
      return;
    }

    const rgba = state.tool === "eraser" ? [0, 0, 0, 0] : rgbaFromHex(state.color);
    const before = snapshotProject();
    const changed = drawLine(point, point, rgba);
    state.interaction = {
      type: "stroke",
      pointerId: event.pointerId,
      before: before,
      last: point,
      rgba: rgba,
      changed: changed
    };
    if (changed) {
      render();
    }
  }

  function onPointerMove(event) {
    if (!event.isFallbackMouse) {
      state.lastPointerEventAt = performance.now();
    }
    if (state.pointers.has(event.pointerId)) {
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (state.pointers.size >= 2) {
      event.preventDefault();
      updatePinch();
      return;
    }
    const interaction = state.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    if (interaction.type === "pan") {
      state.view.panX = interaction.panX + event.clientX - interaction.startX;
      state.view.panY = interaction.panY + event.clientY - interaction.startY;
      render();
      return;
    }
    const point = pointFromEvent(event);
    if (interaction.type === "selection") {
      state.selection.draft.end = point;
      if (state.selection.draft.shape === "lasso") {
        const points = state.selection.draft.points;
        const last = points[points.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) {
          points.push(point);
        }
      }
      render();
      return;
    }
    if (interaction.type === "stroke") {
      const changed = drawLine(interaction.last, point, interaction.rgba);
      interaction.last = point;
      interaction.changed = interaction.changed || changed;
      if (changed) {
        render();
      }
    }
  }

  function onPointerEnd(event) {
    if (!event.isFallbackMouse) {
      state.lastPointerEventAt = performance.now();
    }
    const interaction = state.interaction;
    state.pointers.delete(event.pointerId);
    if (interaction && interaction.type === "pinch") {
      if (state.pointers.size < 2) {
        state.interaction = null;
        persist();
      }
    } else if (interaction && interaction.pointerId === event.pointerId) {
      finishInteraction();
      render();
    }
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  }

  function onLostPointerCapture(event) {
    if (!state.pointers.has(event.pointerId)) {
      return;
    }
    onPointerEnd(event);
  }

  function mouseEventAsPointer(event) {
    return {
      isFallbackMouse: true,
      pointerId: 1,
      pointerType: "mouse",
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      preventDefault: () => event.preventDefault()
    };
  }

  function shouldUseMouseFallback() {
    return performance.now() - state.lastPointerEventAt > 250;
  }

  function onMouseDown(event) {
    if (event.button !== 0 || !shouldUseMouseFallback()) {
      return;
    }
    state.mouseFallbackActive = true;
    onPointerDown(mouseEventAsPointer(event));
  }

  function onMouseMove(event) {
    if (!state.mouseFallbackActive) {
      return;
    }
    onPointerMove(mouseEventAsPointer(event));
  }

  function onMouseUp(event) {
    if (!state.mouseFallbackActive) {
      return;
    }
    onPointerEnd(mouseEventAsPointer(event));
    state.mouseFallbackActive = false;
  }

  function onCanvasClick(event) {
    if (performance.now() - state.lastCanvasInteractionAt < 350 || !eventIsOnCanvas(event)) {
      return;
    }
    if (state.tool !== "pencil" && state.tool !== "eraser") {
      return;
    }
    event.preventDefault();
    const point = pointFromEvent(event);
    const before = snapshotProject();
    const rgba = state.tool === "eraser" ? [0, 0, 0, 0] : rgbaFromHex(state.color);
    if (drawLine(point, point, rgba)) {
      pushHistory(before);
      persist();
      render();
    }
  }

  function resizeProject(width, height) {
    const safeWidth = clamp(Number.parseInt(width, 10) || 0, 8, 512);
    const safeHeight = clamp(Number.parseInt(height, 10) || 0, 8, 512);
    if (safeWidth === state.project.width && safeHeight === state.project.height) {
      return;
    }
    const before = snapshotProject();
    state.project.frames = state.project.frames.map((frame) => {
      const next = createFrame(safeWidth, safeHeight);
      const copyWidth = Math.min(state.project.width, safeWidth);
      const copyHeight = Math.min(state.project.height, safeHeight);
      for (let y = 0; y < copyHeight; y += 1) {
        for (let x = 0; x < copyWidth; x += 1) {
          const source = (y * state.project.width + x) * 4;
          const target = (y * safeWidth + x) * 4;
          next.pixels[target] = frame.pixels[source];
          next.pixels[target + 1] = frame.pixels[source + 1];
          next.pixels[target + 2] = frame.pixels[source + 2];
          next.pixels[target + 3] = frame.pixels[source + 3];
        }
      }
      return next;
    });
    state.project.width = safeWidth;
    state.project.height = safeHeight;
    resetSelection();
    pushHistory(before);
    persist();
    render();
    showStatus(safeWidth + " × " + safeHeight);
  }

  function selectFrame(index) {
    stopPlayback();
    state.project.activeFrame = clamp(index, 0, state.project.frames.length - 1);
    resetSelection();
    persist();
    render();
  }

  function addFrame(copy) {
    const before = snapshotProject();
    const source = activeFrame();
    const frame = copy ? createFrame(state.project.width, state.project.height, source.pixels) : createFrame(state.project.width, state.project.height);
    state.project.frames.splice(state.project.activeFrame + 1, 0, frame);
    state.project.activeFrame += 1;
    resetSelection();
    pushHistory(before);
    persist();
    render();
    showStatus(copy ? "Frame duplicated" : "Frame added");
  }

  function deleteFrame() {
    if (state.project.frames.length === 1) {
      showStatus("Keep one frame");
      return;
    }
    const before = snapshotProject();
    state.project.frames.splice(state.project.activeFrame, 1);
    state.project.activeFrame = clamp(state.project.activeFrame, 0, state.project.frames.length - 1);
    resetSelection();
    pushHistory(before);
    persist();
    render();
    showStatus("Frame deleted");
  }

  function startPlayback() {
    if (state.project.frames.length < 2) {
      showStatus("Add a frame to play");
      return;
    }
    state.playing = true;
    const duration = Math.max(16, Math.round(1000 / state.project.fps));
    state.playTimer = window.setInterval(() => {
      state.project.activeFrame = (state.project.activeFrame + 1) % state.project.frames.length;
      resetSelection();
      render();
    }, duration);
    render();
  }

  function stopPlayback() {
    if (!state.playing) {
      return;
    }
    window.clearInterval(state.playTimer);
    state.playTimer = 0;
    state.playing = false;
    render();
  }

  function togglePlayback() {
    if (state.playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function resetView() {
    state.view.zoom = 1;
    state.view.panX = 0;
    state.view.panY = 0;
    render();
  }

  function bytesToBase64(bytes) {
    let result = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      result += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
    }
    return window.btoa(result);
  }

  function base64ToBytes(encoded) {
    const raw = window.atob(encoded);
    const bytes = new Uint8ClampedArray(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      bytes[index] = raw.charCodeAt(index);
    }
    return bytes;
  }

  function persist() {
    try {
      const data = {
        version: "0.0.2",
        project: {
          width: state.project.width,
          height: state.project.height,
          fps: state.project.fps,
          activeFrame: state.project.activeFrame,
          frames: state.project.frames.map((frame) => ({ id: frame.id, pixels: bytesToBase64(frame.pixels) }))
        },
        preferences: {
          color: state.color,
          tool: state.tool,
          grid: state.grid,
          onion: state.onion,
          zoom: state.view.zoom
        }
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      ui.status.textContent = "Local save unavailable";
    }
  }

  function restoreLegacyProject() {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) {
      return false;
    }
    try {
      const parsed = JSON.parse(legacy);
      const width = Number(parsed.width);
      const height = Number(parsed.height);
      const pixels = base64ToBytes(parsed.pixels);
      if (!Number.isInteger(width) || !Number.isInteger(height) || pixels.length !== width * height * 4) {
        return false;
      }
      state.project = createProject(width, height);
      state.project.frames[0].pixels = pixels;
      state.color = typeof parsed.color === "string" ? parsed.color : state.color;
      state.grid = typeof parsed.grid === "boolean" ? parsed.grid : state.grid;
      state.view.zoom = Number.isFinite(parsed.zoom) ? clamp(parsed.zoom, 0.45, 8) : 1;
      return true;
    } catch (error) {
      return false;
    }
  }

  function restorePersistedProject() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return restoreLegacyProject();
      }
      const parsed = JSON.parse(stored);
      const project = parsed.project;
      if (!project || !Number.isInteger(project.width) || !Number.isInteger(project.height) || !Array.isArray(project.frames) || !project.frames.length) {
        return false;
      }
      const width = clamp(project.width, 8, 512);
      const height = clamp(project.height, 8, 512);
      const frames = project.frames.map((frame) => {
        const pixels = base64ToBytes(frame.pixels);
        if (pixels.length !== width * height * 4) {
          throw new Error("Invalid frame");
        }
        return { id: frame.id || newFrameId(), pixels: pixels };
      });
      state.project = {
        width: width,
        height: height,
        fps: clamp(Number.parseInt(project.fps, 10) || 12, 1, 60),
        activeFrame: clamp(Number.parseInt(project.activeFrame, 10) || 0, 0, frames.length - 1),
        frames: frames
      };
      const preferences = parsed.preferences || {};
      state.color = typeof preferences.color === "string" ? preferences.color : state.color;
      state.tool = typeof preferences.tool === "string" ? preferences.tool : state.tool;
      state.grid = typeof preferences.grid === "boolean" ? preferences.grid : state.grid;
      state.onion = typeof preferences.onion === "boolean" ? preferences.onion : state.onion;
      state.view.zoom = Number.isFinite(preferences.zoom) ? clamp(preferences.zoom, 0.45, 8) : 1;
      return true;
    } catch (error) {
      return false;
    }
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 500);
  }

  function fileStem() {
    return "hwtv-draw-" + state.project.width + "x" + state.project.height + "-f" + (state.project.activeFrame + 1);
  }

  function exportFrame(type, extension) {
    const raw = rawCanvasForFrame(activeFrame());
    raw.toBlob((blob) => {
      if (!blob) {
        showStatus("Export failed");
        return;
      }
      downloadBlob(blob, fileStem() + "." + extension);
      showStatus(extension.toUpperCase() + " saved");
    }, type);
  }

  function exportSheet() {
    const output = document.createElement("canvas");
    output.width = state.project.width * state.project.frames.length;
    output.height = state.project.height;
    const outputContext = output.getContext("2d", { alpha: true });
    state.project.frames.forEach((frame, index) => {
      outputContext.drawImage(rawCanvasForFrame(frame), index * state.project.width, 0);
    });
    output.toBlob((blob) => {
      if (!blob) {
        showStatus("Sheet export failed");
        return;
      }
      downloadBlob(blob, "hwtv-draw-sheet-" + state.project.frames.length + "f.png");
      showStatus("Sprite sheet saved");
    }, "image/png");
  }

  function exportProject() {
    const payload = {
      format: "hwtv-draw-project",
      version: "0.0.2",
      width: state.project.width,
      height: state.project.height,
      fps: state.project.fps,
      frames: state.project.frames.map((frame) => ({ id: frame.id, pixels: bytesToBase64(frame.pixels) }))
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "hwtv-draw-project.json");
    showStatus("Project saved");
  }

  function buildPalette() {
    PALETTE.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.color = color;
      button.style.background = color;
      button.setAttribute("aria-label", "Use " + color);
      button.title = color;
      button.addEventListener("click", () => {
        setColor(color);
        closeDrawer();
      });
      ui.palette.appendChild(button);
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });
    document.querySelectorAll("[data-panel]").forEach((button) => {
      button.addEventListener("click", () => setPanel(button.dataset.panel));
    });
    document.querySelectorAll("[data-selection-shape]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selection.shape = button.dataset.selectionShape;
        setTool("select");
        render();
      });
    });
    document.querySelectorAll("[data-selection-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selection.mode = button.dataset.selectionMode;
        render();
      });
    });
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const parts = button.dataset.preset.split("x").map((part) => Number.parseInt(part, 10));
        ui.width.value = String(parts[0]);
        ui.height.value = String(parts[1]);
        resizeProject(parts[0], parts[1]);
      });
    });

    ui.colorPicker.addEventListener("input", () => setColor(ui.colorPicker.value));
    ui.colorPicker.addEventListener("change", () => closeDrawer());
    ui.drawerScrim.addEventListener("click", closeDrawer);
    document.getElementById("undo-button").addEventListener("click", undo);
    document.getElementById("redo-button").addEventListener("click", redo);
    document.getElementById("fullscreen-button").addEventListener("click", toggleFullscreen);
    document.getElementById("clear-selection").addEventListener("click", () => {
      resetSelection();
      render();
      showStatus("Selection cleared");
    });
    document.getElementById("frame-create").addEventListener("click", () => addFrame(false));
    document.getElementById("frame-duplicate").addEventListener("click", () => addFrame(true));
    document.getElementById("frame-delete").addEventListener("click", deleteFrame);
    document.getElementById("apply-size").addEventListener("click", () => resizeProject(ui.width.value, ui.height.value));
    document.getElementById("reset-view").addEventListener("click", resetView);
    document.getElementById("add-frame").addEventListener("click", () => addFrame(false));
    document.getElementById("previous-frame").addEventListener("click", () => selectFrame(state.project.activeFrame - 1));
    document.getElementById("next-frame").addEventListener("click", () => selectFrame(state.project.activeFrame + 1));
    ui.play.addEventListener("click", togglePlayback);
    ui.grid.addEventListener("click", () => {
      state.grid = !state.grid;
      persist();
      render();
    });
    ui.onion.addEventListener("click", () => {
      state.onion = !state.onion;
      persist();
      render();
    });
    ui.fps.addEventListener("change", () => {
      state.project.fps = clamp(Number.parseInt(ui.fps.value, 10) || 12, 1, 60);
      if (state.playing) {
        stopPlayback();
        startPlayback();
      }
      persist();
      render();
    });

    document.getElementById("export-png").addEventListener("click", () => exportFrame("image/png", "png"));
    document.getElementById("export-webp").addEventListener("click", () => exportFrame("image/webp", "webp"));
    document.getElementById("export-sheet").addEventListener("click", exportSheet);
    document.getElementById("export-project").addEventListener("click", exportProject);

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerEnd);
    stage.addEventListener("pointercancel", onPointerEnd);
    stage.addEventListener("lostpointercapture", onLostPointerCapture);
    stage.addEventListener("mousedown", onMouseDown);
    stage.addEventListener("mousemove", onMouseMove);
    stage.addEventListener("mouseup", onMouseUp);
    stage.addEventListener("click", onCanvasClick);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("resize", () => {
      if (isLandscapeLayout()) {
        state.drawerOpen = true;
      }
      render();
    });
    window.addEventListener("orientationchange", () => window.setTimeout(render, 180));
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if (event.ctrlKey || event.metaKey) {
        return;
      }
      if (key === "b") setTool("pencil");
      if (key === "e") setTool("eraser");
      if (key === "f") setTool("fill");
      if (key === "i") setTool("picker");
      if (key === "s") setTool("select");
      if (key === "h") setTool("pan");
      if (key === " ") togglePlayback();
    });
  }

  function toggleFullscreen() {
    const target = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (target.requestFullscreen) {
      target.requestFullscreen().catch(() => {});
    }
  }

  function initialize() {
    const restored = restorePersistedProject();
    buildPalette();
    setColor(state.color, true);
    state.drawerOpen = isLandscapeLayout();
    bindEvents();
    render();
    showStatus(restored ? "Project restored" : "Ready");
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js?v=0.0.2-r2", { updateViaCache: "none" }).catch(() => {});
      });
    }
  }

  initialize();
})();
