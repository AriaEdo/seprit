<script lang="ts">
  import {
    clampMove, ellipsePoints, floodFill, getPixel, inBounds, linePoints, moveRegion, paintPoints, rectFromCorners, rectPoints,
    TRANSPARENT, type Frame, type Rect, type RGBA,
  } from "./pixels";
  import { drawRuler, RULER_SIZE } from "./ruler";

  export type Tool = "pencil" | "eraser" | "line" | "rect" | "ellipse" | "fill" | "picker" | "select" | "move";

  interface Props {
    // The cel being edited; `view` is what's shown (all visible layers) and what the picker samples.
    frame: Frame;
    view: Frame;
    // Neighbouring frames, drawn faintly under `view`; display only.
    onion: Frame | null;
    // False on a hidden layer: drawing tools are blocked, as in Aseprite.
    editable: boolean;
    zoom: number;
    tool: Tool;
    color: RGBA;
    selection: Rect | null;
    hover?: [number, number] | null;
    onchange: (frame: Frame) => void;
    onzoom: (zoom: number) => void;
    onpick: (color: RGBA) => void;
    onselect: (selection: Rect | null) => void;
    // Called once per finished gesture with the frame from before it, for undo history.
    oncommit: (before: Frame) => void;
  }

  let {
    frame, view, onion, editable, zoom, tool, color, selection, hover = $bindable(null), onchange, onzoom, onpick, onselect, oncommit,
  }: Props = $props();

  const SHAPES = {
    line: linePoints,
    rect: rectPoints,
    ellipse: ellipsePoints,
  } as const;

  const GRID_MIN_ZOOM = 6;

  let viewport: HTMLDivElement;
  // Full zoomed size, for scrolling and pointer input; `canvas` only covers its visible part.
  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let rulerX: HTMLCanvasElement;
  let rulerY: HTMLCanvasElement;
  let last: [number, number] | null = null;
  // Shape/select drags redraw from the frame as it was at pointerdown.
  let start: [number, number] | null = null;
  let base: Frame | null = null;
  let before: Frame | null = null;
  // Move drags offset the selection as it was at pointerdown.
  let moving: Rect | null = null;
  // Drives the closed-hand cursor while a move drag is in progress.
  let grabbing = $state(false);

  // 1:1 offscreen copy of the frame; scaled up with smoothing off for crisp pixels.
  const source = document.createElement("canvas");
  const onionSource = document.createElement("canvas");

  function blit(target: HTMLCanvasElement, f: Frame) {
    target.width = f.width;
    target.height = f.height;
    target.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0);
  }

  $effect(() => {
    blit(source, view);
    if (onion) blit(onionSource, onion);
    render();
  });

  // The viewport also resizes without a window resize (e.g. the timeline toggling), exposing undrawn area.
  $effect(() => {
    const ro = new ResizeObserver(() => render());
    ro.observe(viewport);
    return () => ro.disconnect();
  });

  // Visible part of the stage, in stage pixels. A full-size canvas (size × zoom) can exceed the WebView's limit.
  function visibleArea() {
    const vp = viewport.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const left = vp.left + viewport.clientLeft - st.left;
    const top = vp.top + viewport.clientTop - st.top;
    const x0 = Math.max(0, Math.floor(left));
    const y0 = Math.max(0, Math.floor(top));
    const x1 = Math.min(frame.width * zoom, Math.ceil(left + viewport.clientWidth));
    const y1 = Math.min(frame.height * zoom, Math.ceil(top + viewport.clientHeight));
    return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }

  function render() {
    if (!viewport) return;
    const w = frame.width * zoom;
    const h = frame.height * zoom;
    const a = visibleArea();
    canvas.width = a.x1 - a.x0;
    canvas.height = a.y1 - a.y0;
    canvas.style.left = `${a.x0}px`;
    canvas.style.top = `${a.y0}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(-a.x0, -a.y0);
    drawChecker(ctx, a);
    ctx.imageSmoothingEnabled = false;
    if (onion) ctx.drawImage(onionSource, 0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    if (zoom >= GRID_MIN_ZOOM) drawGrid(ctx, a);
    if (selection) drawSelection(ctx, selection);
    renderRulers();
  }

  // One fill per render instead of a fillRect per square; rebuilt only when the square size changes.
  let checker: { cell: number; pattern: CanvasPattern } | null = null;

  function drawChecker(ctx: CanvasRenderingContext2D, a: ReturnType<typeof visibleArea>) {
    const cell = Math.max(zoom, 8);
    if (checker?.cell !== cell) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = cell * 2;
      const t = tile.getContext("2d")!;
      t.fillStyle = "#4a4a4a";
      t.fillRect(0, 0, cell * 2, cell * 2);
      t.fillStyle = "#3a3a3a";
      t.fillRect(cell, 0, cell, cell);
      t.fillRect(0, cell, cell, cell);
      checker = { cell, pattern: ctx.createPattern(tile, "repeat")! };
    }
    // The pattern is anchored at the stage origin (the context is translated), matching the old squares.
    ctx.fillStyle = checker.pattern;
    ctx.fillRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  }

  function drawGrid(ctx: CanvasRenderingContext2D, a: ReturnType<typeof visibleArea>) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.max(zoom, a.x0 - (a.x0 % zoom)); x < a.x1; x += zoom) { ctx.moveTo(x + 0.5, a.y0); ctx.lineTo(x + 0.5, a.y1); }
    for (let y = Math.max(zoom, a.y0 - (a.y0 % zoom)); y < a.y1; y += zoom) { ctx.moveTo(a.x0, y + 0.5); ctx.lineTo(a.x1, y + 0.5); }
    ctx.stroke();
  }

  function drawSelection(ctx: CanvasRenderingContext2D, r: Rect) {
    const args = [r.x * zoom + 0.5, r.y * zoom + 0.5, r.width * zoom - 1, r.height * zoom - 1] as const;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(...args);
    ctx.lineDashOffset = 4;
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(...args);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // Rulers follow the canvas's on-screen position, so they stay correct when centered or scrolled.
  function renderRulers() {
    if (!viewport) return;
    const vp = viewport.getBoundingClientRect();
    const cv = stage.getBoundingClientRect();
    drawRuler(rulerX, "x", vp.width, cv.left - vp.left, zoom, frame.width, hover?.[0]);
    drawRuler(rulerY, "y", vp.height, cv.top - vp.top, zoom, frame.height, hover?.[1]);
  }

  function toPixel(e: PointerEvent): [number, number] {
    const r = stage.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / zoom), Math.floor((e.clientY - r.top) / zoom)];
  }

  function paint(to: [number, number]) {
    const from = last ?? to;
    const ink = tool === "eraser" ? TRANSPARENT : color;
    onchange(paintPoints(frame, linePoints(from[0], from[1], to[0], to[1]), ink));
    last = to;
  }

  function drag(p: [number, number]) {
    if (!start || !base) return;
    if (tool === "select") onselect(rectFromCorners(start, p, frame.width, frame.height));
    else if (tool === "move" && moving) {
      const [dx, dy] = clampMove(moving, p[0] - start[0], p[1] - start[1], frame.width, frame.height);
      // Offset 0 hands back the original frame, so a click without dragging adds no undo step.
      onchange(dx || dy ? moveRegion(base, moving, dx, dy) : base);
      onselect({ ...moving, x: moving.x + dx, y: moving.y + dy });
    }
    else if (tool in SHAPES) {
      const pts = SHAPES[tool as keyof typeof SHAPES](start[0], start[1], p[0], p[1]);
      onchange(paintPoints(base, pts, color));
    }
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = toPixel(e);
    if (tool === "picker") {
      if (inBounds(view, ...p)) onpick(getPixel(view, ...p));
      return;
    }
    if (!editable && tool !== "select") return;
    if (tool === "move" && !selection) return;
    if (tool === "fill") {
      const prev = frame;
      onchange(floodFill(frame, p[0], p[1], color));
      oncommit(prev);
      return;
    }
    stage.setPointerCapture(e.pointerId);
    before = frame;
    if (tool === "pencil" || tool === "eraser") {
      last = null;
      paint(p);
    } else {
      start = p;
      base = frame;
      moving = selection;
      grabbing = tool === "move";
      drag(p);
    }
  }

  function onpointermove(e: PointerEvent) {
    const p = toPixel(e);
    hover = p;
    renderRulers();
    if (!stage.hasPointerCapture(e.pointerId)) return;
    if (last) paint(p);
    else drag(p);
  }

  function onpointerup(e: PointerEvent) {
    if (before) oncommit(before);
    before = null;
    last = null;
    start = null;
    base = null;
    moving = null;
    grabbing = false;
    stage.releasePointerCapture(e.pointerId);
  }

  function onwheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls; Ctrl/Cmd/pinch zooms
    e.preventDefault();
    onzoom(e.deltaY < 0 ? zoom + 1 : zoom - 1);
  }
</script>

<div class="wrap">
  <div class="corner" style:width="{RULER_SIZE}px" style:height="{RULER_SIZE}px"></div>
  <canvas class="ruler-x" bind:this={rulerX}></canvas>
  <canvas class="ruler-y" bind:this={rulerY}></canvas>
  <div class="viewport" bind:this={viewport} onscroll={render} {onwheel}>
    <div
      class="stage"
      role="application"
      bind:this={stage}
      style:width="{frame.width * zoom}px"
      style:height="{frame.height * zoom}px"
      class:grab={tool === "move"}
      class:grabbing
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointerleave={() => { hover = null; renderRulers(); }}
    ><canvas bind:this={canvas}></canvas></div>
  </div>
</div>

<style>
  .wrap {
    display: grid;
    /* minmax(0, …): the ruler canvases' pixel size must not stop the area from shrinking. */
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .corner { background: #222; }
  .ruler-x, .ruler-y { display: block; background: #222; }
  .ruler-x { width: 100%; height: 20px; }
  .ruler-y { width: 20px; height: 100%; }
  .viewport {
    overflow: auto;
    display: grid;
    place-items: center;
    background: #2b2b2b;
    min-height: 0;
  }
  .stage { position: relative; cursor: crosshair; margin: 24px; }
  .stage.grab { cursor: grab; }
  .stage.grabbing { cursor: grabbing; }
  .stage canvas { position: absolute; display: block; pointer-events: none; }
</style>
