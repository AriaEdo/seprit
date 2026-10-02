export const RULER_SIZE = 20;

// Smallest "nice" pixel step whose labels are at least this far apart on screen.
const MIN_LABEL_GAP_PX = 40;
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200];

export function labelStep(zoom: number): number {
  return STEPS.find((s) => s * zoom >= MIN_LABEL_GAP_PX) ?? STEPS[STEPS.length - 1];
}

// `offset` is where pixel 0 sits relative to the ruler's start, in CSS px.
export function drawRuler(
  el: HTMLCanvasElement,
  axis: "x" | "y",
  length: number,
  offset: number,
  zoom: number,
  count: number,
  highlight?: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = axis === "x" ? length : RULER_SIZE;
  const h = axis === "x" ? RULER_SIZE : length;
  el.width = Math.round(w * dpr);
  el.height = Math.round(h * dpr);
  const ctx = el.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, w, h);

  if (highlight !== undefined && highlight >= 0 && highlight < count) {
    ctx.fillStyle = "rgba(90,160,255,0.35)";
    const p = offset + highlight * zoom;
    if (axis === "x") ctx.fillRect(p, 0, zoom, RULER_SIZE);
    else ctx.fillRect(0, p, RULER_SIZE, zoom);
  }

  const step = labelStep(zoom);
  const minor = Math.max(1, step / 5);
  ctx.strokeStyle = "#777";
  ctx.fillStyle = "#bbb";
  ctx.font = "9px monospace";
  ctx.beginPath();
  for (let i = 0; i <= count; i += minor) {
    const p = Math.round(offset + i * zoom) + 0.5;
    if (p < 0 || p > length) continue;
    const major = i % step === 0;
    const tick = major ? RULER_SIZE : RULER_SIZE / 3;
    if (axis === "x") {
      ctx.moveTo(p, RULER_SIZE); ctx.lineTo(p, RULER_SIZE - tick);
      if (major) ctx.fillText(String(i), p + 2, 9);
    } else {
      ctx.moveTo(RULER_SIZE, p); ctx.lineTo(RULER_SIZE - tick, p);
      if (major) {
        ctx.save();
        ctx.translate(9, p + 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "right";
        ctx.fillText(String(i), 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
}
