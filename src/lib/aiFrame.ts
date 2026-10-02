// "Generate next frame" (Claude): a frame travels as rows of palette indices, one char per pixel:
// "0"–"f" = palette index, "." = transparent. The request itself runs in Rust (the key never leaves it).
import { invoke } from "@tauri-apps/api/core";
import { createFrame, getPixel, nearestIndex, type Frame, type RGBA } from "./pixels";

// Keeps the grid small enough for the model to reason about pixel by pixel.
export const MAX_AI_SIZE = 64;
const TRANSPARENT_CHAR = ".";
const INDEX_CHARS = "0123456789abcdef";

export const fitsAi = (f: Frame) => f.width <= MAX_AI_SIZE && f.height <= MAX_AI_SIZE;

// Same rule as Import: alpha < 128 → transparent, else the nearest palette color.
export function frameToRows(frame: Frame, palette: readonly RGBA[]): string[] {
  return Array.from({ length: frame.height }, (_, y) =>
    Array.from({ length: frame.width }, (_, x) => {
      const px = getPixel(frame, x, y);
      return px[3] < 128 ? TRANSPARENT_CHAR : INDEX_CHARS[nearestIndex(palette, px)];
    }).join(""),
  );
}

// Throws unless `rows` is exactly width × height of valid chars for this palette.
export function rowsToFrame(rows: unknown, width: number, height: number, palette: readonly RGBA[]): Frame {
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`Hasil AI harus ${height} baris`);
  const out = createFrame(width, height);
  rows.forEach((row, y) => {
    if (typeof row !== "string" || row.length !== width) throw new Error(`Baris ${y + 1} hasil AI harus ${width} karakter`);
    [...row].forEach((ch, x) => {
      if (ch === TRANSPARENT_CHAR) return;
      const i = INDEX_CHARS.indexOf(ch);
      if (i < 0 || i >= palette.length) throw new Error(`Karakter tidak valid "${ch}" di baris ${y + 1}`);
      out.data.set(palette[i], (y * width + x) * 4);
    });
  });
  return out;
}

export const generateNextFrame = (rows: string[], palette: string[], instruction: string) =>
  invoke<unknown>("ai_next_frame", { rows, palette, instruction });
