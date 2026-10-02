<script lang="ts">
  // Failed AI requests: the API's message as is, in the app's own dialog style.
  let { title, text, onclose }: { title: string; text: string; onclose: () => void } = $props();
</script>

<div class="backdrop">
  <div class="dialog" role="alertdialog" aria-label={title}>
    <h3>{title}</h3>
    <p class="error">{text}</p>
    <div class="actions">
      <button onclick={onclose}>Tutup</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: grid; place-items: center; z-index: 10; }
  .dialog { background: #252525; border: 1px solid #444; border-radius: 6px; padding: 12px 16px; min-width: 360px; max-width: 520px; }
  h3 { margin: 0 0 10px; }
  .error { color: #e07070; font-size: 12px; margin: 4px 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; user-select: text; }
  button { background: #333; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
