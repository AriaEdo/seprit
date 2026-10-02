import { describe, expect, it } from "vitest";
import { createFrame, paintPoints, type RGBA } from "./pixels";
import { newDoc, type Doc } from "./frames";
import { sheetJson, sheetSvg } from "./exportFormats";

const RED: RGBA = [255, 0, 0, 255];

// 3 frames of 4 × 2 with different durations and one tag over frames 1–2.
const doc: Doc = {
  ...newDoc(4, 2),
  layers: [{ ...newDoc(4, 2).layers[0], cels: [createFrame(4, 2), createFrame(4, 2), createFrame(4, 2)], links: [null, null, null] }],
  durations: [100, 200, 300],
  tags: [{ name: "run", from: 1, to: 2, direction: "pingpong" }],
};

describe("sheetJson (Aseprite array format)", () => {
  const json = sheetJson(doc, "hero.png");

  it("gives each frame's rect in the one-row sheet, so engines can cut frame i at x = i × width", () => {
    expect(json.frames.map((f) => f.frame)).toEqual([
      { x: 0, y: 0, w: 4, h: 2 }, { x: 4, y: 0, w: 4, h: 2 }, { x: 8, y: 0, w: 4, h: 2 },
    ]);
  });

  it("carries per-frame durations so the game plays at the same speed as the editor", () => {
    expect(json.frames.map((f) => f.duration)).toEqual([100, 200, 300]);
  });

  it("exports tags as frameTags so each animation (run, idle…) can be played by name", () => {
    expect(json.meta.frameTags).toEqual([{ name: "run", from: 1, to: 2, direction: "pingpong" }]);
  });

  it("points meta.image at the exported sheet and reports its full size", () => {
    expect(json.meta.image).toBe("hero.png");
    expect(json.meta.size).toEqual({ w: 12, h: 2 });
  });
});

describe("sheetSvg", () => {
  it("merges a horizontal run of one color into a single rect, keeping files small", () => {
    const svg = sheetSvg(paintPoints(createFrame(4, 1), [[0, 0], [1, 0], [2, 0]], RED));
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg).toContain('<rect x="0" y="0" width="3" height="1" fill="#ff0000"/>');
  });

  it("leaves transparent pixels out instead of drawing them as black", () => {
    expect(sheetSvg(createFrame(2, 2))).not.toContain("<rect");
  });

  it("keeps partial alpha as fill-opacity so soft pixels stay soft", () => {
    expect(sheetSvg(paintPoints(createFrame(1, 1), [[0, 0]], [0, 0, 255, 128]))).toContain('fill="#0000ff" fill-opacity="0.502"');
  });

  it("uses the pixel grid as viewBox with crisp edges, so it scales without blurring or seams", () => {
    const svg = sheetSvg(createFrame(5, 3));
    expect(svg).toContain('viewBox="0 0 5 3"');
    expect(svg).toContain('shape-rendering="crispEdges"');
  });
});
