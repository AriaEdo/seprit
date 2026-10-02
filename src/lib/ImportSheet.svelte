<script lang="ts">
  import { untrack } from "svelte";
  import { guessGrid, type Frame } from "$lib/pixels";

  // The page slices the sheet and places the cells; this only asks for the grid.
  let { sheet, onimport, onclose }: { sheet: Frame; onimport: (cols: number, rows: number, trim: boolean) => void; onclose: () => void } = $props();

  // The dialog is recreated per import, so the guess only needs computing once.
  const guess = untrack(() => guessGrid(sheet));
  let cols = $state(guess.cols);
  let rows = $state(guess.rows);
  let trim = $state(true);
  // The guess fails when sprites touch or sit on an opaque grid/background; a long 1 × 1 image is likely a strip.
  const suspect = untrack(() => guess.cols === 1 && guess.rows === 1 && Math.max(sheet.width, sheet.height) >= 2 * Math.min(sheet.width, sheet.height));
  const valid = $derived(Number.isInteger(cols) && Number.isInteger(rows) && cols >= 1 && rows >= 1 && cols <= sheet.width && rows <= sheet.height);
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-label="Import Image">
    <h3>Import Image</h3>
    <p class="note">Gambar {sheet.width} × {sheet.height} px lebih besar dari canvas. Jika ini sprite sheet, isi jumlah kolom × baris; 1 × 1 = satu gambar.</p>
    {#if suspect}
      <p class="warn">Grid tidak terdeteksi otomatis (sprite bersentuhan atau ada garis/latar opaque). Gambar ini memanjang, mungkin sprite sheet — isi jumlah kolom/baris secara manual.</p>
    {/if}
    <label>Kolom <input type="number" min="1" max={sheet.width} bind:value={cols} /></label>
    <label>Baris <input type="number" min="1" max={sheet.height} bind:value={rows} /></label>
    <label class="check"><input type="checkbox" bind:checked={trim} /> Buang ruang transparan di sekeliling sprite</label>
    {#if valid}
      <p class="note">{cols * rows} frame, tiap sel {Math.floor(sheet.width / cols)} × {Math.floor(sheet.height / rows)} px. Masuk sebagai layer baru mulai frame aktif.</p>
    {/if}
    <div class="actions">
      <button onclick={onclose}>Tutup</button>
      <button class="primary" onclick={() => onimport(cols, rows, trim)} disabled={!valid}>Import</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: grid; place-items: center; z-index: 10; }
  .dialog { background: #252525; border: 1px solid #444; border-radius: 6px; padding: 12px 16px; min-width: 360px; }
  h3 { margin: 0 0 10px; }
  label { display: inline-flex; gap: 6px; align-items: center; margin-right: 12px; }
  .check { display: flex; margin: 6px 0 0; }
  .check input { width: auto; }
  input { width: 64px; background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 2px 4px; }
  button { background: #333; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
  button:hover:not(:disabled) { background: #3d3d3d; border-color: #666; }
  button:active:not(:disabled) { background: #2a2a2a; transform: translateY(1px); }
  button:focus-visible { outline: 2px solid #5a8ad6; outline-offset: 1px; }
  button.primary { background: #3d6bb3; border-color: #5a8ad6; color: #fff; }
  button.primary:hover:not(:disabled) { background: #4a7bc6; border-color: #7aa3e3; }
  button.primary:active:not(:disabled) { background: #335c9c; }
  button:disabled { opacity: 0.4; cursor: default; }
  .warn { color: #e0b050; font-size: 12px; margin: 4px 0; }
  .note { color: #888; font-size: 12px; margin: 4px 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
