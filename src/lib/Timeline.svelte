<script lang="ts">
  import { frameCount, type Doc } from "./frames";
  import type { Frame } from "./pixels";

  interface Props {
    doc: Doc;
    onselect: (layer: number, frame: number) => void;
    onmoveframe: (from: number, to: number) => void;
    onmovelayer: (from: number, to: number) => void;
    ontoggle: (layer: number) => void;
    onlock: (layer: number) => void;
    onrename: (layer: number, name: string) => void;
  }

  let { doc, onselect, onmoveframe, onmovelayer, ontoggle, onlock, onrename }: Props = $props();

  // Pointer-based reorder: HTML5 drag-and-drop is swallowed by Tauri's window drop handler on Windows.
  let drag = $state<{ kind: "frame" | "layer"; from: number; over: number } | null>(null);
  let renaming = $state<number | null>(null);

  const frames = $derived(Array.from({ length: frameCount(doc) }, (_, i) => i));
  // Top layer first, as in Aseprite; `doc.layers` is stored bottom → top.
  const rows = $derived(doc.layers.map((layer, i) => ({ layer, i })).toReversed());

  // Cels are immutable, so emptiness is cached per object.
  const emptyCache = new WeakMap<Frame, boolean>();
  function isEmpty(cel: Frame) {
    let empty = emptyCache.get(cel);
    if (empty === undefined) emptyCache.set(cel, (empty = cel.data.every((b) => b === 0)));
    return empty;
  }

  function startDrag(e: PointerEvent, kind: "frame" | "layer", i: number) {
    if (e.button !== 0) return;
    if (kind === "frame") onselect(doc.layer, i);
    else onselect(i, doc.frame);
    drag = { kind, from: i, over: i };
  }

  function onpointerup() {
    if (drag?.kind === "frame") onmoveframe(drag.from, drag.over);
    else if (drag?.kind === "layer") onmovelayer(drag.from, drag.over);
    drag = null;
  }

  // Enter and blur both commit; clearing `renaming` first stops the blur from committing a second time.
  function commitRename(i: number, name: string) {
    if (renaming !== i) return;
    renaming = null;
    onrename(i, name);
  }

  function onrenamekey(e: KeyboardEvent, i: number) {
    if (e.key === "Enter") commitRename(i, e.currentTarget instanceof HTMLInputElement ? e.currentTarget.value : "");
    else if (e.key === "Escape") renaming = null;
  }

  // Arrows move the active cel; ↑ is the layer above, since `doc.layers` is stored bottom → top.
  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
    if (e.key === "ArrowLeft") onselect(doc.layer, clamp(doc.frame - 1, frames.length - 1));
    else if (e.key === "ArrowRight") onselect(doc.layer, clamp(doc.frame + 1, frames.length - 1));
    else if (e.key === "ArrowUp") onselect(clamp(doc.layer + 1, doc.layers.length - 1), doc.frame);
    else if (e.key === "ArrowDown") onselect(clamp(doc.layer - 1, doc.layers.length - 1), doc.frame);
    else return;
    e.preventDefault();
  }

  // Keeps the active cel visible when it moves off-screen (arrows, playback). Effects run after the DOM update.
  let el: HTMLDivElement;
  $effect(() => {
    void [doc.layer, doc.frame];
    el.querySelector(".cel.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  const isDrop = (kind: "frame" | "layer", i: number) => drag?.kind === kind && drag.over === i && drag.from !== i;
</script>

<svelte:window {onpointerup} />

<div class="timeline" bind:this={el} role="grid" tabindex="0" {onkeydown} class:dragging={drag !== null} style:--frames={frames.length}>
  <div class="tags">
    <div class="tags-label">Tags</div>
    {#each doc.tags as t, i (i)}
      <button
        class="tag"
        class:active={t.from <= doc.frame && doc.frame <= t.to}
        style:grid-column="{t.from + 2} / {t.to + 3}"
        onpointerdown={() => onselect(doc.layer, t.from)}
        title="{t.name} ({t.direction})"
      >{t.name}</button>
    {/each}
  </div>
  <div class="corner"></div>
  {#each frames as f (f)}
    <div
      class="frame-head"
      role="button"
      tabindex="-1"
      class:active={f === doc.frame}
      class:drop={isDrop("frame", f)}
      onpointerdown={(e) => startDrag(e, "frame", f)}
      onpointerenter={() => { if (drag?.kind === "frame") drag.over = f; }}
      title="{doc.durations[f]} ms"
    >{f + 1}</div>
  {/each}

  {#each rows as { layer, i } (i)}
    <div
      class="layer"
      role="button"
      tabindex="-1"
      class:active={i === doc.layer}
      class:drop={isDrop("layer", i)}
      onpointerdown={(e) => startDrag(e, "layer", i)}
      onpointerenter={() => { if (drag?.kind === "layer") drag.over = i; }}
      ondblclick={() => (renaming = i)}
    >
      <button
        class="eye"
        class:hidden={!layer.visible}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => ontoggle(i)}
        title={layer.visible ? "Sembunyikan layer" : "Tampilkan layer"}
      ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg></button>
      <button
        class="eye"
        class:hidden={!layer.locked}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => onlock(i)}
        title={layer.locked ? "Buka kunci layer" : "Kunci layer"}
      ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></button>
      {#if renaming === i}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          value={layer.name}
          autofocus
          onfocus={(e) => e.currentTarget.select()}
          onpointerdown={(e) => e.stopPropagation()}
          onkeydown={(e) => onrenamekey(e, i)}
          onblur={(e) => commitRename(i, e.currentTarget.value)}
        />
      {:else}
        <span class="name" title="Double-click untuk rename">{layer.name}</span>
      {/if}
    </div>
    {#each layer.cels as cel, f (f)}
      <button
        class="cel"
        class:active={i === doc.layer && f === doc.frame}
        class:column={f === doc.frame}
        class:dim={!layer.visible}
        onpointerdown={() => onselect(i, f)}
        aria-label="Layer {layer.name}, frame {f + 1}"
        class:linked={layer.links[f] !== null}
        title={layer.links[f] !== null ? "Cel tertaut" : undefined}
      >{isEmpty(cel) ? "" : "●"}</button>
    {/each}
  {/each}
</div>

<style>
  .timeline {
    display: grid;
    grid-template-columns: 160px repeat(var(--frames), 28px);
    grid-auto-rows: 24px;
    gap: 1px;
    padding: 6px;
    overflow: auto;
    max-height: 160px;
    user-select: none;
    font: 11px monospace;
    /* Sticky frame-number row (24px) and layer-name column (160px) would otherwise cover a cel scrolled into view. */
    scroll-padding: 26px 0 0 162px;
  }
  .tags { grid-column: 1 / -1; display: grid; grid-template-columns: inherit; gap: 1px; }
  .tags-label { grid-column: 1; padding: 0 4px; align-self: center; color: #888; }
  .tag { grid-row: 1; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #4a3f6b; border: 1px solid #6b5a9c; border-radius: 3px; color: #ddd; font: inherit; cursor: pointer; }
  .tag.active { background: #6b5a9c; }
  .corner { position: sticky; left: 0; top: 0; z-index: 2; background: #252525; }
  .frame-head { position: sticky; top: 0; z-index: 1; display: grid; place-items: center; background: #2c2c2c; color: #aaa; cursor: pointer; }
  .layer { position: sticky; left: 0; z-index: 1; display: flex; align-items: center; gap: 4px; padding: 0 4px; background: #2c2c2c; cursor: pointer; overflow: hidden; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layer input { min-width: 0; flex: 1; background: #1a1a1a; color: #ddd; border: 1px solid #5a8ad6; font: inherit; padding: 1px 3px; }
  .eye { padding: 0 2px; background: none; border: none; color: #fff; font-size: 11px; cursor: pointer; }
  .eye.hidden { opacity: 0.25; }
  .cel { padding: 0; background: #333; border: 1px solid transparent; border-radius: 0; color: #ddd; font-size: 10px; cursor: pointer; }
  .cel.column, .frame-head.active, .layer.active { background: #3a3f4a; }
  .cel.active { border-color: #5a8ad6; }
  .cel.dim { color: #666; }
  .cel.linked { color: #e0b84a; box-shadow: inset 0 -2px #e0b84a; }
  .drop { outline: 2px solid #e0b84a; outline-offset: -2px; }
  .dragging, .dragging * { cursor: grabbing; }
</style>
