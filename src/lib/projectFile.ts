// Native open/save dialogs for .sprt files. Paths picked in the dialog are added to the fs scope by Tauri,
// so the app can only read/write files the user chose.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { sheetJson, sheetSvg } from "./exportFormats";
import { spriteSheet, type Doc } from "./frames";
import type { Frame } from "./pixels";
import { parseSprt, serializeSprt } from "./sprt";

const FILTERS = [{ name: "Seprit", extensions: ["sprt"] }];

// Null when the user cancels the dialog.
export async function openProject(): Promise<{ path: string; doc: Doc } | null> {
  const path = await open({ filters: FILTERS, multiple: false, directory: false });
  if (!path) return null;
  return { path, doc: parseSprt(await readTextFile(path)) };
}

// Writes to `path`, or asks for one first (Save As). Returns the path written, or null when cancelled.
export async function saveProject(doc: Doc, path: string | null): Promise<string | null> {
  const target = path ?? (await save({ filters: FILTERS, defaultPath: "untitled.sprt" }));
  if (!target) return null;
  await writeTextFile(target, serializeSprt(doc));
  return target;
}

const EXPORT_FILTERS = [
  { name: "PNG + JSON", extensions: ["png"] },
  { name: "WebP", extensions: ["webp"] },
  { name: "TGA", extensions: ["tga"] },
  { name: "TIFF", extensions: ["tiff", "tif"] },
  { name: "SVG", extensions: ["svg"] },
];

// Sprite sheet of all frames; the format follows the chosen extension. PNG also writes an
// Aseprite-style .json next to it (frame rects, durations, tags). Returns path written, or null when cancelled.
export async function exportSheet(doc: Doc): Promise<string | null> {
  const target = await save({ filters: EXPORT_FILTERS, defaultPath: "sprite.png" });
  if (!target) return null;
  const ext = target.split(".").pop()!.toLowerCase();
  const sheet = spriteSheet(doc);
  if (ext === "svg") await writeTextFile(target, sheetSvg(sheet));
  else if (ext === "png") {
    await writeFile(target, await encodePng(sheet));
    const image = target.split(/[\\/]/).pop()!;
    await invoke("write_sheet_json", { pngPath: target, json: JSON.stringify(sheetJson(doc, image), null, 2) });
  } else if (["webp", "tga", "tiff", "tif"].includes(ext)) {
    const format = ext === "tif" ? "tiff" : ext;
    const bytes = await invoke<ArrayBuffer>("encode_image", new Uint8Array(sheet.data), { headers: { width: `${sheet.width}`, height: `${sheet.height}`, format } });
    await writeFile(target, new Uint8Array(bytes));
  } else throw new Error(`format .${ext} tidak didukung`);
  return target;
}

async function encodePng(sheet: Frame): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(sheet.width, sheet.height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(sheet.data), sheet.width, sheet.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

// Decodes an image file with the WebView (GIF: first frame only). Returns its full-size pixels, or null when cancelled.
export async function importImage(): Promise<Frame | null> {
  const path = await open({ filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }], multiple: false, directory: false });
  if (!path) return null;
  return decodeImage(new Blob([await readFile(path)]));
}

// PNG/JPG/GIF (first frame)/WebP → RGBA, decoded by the WebView.
export async function decodeImage(blob: Blob): Promise<Frame> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap; // read before close(), which zeroes them
  const ctx = new OffscreenCanvas(width, height).getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}
