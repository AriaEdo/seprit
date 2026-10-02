import { describe, expect, it } from "vitest";
import { createFrame, paintPoints } from "./pixels";
import { addFrame, addLayer, addTag, duplicateLinked, newDoc, setCel, setDuration, updateTag, type Doc } from "./frames";
import { parseSprt, serializeSprt } from "./sprt";

// A doc that uses every saved feature, so a round trip that drops any of them fails.
function richDoc(): Doc {
  let d = newDoc(3, 2);
  d = setCel(d, paintPoints(createFrame(3, 2), [[0, 0], [2, 1]], [10, 20, 30, 40]));
  d = duplicateLinked(d);
  d = addFrame(d);
  d = setDuration(d, 2, 300);
  d = addTag(d);
  d = updateTag(d, 0, { name: "run", from: 1, to: 2, direction: "pingpong" });
  d = addLayer(d);
  d = { ...d, layers: d.layers.with(1, { ...d.layers[1], name: "fx", visible: false, locked: true, opacity: 77, blend: "screen" }) };
  return d;
}

const reparse = (d: Doc) => parseSprt(serializeSprt(d));
const tamper = (d: Doc, fn: (json: any) => void) => {
  const json = JSON.parse(serializeSprt(d));
  fn(json);
  return () => parseSprt(JSON.stringify(json));
};

describe("sprt round trip: reopening a saved file gives back the same document", () => {
  it("keeps pixels, layer settings, links, durations and tags; opens on the first layer and frame", () => {
    const d = richDoc();
    expect(reparse(d)).toEqual({ ...d, layer: 0, frame: 0 });
  });

  it("stores each shared cel once and keeps it shared, so blank frames don't bloat the file or memory", () => {
    const d = richDoc();
    const json = JSON.parse(serializeSprt(d));
    // Unique pixel contents: the linked drawing and blank (layer 2's blanks match layer 1's).
    expect(json.cels.length).toBe(2);
    const back = reparse(d);
    expect(back.layers[1].cels[0]).toBe(back.layers[1].cels[2]);
    expect(back.layers[0].cels[0]).toBe(back.layers[0].cels[1]);
  });
});

describe("parseSprt rejects files it can't open safely, with a reason", () => {
  const d = richDoc();
  it.each([
    ["not JSON", () => parseSprt("{oops"), /JSON/],
    ["unknown version", tamper(d, (j) => (j.version = 99)), /versi/],
    ["bad size", tamper(d, (j) => (j.width = 0)), /ukuran/],
    ["pixel data of the wrong length", tamper(d, (j) => (j.cels[0] = btoa("abc"))), /cel/],
    ["cel index out of range", tamper(d, (j) => (j.layers[0].cels[0] = 9)), /cel/],
    ["layers with different frame counts", tamper(d, (j) => j.layers[1].cels.pop()), /frame/],
    ["no layers", tamper(d, (j) => (j.layers = [])), /layer/],
    ["unknown blend mode", tamper(d, (j) => (j.layers[0].blend = "glow")), /blend/],
    ["opacity out of range", tamper(d, (j) => (j.layers[0].opacity = 300)), /opacity/],
    ["zero duration", tamper(d, (j) => (j.durations[0] = 0)), /durasi/],
    ["tag past the last frame", tamper(d, (j) => (j.tags[0].to = 3)), /tag/],
    ["overlapping tags", tamper(d, (j) => j.tags.push({ name: "x", from: 2, to: 2, direction: "forward" })), /tag/],
  ])("%s", (_, open, reason) => {
    expect(open).toThrow(reason);
  });
});
