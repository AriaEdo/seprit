// `.sprt` project files: the Doc as JSON. Cels with identical pixels are stored once in `cels`
// (raw RGBA, base64) and layers refer to them by index, so blank frames cost almost nothing.
import { BLEND_MODES, isValidSize, type Frame } from "./pixels";
import { MAX_DURATION, MIN_DURATION, type Direction, type Doc, type Layer, type Tag } from "./frames";

const VERSION = 1;
const DIRECTIONS: readonly Direction[] = ["forward", "reverse", "pingpong"];

interface SprtFile {
  version: number;
  width: number;
  height: number;
  cels: string[];
  layers: (Omit<Layer, "cels"> & { cels: number[] })[];
  durations: number[];
  tags: Tag[];
}

// btoa/atob work on "binary strings"; chunked so big cels don't overflow the argument list.
function toBase64(bytes: Uint8ClampedArray): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const fromBase64 = (b64: string) => Uint8ClampedArray.from(atob(b64), (c) => c.charCodeAt(0));

export function serializeSprt(doc: Doc): string {
  const { width, height } = doc.layers[0].cels[0];
  const index = new Map<string, number>();
  const ref = (cel: Frame) => {
    const b64 = toBase64(cel.data);
    return index.get(b64) ?? index.set(b64, index.size).get(b64)!;
  };
  const layers = doc.layers.map((l) => ({ ...l, cels: l.cels.map(ref) }));
  const file: SprtFile = { version: VERSION, width, height, cels: [...index.keys()], layers, durations: [...doc.durations], tags: [...doc.tags] };
  return JSON.stringify(file);
}

// Never trust the file: anything malformed throws an Error whose message is shown to the user.
export function parseSprt(text: string): Doc {
  let f: SprtFile;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error("File bukan JSON yang valid");
  }
  const fail = (why: string): never => { throw new Error(`File .sprt rusak: ${why}`); };
  const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

  if (f?.version !== VERSION) fail(`versi ${f?.version} tidak didukung`);
  if (!isValidSize(f.width) || !isValidSize(f.height)) fail("ukuran canvas tidak valid");
  if (!Array.isArray(f.cels) || !Array.isArray(f.layers) || !Array.isArray(f.durations) || !Array.isArray(f.tags)) fail("struktur tidak lengkap");
  if (f.layers.length === 0) fail("tidak ada layer");
  const frames = f.durations.length;
  if (frames === 0) fail("tidak ada frame");
  if (!f.durations.every((ms) => isInt(ms, MIN_DURATION, MAX_DURATION))) fail("durasi frame tidak valid");

  const bytes = f.width * f.height * 4;
  const pool: Frame[] = f.cels.map((b64, i) => {
    let data: Uint8ClampedArray | null = null;
    try { data = fromBase64(b64); } catch { /* reported below */ }
    if (data?.length !== bytes) fail(`data cel ${i} tidak sesuai ukuran canvas`);
    return { width: f.width, height: f.height, data: data! };
  });

  const layers: Layer[] = f.layers.map((l, i) => {
    if (typeof l?.name !== "string" || typeof l.visible !== "boolean" || typeof l.locked !== "boolean") fail(`layer ${i} tidak valid`);
    if (!isInt(l.opacity, 0, 255)) fail(`opacity layer ${i} tidak valid`);
    if (!BLEND_MODES.includes(l.blend)) fail(`blend mode layer ${i} tidak dikenal`);
    if (!Array.isArray(l.cels) || l.cels.length !== frames) fail(`jumlah frame layer ${i} tidak sama`);
    if (!l.cels.every((c) => isInt(c, 0, pool.length - 1))) fail(`indeks cel layer ${i} tidak valid`);
    if (!Array.isArray(l.links) || l.links.length !== frames || !l.links.every((id) => id === null || Number.isInteger(id))) fail(`link layer ${i} tidak valid`);
    return { name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend, cels: l.cels.map((c) => pool[c]), links: [...l.links] };
  });

  const tags: Tag[] = f.tags.map((t, i) => {
    const ok = typeof t?.name === "string" && DIRECTIONS.includes(t.direction) && isInt(t.from, 0, frames - 1) && isInt(t.to, t.from, frames - 1);
    if (!ok) fail(`tag ${i} tidak valid`);
    return { name: t.name, from: t.from, to: t.to, direction: t.direction };
  });
  if (tags.some((a, i) => tags.some((b, j) => i < j && a.from <= b.to && b.from <= a.to))) fail("tag tumpang-tindih");

  return { layers, layer: 0, frame: 0, durations: [...f.durations], tags };
}
