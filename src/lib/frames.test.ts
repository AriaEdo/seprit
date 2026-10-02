import { describe, expect, it } from "vitest";
import { createFrame, getPixel, paintPoints, type Frame, type RGBA } from "./pixels";
import {
  addFrame, addLayer, currentCel, deleteFrame, deleteLayer, duplicateFrame, flatten, frameCount, mapCels,
  duplicateLinked, isEditable, isLinked, moveFrame, moveLayer, newDoc, nextFrame, renameLayer, setBlend, setCel, setOpacity, toggleLocked,
  toggleVisible, unlinkCel, addTag, deleteTag, playRange, setAllDurations, setDuration, tagAt, updateTag, DEFAULT_DURATION, onionSkin, spriteSheet, addLayerFromCels,
  type Doc, type Layer, type PlayRange, type Tag,
} from "./frames";

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const blank = createFrame(2, 2);
const art = (r: number): Frame => paintPoints(blank, [[0, 0]], [r, 0, 0, 255]);
const mkLayer = (name: string, cels: Frame[]): Layer =>
  ({ name, visible: true, locked: false, opacity: 255, blend: "normal", cels, links: cels.map(() => null) });
// `layers` × `frames` grid where every cel is distinct, so tests can tell which cel went where.
const grid = (layers: number, frames: number, layer = 0, frame = 0): Doc => ({
  layers: Array.from({ length: layers }, (_, l) =>
    mkLayer(`Layer ${l + 1}`, Array.from({ length: frames }, (_, f) => art(l * 10 + f + 1)))),
  layer,
  frame,
  // Distinct per frame so tests can tell which duration went where.
  durations: Array.from({ length: frames }, (_, f) => (f + 1) * 100),
  tags: [],
});
const tag = (from: number, to: number, name = "t"): Tag => ({ name, from, to, direction: "forward" });
const withTags = (d: Doc, ...tags: Tag[]): Doc => ({ ...d, tags });
const spans = (d: Doc) => d.tags.map((t) => [t.from, t.to]);
const cels = (d: Doc, layer: number) => d.layers[layer].cels;
const sameShape = (d: Doc) => d.layers.every((l) => l.cels.length === frameCount(d));

describe("newDoc", () => {
  it("starts with one empty layer and one frame of the requested size", () => {
    const d = newDoc(4, 3);
    expect(d.layers.length).toBe(1);
    expect(frameCount(d)).toBe(1);
    expect(currentCel(d).width).toBe(4);
    expect(currentCel(d).data.every((b) => b === 0)).toBe(true);
  });
});

describe("frame edits apply to every layer, keeping the layer × frame grid rectangular", () => {
  it("adds a blank frame after the current one in all layers and selects it", () => {
    const d = grid(2, 2, 1, 0);
    const next = addFrame(d);
    expect(sameShape(next)).toBe(true);
    expect(frameCount(next)).toBe(3);
    expect(next.frame).toBe(1);
    expect(next.layer).toBe(1);
    expect(cels(next, 0)[1].data.every((b) => b === 0)).toBe(true);
    expect(cels(next, 1)[2]).toBe(cels(d, 1)[1]);
  });

  it("duplicates each layer's own cel, so the copy looks exactly like the current frame", () => {
    const d = grid(2, 2, 0, 1);
    const next = duplicateFrame(d);
    expect(next.frame).toBe(2);
    expect(cels(next, 0)[2]).toBe(cels(d, 0)[1]);
    expect(cels(next, 1)[2]).toBe(cels(d, 1)[1]);
  });

  it("never deletes the last frame, and clamps the selection after deleting the final one", () => {
    const single = grid(2, 1);
    expect(deleteFrame(single)).toBe(single);
    const next = deleteFrame(grid(2, 3, 0, 2));
    expect(sameShape(next)).toBe(true);
    expect(frameCount(next)).toBe(2);
    expect(next.frame).toBe(1);
  });

  it("moves the frame column in all layers and keeps it selected", () => {
    const d = grid(2, 3, 0, 0);
    const next = moveFrame(d, 0, 2);
    expect(cels(next, 0)).toEqual([cels(d, 0)[1], cels(d, 0)[2], cels(d, 0)[0]]);
    expect(cels(next, 1)[2]).toBe(cels(d, 1)[0]);
    expect(next.frame).toBe(2);
    expect(moveFrame(d, 1, 1)).toBe(d);
  });
});

describe("layer edits", () => {
  it("adds an empty layer directly above the current one, with a frame count matching the doc", () => {
    const d = grid(2, 3, 0, 1);
    const next = addLayer(d);
    expect(next.layers.length).toBe(3);
    expect(next.layer).toBe(1);
    expect(next.frame).toBe(1);
    expect(next.layers[1].name).toBe("Layer 3");
    expect(next.layers[1].visible).toBe(true);
    expect(cels(next, 1).length).toBe(3);
    expect(cels(next, 1).every((c) => c.data.every((b) => b === 0))).toBe(true);
    expect(next.layers[2]).toBe(d.layers[1]);
  });

  it("never deletes the last layer, and clamps the selection after deleting the top one", () => {
    const single = grid(1, 2);
    expect(deleteLayer(single)).toBe(single);
    const next = deleteLayer(grid(3, 1, 2));
    expect(next.layers.length).toBe(2);
    expect(next.layer).toBe(1);
  });

  it("reorders layers (changing what draws on top) and keeps the moved layer selected", () => {
    const d = grid(3, 1, 0);
    const next = moveLayer(d, 0, 2);
    expect(next.layers).toEqual([d.layers[1], d.layers[2], d.layers[0]]);
    expect(next.layer).toBe(2);
    expect(moveLayer(d, 1, 1)).toBe(d);
  });

  it("renames a layer, ignoring blank or unchanged names so they don't create undo steps", () => {
    const d = grid(2, 1);
    expect(renameLayer(d, 1, "  Outline ").layers[1].name).toBe("Outline");
    expect(renameLayer(d, 1, "   ")).toBe(d);
    expect(renameLayer(d, 1, "Layer 2")).toBe(d);
  });

  it("toggles visibility of one layer only", () => {
    const next = toggleVisible(grid(2, 1), 0);
    expect(next.layers[0].visible).toBe(false);
    expect(next.layers[1].visible).toBe(true);
    expect(toggleVisible(next, 0).layers[0].visible).toBe(true);
  });
});

describe("layer properties", () => {
  it("locking blocks editing without hiding the layer; hidden layers aren't editable either", () => {
    const d = toggleLocked(grid(2, 1), 0);
    expect(d.layers[0].locked).toBe(true);
    expect(isEditable(d.layers[0])).toBe(false);
    expect(isEditable(d.layers[1])).toBe(true);
    expect(isEditable(toggleVisible(grid(1, 1), 0).layers[0])).toBe(false);
  });

  it("opacity is clamped to 0–255 and garbage input is ignored, so a bad field can't corrupt the doc", () => {
    const d = grid(1, 1);
    expect(setOpacity(d, 0, 300).layers[0].opacity).toBe(255);
    expect(setOpacity(d, 0, -5).layers[0].opacity).toBe(0);
    expect(setOpacity(d, 0, 127.6).layers[0].opacity).toBe(128);
    expect(setOpacity(d, 0, NaN)).toBe(d);
  });

  it("flatten applies each layer's opacity and blend mode", () => {
    const d: Doc = {
      layers: [mkLayer("bg", [paintPoints(blank, [[0, 0]], [255, 255, 255, 255])]), mkLayer("fg", [art(128)])],
      layer: 1,
      frame: 0, durations: [DEFAULT_DURATION], tags: [],
    };
    expect(getPixel(flatten(setOpacity(d, 1, 0), 0), 0, 0)).toEqual([255, 255, 255, 255]);
    // Multiply: white × (128, 0, 0) = (128, 0, 0).
    expect(getPixel(flatten(setBlend(d, 1, "multiply"), 0), 0, 0)).toEqual([128, 0, 0, 255]);
  });
});

describe("cels", () => {
  it("setCel replaces only the selected layer's cel in the selected frame", () => {
    const d = grid(2, 2, 1, 1);
    const f = art(99);
    const next = setCel(d, f);
    expect(currentCel(next)).toBe(f);
    expect(cels(next, 1)[0]).toBe(cels(d, 1)[0]);
    expect(next.layers[0]).toBe(d.layers[0]);
  });

  it("mapCels applies canvas-wide edits (resize/crop) to every cel so all cels share one size", () => {
    const next = mapCels(grid(2, 3, 1, 2), () => createFrame(5, 5));
    expect(next.layers.every((l) => l.cels.every((c) => c.width === 5))).toBe(true);
    expect(next.layer).toBe(1);
    expect(next.frame).toBe(2);
  });

  it("mapCels runs once per shared cel, so blank cels stay shared instead of multiplying memory", () => {
    // 2 layers × 2 frames, but the new frame's column is one blank shared by both layers: 3 distinct cels.
    const d = addFrame(addLayer(newDoc(2, 2)));
    let calls = 0;
    const next = mapCels(d, (c) => { calls++; return createFrame(c.width + 1, c.height); });
    expect(calls).toBe(3);
    expect(cels(next, 0)[1]).toBe(cels(next, 1)[1]);
  });
});

describe("flatten", () => {
  it("draws visible layers bottom to top, so the higher layer covers the lower one", () => {
    const d: Doc = {
      layers: [
        mkLayer("bg", [paintPoints(blank, [[0, 0], [1, 0]], BLUE)]),
        mkLayer("fg", [paintPoints(blank, [[0, 0]], RED)]),
      ],
      layer: 0,
      frame: 0, durations: [DEFAULT_DURATION], tags: [],
    };
    const out = flatten(d, 0);
    expect(getPixel(out, 0, 0)).toEqual(RED);
    expect(getPixel(out, 1, 0)).toEqual(BLUE);
    expect(getPixel(flatten(toggleVisible(d, 1), 0), 0, 0)).toEqual(BLUE);
  });

  // Onion skin flattens up to 10 neighbours on every stroke; unchanged frames must not be recomputed.
  it("reuses the result for a frame whose visible cels, opacity and blend are unchanged", () => {
    const d: Doc = {
      layers: [mkLayer("bg", [blank, paintPoints(blank, [[0, 0]], BLUE)]), mkLayer("fg", [blank, blank])],
      layer: 1, frame: 0, durations: [DEFAULT_DURATION, DEFAULT_DURATION], tags: [],
    };
    const before = flatten(d, 1);
    const edited = setCel(d, paintPoints(blank, [[1, 0]], RED)); // frame 0 only
    expect(flatten(edited, 1)).toBe(before);
    expect(getPixel(flatten(edited, 0), 1, 0)).toEqual(RED);
    // Changes to frame 1's inputs must not serve the stale result.
    expect(getPixel(flatten(toggleVisible(edited, 0), 1), 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(flatten(setOpacity(edited, 0, 0), 1), 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("is fully transparent when every layer is hidden", () => {
    const d = toggleVisible(grid(1, 1), 0);
    expect(flatten(d, 0).data.every((b) => b === 0)).toBe(true);
  });
});

describe("linked cels: one drawing shared by several frames", () => {
  it("drawing on a linked cel updates every frame it is linked to, in that layer only", () => {
    const d = setCel(duplicateLinked(duplicateLinked(grid(2, 1))), art(99));
    expect(cels(d, 0)).toEqual([art(99), art(99), art(99)]);
    expect(cels(d, 1)).toEqual([art(11), art(11), art(11)]); // other layer untouched
  });

  it("a plain duplicate is an independent copy: editing it leaves the original", () => {
    const d = setCel(duplicateFrame(grid(1, 1)), art(99));
    expect(cels(d, 0)).toEqual([art(1), art(99)]);
  });

  it("links follow their frames when frames are added, moved or deleted", () => {
    let d = duplicateLinked(grid(1, 2)); // frames: A(linked) A(linked) B
    d = moveFrame(d, 2, 0); // B A A
    d = addFrame({ ...d, frame: 0 }); // B _ A A
    d = setCel({ ...d, frame: 3 }, art(99));
    expect(cels(d, 0)[1].data.every((b) => b === 0)).toBe(true);
    expect(cels(d, 0).slice(2)).toEqual([art(99), art(99)]);
    expect(cels(d, 0)[0]).toEqual(art(2));
  });

  it("unlinking makes the cel independent; the last member of a group is no longer linked", () => {
    const d = unlinkCel(duplicateLinked(grid(1, 1)));
    expect([isLinked(d.layers[0], 0), isLinked(d.layers[0], 1)]).toEqual([false, false]);
    expect(cels(setCel(d, art(99)), 0)).toEqual([art(1), art(99)]);
  });

  it("deleting a linked frame leaves the remaining one unlinked", () => {
    const d = deleteFrame(duplicateLinked(grid(1, 1)));
    expect(isLinked(d.layers[0], 0)).toBe(false);
  });

  it("separate linked groups in one layer stay separate", () => {
    let d = duplicateLinked(grid(1, 2)); // A A B
    d = duplicateLinked({ ...d, frame: 2 }); // A A B B
    d = setCel(d, art(99));
    expect(cels(d, 0)).toEqual([art(1), art(1), art(99), art(99)]);
  });
});

describe("frame durations", () => {
  it("a new doc's frame plays for the default duration", () => {
    expect(newDoc(2, 2).durations).toEqual([DEFAULT_DURATION]);
  });

  it("stay attached to their frame through add, duplicate, move and delete", () => {
    expect(addFrame(grid(1, 2)).durations).toEqual([100, DEFAULT_DURATION, 200]);
    // A copy should play exactly like the original.
    expect(duplicateFrame(grid(1, 2, 0, 1)).durations).toEqual([100, 200, 200]);
    expect(duplicateLinked(grid(1, 2)).durations).toEqual([100, 100, 200]);
    expect(moveFrame(grid(1, 3), 0, 2).durations).toEqual([200, 300, 100]);
    expect(deleteFrame(grid(1, 3, 0, 1)).durations).toEqual([100, 300]);
  });

  it("are clamped to 1–65535 ms and garbage input is ignored, so playback can't spin on a 0/NaN timer", () => {
    const d = grid(1, 2);
    expect(setDuration(d, 1, 0).durations).toEqual([100, 1]);
    expect(setDuration(d, 1, 99999).durations).toEqual([100, 65535]);
    expect(setDuration(d, 1, NaN)).toBe(d);
    expect(setDuration(d, 1, 200)).toBe(d);
  });

  it("FPS sets every frame at once", () => {
    expect(setAllDurations(grid(1, 3), 1000 / 8).durations).toEqual([125, 125, 125]);
  });
});

describe("tags", () => {
  it("are created on the current frame, but not on a frame that already has a tag", () => {
    const d = addTag(grid(1, 3, 0, 1));
    expect(d.tags).toEqual([{ name: "Tag 1", from: 1, to: 1, direction: "forward" }]);
    expect(addTag(d)).toBe(d);
  });

  it("reject edits that overlap another tag or invert the range; out-of-range frames are clamped", () => {
    const d = withTags(grid(1, 5), tag(0, 1), tag(3, 3));
    expect(updateTag(d, 0, { to: 3 })).toBe(d);
    expect(updateTag(d, 1, { from: 4, to: 3 })).toBe(d);
    expect(spans(updateTag(d, 1, { to: 99 }))).toEqual([[0, 1], [3, 4]]);
    expect(updateTag(d, 0, { name: "  " })).toBe(d);
    expect(updateTag(d, 0, { name: " run ", direction: "pingpong" }).tags[0]).toEqual({ name: "run", from: 0, to: 1, direction: "pingpong" });
    expect(deleteTag(d, 0).tags).toEqual([tag(3, 3)]);
  });

  it("follow their frames when frames are inserted, so a tag keeps naming the same animation", () => {
    const d = withTags(grid(1, 4), tag(0, 1, "a"), tag(2, 3, "b"));
    // Inserting after a tag's last frame extends that tag; tags after it shift right.
    expect(spans(addFrame({ ...d, frame: 1 }))).toEqual([[0, 2], [3, 4]]);
    expect(spans(duplicateFrame({ ...d, frame: 0 }))).toEqual([[0, 2], [3, 4]]);
    expect(spans(duplicateLinked({ ...d, frame: 3 }))).toEqual([[0, 1], [2, 4]]);
  });

  it("shrink when one of their frames is deleted, and disappear with their only frame", () => {
    const d = withTags(grid(1, 4), tag(0, 1, "a"), tag(2, 2, "b"), tag(3, 3, "c"));
    expect(spans(deleteFrame({ ...d, frame: 0 }))).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(deleteFrame({ ...d, frame: 2 }).tags.map((t) => t.name)).toEqual(["a", "c"]);
  });

  it("stay on their frame positions when a frame is dragged", () => {
    const d = withTags(grid(1, 3), tag(0, 1));
    expect(moveFrame(d, 0, 2).tags).toEqual(d.tags);
  });

  it("tagAt finds the tag under a frame", () => {
    const d = withTags(grid(1, 4), tag(1, 2));
    expect([0, 1, 2, 3].map((f) => tagAt(d, f))).toEqual([-1, 0, 0, -1]);
  });
});

describe("playRange: only the active tag plays", () => {
  it("is the tag under the current frame, else every frame forward", () => {
    const d = withTags(grid(1, 5), { name: "t", from: 1, to: 3, direction: "reverse" });
    expect(playRange({ ...d, frame: 2 })).toEqual({ from: 1, to: 3, direction: "reverse" });
    expect(playRange({ ...d, frame: 4 })).toEqual({ from: 0, to: 4, direction: "forward" });
  });
});

describe("nextFrame (playback)", () => {
  const range = (from: number, to: number, direction: PlayRange["direction"]): PlayRange => ({ from, to, direction });
  // Plays from `start` until it stops or `n` steps pass, returning the frames shown.
  function play(r: PlayRange, start: number, loop: boolean, n = 8) {
    const out = [start];
    let s = { frame: start, backward: false };
    for (let i = 0; i < n; i++) {
      const next = nextFrame(s.frame, r, loop, s.backward);
      if (!next) break;
      out.push(next.frame);
      s = next;
    }
    return out;
  }

  it("forward stays inside the range, wrapping when looping and stopping at the end otherwise", () => {
    expect(play(range(1, 3, "forward"), 1, true, 4)).toEqual([1, 2, 3, 1, 2]);
    expect(play(range(1, 3, "forward"), 1, false)).toEqual([1, 2, 3]);
  });

  it("reverse runs from the end of the range back to the start", () => {
    expect(play(range(1, 3, "reverse"), 3, true, 4)).toEqual([3, 2, 1, 3, 2]);
    expect(play(range(1, 3, "reverse"), 3, false)).toEqual([3, 2, 1]);
  });

  it("pingpong bounces without repeating the end frames; one round trip is one loop", () => {
    expect(play(range(0, 2, "pingpong"), 0, true, 6)).toEqual([0, 1, 2, 1, 0, 1, 2]);
    expect(play(range(0, 2, "pingpong"), 0, false)).toEqual([0, 1, 2, 1, 0]);
    expect(play(range(1, 1, "pingpong"), 1, false)).toEqual([1]);
  });
});

describe("onionSkin: neighbouring frames shown faintly to guide drawing", () => {
  // 3×1 frames; frame f has one opaque pixel at x = f, so we can tell which frame shows through.
  const strip = (frames: number, frame: number): Doc => {
    const one = createFrame(frames, 1);
    return { ...grid(1, frames, 0, frame), layers: [mkLayer("L", Array.from({ length: frames }, (_, f) => paintPoints(one, [[f, 0]], [255, 255, 255, 255])))] };
  };
  const alpha = (f: Frame, x: number) => getPixel(f, x, 0)[3];

  it("is null when there is nothing to show", () => {
    expect(onionSkin(strip(3, 1), 0, 0, 255)).toBeNull();
    expect(onionSkin(strip(1, 0), 2, 2, 255)).toBeNull();
  });

  it("tints frames before red and frames after blue, and leaves out the current frame", () => {
    const o = onionSkin(strip(3, 1), 1, 1, 255)!;
    const [r0, , b0] = getPixel(o, 0, 0);
    const [r2, , b2] = getPixel(o, 2, 0);
    expect(r0).toBeGreaterThan(b0);
    expect(b2).toBeGreaterThan(r2);
    expect(alpha(o, 1)).toBe(0);
  });

  it("fades farther frames and does not wrap past the first or last frame", () => {
    const o = onionSkin(strip(4, 3), 2, 2, 200)!;
    expect(alpha(o, 2)).toBe(200);
    expect(alpha(o, 1)).toBe(100);
    expect(alpha(o, 0)).toBe(0);
  });

  it("shows what the frame looks like, so hidden layers stay hidden", () => {
    const d = strip(2, 1);
    const hidden = { ...d, layers: [{ ...d.layers[0], visible: false }] };
    expect(onionSkin(hidden, 1, 0, 255)!.data.every((b) => b === 0)).toBe(true);
  });
});

describe("spriteSheet", () => {
  it("lays out what each frame looks like left → right, so frame i sits at x = i × width", () => {
    const d = grid(1, 3);
    const sheet = spriteSheet(d);
    expect([sheet.width, sheet.height]).toEqual([6, 2]);
    for (let f = 0; f < 3; f++) expect(getPixel(sheet, f * 2, 0)).toEqual(getPixel(flatten(d, f), 0, 0));
  });

  it("leaves hidden layers out, matching what the user sees on canvas", () => {
    const d = toggleVisible(grid(2, 1), 1);
    expect(spriteSheet(d).data).toEqual(flatten(d, 0).data);
  });
});

describe("addLayerFromCels", () => {
  const cel = (v: number) => paintPoints(blank, [[0, 0]], [v, 0, 0, 255]);

  it("puts cel i in frame (current + i) of a new layer, so existing drawings are never overwritten", () => {
    const d = { ...addFrame(addFrame(setCel(newDoc(2, 2), cel(99)))), frame: 1 };
    const out = addLayerFromCels(d, [cel(1), cel(2)]);
    expect(out.layers).toHaveLength(2);
    expect(out.layers[0].cels.map((c) => getPixel(c, 0, 0)[0])).toEqual([99, 0, 0]);
    expect(out.layers[1].cels.map((c) => getPixel(c, 0, 0)[0])).toEqual([0, 1, 2]);
    expect([out.layer, out.frame]).toEqual([1, 1]);
  });

  it("appends frames when the sheet has more cells than frames left, so no cell is lost", () => {
    const out = addLayerFromCels(newDoc(2, 2), [cel(1), cel(2), cel(3)]);
    expect(frameCount(out)).toBe(3);
    expect(out.durations).toEqual([DEFAULT_DURATION, DEFAULT_DURATION, DEFAULT_DURATION]);
    expect(out.layers[1].cels.map((c) => getPixel(c, 0, 0)[0])).toEqual([1, 2, 3]);
  });
});
