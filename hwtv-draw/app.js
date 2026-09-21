(() => {
  "use strict";

  const STORAGE_KEY = "hwtv-draw-v1";
  const MAX_HISTORY = 48;
  const PALETTE = [
    "#000000", "#ffffff", "#20283b", "#4b5570",
    "#8b9bb4", "#d8e2f0", "#ef5a3c", "#ff9b4a",
    "#ffda69", "#b9e769", "#4fc3a1", "#43a6dc",
    "#6582e8", "#a779dc", "#e778b7", "#8d4c5b"
  ];

  const canvas = document.getElementById("draw-canvas");
  const canvasStage = document.getElementById("canvas-stage");
  const context = canvas.getContext("2d", { alpha: true });
  const buffer = document.createElement("canvas");
  const bufferContext = buffer.getContext("2d", { alpha: true });

  const ui = {
    status: document.getElementById("status"),
    coordinates: document.getElementById("coordinate-readout"),
    document: document.getElementById("document-readout"),
    colorPicker: document.getElementById("color-picker"),
    colorReadout: document.getElementById("color-readout"),
    colorPreview: document.getElementById("color-preview"),
    palette: document.getElementById("palette"),
    size: document.getElementById("canvas-size"),
    grid: document.getElementById("grid-toggle"),
    zoomOut: document.getElementById("zoom-out"),
    zoomIn: document.getElementById("zoom-in"),
    zoomReadout: document.getElementById("zoom-readout")
  };

  const state = {
    width: 32,
    height: 32,
    pixels: new Uint8ClampedArray(32 * 32 * 4),
    color: "#202020",
    tool: "pencil",
    grid: true,
    zoom: 1,
    history: [],
    redo: [],
    drawing: false,
    pointerId: null,
    lastPoint: null,
    beforeStroke: null,
    strokeChanged: false,
    statusTimer: 0
  };

  function clamp(value, lower, upper) {
    return Math.min(Math.max(value, lower), upper);
  }

  function indexAt(x, y) {
    return (y * state.width + x) * 4;
  }

  function rgbaFromHex(hex) {
    const normalized = hex.replace("#", "");
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
      255
    ];
  }

  function samePixelAt(offset, rgba) {
    return state.pixels[offset] === rgba[0] &&
      state.pixels[offset + 1] === rgba[1] &&
      state.pixels[offset + 2] === rgba[2] &&
      state.pixels[offset + 3] === rgba[3];
  }

  function snapshot() {
    return {
      width: state.width,
      height: state.height,
      pixels: new Uint8ClampedArray(state.pixels)
    };
  }

  function pushHistory(entry) {
    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }
    state.redo.length = 0;
  }

  function restoreSnapshot(entry) {
    state.width = entry.width;
    state.height = entry.height;
    state.pixels = new Uint8ClampedArray(entry.pixels);
    ui.size.value = String(state.width);
    render();
    persist();
  }

  function undo() {
    const entry = state.history.pop();
    if (!entry) {
      setStatus("Nothing to undo");
      return;
    }
    state.redo.push(snapshot());
    restoreSnapshot(entry);
    setStatus("Undid last change");
  }

  function redo() {
    const entry = state.redo.pop();
    if (!entry) {
      setStatus("Nothing to redo");
      return;
    }
    state.history.push(snapshot());
    restoreSnapshot(entry);
    setStatus("Redid change");
  }

  function setStatus(message, hold) {
    window.clearTimeout(state.statusTimer);
    ui.status.textContent = message;
    if (!hold) {
      state.statusTimer = window.setTimeout(() => {
        ui.status.textContent = "Ready";
      }, 2400);
    }
  }

  function updateDocumentReadout() {
    ui.document.textContent = state.width + " × " + state.height + " · FRAME 1 / 1";
    ui.zoomReadout.textContent = state.zoom + "×";
  }

  function createCheckerPattern(scale) {
    const tile = document.createElement("canvas");
    const tileSize = Math.max(scale * 2, 8);
    tile.width = tileSize;
    tile.height = tileSize;
    const tileContext = tile.getContext("2d");
    tileContext.fillStyle = "#e3e6ea";
    tileContext.fillRect(0, 0, tileSize, tileSize);
    tileContext.fillStyle = "#bcc2cc";
    tileContext.fillRect(0, 0, scale, scale);
    tileContext.fillRect(scale, scale, scale, scale);
    return context.createPattern(tile, "repeat");
  }

  function bestScale() {
    const availableWidth = Math.max(canvasStage.clientWidth - 32, 100);
    const availableHeight = Math.max(canvasStage.clientHeight - 32, 100);
    const fit = Math.floor(Math.min(availableWidth / state.width, availableHeight / state.height));
    const baseline = clamp(fit, 5, 28);
    return clamp(baseline * state.zoom, 4, 56);
  }

  function render() {
    const scale = bestScale();
    const outputWidth = state.width * scale;
    const outputHeight = state.height * scale;

    buffer.width = state.width;
    buffer.height = state.height;
    bufferContext.putImageData(new ImageData(state.pixels, state.width, state.height), 0, 0);

    canvas.width = outputWidth;
    canvas.height = outputHeight;
    canvas.style.width = outputWidth + "px";
    canvas.style.height = outputHeight + "px";
    context.imageSmoothingEnabled = false;
    context.fillStyle = createCheckerPattern(scale);
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(buffer, 0, 0, outputWidth, outputHeight);

    if (state.grid && scale >= 6) {
      context.beginPath();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(21, 27, 39, 0.34)";
      for (let x = 0; x <= state.width; x += 1) {
        const point = x * scale + 0.5;
        context.moveTo(point, 0);
        context.lineTo(point, outputHeight);
      }
      for (let y = 0; y <= state.height; y += 1) {
        const point = y * scale + 0.5;
        context.moveTo(0, point);
        context.lineTo(outputWidth, point);
      }
      context.stroke();
    }

    updateDocumentReadout();
  }

  function setPixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) {
      return false;
    }
    const offset = indexAt(x, y);
    if (samePixelAt(offset, rgba)) {
      return false;
    }
    state.pixels[offset] = rgba[0];
    state.pixels[offset + 1] = rgba[1];
    state.pixels[offset + 2] = rgba[2];
    state.pixels[offset + 3] = rgba[3];
    return true;
  }

  function drawLine(from, to, rgba) {
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - from.x);
    const sx = from.x < to.x ? 1 : -1;
    const dy = -Math.abs(to.y - from.y);
    const sy = from.y < to.y ? 1 : -1;
    let error = dx + dy;
    let changed = false;

    while (true) {
      changed = setPixel(x, y, rgba) || changed;
      if (x === to.x && y === to.y) {
        break;
      }
      const doubleError = error * 2;
      if (doubleError >= dy) {
        error += dy;
        x += sx;
      }
      if (doubleError <= dx) {
        error += dx;
        y += sy;
      }
    }
    return changed;
  }

  function pixelMatches(offset, rgba) {
    return state.pixels[offset] === rgba[0] &&
      state.pixels[offset + 1] === rgba[1] &&
      state.pixels[offset + 2] === rgba[2] &&
      state.pixels[offset + 3] === rgba[3];
  }

  function floodFill(startX, startY, replacement) {
    const startOffset = indexAt(startX, startY);
    const source = [
      state.pixels[startOffset],
      state.pixels[startOffset + 1],
      state.pixels[startOffset + 2],
      state.pixels[startOffset + 3]
    ];
    if (source[0] === replacement[0] && source[1] === replacement[1] &&
      source[2] === replacement[2] && source[3] === replacement[3]) {
      return false;
    }

    const visited = new Uint8Array(state.width * state.height);
    const stack = [[startX, startY]];
    let changed = false;

    while (stack.length > 0) {
      const point = stack.pop();
      const x = point[0];
      const y = point[1];
      if (x < 0 || y < 0 || x >= state.width || y >= state.height) {
        continue;
      }
      const cell = y * state.width + x;
      if (visited[cell]) {
        continue;
      }
      visited[cell] = 1;
      const offset = cell * 4;
      if (!pixelMatches(offset, source)) {
        continue;
      }
      state.pixels[offset] = replacement[0];
      state.pixels[offset + 1] = replacement[1];
      state.pixels[offset + 2] = replacement[2];
      state.pixels[offset + 3] = replacement[3];
      changed = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return changed;
  }

  function pointFromEvent(event) {
    const rectangle = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rectangle.left) * state.width / rectangle.width);
    const y = Math.floor((event.clientY - rectangle.top) * state.height / rectangle.height);
    return {
      x: clamp(x, 0, state.width - 1),
      y: clamp(y, 0, state.height - 1)
    };
  }

  function strokeColor() {
    return state.tool === "eraser" ? [0, 0, 0, 0] : rgbaFromHex(state.color);
  }

  function commitStroke() {
    if (state.strokeChanged && state.beforeStroke) {
      pushHistory(state.beforeStroke);
      persist();
    }
    state.beforeStroke = null;
    state.strokeChanged = false;
  }

  function drawAt(point) {
    const changed = drawLine(state.lastPoint || point, point, strokeColor());
    state.lastPoint = point;
    state.strokeChanged = state.strokeChanged || changed;
    if (changed) {
      render();
    }
  }

  function onPointerDown(event) {
    event.preventDefault();
    const point = pointFromEvent(event);
    canvas.setPointerCapture(event.pointerId);
    state.pointerId = event.pointerId;
    ui.coordinates.textContent = "X: " + point.x + "  Y: " + point.y;

    if (state.tool === "fill") {
      const before = snapshot();
      if (floodFill(point.x, point.y, rgbaFromHex(state.color))) {
        pushHistory(before);
        render();
        persist();
        setStatus("Filled region");
      } else {
        setStatus("That region already has this color");
      }
      return;
    }

    state.drawing = true;
    state.beforeStroke = snapshot();
    state.strokeChanged = false;
    state.lastPoint = point;
    drawAt(point);
  }

  function onPointerMove(event) {
    const point = pointFromEvent(event);
    ui.coordinates.textContent = "X: " + point.x + "  Y: " + point.y;
    if (!state.drawing || state.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    drawAt(point);
  }

  function onPointerEnd(event) {
    if (state.pointerId !== event.pointerId) {
      return;
    }
    if (state.drawing) {
      commitStroke();
    }
    state.drawing = false;
    state.pointerId = null;
    state.lastPoint = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll("[data-tool]").forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    setStatus(tool === "fill" ? "Fill tool selected" : tool === "eraser" ? "Eraser selected" : "Pencil selected");
  }

  function setColor(color) {
    state.color = color.toUpperCase();
    ui.colorPicker.value = color;
    ui.colorReadout.textContent = state.color;
    ui.colorPreview.style.background = state.color;
    document.querySelectorAll(".swatch").forEach((swatch) => {
      swatch.classList.toggle("is-current", swatch.dataset.color.toUpperCase() === state.color);
    });
  }

  function buildPalette() {
    PALETTE.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.color = color;
      button.style.background = color;
      button.setAttribute("aria-label", "Use " + color);
      button.addEventListener("click", () => {
        setColor(color);
        setStatus("Color " + color.toUpperCase());
      });
      ui.palette.appendChild(button);
    });
  }

  function clearCanvas() {
    const hasInk = state.pixels.some((value) => value !== 0);
    if (!hasInk) {
      setStatus("Canvas is already clear");
      return;
    }
    if (!window.confirm("Clear every pixel? You can still use Undo immediately afterward.")) {
      return;
    }
    pushHistory(snapshot());
    state.pixels.fill(0);
    render();
    persist();
    setStatus("Canvas cleared");
  }

  function resizeCanvas(size) {
    const nextSize = Number.parseInt(size, 10);
    if (nextSize === state.width && nextSize === state.height) {
      return;
    }
    const before = snapshot();
    const next = new Uint8ClampedArray(nextSize * nextSize * 4);
    const copyWidth = Math.min(state.width, nextSize);
    const copyHeight = Math.min(state.height, nextSize);
    for (let y = 0; y < copyHeight; y += 1) {
      for (let x = 0; x < copyWidth; x += 1) {
        const source = indexAt(x, y);
        const target = (y * nextSize + x) * 4;
        next[target] = state.pixels[source];
        next[target + 1] = state.pixels[source + 1];
        next[target + 2] = state.pixels[source + 2];
        next[target + 3] = state.pixels[source + 3];
      }
    }
    pushHistory(before);
    state.width = nextSize;
    state.height = nextSize;
    state.pixels = next;
    render();
    persist();
    setStatus("Canvas resized to " + nextSize + " × " + nextSize);
  }

  function encodeBytes(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
    }
    return window.btoa(binary);
  }

  function decodeBytes(encoded) {
    const binary = window.atob(encoded);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        width: state.width,
        height: state.height,
        pixels: encodeBytes(state.pixels),
        color: state.color,
        grid: state.grid,
        zoom: state.zoom
      }));
    } catch (error) {
      setStatus("Local save unavailable");
    }
  }

  function restorePersistedState() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return false;
      }
      const parsed = JSON.parse(saved);
      const width = Number(parsed.width);
      const height = Number(parsed.height);
      const pixels = decodeBytes(parsed.pixels);
      if (!Number.isInteger(width) || width < 8 || width > 128 ||
        width !== height || pixels.length !== width * height * 4) {
        return false;
      }
      state.width = width;
      state.height = height;
      state.pixels = pixels;
      state.color = typeof parsed.color === "string" ? parsed.color : state.color;
      state.grid = typeof parsed.grid === "boolean" ? parsed.grid : state.grid;
      state.zoom = Number.isInteger(parsed.zoom) ? clamp(parsed.zoom, 1, 4) : state.zoom;
      ui.size.value = String(width);
      return true;
    } catch (error) {
      return false;
    }
  }

  function exportPng() {
    buffer.toBlob((blob) => {
      if (!blob) {
        setStatus("PNG export failed");
        return;
      }
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = URL.createObjectURL(blob);
      link.download = "hwtv-draw-" + state.width + "x" + state.height + "-" + stamp + ".png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 200);
      setStatus("PNG downloaded");
    }, "image/png");
  }

  function bindControls() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });

    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "undo") undo();
        if (action === "redo") redo();
        if (action === "clear") clearCanvas();
        if (action === "export") exportPng();
      });
    });

    ui.colorPicker.addEventListener("input", () => setColor(ui.colorPicker.value));
    ui.size.addEventListener("change", () => resizeCanvas(ui.size.value));
    ui.grid.addEventListener("click", () => {
      state.grid = !state.grid;
      ui.grid.textContent = "Grid: " + (state.grid ? "On" : "Off");
      ui.grid.setAttribute("aria-pressed", String(state.grid));
      render();
      persist();
      setStatus(state.grid ? "Grid shown" : "Grid hidden");
    });
    ui.zoomOut.addEventListener("click", () => {
      state.zoom = clamp(state.zoom - 1, 1, 4);
      render();
      persist();
    });
    ui.zoomIn.addEventListener("click", () => {
      state.zoom = clamp(state.zoom + 1, 1, 4);
      render();
      persist();
    });

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("resize", render);
    window.addEventListener("keydown", (event) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if (!modifier && event.key.toLowerCase() === "b") setTool("pencil");
      if (!modifier && event.key.toLowerCase() === "e") setTool("eraser");
      if (!modifier && event.key.toLowerCase() === "f") setTool("fill");
    });
  }

  function initialize() {
    buildPalette();
    const restored = restorePersistedState();
    setColor(state.color);
    ui.grid.textContent = "Grid: " + (state.grid ? "On" : "Off");
    ui.grid.setAttribute("aria-pressed", String(state.grid));
    bindControls();
    render();
    setStatus(restored ? "Restored local drawing" : "Ready", restored);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {
          /* Offline installation is optional; drawing still works. */
        });
      });
    }
  }

  initialize();
})();
