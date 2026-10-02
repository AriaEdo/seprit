// Pure pixel-buffer helpers. Every mutation returns a new Frame so undo
// history (later phase) can keep references to old frames safely.

export type RGBA = readonly [number, number, number, number];

export interface Frame {
  readonly width: number;
  readonly height: number;
  // RGBA bytes, row-major; layout matches ImageData so it can be blitted directly.
  readonly data: Uint8ClampedArray;
}

export const TRANSPARENT: RGBA = [0, 0, 0, 0];
export const MIN_SIZE = 1;
export const MAX_SIZE = 512;

export function createFrame(width: number, height: number): Frame {
  if (!isValidSize(width) || !isValidSize(height)) {
    throw new RangeError(`Canvas size must be ${MIN_SIZE}-${MAX_SIZE}px, got ${width}x${height}`);
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function isValidSize(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE;
}

export function inBounds(frame: Frame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < frame.width && y < frame.height;
}

export function getPixel(frame: Frame, x: number, y: number): RGBA {
  const i = (y * frame.width + x) * 4;
  const d = frame.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

// Paints a list of points in one copy; out-of-bounds points are ignored.
export function paintPoints(frame: Frame, points: Iterable<[number, number]>, color: RGBA): Frame {
  const data = new Uint8ClampedArray(frame.data);
  for (const [x, y] of points) {
    if (!inBounds(frame, x, y)) continue;
    data.set(color, (y * frame.width + x) * 4);
  }
  return { ...frame, data };
}

// Bresenham: fills gaps between pointer events when the mouse moves fast.
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// Changes canvas size anchored at top-left: shrinking crops, growing pads with transparency.
export function resizeFrame(frame: Frame, width: number, height: number): Frame {
  const next = createFrame(width, height);
  const data = new Uint8ClampedArray(next.data);
  const copyW = Math.min(width, frame.width);
  const rows = Math.min(height, frame.height);
  for (let y = 0; y < rows; y++) {
    const src = y * frame.width * 4;
    data.set(frame.data.subarray(src, src + copyW * 4), y * width * 4);
  }
  return { ...next, data };
}

export function hexToRgba(hex: string): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbaToHex([r, g, b]: RGBA): string {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Rectangle outline between two dragged corners (any drag direction).
export function rectPoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  return [
    ...linePoints(l, t, r, t),
    ...linePoints(l, b, r, b),
    ...linePoints(l, t, l, b),
    ...linePoints(r, t, r, b),
  ];
}

// Ellipse outline inscribed in the box between two corners (Zingl's plotEllipseRect).
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a *= 8 * a;
  b1 = 8 * b * b;
  do {
    points.push([x1, y0], [x0, y0], [x0, y1], [x1, y1]);
    const e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  // Flat ellipses: finish the tips.
  while (y0 - y1 <= b) {
    points.push([x0 - 1, y0], [x1 + 1, y0++], [x0 - 1, y1], [x1 + 1, y1--]);
  }
  return points;
}

// 4-connected bucket fill; a pixel matches when every channel is within `tolerance` of the start pixel
// (0 = exact match).
export function floodFill(frame: Frame, x: number, y: number, color: RGBA, tolerance = 0): Frame {
  if (!inBounds(frame, x, y)) return frame;
  const target = getPixel(frame, x, y);
  if (target.every((v, i) => v === color[i])) return frame;
  const { width, height, data: src } = frame;
  const data = new Uint8ClampedArray(src);
  const [tr, tg, tb, ta] = target;
  const [cr, cg, cb, ca] = color;
  // Pixel indices, marked when pushed so each is pushed at most once: width × height slots suffice.
  // Typed arrays instead of [x, y] pairs: no allocation per pixel.
  const filled = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  const visit = (p: number) => {
    const i = p * 4;
    if (filled[p] || Math.abs(src[i] - tr) > tolerance || Math.abs(src[i + 1] - tg) > tolerance
      || Math.abs(src[i + 2] - tb) > tolerance || Math.abs(src[i + 3] - ta) > tolerance) return;
    filled[p] = 1;
    stack[top++] = p;
  };
  visit(y * width + x);
  while (top) {
    const p = stack[--top];
    const i = p * 4;
    data[i] = cr; data[i + 1] = cg; data[i + 2] = cb; data[i + 3] = ca;
    const px = p % width;
    if (px + 1 < width) visit(p + 1);
    if (px > 0) visit(p - 1);
    if (p + width < width * height) visit(p + width);
    if (p >= width) visit(p - width);
  }
  return { ...frame, data };
}

// Normalized selection from two dragged corners, clamped to the canvas.
export function rectFromCorners(a: [number, number], b: [number, number], width: number, height: number): Rect {
  const clampX = (v: number) => Math.min(width - 1, Math.max(0, v));
  const clampY = (v: number) => Math.min(height - 1, Math.max(0, v));
  const x0 = clampX(Math.min(a[0], b[0]));
  const x1 = clampX(Math.max(a[0], b[0]));
  const y0 = clampY(Math.min(a[1], b[1]));
  const y1 = clampY(Math.max(a[1], b[1]));
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// Copies a region into a new frame; also used for crop. `r` must lie inside the frame. No size limit,
// so cells of a large imported sheet can be cut before being shrunk to the canvas.
export function copyRegion(frame: Frame, r: Rect): Frame {
  const data = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const src = ((r.y + y) * frame.width + r.x) * 4;
    data.set(frame.data.subarray(src, src + r.width * 4), y * r.width * 4);
  }
  return { width: r.width, height: r.height, data };
}

// Makes a region transparent (delete / cut). `r` must lie inside the frame.
export function clearRegion(frame: Frame, r: Rect): Frame {
  const data = new Uint8ClampedArray(frame.data);
  for (let y = r.y; y < r.y + r.height; y++) data.fill(0, (y * frame.width + r.x) * 4, (y * frame.width + r.x + r.width) * 4);
  return { ...frame, data };
}

// Splits a sprite sheet into cols × rows equal cells, left → right then top → bottom.
// Leftover pixels at the right/bottom edge (size not divisible) are dropped.
export function sliceSheet(sheet: Frame, cols: number, rows: number): Frame[] {
  const width = Math.floor(sheet.width / cols);
  const height = Math.floor(sheet.height / rows);
  return Array.from({ length: cols * rows }, (_, i) => copyRegion(sheet, { x: (i % cols) * width, y: Math.floor(i / cols) * height, width, height }));
}

// Crops same-size cells to one shared box around all pixels with alpha >= 128 (the import threshold),
// so the sprite keeps its position from frame to frame. All-transparent cells are returned as is.
export function trimCells(cells: Frame[]): Frame[] {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of cells) {
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (c.data[(y * c.width + x) * 4 + 3] < 128) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return cells;
  return cells.map((c) => copyRegion(c, { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }));
}

// Guesses a sheet's grid by counting runs of columns and rows holding pixels with alpha >= 128 (the
// import threshold, so faint specks don't count). Sprites that touch count as one, so this is only a
// starting value for the user to correct.
export function guessGrid(sheet: Frame): { cols: number; rows: number } {
  const filled = (n: number, at: (i: number, j: number) => number, m: number) =>
    Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => at(i, j)).some((a) => a >= 128));
  const runs = (xs: boolean[]) => Math.max(1, xs.filter((f, i) => f && !xs[i - 1]).length);
  const alpha = (x: number, y: number) => sheet.data[(y * sheet.width + x) * 4 + 3];
  return {
    cols: runs(filled(sheet.width, (x, y) => alpha(x, y), sheet.height)),
    rows: runs(filled(sheet.height, (y, x) => alpha(x, y), sheet.width)),
  };
}

// Sheets drawn with dark cell borders (common from image generators) join every sprite for guessGrid and
// put the borders into each frame. A column/row whose pixels across the content span are ≥ 90% dark and
// opaque is a border: it and 1 px either side (anti-aliasing) become transparent, and the sheet is cropped
// to inside the outermost borders so equal slicing lines up with the boxes. No borders → `sheet` as is.
export function removeGridLines(sheet: Frame): Frame {
  const LINE_SHARE = 0.9;
  const DARK = 80;
  const { width, height, data } = sheet;
  const i = (x: number, y: number) => (y * width + x) * 4;
  const dark = (x: number, y: number) => data[i(x, y) + 3] >= 128 && Math.max(data[i(x, y)], data[i(x, y) + 1], data[i(x, y) + 2]) < DARK;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[i(x, y) + 3] < 128) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return sheet;
  const share = (n: number, isDark: (j: number) => boolean) => Array.from({ length: n }, (_, j) => isDark(j)).filter(Boolean).length / n;
  const cols = Array.from({ length: width }, (_, x) => x).filter((x) => share(y1 - y0 + 1, (j) => dark(x, y0 + j)) >= LINE_SHARE);
  const rows = Array.from({ length: height }, (_, y) => y).filter((y) => share(x1 - x0 + 1, (j) => dark(x0 + j, y)) >= LINE_SHARE);
  if (cols.length === 0 && rows.length === 0) return sheet;
  const band = (lines: number[], n: number) => new Set(lines.flatMap((l) => [l - 1, l, l + 1]).filter((l) => l >= 0 && l < n));
  // Inside the first and last band; a single band (or none) leaves that axis uncropped.
  const inner = (b: Set<number>, n: number): [number, number] => {
    if (b.size === 0) return [0, n - 1];
    let lo = Math.min(...b), hi = Math.max(...b);
    while (b.has(lo + 1)) lo++;
    while (b.has(hi - 1)) hi--;
    return lo + 1 <= hi - 1 ? [lo + 1, hi - 1] : [0, n - 1];
  };
  const bx = band(cols, width), by = band(rows, height);
  const cleared = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (bx.has(x) || by.has(y)) cleared.fill(0, i(x, y), i(x, y) + 4);
  }
  const [cx0, cx1] = inner(bx, width), [cy0, cy1] = inner(by, height);
  return copyRegion({ width, height, data: cleared }, { x: cx0, y: cy0, width: cx1 - cx0 + 1, height: cy1 - cy0 + 1 });
}

// Stamps `clip` at (x, y); fully transparent clip pixels leave the destination as is.
export function pasteFrame(frame: Frame, clip: Frame, x: number, y: number): Frame {
  const data = new Uint8ClampedArray(frame.data);
  for (let cy = 0; cy < clip.height; cy++) {
    for (let cx = 0; cx < clip.width; cx++) {
      const s = (cy * clip.width + cx) * 4;
      if (clip.data[s + 3] === 0 || !inBounds(frame, x + cx, y + cy)) continue;
      data.set(clip.data.subarray(s, s + 4), ((y + cy) * frame.width + x + cx) * 4);
    }
  }
  return { ...frame, data };
}

// Move tool: lifts the region and stamps it (dx, dy) away; transparent pixels don't erase the destination.
export function moveRegion(frame: Frame, r: Rect, dx: number, dy: number): Frame {
  return pasteFrame(clearRegion(frame, r), copyRegion(frame, r), r.x + dx, r.y + dy);
}

// Limits a move offset so the region stays inside a width × height canvas.
export function clampMove(r: Rect, dx: number, dy: number, width: number, height: number): [number, number] {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [clamp(dx, -r.x, width - r.x - r.width), clamp(dy, -r.y, height - r.y - r.height)];
}

export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "addition", "difference"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

// Separable blend functions on 0..1 channels (b = backdrop, s = source), as in the W3C compositing spec.
const BLEND: Record<BlendMode, (b: number, s: number) => number> = {
  normal: (_b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: Math.min,
  lighten: Math.max,
  addition: (b, s) => Math.min(1, b + s),
  difference: (b, s) => Math.abs(b - s),
};

// Composites `upper` over `lower` (same size, straight alpha) into a new frame.
// `opacity` (0–255) scales upper's alpha; `mode` mixes colors where lower is opaque, so blending
// onto transparent pixels shows upper unchanged.
export function composite(lower: Frame, upper: Frame, opacity = 255, mode: BlendMode = "normal"): Frame {
  const data = new Uint8ClampedArray(lower.data);
  const u = upper.data;
  const fn = BLEND[mode];
  for (let i = 0; i < data.length; i += 4) {
    const ua = u[i + 3] * opacity;
    if (ua === 0) continue;
    if (ua === 255 * 255 && mode === "normal") {
      data[i] = u[i]; data[i + 1] = u[i + 1]; data[i + 2] = u[i + 2]; data[i + 3] = 255;
      continue;
    }
    const ta = ua / (255 * 255);
    const bb = data[i + 3] / 255;
    const ba = bb * (1 - ta);
    const a = ta + ba;
    for (let c = 0; c < 3; c++) {
      const s = u[i + c] / 255;
      const b = data[i + c] / 255;
      const mixed = (1 - bb) * s + bb * fn(b, s);
      data[i + c] = ((mixed * ta + b * ba) / a) * 255;
    }
    data[i + 3] = a * 255;
  }
  return { ...lower, data };
}

// Mixes each pixel's color halfway toward `rgb`, keeping alpha (used for onion skin).
export function tintFrame(frame: Frame, [r, g, b]: RGBA): Frame {
  const data = new Uint8ClampedArray(frame.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] + r) / 2;
    data[i + 1] = (data[i + 1] + g) / 2;
    data[i + 2] = (data[i + 2] + b) / 2;
  }
  return { ...frame, data };
}

// Import: shrinks `src` (any size) to fit a width × height cel keeping aspect ratio, top-left, never upscaled.
// Each output pixel is the alpha-weighted average of its source block, then alpha < 128 → transparent,
// else that color, fully opaque (the image's own colors are kept, not snapped to the palette).
export function imageToCel(src: Frame, width: number, height: number): Frame {
  const scale = Math.max(src.width / width, src.height / height, 1);
  const outW = Math.min(width, Math.max(1, Math.round(src.width / scale)));
  const outH = Math.min(height, Math.max(1, Math.round(src.height / scale)));
  const out = createFrame(width, height);
  const span = (i: number, n: number, srcN: number) => {
    const a = Math.floor((i * srcN) / n);
    return [a, Math.max(a + 1, Math.floor(((i + 1) * srcN) / n))];
  };
  for (let y = 0; y < outH; y++) {
    const [y0, y1] = span(y, outH, src.height);
    for (let x = 0; x < outW; x++) {
      const [x0, x1] = span(x, outW, src.width);
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const [pr, pg, pb, pa] = getPixel(src, sx, sy);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      if (a / ((x1 - x0) * (y1 - y0)) < 128) continue;
      out.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), 255], (y * width + x) * 4);
    }
  }
  return out;
}

export function nearestIndex(palette: readonly RGBA[], [r, g, b]: RGBA): number {
  const dist = ([pr, pg, pb]: RGBA) => (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
  return palette.reduce((best, c, i) => (dist(c) < dist(palette[best]) ? i : best), 0);
}
