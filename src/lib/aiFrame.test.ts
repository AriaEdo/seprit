import { describe, expect, it } from "vitest";
import { fitsAi, frameToRows, rowsToFrame } from "./aiFrame";
import { createFrame, getPixel, paintPoints, type RGBA } from "./pixels";

const BLACK: RGBA = [0, 0, 0, 255];
const RED: RGBA = [255, 0, 0, 255];
const PALETTE = [BLACK, RED];

describe("frameToRows / rowsToFrame", () => {
  it("round-trips a palette frame, so an unchanged answer from Claude reproduces the frame exactly", () => {
    const f = paintPoints(paintPoints(createFrame(3, 2), [[0, 0]], RED), [[2, 1]], BLACK);
    const rows = frameToRows(f, PALETTE);
    expect(rows).toEqual(["1..", "..0"]);
    expect(rowsToFrame(rows, 3, 2, PALETTE).data).toEqual(f.data);
  });

  it("snaps off-palette colors (e.g. from blended layers) to the nearest palette index", () => {
    const f = paintPoints(createFrame(1, 1), [[0, 0]], [200, 20, 10, 255]);
    expect(frameToRows(f, PALETTE)).toEqual(["1"]);
  });

  it("treats mostly transparent pixels as transparent, like Import", () => {
    const f = paintPoints(createFrame(1, 1), [[0, 0]], [255, 0, 0, 127]);
    expect(frameToRows(f, PALETTE)).toEqual(["."]);
  });

  it("rejects a grid whose size differs from the canvas, so a bad answer never resizes the sprite", () => {
    expect(() => rowsToFrame(["11", "11"], 2, 3, PALETTE)).toThrow();
    expect(() => rowsToFrame(["11", "1"], 2, 2, PALETTE)).toThrow();
    expect(() => rowsToFrame("11", 2, 1, PALETTE)).toThrow();
  });

  it("rejects indices outside the palette and unknown chars instead of guessing a color", () => {
    expect(() => rowsToFrame(["2"], 1, 1, PALETTE)).toThrow();
    expect(() => rowsToFrame(["x"], 1, 1, PALETTE)).toThrow();
    expect(() => rowsToFrame(["A"], 1, 1, PALETTE)).toThrow();
  });

  it("writes palette colors fully opaque and leaves '.' transparent", () => {
    const f = rowsToFrame(["1."], 2, 1, PALETTE);
    expect(getPixel(f, 0, 0)).toEqual(RED);
    expect(getPixel(f, 1, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe("fitsAi", () => {
  it("allows up to 64×64 only, keeping the grid small enough for Claude", () => {
    expect(fitsAi(createFrame(64, 64))).toBe(true);
    expect(fitsAi(createFrame(65, 1))).toBe(false);
    expect(fitsAi(createFrame(1, 65))).toBe(false);
  });
});
