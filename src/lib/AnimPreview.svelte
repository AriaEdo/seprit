<script lang="ts">
  import type { Frame } from "./pixels";

  // Real-size view of the active frame (flattened by the page); follows the main Play, so it animates only while playing.
  let { frame: shown }: { frame: Frame } = $props();

  let scale = $state(1);
  let canvas: HTMLCanvasElement;

  $effect(() => {
    canvas.width = shown.width;
    canvas.height = shown.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(shown.data), shown.width, shown.height), 0, 0);
  });
</script>

<div class="preview">
  <div class="bar">
    <span>Preview</span>
    <button onclick={() => (scale = (scale % 3) + 1)} title="Ukuran preview">{scale}×</button>
  </div>
  <canvas bind:this={canvas} style:width="{shown.width * scale}px" style:height="{shown.height * scale}px"></canvas>
</div>

<style>
  .preview { position: absolute; top: 8px; right: 8px; background: #252525; border: 1px solid #444; border-radius: 4px; padding: 4px; z-index: 1; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
  button { background: #333; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 0 6px; cursor: pointer; font-size: 11px; }
  /* Checker shows transparency; pixelated keeps upscaling crisp. */
  canvas { display: block; image-rendering: pixelated; background: repeating-conic-gradient(#3a3a3a 0 25%, #4a4a4a 0 50%) 0 0 / 8px 8px; }
</style>
