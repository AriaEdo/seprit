// Pure edits on the animation document: a grid of layers × frames where each cell (cel) is a Frame.
// Every layer has one cel per frame and all cels share one size.
import { composite, createFrame, tintFrame, type BlendMode, type Frame, type RGBA } from "./pixels";

export interface Layer {
  readonly name: string;
  readonly visible: boolean;
  // Locked layers are shown but can't be drawn on.
  readonly locked: boolean;
  readonly opacity: number; // 0–255
  readonly blend: BlendMode;
  readonly cels: readonly Frame[];
  // Parallel to `cels`: cels with the same id are linked (one drawing shown in several frames); null = unlinked.
  // Object identity can't mean "linked" because blank cels are shared too.
  readonly links: readonly (number | null)[];
}

export type Direction = "forward" | "reverse" | "pingpong";

// The frames playback loops over.
export interface PlayRange {
  readonly from: number; // inclusive
  readonly to: number; // inclusive
  readonly direction: Direction;
}

// A named animation inside the timeline. Tags never overlap, so a frame belongs to at most one.
export interface Tag extends PlayRange {
  readonly name: string;
}

export interface Doc {
  // Bottom → top: later layers draw over earlier ones.
  readonly layers: readonly Layer[];
  readonly layer: number;
  readonly frame: number;
  // Per frame, in ms.
  readonly durations: readonly number[];
  readonly tags: readonly Tag[];
}

export const DEFAULT_DURATION = 125;
export const MIN_DURATION = 1;
export const MAX_DURATION = 65535;

const newLayer = (name: string, cels: readonly Frame[]): Layer =>
  ({ name, visible: true, locked: false, opacity: 255, blend: "normal", cels, links: cels.map(() => null) });

export function newDoc(width: number, height: number): Doc {
  return { layers: [newLayer("Layer 1", [createFrame(width, height)])], layer: 0, frame: 0, durations: [DEFAULT_DURATION], tags: [] };
}

export const frameCount = (doc: Doc) => doc.layers[0].cels.length;
export const currentCel = (doc: Doc) => doc.layers[doc.layer].cels[doc.frame];

const blankLike = (doc: Doc) => createFrame(currentCel(doc).width, currentCel(doc).height);

function withLayer(doc: Doc, i: number, patch: Partial<Layer>): Doc {
  return { ...doc, layers: doc.layers.with(i, { ...doc.layers[i], ...patch }) };
}

type Links = Layer["links"];

// Edits every layer's column; `links` must get the matching edit so it stays aligned with `cels`.
function mapColumns(doc: Doc, cels: (c: readonly Frame[]) => readonly Frame[], links: (l: Links) => Links = (l) => l): readonly Layer[] {
  return doc.layers.map((l) => ({ ...l, cels: cels(l.cels), links: dropLonelyLinks(links(l.links)) }));
}

// A link group with one member left links nothing.
function dropLonelyLinks(links: Links): Links {
  const count = new Map<number, number>();
  for (const id of links) if (id !== null) count.set(id, (count.get(id) ?? 0) + 1);
  return links.map((id) => (id !== null && count.get(id) === 1 ? null : id));
}

export const isLinked = (layer: Layer, frame: number) => layer.links[frame] !== null;

// Writing to a linked cel writes to every frame it is linked with.
export function setCel(doc: Doc, cel: Frame): Doc {
  const { cels, links } = doc.layers[doc.layer];
  const id = links[doc.frame];
  return withLayer(doc, doc.layer, { cels: cels.map((c, f) => (f === doc.frame || (id !== null && links[f] === id) ? cel : c)) });
}

// Timing for a frame inserted at `at`, right after frame at - 1: a tag ending at at - 1 grows to include it.
function insertTiming(doc: Doc, at: number, duration: number): Pick<Doc, "durations" | "tags"> {
  const tags = doc.tags.map((t) => ({ ...t, from: t.from >= at ? t.from + 1 : t.from, to: t.to >= at - 1 ? t.to + 1 : t.to }));
  return { durations: doc.durations.toSpliced(at, 0, duration), tags };
}

// Frames are immutable, so one blank cel can be shared by every layer.
export function addFrame(doc: Doc): Doc {
  const at = doc.frame + 1;
  const blank = blankLike(doc);
  const layers = mapColumns(doc, (c) => c.toSpliced(at, 0, blank), (l) => l.toSpliced(at, 0, null));
  return { ...doc, ...insertTiming(doc, at, DEFAULT_DURATION), layers, frame: at };
}

export function duplicateFrame(doc: Doc): Doc {
  const at = doc.frame + 1;
  const layers = mapColumns(doc, (c) => c.toSpliced(at, 0, c[doc.frame]), (l) => l.toSpliced(at, 0, null));
  return { ...doc, ...insertTiming(doc, at, doc.durations[doc.frame]), layers, frame: at };
}

// Like duplicateFrame, but each new cel stays linked to the one it was copied from.
export function duplicateLinked(doc: Doc): Doc {
  const at = doc.frame + 1;
  const layers = doc.layers.map((l) => {
    const id = l.links[doc.frame] ?? Math.max(-1, ...l.links.map((x) => x ?? -1)) + 1;
    return { ...l, cels: l.cels.toSpliced(at, 0, l.cels[doc.frame]), links: l.links.with(doc.frame, id).toSpliced(at, 0, id) };
  });
  return { ...doc, ...insertTiming(doc, at, doc.durations[doc.frame]), layers, frame: at };
}

export function unlinkCel(doc: Doc): Doc {
  const { links } = doc.layers[doc.layer];
  if (links[doc.frame] === null) return doc;
  return withLayer(doc, doc.layer, { links: dropLonelyLinks(links.with(doc.frame, null)) });
}

export function deleteFrame(doc: Doc): Doc {
  if (frameCount(doc) === 1) return doc;
  const f = doc.frame;
  const layers = mapColumns(doc, (c) => c.toSpliced(f, 1), (l) => l.toSpliced(f, 1));
  const tags = doc.tags
    .filter((t) => t.from !== f || t.to !== f)
    .map((t) => ({ ...t, from: t.from > f ? t.from - 1 : t.from, to: t.to >= f ? t.to - 1 : t.to }));
  return { ...doc, layers, durations: doc.durations.toSpliced(f, 1), tags, frame: Math.min(f, layers[0].cels.length - 1) };
}

// Tags keep their positions; the dragged frame's duration goes with it.
export function moveFrame(doc: Doc, from: number, to: number): Doc {
  if (from === to) return doc;
  const move = <T>(xs: readonly T[]) => xs.toSpliced(from, 1).toSpliced(to, 0, xs[from]);
  return { ...doc, layers: mapColumns(doc, move, move), durations: move(doc.durations), frame: to };
}

export function addLayer(doc: Doc): Doc {
  const at = doc.layer + 1;
  const blank = blankLike(doc);
  const layer = newLayer(`Layer ${doc.layers.length + 1}`, Array(frameCount(doc)).fill(blank));
  return { ...doc, layers: doc.layers.toSpliced(at, 0, layer), layer: at };
}

// New layer above the active one with cel i in frame (current + i); frames are appended when cels run past
// the end. Ends on the starting frame.
export function addLayerFromCels(doc: Doc, cels: readonly Frame[]): Doc {
  let next = addLayer(doc);
  cels.forEach((cel, i) => {
    if (i > 0) next = next.frame + 1 < frameCount(next) ? { ...next, frame: next.frame + 1 } : addFrame(next);
    next = setCel(next, cel);
  });
  return { ...next, frame: doc.frame };
}

export function deleteLayer(doc: Doc): Doc {
  if (doc.layers.length === 1) return doc;
  const layers = doc.layers.toSpliced(doc.layer, 1);
  return { ...doc, layers, layer: Math.min(doc.layer, layers.length - 1) };
}

export function moveLayer(doc: Doc, from: number, to: number): Doc {
  if (from === to) return doc;
  return { ...doc, layers: doc.layers.toSpliced(from, 1).toSpliced(to, 0, doc.layers[from]), layer: to };
}

export function renameLayer(doc: Doc, i: number, name: string): Doc {
  const trimmed = name.trim();
  if (!trimmed || trimmed === doc.layers[i].name) return doc;
  return withLayer(doc, i, { name: trimmed });
}

export const toggleVisible = (doc: Doc, i: number): Doc => withLayer(doc, i, { visible: !doc.layers[i].visible });
export const toggleLocked = (doc: Doc, i: number): Doc => withLayer(doc, i, { locked: !doc.layers[i].locked });
export const setBlend = (doc: Doc, i: number, blend: BlendMode): Doc => withLayer(doc, i, { blend });

export function setOpacity(doc: Doc, i: number, opacity: number): Doc {
  const clamped = Number.isFinite(opacity) ? Math.round(Math.min(255, Math.max(0, opacity))) : doc.layers[i].opacity;
  return clamped === doc.layers[i].opacity ? doc : withLayer(doc, i, { opacity: clamped });
}

// Hidden layers can't be edited either: the user couldn't see what they're drawing.
export const isEditable = (layer: Layer) => layer.visible && !layer.locked;

// Canvas-wide edits (resize/crop). Memoized per cel so shared cels stay shared.
export function mapCels(doc: Doc, fn: (cel: Frame) => Frame): Doc {
  const done = new Map<Frame, Frame>();
  const once = (c: Frame) => done.get(c) ?? done.set(c, fn(c)).get(c)!;
  return { ...doc, layers: mapColumns(doc, (c) => c.map(once)) };
}

// What the frame looks like: visible layers composited bottom → top.
// Last result per frame index with its inputs. Cels are immutable, so matching references mean the same
// image: a stroke recomputes only its own frame, not the onion-skin neighbours. Results must not be mutated.
const flattenCache = new Map<number, { width: number; height: number; inputs: (Frame | number | BlendMode)[]; out: Frame }>();

export function flatten(doc: Doc, frame: number): Frame {
  const { width, height } = doc.layers[0].cels[frame];
  const visible = doc.layers.filter((l) => l.visible);
  const inputs = visible.flatMap((l) => [l.cels[frame], l.opacity, l.blend]);
  const hit = flattenCache.get(frame);
  if (hit && hit.width === width && hit.height === height && hit.inputs.length === inputs.length && hit.inputs.every((x, i) => x === inputs[i])) {
    return hit.out;
  }
  // A fully opaque bottom layer composited onto nothing is just its cel, whatever the blend mode.
  const [bottom, ...rest] = visible;
  const start = bottom?.opacity === 255 ? bottom.cels[frame] : blankLike(doc);
  const out = (start === bottom?.cels[frame] ? rest : visible).reduce((acc, l) => composite(acc, l.cels[frame], l.opacity, l.blend), start);
  flattenCache.set(frame, { width, height, inputs, out });
  return out;
}

// Export: every frame as it looks (flattened), in one row left → right.
export function spriteSheet(doc: Doc): Frame {
  const { width, height } = currentCel(doc);
  const sheet = createFrame(width * frameCount(doc), height);
  // Copied row by row into one buffer: pasting would copy the whole sheet once per frame.
  for (let f = 0; f < frameCount(doc); f++) {
    const { data } = flatten(doc, f);
    for (let y = 0; y < height; y++) sheet.data.set(data.subarray(y * width * 4, (y + 1) * width * 4), (y * sheet.width + f * width) * 4);
  }
  return sheet;
}

const ONION_BEFORE: RGBA = [255, 0, 0, 255];
const ONION_AFTER: RGBA = [0, 0, 255, 255];

// Up to `before`/`after` neighbouring frames (no wrap-around), tinted red/blue and merged into one
// frame to draw under the current one. Frame d steps away gets opacity / d. Null when there is none.
// Last result with its inputs: during a stroke only the current frame changes, so the neighbours'
// flatten() results keep their identity and the merge can be reused. Results must not be mutated.
let onionCache: { inputs: (Frame | RGBA | number)[]; out: Frame } | null = null;

export function onionSkin(doc: Doc, before: number, after: number, opacity: number): Frame | null {
  const shown: { frame: number; d: number; tint: RGBA }[] = [];
  for (let d = 1; d <= before && doc.frame - d >= 0; d++) shown.push({ frame: doc.frame - d, d, tint: ONION_BEFORE });
  for (let d = 1; d <= after && doc.frame + d < frameCount(doc); d++) shown.push({ frame: doc.frame + d, d, tint: ONION_AFTER });
  if (shown.length === 0) return null;
  const flat = shown.map((s) => flatten(doc, s.frame));
  const inputs = [opacity, ...shown.flatMap((s, i) => [s.d, s.tint, flat[i]])];
  if (onionCache && onionCache.inputs.length === inputs.length && onionCache.inputs.every((x, i) => x === inputs[i])) return onionCache.out;
  // Farthest first, so nearer frames draw on top.
  const out = shown
    .map((s, i) => ({ ...s, flat: flat[i] }))
    .toSorted((a, b) => b.d - a.d)
    .reduce((acc, s) => composite(acc, tintFrame(s.flat, s.tint), Math.round(opacity / s.d)), blankLike(doc));
  onionCache = { inputs, out };
  return out;
}

const clampDuration = (ms: number) => Math.round(Math.min(MAX_DURATION, Math.max(MIN_DURATION, ms)));

export function setDuration(doc: Doc, frame: number, ms: number): Doc {
  if (!Number.isFinite(ms) || clampDuration(ms) === doc.durations[frame]) return doc;
  return { ...doc, durations: doc.durations.with(frame, clampDuration(ms)) };
}

export function setAllDurations(doc: Doc, ms: number): Doc {
  if (!Number.isFinite(ms)) return doc;
  return { ...doc, durations: doc.durations.map(() => clampDuration(ms)) };
}

// Index of the tag covering `frame`, or -1.
export const tagAt = (doc: Doc, frame: number) => doc.tags.findIndex((t) => t.from <= frame && frame <= t.to);

export function addTag(doc: Doc): Doc {
  if (tagAt(doc, doc.frame) !== -1) return doc;
  const tag: Tag = { name: `Tag ${doc.tags.length + 1}`, from: doc.frame, to: doc.frame, direction: "forward" };
  return { ...doc, tags: [...doc.tags, tag] };
}

// Invalid edits (empty name, from > to, overlapping another tag) leave the doc unchanged.
export function updateTag(doc: Doc, i: number, patch: Partial<Tag>): Doc {
  const last = frameCount(doc) - 1;
  const clampFrame = (f: number) => Math.round(Math.min(last, Math.max(0, f)));
  const old = doc.tags[i];
  const name = patch.name?.trim() || old.name;
  const from = Number.isFinite(patch.from) ? clampFrame(patch.from!) : old.from;
  const to = Number.isFinite(patch.to) ? clampFrame(patch.to!) : old.to;
  const tag: Tag = { name, from, to, direction: patch.direction ?? old.direction };
  const overlaps = doc.tags.some((t, j) => j !== i && t.from <= to && from <= t.to);
  if (from > to || overlaps || (Object.keys(tag) as (keyof Tag)[]).every((k) => tag[k] === old[k])) return doc;
  return { ...doc, tags: doc.tags.with(i, tag) };
}

export const deleteTag = (doc: Doc, i: number): Doc => ({ ...doc, tags: doc.tags.toSpliced(i, 1) });

// Playback loops over the tag under the current frame, or the whole timeline when there is none.
export function playRange(doc: Doc): PlayRange {
  const t = doc.tags[tagAt(doc, doc.frame)];
  return t ? { from: t.from, to: t.to, direction: t.direction } : { from: 0, to: frameCount(doc) - 1, direction: "forward" };
}

// Next frame during playback, or null when a non-looping animation has ended.
// `backward` is the pingpong phase; one round trip (from → to → from) counts as one loop.
export function nextFrame(current: number, { from, to, direction }: PlayRange, loop: boolean, backward = false): { frame: number; backward: boolean } | null {
  const go = (frame: number, back = false) => ({ frame, backward: back });
  if (direction === "forward") return current < to ? go(current + 1) : loop ? go(from) : null;
  if (direction === "reverse") return current > from ? go(current - 1) : loop ? go(to) : null;
  if (from === to) return loop ? go(from) : null;
  if (!backward) return current < to ? go(current + 1) : go(current - 1, true);
  if (current > from) return go(current - 1, true);
  return loop ? go(current + 1) : null;
}
