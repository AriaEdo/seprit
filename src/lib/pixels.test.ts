import { describe, expect, it } from "vitest";
import {
  clearRegion, clampMove, composite, copyRegion, createFrame, ellipsePoints, MAX_SIZE, floodFill, getPixel, hexToRgba, linePoints, moveRegion, paintPoints,
  imageToCel, pasteFrame, rectFromCorners, rectPoints, resizeFrame, rgbaToHex, sliceSheet, guessGrid, removeGridLines, trimCells, type Frame, type RGBA,
} from "./pixels";

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];

describe("paintPoints", () => {
  it("returns a new frame and leaves the original untouched, so undo snapshots stay valid", () => {
    const before = createFrame(4, 4);
    const after = paintPoints(before, [[1, 2]], RED);
    expect(getPixel(after, 1, 2)).toEqual(RED);
    expect(getPixel(before, 1, 2)).toEqual([0, 0, 0, 0]);
  });

  it("ignores strokes that leave the canvas instead of wrapping into the next row", () => {
    const frame = paintPoints(createFrame(4, 4), [[4, 0], [-1, 1]], RED);
    // x=4 on row 0 would alias to (0,1) if bounds were not checked.
    expect(getPixel(frame, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(frame.data.every((b) => b === 0)).toBe(true);
  });
});

describe("linePoints", () => {
  it("produces a gap-free stroke when the pointer jumps several pixels between events", () => {
    const pts = linePoints(0, 0, 5, 2);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([5, 2]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBe(1);
    }
  });
});

describe("resizeFrame", () => {
  it("keeps existing art anchored top-left when the user grows or shrinks the canvas", () => {
    const art = paintPoints(createFrame(4, 4), [[1, 1], [3, 3]], RED);
    const grown = resizeFrame(art, 6, 5);
    expect(getPixel(grown, 1, 1)).toEqual(RED);
    expect(getPixel(grown, 3, 3)).toEqual(RED);
    expect(getPixel(grown, 5, 4)).toEqual([0, 0, 0, 0]);

    const shrunk = resizeFrame(art, 2, 2);
    expect(shrunk.width).toBe(2);
    expect(getPixel(shrunk, 1, 1)).toEqual(RED);
  });

  it("rejects sizes outside the supported range rather than allocating huge buffers", () => {
    expect(() => resizeFrame(createFrame(4, 4), 0, 4)).toThrow(RangeError);
    expect(() => resizeFrame(createFrame(4, 4), 4, 10_000)).toThrow(RangeError);
  });
});

describe("hexToRgba", () => {
  it("converts the native color input value to an opaque pixel", () => {
    expect(hexToRgba("#ff8000")).toEqual([255, 128, 0, 255]);
    expect(() => hexToRgba("red")).toThrow();
  });
});

describe("rgbaToHex", () => {
  it("round-trips with hexToRgba so the eyedropper can feed the color input", () => {
    expect(rgbaToHex([255, 128, 0, 255])).toBe("#ff8000");
    expect(hexToRgba(rgbaToHex([1, 2, 3, 255]))).toEqual([1, 2, 3, 255]);
  });
});

describe("rectPoints / ellipsePoints", () => {
  it("draws a rectangle outline that touches both dragged corners, whichever way the user drags", () => {
    const pts = rectPoints(3, 2, 0, 0);
    const set = new Set(pts.map(([x, y]) => `${x},${y}`));
    for (const c of ["0,0", "3,0", "0,2", "3,2"]) expect(set.has(c)).toBe(true);
    expect(set.has("1,1")).toBe(false); // outline only
  });

  it("fits the ellipse inside the dragged box and reaches all four edges", () => {
    const pts = ellipsePoints(0, 0, 6, 4);
    expect(pts.every(([x, y]) => x >= 0 && x <= 6 && y >= 0 && y <= 4)).toBe(true);
    expect(Math.min(...pts.map((p) => p[0]))).toBe(0);
    expect(Math.max(...pts.map((p) => p[0]))).toBe(6);
    expect(Math.min(...pts.map((p) => p[1]))).toBe(0);
    expect(Math.max(...pts.map((p) => p[1]))).toBe(4);
  });
});

describe("floodFill", () => {
  it("fills only the connected region, so a closed outline keeps the outside untouched", () => {
    // 5x5 with a red box outline from (0,0)-(3,3); fill inside at (1,1).
    const boxed = paintPoints(createFrame(5, 5), rectPoints(0, 0, 3, 3), RED);
    const filled = floodFill(boxed, 1, 1, BLUE);
    expect(getPixel(filled, 2, 2)).toEqual(BLUE);
    expect(getPixel(filled, 0, 0)).toEqual(RED);
    expect(getPixel(filled, 4, 4)).toEqual([0, 0, 0, 0]);
    expect(getPixel(boxed, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("returns the same frame when filling with the color already there (no infinite loop, no no-op history entry)", () => {
    const f = createFrame(3, 3);
    expect(floodFill(f, 0, 0, [0, 0, 0, 0])).toBe(f);
  });

  it("tolerance absorbs a slightly noisy background (AI images) but stops at the sprite's real edge", () => {
    const f: Frame = { width: 3, height: 1, data: new Uint8ClampedArray([250, 250, 250, 255, 240, 245, 255, 255, ...RED]) };
    const filled = floodFill(f, 0, 0, [0, 0, 0, 0], 16);
    expect(getPixel(filled, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(filled, 2, 0)).toEqual(RED);
    expect(getPixel(floodFill(f, 0, 0, [0, 0, 0, 0]), 1, 0)).toEqual([240, 245, 255, 255]);
  });
});

describe("rectFromCorners / copyRegion / pasteFrame", () => {
  it("normalizes a drag in any direction and clamps it to the canvas", () => {
    expect(rectFromCorners([5, 4], [-2, 1], 4, 4)).toEqual({ x: 0, y: 1, width: 4, height: 3 });
  });

  it("copy then paste elsewhere duplicates the art; crop uses the same copy", () => {
    const art = paintPoints(createFrame(6, 6), [[1, 1], [2, 2]], RED);
    const clip = copyRegion(art, { x: 1, y: 1, width: 2, height: 2 });
    expect(clip.width).toBe(2);
    expect(getPixel(clip, 0, 0)).toEqual(RED);
    expect(getPixel(clip, 1, 1)).toEqual(RED);

    const pasted = pasteFrame(art, clip, 4, 4);
    expect(getPixel(pasted, 4, 4)).toEqual(RED);
    expect(getPixel(pasted, 5, 5)).toEqual(RED);
    expect(getPixel(art, 4, 4)).toEqual([0, 0, 0, 0]);
  });

  it("pastes transparent clip pixels as holes, not erasers, and clips at the canvas edge", () => {
    const bg = paintPoints(createFrame(3, 3), [[2, 2]], BLUE);
    const clip = paintPoints(createFrame(2, 2), [[0, 0]], RED); // (1,1) of clip is transparent
    const out = pasteFrame(bg, clip, 1, 1);
    expect(getPixel(out, 1, 1)).toEqual(RED);
    expect(getPixel(out, 2, 2)).toEqual(BLUE);
    expect(() => pasteFrame(bg, clip, 2, 2)).not.toThrow();
  });

  it("clearRegion erases only inside the selection (delete/cut), so art outside it survives", () => {
    const art = paintPoints(createFrame(4, 4), [[0, 0], [1, 1], [2, 2], [3, 3]], RED);
    const out = clearRegion(art, { x: 1, y: 1, width: 2, height: 2 });
    expect(getPixel(out, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(getPixel(out, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(getPixel(out, 0, 0)).toEqual(RED);
    expect(getPixel(out, 3, 3)).toEqual(RED);
    expect(getPixel(art, 1, 1)).toEqual(RED); // original kept for undo
  });

  it("moveRegion moves the selected art (leaving a hole) without erasing what it lands on", () => {
    const art = paintPoints(paintPoints(createFrame(4, 1), [[0, 0]], RED), [[2, 0]], BLUE);
    // Selection = 2 px at x 0–1 (RED + transparent); moved right by 2 onto BLUE at x 2.
    const out = moveRegion(art, { x: 0, y: 0, width: 2, height: 1 }, 2, 0);
    expect(getPixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(out, 2, 0)).toEqual(RED);
    expect(getPixel(out, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(art, 0, 0)).toEqual(RED);
  });

  it("clampMove keeps the moved selection on the canvas, so no pixels get cut off", () => {
    const r = { x: 1, y: 1, width: 2, height: 2 };
    expect(clampMove(r, 10, -10, 4, 4)).toEqual([1, -1]);
    expect(clampMove(r, 1, 0, 4, 4)).toEqual([1, 0]);
  });
});

describe("composite", () => {
  it("stacks the upper layer over the lower one: opaque pixels cover, transparent ones show through", () => {
    const lower = paintPoints(createFrame(2, 1), [[0, 0], [1, 0]], BLUE);
    const upper = paintPoints(createFrame(2, 1), [[0, 0]], RED);
    const out = composite(lower, upper);
    expect(getPixel(out, 0, 0)).toEqual(RED);
    expect(getPixel(out, 1, 0)).toEqual(BLUE);
    expect(getPixel(lower, 0, 0)).toEqual(BLUE);
  });

  it("blends semi-transparent pixels instead of replacing them, so soft layers mix with what's below", () => {
    const lower = paintPoints(createFrame(1, 1), [[0, 0]], BLUE);
    const upper = paintPoints(createFrame(1, 1), [[0, 0]], [255, 0, 0, 128]);
    const [r, g, b, a] = getPixel(composite(lower, upper), 0, 0);
    expect(a).toBe(255);
    expect(r).toBeCloseTo(128, -1);
    expect(b).toBeCloseTo(127, -1);
    expect(g).toBe(0);
  });
  it("layer opacity fades the whole layer, so 0 hides it and half lets the backdrop through", () => {
    const lower = paintPoints(createFrame(1, 1), [[0, 0]], BLUE);
    const upper = paintPoints(createFrame(1, 1), [[0, 0]], RED);
    expect(getPixel(composite(lower, upper, 0), 0, 0)).toEqual(BLUE);
    const [r, , b] = getPixel(composite(lower, upper, 128), 0, 0);
    expect(r).toBeCloseTo(128, -1);
    expect(b).toBeCloseTo(127, -1);
  });

  it("blend modes mix with the backdrop color (multiply darkens, screen lightens, difference cancels)", () => {
    const gray = paintPoints(createFrame(1, 1), [[0, 0]], [128, 128, 128, 255]);
    const white = paintPoints(createFrame(1, 1), [[0, 0]], [255, 255, 255, 255]);
    expect(getPixel(composite(white, gray, 255, "multiply"), 0, 0)).toEqual([128, 128, 128, 255]);
    expect(getPixel(composite(gray, white, 255, "screen"), 0, 0)).toEqual([255, 255, 255, 255]);
    expect(getPixel(composite(gray, gray, 255, "difference"), 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("blend modes leave pixels over a transparent backdrop unchanged, so a lone multiply layer isn't black", () => {
    const upper = paintPoints(createFrame(1, 1), [[0, 0]], RED);
    expect(getPixel(composite(createFrame(1, 1), upper, 255, "multiply"), 0, 0)).toEqual(RED);
  });
});

describe("imageToCel (import)", () => {
  const BLACK: RGBA = [0, 0, 0, 255];
  const WHITE: RGBA = [255, 255, 255, 255];
  // Source images can be bigger than MAX_SIZE, so they're built directly instead of via createFrame.
  const image = (width: number, height: number, pixels: RGBA[]): Frame =>
    ({ width, height, data: new Uint8ClampedArray(pixels.flat()) });

  it("shrinks to fit the canvas keeping aspect ratio, placed top-left (no stretching)", () => {
    const img = image(4, 2, [RED, RED, BLUE, BLUE, RED, RED, BLUE, BLUE]);
    const cel = imageToCel(img, 2, 2);
    expect([cel.width, cel.height]).toEqual([2, 2]);
    expect(getPixel(cel, 0, 0)).toEqual(RED);
    expect(getPixel(cel, 1, 0)).toEqual(BLUE);
    expect(getPixel(cel, 0, 1)).toEqual([0, 0, 0, 0]);
  });

  it("never upscales a smaller image: pixel art imports 1:1", () => {
    const cel = imageToCel(image(1, 1, [RED]), 4, 4);
    expect(getPixel(cel, 0, 0)).toEqual(RED);
    expect(getPixel(cel, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("averages each block instead of picking one pixel, so detail isn't dropped", () => {
    const gray: RGBA = [128, 128, 128, 255];
    expect(getPixel(imageToCel(image(2, 1, [BLACK, WHITE]), 1, 1), 0, 0)).toEqual(gray);
  });

  it("keeps the image's own colors instead of snapping them to the 16-color palette", () => {
    const skin: RGBA = [233, 180, 140, 255];
    expect(getPixel(imageToCel(image(1, 1, [skin]), 1, 1), 0, 0)).toEqual(skin);
  });

  it("alpha < 128 becomes transparent, otherwise fully opaque", () => {
    const cel = imageToCel(image(2, 1, [[255, 0, 0, 100], [255, 0, 0, 200]]), 2, 1);
    expect(getPixel(cel, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(cel, 1, 0)).toEqual(RED);
  });

  it("transparent pixels don't darken the block color (average is alpha-weighted)", () => {
    const img = image(4, 1, [RED, RED, RED, [0, 0, 0, 0]]);
    expect(getPixel(imageToCel(img, 1, 1), 0, 0)).toEqual(RED);
  });
});

describe("sliceSheet (sprite sheet import)", () => {
  // 4×2 sheet, 2 columns × 2 rows: cell (col, row) is painted with value 10 * (row * 2 + col) + 1.
  const sheet: Frame = (() => {
    let f = createFrame(4, 2);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) f = paintPoints(f, [[x, y]], [10 * (y * 2 + Math.floor(x / 2)) + 1, 0, 0, 255]);
    return f;
  })();

  it("orders cells left → right, then top → bottom, matching how sheets are read into animation frames", () => {
    const cells = sliceSheet(sheet, 2, 2);
    expect(cells.map((c) => [c.width, c.height])).toEqual([[2, 1], [2, 1], [2, 1], [2, 1]]);
    expect(cells.map((c) => getPixel(c, 0, 0)[0])).toEqual([1, 11, 21, 31]);
  });

  it("drops leftover pixels at the right/bottom edge so every cell has the same size", () => {
    const cells = sliceSheet({ ...createFrame(7, 3) }, 3, 1);
    expect(cells.map((c) => [c.width, c.height])).toEqual([[2, 3], [2, 3], [2, 3]]);
  });

  it("accepts cells bigger than the max canvas size, since imported images are shrunk only afterwards", () => {
    const big: Frame = { width: MAX_SIZE * 2, height: 2, data: new Uint8ClampedArray(MAX_SIZE * 2 * 2 * 4) };
    expect(sliceSheet(big, 1, 2).map((c) => [c.width, c.height])).toEqual([[MAX_SIZE * 2, 1], [MAX_SIZE * 2, 1]]);
  });
});

describe("trimCells (sprite sheet import)", () => {
  const dot = (w: number, h: number, x: number, y: number, a = 255) => paintPoints(createFrame(w, h), [[x, y]], [255, 0, 0, a]);

  it("crops every cell to the same box around all their content, so the sprite doesn't jump between frames", () => {
    const cells = trimCells([dot(6, 6, 1, 2), dot(6, 6, 3, 4)]);
    expect(cells.map((c) => [c.width, c.height])).toEqual([[3, 3], [3, 3]]);
    expect(getPixel(cells[0], 0, 0)[3]).toBe(255);
    expect(getPixel(cells[1], 2, 2)[3]).toBe(255);
  });

  it("ignores faint pixels (alpha < 128) like import does, so stray specks don't defeat the trim", () => {
    const cell = paintPoints(dot(6, 6, 2, 2), [[5, 5]], [255, 0, 0, 40]);
    expect(trimCells([cell]).map((c) => [c.width, c.height])).toEqual([[1, 1]]);
  });

  it("leaves fully transparent cells unchanged instead of producing empty frames", () => {
    const cells = [createFrame(4, 4)];
    expect(trimCells(cells)).toBe(cells);
  });
});

describe("guessGrid (sprite sheet import)", () => {
  const RED: RGBA = [255, 0, 0, 255];

  it("counts sprites separated by fully transparent columns/rows, so a clean sheet needs no typing", () => {
    // 3 sprites in a row (x = 0, 2, 4), 2 rows (y = 0, 2), gaps between them.
    const pts: [number, number][] = [];
    for (const x of [0, 2, 4]) for (const y of [0, 2]) pts.push([x, y]);
    expect(guessGrid(paintPoints(createFrame(5, 3), pts, RED))).toEqual({ cols: 3, rows: 2 });
  });

  it("falls back to one cell when sprites touch, since the gap can't be found and the user must enter it", () => {
    expect(guessGrid(paintPoints(createFrame(4, 1), [[0, 0], [1, 0], [2, 0], [3, 0]], RED))).toEqual({ cols: 1, rows: 1 });
  });

  it("ignores transparent margins around the sheet", () => {
    expect(guessGrid(paintPoints(createFrame(7, 3), [[1, 1], [3, 1], [5, 1]], RED))).toEqual({ cols: 3, rows: 1 });
  });

  it("ignores faint pixels (alpha < 128) like import does, so stray specks below a sheet don't add rows", () => {
    const sheet = paintPoints(paintPoints(createFrame(3, 3), [[0, 0], [2, 0]], RED), [[1, 2]], [255, 0, 0, 40]);
    expect(guessGrid(sheet)).toEqual({ cols: 2, rows: 1 });
  });

  it("returns 1 × 1 for a fully transparent image instead of 0 cells", () => {
    expect(guessGrid(createFrame(3, 3))).toEqual({ cols: 1, rows: 1 });
  });
});

describe("removeGridLines (sprite sheet import)", () => {
  const INK: RGBA = [0, 0, 0, 255];
  // Two 6 px boxes drawn with dark borders (x = 0, 7, 14; y = 0, 6), one red sprite pixel in each box.
  const boxed = (() => {
    const pts: [number, number][] = [];
    for (const x of [0, 7, 14]) for (let y = 0; y <= 6; y++) pts.push([x, y]);
    for (const y of [0, 6]) for (let x = 0; x <= 14; x++) pts.push([x, y]);
    return paintPoints(paintPoints(createFrame(15, 7), pts, INK), [[3, 3], [10, 3]], RED);
  })();

  it("lets the grid be guessed when borders join the sprites, which otherwise reads as one 1 × 1 image", () => {
    expect(guessGrid(boxed)).toEqual({ cols: 1, rows: 1 });
    expect(guessGrid(removeGridLines(boxed))).toEqual({ cols: 2, rows: 1 });
  });

  it("crops to inside the outer borders, so equal slicing lands each sprite in its own cell without drift", () => {
    const cells = sliceSheet(removeGridLines(boxed), 2, 1);
    expect(cells.map((c) => c.data.some((v, i) => i % 4 === 3 && v >= 128))).toEqual([true, true]);
    expect(cells.flatMap((c) => Array.from({ length: c.width * c.height }, (_, i) => getPixel(c, i % c.width, Math.floor(i / c.width))))
      .filter((px) => px[3] >= 128).every((px) => px[0] === 255)).toBe(true);
  });

  it("keeps a sprite's own short dark outline, since only near-full-length lines are borders", () => {
    const sprite = paintPoints(createFrame(6, 6), [[2, 0], [2, 1], [2, 2], [3, 5]], INK);
    expect(removeGridLines(sprite)).toBe(sprite);
  });

  it("leaves border-less sheets untouched, so regular pixel-art sheets keep their exact cell grid", () => {
    const sheet = paintPoints(createFrame(8, 4), [[1, 1], [5, 1]], RED);
    expect(removeGridLines(sheet)).toBe(sheet);
  });
});
