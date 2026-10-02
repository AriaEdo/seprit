<script lang="ts">
  import { getSpriteProvider } from "$lib/aiKeys";

  // The page owns the prompt (kept for a retry) and runs the request; errors show in its ErrorDialog.
  let { prompt = $bindable(), busy, ongenerate, onclose }: { prompt: string; busy: boolean; ongenerate: () => void; onclose: () => void } = $props();

  const provider = getSpriteProvider() === "gemini" ? "Gemini" : "OpenAI";
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-label="Generate Sprite">
    <h3>Generate Sprite</h3>
    <textarea rows="4" placeholder="Contoh: knight kecil dengan pedang, menghadap kanan" bind:value={prompt} disabled={busy}></textarea>
    <p class="note">Provider: {provider} (ubah di AI Settings…). Hasil masuk sebagai layer baru di frame aktif.</p>
    <div class="actions">
      <button onclick={onclose}>Tutup</button>
      <button onclick={ongenerate} disabled={busy || !prompt.trim()}>{busy ? "Generating…" : "Generate"}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: grid; place-items: center; z-index: 10; }
  .dialog { background: #252525; border: 1px solid #444; border-radius: 6px; padding: 12px 16px; min-width: 520px; }
  h3 { margin: 0 0 10px; }
  textarea { width: 100%; box-sizing: border-box; background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 4px 6px; resize: vertical; }
  button { background: #333; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  .note { color: #888; font-size: 12px; margin: 4px 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
