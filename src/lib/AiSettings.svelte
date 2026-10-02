<script lang="ts">
  import {
    deleteKey, getSpriteProvider, keyStatus, setKey, setSpriteProvider,
    type KeyStatus, type Provider, type SpriteProvider,
  } from "$lib/aiKeys";

  let { onclose }: { onclose: () => void } = $props();

  const PROVIDERS: { id: Provider; label: string }[] = [
    { id: "anthropic", label: "Anthropic (Claude)" },
    { id: "openai", label: "OpenAI" },
    { id: "gemini", label: "Gemini" },
  ];

  let status = $state<KeyStatus | null>(null);
  let inputs = $state<Record<Provider, string>>({ anthropic: "", openai: "", gemini: "" });
  let spriteProvider = $state<SpriteProvider>(getSpriteProvider());
  let error = $state("");
  let busy = $state(false);

  async function run(action: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await action();
      status = await keyStatus();
    } catch (err) {
      error = String(err);
    } finally {
      busy = false;
    }
  }

  // Initial status load.
  run(async () => {});

  function save(p: Provider) {
    run(async () => {
      await setKey(p, inputs[p]);
      inputs[p] = "";
    });
  }
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-label="AI Settings">
    <h3>AI Settings</h3>
    {#each PROVIDERS as p (p.id)}
      <div class="row">
        <span class="label">{p.label}</span>
        <span class="status">{status === null ? "…" : status[p.id] ? "tersimpan ✓" : "kosong"}</span>
        <input type="password" placeholder="API key baru" autocomplete="off" bind:value={inputs[p.id]} />
        <button onclick={() => save(p.id)} disabled={busy || !inputs[p.id].trim()}>Simpan</button>
        <button onclick={() => run(() => deleteKey(p.id))} disabled={busy || !status?.[p.id]}>Hapus</button>
      </div>
    {/each}
    <div class="row">
      <span class="label">Provider sprite</span>
      <select bind:value={spriteProvider} onchange={() => setSpriteProvider(spriteProvider)}>
        <option value="openai">OpenAI</option>
        <option value="gemini">Gemini</option>
      </select>
    </div>
    <p class="note">Key disimpan di Keychain OS, tidak di file proyek.</p>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions"><button onclick={onclose}>Tutup</button></div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: grid; place-items: center; z-index: 10; }
  .dialog { background: #252525; border: 1px solid #444; border-radius: 6px; padding: 12px 16px; min-width: 520px; }
  h3 { margin: 0 0 10px; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .label { width: 140px; }
  .status { width: 80px; color: #aaa; font-size: 12px; }
  input { flex: 1; background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 3px 6px; }
  button { background: #333; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  select { background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 2px 4px; }
  .note { color: #888; font-size: 12px; margin: 4px 0; }
  .error { color: #f77; margin: 4px 0; }
  .actions { display: flex; justify-content: flex-end; }
</style>
