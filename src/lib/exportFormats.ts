// Export formats built in TS: Aseprite-style JSON next to the sprite sheet, and SVG.
// WebP/TGA/TIFF are encoded in Rust (src-tauri/src/encode.rs) since the WebView can't write them.
import { currentCel, frameCount, type Direction, type Doc } from "./frames";
import { getPixel, rgbaToHex, type Frame } from "./pixels";

interface Rect { x: number; y: number; w: number; h: number }

// Aseprite "JSON array" layout, read by Phaser, PixiJS, Godot/Unity importers and others.
export interface SheetJson {
  frames: { filename: string; frame: Rect; rotated: false; trimmed: false; spriteSourceSize: Rect; sourceSize: { w: number; h: number }; duration: number }[];
  meta: { app: string; image: string; format: "RGBA8888"; size: { w: number; h: number }; scale: "1"; frameTags: { name: string; from: number; to: number; direction: Direction }[] };
}

// Matches `spriteSheet`: one row, frame i at x = i × width.
export function sheetJson(doc: Doc, image: string): SheetJson {
  const { width: w, height: h } = currentCel(doc);
  const base = image.replace(/\.[^.]*$/, "");
  return {
    frames: doc.durations.map((duration, i) => ({
      filename: `${base} ${i}`,
      frame: { x: i * w, y: 0, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      duration,
    })),
    meta: {
      app: "Seprit",
      image,
      format: "RGBA8888",
      size: { w: w * frameCount(doc), h },
      scale: "1",
      frameTags: doc.tags.map(({ name, from, to, direction }) => ({ name, from, to, direction })),
    },
  };
}

// One rect per horizontal run of the same color; transparent pixels are skipped.
export function sheetSvg(frame: Frame): string {
  const rects: string[] = [];
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; ) {
      const [r, g, b, a] = getPixel(frame, x, y);
      let end = x + 1;
      while (end < frame.width && getPixel(frame, end, y).every((v, i) => v === [r, g, b, a][i])) end++;
      if (a > 0) {
        const opacity = a < 255 ? ` fill-opacity="${+(a / 255).toFixed(3)}"` : "";
        rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${rgbaToHex([r, g, b, a])}"${opacity}/>`);
      }
      x = end;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" shape-rendering="crispEdges">\n${rects.join("\n")}\n</svg>\n`;
}
