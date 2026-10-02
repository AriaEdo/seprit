<script lang="ts">
  import PixelCanvas, { type Tool } from "$lib/PixelCanvas.svelte";
  import {
    BLEND_MODES, clearRegion, copyRegion, floodFill, hexToRgba, TRANSPARENT, imageToCel, isValidSize, MAX_SIZE, MIN_SIZE, pasteFrame, removeGridLines, resizeFrame, rgbaToHex, sliceSheet, trimCells,
    type BlendMode, type Frame, type Rect,
  } from "$lib/pixels";
  import { canRedo, canUndo, emptyHistory, record, redo, undo } from "$lib/history";
  import Timeline from "$lib/Timeline.svelte";
  import AiSettings from "$lib/AiSettings.svelte";
  import GenerateSprite from "$lib/GenerateSprite.svelte";
  import ErrorDialog from "$lib/ErrorDialog.svelte";
  import ImportSheet from "$lib/ImportSheet.svelte";
  import AnimPreview from "$lib/AnimPreview.svelte";
  import { generateSprite, getSpriteProvider } from "$lib/aiKeys";
  import { fitsAi, frameToRows, generateNextFrame, MAX_AI_SIZE, rowsToFrame } from "$lib/aiFrame";
  import { decodeImage, exportSheet as exportSheetFile, importImage, openProject, saveProject } from "$lib/projectFile";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { setupAppMenu } from "$lib/appMenu";
  import {
    addFrame, addLayer, addLayerFromCels, currentCel, deleteFrame, deleteLayer, duplicateFrame, duplicateLinked, isLinked, flatten, frameCount, mapCels, moveFrame,
    isEditable, moveLayer, newDoc, nextFrame, renameLayer, setBlend, setCel, setOpacity, toggleLocked, toggleVisible, unlinkCel,
    addTag, deleteTag, onionSkin, playRange, setAllDurations, setDuration, tagAt, updateTag, MAX_DURATION, MIN_DURATION,
    type Direction, type Doc, type PlayRange,
  } from "$lib/frames";

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 64;
  const DEFAULT_SIZE = 32;
  const DEFAULT_FPS = 8;
  const MIN_FPS = 1;
  const MAX_FPS = 60;
  const DIRECTIONS: Direction[] = ["forward", "reverse", "pingpong"];
  const MAX_ONION = 5;
  const BG_TOLERANCE = 24;
  // PICO-8 palette: small, well-known default for pixel art.
  const PALETTE = [
    "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
    "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
  ];
  const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
    { id: "pencil", icon: "✏️", label: "Pencil", key: "b" },
    { id: "eraser", icon: "🧽", label: "Eraser", key: "e" },
    { id: "line", icon: "╱", label: "Garis", key: "l" },
    { id: "rect", icon: "▭", label: "Kotak", key: "u" },
    { id: "ellipse", icon: "◯", label: "Lingkaran", key: "o" },
    { id: "fill", icon: "🪣", label: "Fill", key: "g" },
    { id: "picker", icon: "💧", label: "Color picker", key: "i" },
    { id: "select", icon: "⬚", label: "Seleksi", key: "m" },
    { id: "move", icon: "✋", label: "Pindah seleksi", key: "v" },
  ];

  const blankDoc = newDoc(DEFAULT_SIZE, DEFAULT_SIZE);
  let doc = $state.raw<Doc>(blankDoc);
  const frame = $derived(currentCel(doc));
  const view = $derived(flatten(doc, doc.frame));
  const layer = $derived(doc.layers[doc.layer]);
  const tagIndex = $derived(tagAt(doc, doc.frame));
  const tag = $derived(doc.tags[tagIndex]);
  let zoom = $state(16);
  let tool = $state<Tool>("pencil");

  // Only select & move work on the selection; other tools drop it so Delete/Cut/Crop can't hit an unseen area.
  function setTool(t: Tool) {
    tool = t;
    if (t !== "select" && t !== "move") selection = null;
  }
  let hex = $state("#000000");
  let newW = $state(DEFAULT_SIZE);
  let newH = $state(DEFAULT_SIZE);
  let sizeError = $state("");
  let selection = $state<Rect | null>(null);
  let hover = $state<[number, number] | null>(null);
  let clipboard: Frame | null = null;
  let history = $state.raw(emptyHistory<Doc>());
  let playing = $state(false);
  let loop = $state(true);
  let fps = $state(DEFAULT_FPS);
  // Fixed when play starts, so playback stays inside the tag it started in.
  let range: PlayRange = { from: 0, to: 0, direction: "forward" };
  let backward = false;
  // Onion skin is a view setting: not part of the doc, not undoable.
  let onionOn = $state(false);
  // View setting like onion skin: hiding the timeline gives the canvas more room.
  let timelineOpen = $state(true);
  let previewOpen = $state(true);
  let onionBefore = $state(1);
  let onionAfter = $state(1);
  let onionOpacity = $state(128);
  const clampInt = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);
  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
  // Hidden while playing: it would flicker, and the animation itself is what's being watched.
  const onion = $derived(onionOn && !playing
    ? onionSkin(doc, clampInt(onionBefore, 0, MAX_ONION), clampInt(onionAfter, 0, MAX_ONION), clampInt(onionOpacity, 0, 255))
    : null);

  let filePath = $state<string | null>(null);
  let saved = $state.raw(blankDoc);
  let fileError = $state("");
  // Selecting a layer/frame replaces `doc` too, so compare only what gets saved.
  const dirty = $derived(doc.layers !== saved.layers || doc.durations !== saved.durations || doc.tags !== saved.tags);
  const fileName = $derived(filePath?.split(/[\\/]/).pop() ?? "untitled.sprt");

  // Page-level edits (resize, crop, paste, frame list) go through here so each is one undo step.
  function edit(next: Doc) {
    history = record(history, doc, next);
    doc = next;
  }


  function step(fn: typeof undo) {
    const r = fn(history, doc);
    if (!r) return;
    history = r.history;
    doc = r.value;
    // Undoing a crop/resize changes the size, so keep the inputs and selection valid.
    newW = frame.width;
    newH = frame.height;
    selection = null;
  }

  const setZoom = (z: number) => (zoom = clampInt(z, MIN_ZOOM, MAX_ZOOM));

  function applySize() {
    if (!isValidSize(newW) || !isValidSize(newH)) {
      sizeError = `Ukuran harus ${MIN_SIZE}–${MAX_SIZE}`;
      return;
    }
    sizeError = "";
    edit(mapCels(doc, (f) => resizeFrame(f, newW, newH)));
    selection = null;
  }

  function crop() {
    const r = selection;
    if (!r) return;
    edit(mapCels(doc, (f) => copyRegion(f, r)));
    newW = frame.width;
    newH = frame.height;
    selection = null;
  }

  function paste() {
    if (!clipboard || !isEditable(layer)) return;
    // Paste at the hovered pixel so the user can aim it; else at the selection, else top-left.
    const [x, y] = hover ?? (selection ? [selection.x, selection.y] : [0, 0]);
    edit(setCel(doc, pasteFrame(frame, clipboard, x, y)));
  }

  // Delete / cut: clears the selection on the active layer; the selection stays, as in Aseprite.
  function clearSelection() {
    if (!selection || !isEditable(layer)) return;
    edit(setCel(doc, clearRegion(frame, selection)));
  }

  const clampFps = (n: number) => (Number.isFinite(n) ? clampInt(n, MIN_FPS, MAX_FPS) : DEFAULT_FPS);

  function togglePlay() {
    if (!playing) {
      range = playRange(doc);
      backward = false;
      // A finished non-looping run restarts from the start of its range.
      if (!loop && nextFrame(doc.frame, range, loop) === null) doc = { ...doc, frame: range.direction === "reverse" ? range.to : range.from };
    }
    playing = !playing;
  }

  $effect(() => {
    getCurrentWindow().setTitle(`Seprit - ${fileName}${dirty ? " •" : ""}`);
  });

  // Re-runs on every frame change, so each frame is shown for its own duration.
  $effect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      const n = nextFrame(doc.frame, range, loop, backward);
      if (n === null) playing = false;
      else { backward = n.backward; doc = { ...doc, frame: n.frame }; }
    }, doc.durations[doc.frame]);
    return () => clearTimeout(id);
  });

  async function save(asNew: boolean) {
    try {
      const path = await saveProject(doc, asNew ? null : filePath);
      if (!path) return;
      filePath = path;
      saved = doc;
      fileError = "";
    } catch (err) {
      fileError = `Gagal menyimpan: ${errText(err)}`;
    }
  }

  async function exportSheet() {
    try {
      await exportSheetFile(doc);
      fileError = "";
    } catch (err) {
      fileError = `Gagal export: ${errText(err)}`;
    }
  }

  // Image larger than the canvas: may be a sprite sheet, so ask for its grid first (1 × 1 = plain import).
  let sheet = $state<Frame | null>(null);

  async function importFile() {
    try {
      const raw = await importImage();
      if (!raw) return;
      const img = removeGridLines(raw);
      fileError = "";
      if (img.width > frame.width || img.height > frame.height) sheet = img;
      else placeSheet(img, 1, 1);
    } catch (err) {
      fileError = `Gagal import: ${errText(err)}`;
    }
  }

  // Each cell is shrunk to fit the canvas; all land on one new layer from the active frame (frames appended
  // as needed), so nothing is overwritten; one undo step.
  // `trim` crops all cells to their shared content box first, so empty margins don't shrink the sprite.
  function placeSheet(img: Frame, cols: number, rows: number, trim = false) {
    try {
      const cells = sliceSheet(img, cols, rows);
      const cels = (trim ? trimCells(cells) : cells).map((c) => imageToCel(c, frame.width, frame.height));
      playing = false;
      edit(addLayerFromCels(doc, cels));
      fileError = "";
    } catch (err) {
      fileError = `Gagal import: ${errText(err)}`;
    }
    sheet = null;
  }

  // Failed AI request, shown in a modal until closed.
  let aiError = $state<{ title: string; text: string } | null>(null);
  let aiBusy = $state(false);
  let aiInstruction = $state("");

  // Claude draws the frame after the active one from its flattened look. The result lands in a new frame
  // on the active layer (other layers blank), one undo step. Edits made while waiting would be lost, so
  // the result is dropped if the layers changed in the meantime.
  async function aiNextFrame() {
    const before = doc;
    const { width, height } = frame;
    const palette = PALETTE.map(hexToRgba);
    aiBusy = true;
    try {
      const rows = await generateNextFrame(frameToRows(view, palette), PALETTE, aiInstruction);
      const cel = rowsToFrame(rows, width, height, palette);
      if (doc.layers !== before.layers) throw new Error("dokumen berubah selama generate, hasil dibuang");
      playing = false;
      edit(setCel(addFrame({ ...doc, layer: before.layer, frame: before.frame }), cel));
      fileError = "";
    } catch (err) {
      aiError = { title: "Gagal generate frame", text: `${errText(err)}` };
    } finally {
      aiBusy = false;
    }
  }

  let showGenerateSprite = $state(false);
  let spriteBusy = $state(false);
  let spritePrompt = $state("");

  // Like Import: the image lands on a new layer above the active one in the active frame, one undo step.
  async function aiSprite() {
    const provider = getSpriteProvider();
    spriteBusy = true;
    try {
      const b64 = await generateSprite(provider, spritePrompt, frame.width, frame.height);
      const img = await decodeImage(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      let cel = imageToCel(img, frame.width, frame.height);
      // Gemini can't return transparency; it is asked for a plain background, removed here as the
      // region connected to the top-left pixel (so same-colored pixels inside the sprite stay). The
      // tolerance absorbs the slight noise in that "plain" background.
      if (provider === "gemini") cel = floodFill(cel, 0, 0, TRANSPARENT, BG_TOLERANCE);
      playing = false;
      edit(setCel(addLayer(doc), cel));
      showGenerateSprite = false;
      fileError = "";
    } catch (err) {
      showGenerateSprite = false;
      aiError = { title: "Gagal generate sprite", text: `${errText(err)}` };
    } finally {
      spriteBusy = false;
    }
  }

  const confirmDiscard = async () => !dirty || (await ask("Perubahan yang belum disimpan akan hilang. Lanjutkan?", { kind: "warning" }));

  // Replaces the whole document (New / Open): undo history is cleared, it belonged to the old file.
  function loadDoc(next: Doc, path: string | null) {
    playing = false;
    doc = saved = next;
    filePath = path;
    history = emptyHistory<Doc>();
    selection = null;
    newW = frame.width;
    newH = frame.height;
    fileError = "";
  }

  async function newFile() {
    if (await confirmDiscard()) loadDoc(newDoc(DEFAULT_SIZE, DEFAULT_SIZE), null);
  }

  async function openFile() {
    try {
      if (!(await confirmDiscard())) return;
      const result = await openProject();
      if (result) loadDoc(result.doc, result.path);
    } catch (err) {
      fileError = `Gagal membuka: ${errText(err)}`;
    }
  }

  let showAiSettings = $state(false);

  // File actions live in the OS menu bar; its accelerators handle Cmd/Ctrl+O/S/Shift+S.
  onMount(() => {
    setupAppMenu({ newFile, open: openFile, save: () => save(false), saveAs: () => save(true), exportSheet, importImage: importFile, aiSettings: () => (showAiSettings = true), generateSprite: () => (showGenerateSprite = true) })
      .catch((err) => (fileError = `Gagal memasang menu: ${errText(err)}`));
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || showAiSettings || showGenerateSprite || sheet || aiError) return;
    const mod = e.metaKey || e.ctrlKey;
    const shortcut = TOOLS.find((t) => t.key === e.key);
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); step(e.shiftKey ? redo : undo); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); step(redo); }
    else if (mod && e.key === "c") { if (selection) clipboard = copyRegion(frame, selection); }
    else if (mod && e.key === "x") { if (selection && isEditable(layer)) { clipboard = copyRegion(frame, selection); clearSelection(); } }
    else if (mod && e.key === "v") paste();
    else if (e.key === "Delete" || e.key === "Backspace") clearSelection();
    else if (e.key === "Escape") selection = null;
    else if (shortcut && !mod) setTool(shortcut.id);
    else if (e.key === "=" || e.key === "+") setZoom(zoom + 1);
    else if (e.key === "-") setZoom(zoom - 1);
  }
</script>

<svelte:window {onkeydown} />

<main>
  <aside>
    {#each TOOLS as t (t.id)}
      <button class:active={tool === t.id} onclick={() => setTool(t.id)} title="{t.label} ({t.key.toUpperCase()})">{t.icon}</button>
    {/each}
    <input type="color" bind:value={hex} title="Warna" />
    <div class="palette">
      {#each PALETTE as c (c)}
        <button class="swatch" class:active={hex === c} style:background={c} title={c} onclick={() => (hex = c)} aria-label={c}></button>
      {/each}
    </div>
  </aside>

  <header>
    <label>Zoom <button onclick={() => setZoom(zoom - 1)}>−</button> {zoom}x <button onclick={() => setZoom(zoom + 1)}>+</button></label>
    <label>W <input type="number" min={MIN_SIZE} max={MAX_SIZE} bind:value={newW} /></label>
    <label>H <input type="number" min={MIN_SIZE} max={MAX_SIZE} bind:value={newH} /></label>
    <button onclick={applySize}>Ubah ukuran</button>
    <button onclick={() => step(undo)} disabled={!canUndo(history)} title="Undo (Cmd/Ctrl+Z)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg></button>
    <button onclick={() => step(redo)} disabled={!canRedo(history)} title="Redo (Cmd/Ctrl+Shift+Z)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg></button>
    <button onclick={crop} disabled={!selection} title="Crop canvas ke seleksi">Crop</button>
    {#if spriteBusy}<span>Generating sprite…</span>{/if}
    {#if fileError}<span class="error">{fileError}</span>{/if}
    {#if sizeError}<span class="error">{sizeError}</span>{/if}
    {#if !layer.visible}<span class="error">Layer "{layer.name}" tersembunyi</span>
    {:else if layer.locked}<span class="error">Layer "{layer.name}" terkunci</span>{/if}
  </header>

  <section>
    <PixelCanvas
      {frame}
      {view}
      {onion}
      editable={isEditable(layer)}
      {zoom}
      {tool}
      {selection}
      bind:hover
      color={hexToRgba(hex)}
      onchange={(f) => {
        // Editing stops playback so a stroke can't jump to another frame mid-gesture.
        playing = false;
        doc = setCel(doc, f);
      }}
      onzoom={setZoom}
      onpick={(c) => { hex = rgbaToHex(c); setTool("pencil"); }}
      onselect={(r) => (selection = r)}
      oncommit={(before) => { if (before !== frame) history = record(history, setCel(doc, before), doc); }}
    />
    {#if previewOpen}<AnimPreview frame={view} />{/if}
  </section>

  <footer>
    <div class="controls">
      <div class="group">
        <button onclick={() => (timelineOpen = !timelineOpen)} class:active={timelineOpen} title={timelineOpen ? "Tutup timeline" : "Buka timeline"}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 5v14M15 5v14" /></svg></button>
        <button onclick={() => (previewOpen = !previewOpen)} class:active={previewOpen} title={previewOpen ? "Tutup preview" : "Buka preview animasi (ukuran asli)"}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle"><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="8" width="6" height="5" rx="1" /></svg></button>
      </div>
      <div class="group">
        <span class="group-label">Play</span>
        <button onclick={togglePlay} class:active={playing} title={playing ? "Stop" : "Play"}>{playing ? "■" : "▶"}</button>
        <label><input type="checkbox" bind:checked={loop} /> Loop</label>
        <label>FPS <input type="number" min={MIN_FPS} max={MAX_FPS} bind:value={fps} onchange={() => (fps = clampFps(fps))} /></label>
        <button onclick={() => edit(setAllDurations(doc, 1000 / clampFps(fps)))} title="Set durasi semua frame dari FPS">Set semua</button>
      </div>
      <div class="group">
        <span class="group-label">Frame {doc.frame + 1}</span>
        <button onclick={() => edit(addFrame(doc))} title="Frame baru">＋</button>
        <button onclick={() => edit(duplicateFrame(doc))} title="Duplikat frame">⧉</button>
        <button onclick={() => edit(duplicateLinked(doc))} title="Duplikat frame, cel tetap tertaut">⧉🔗</button>
        <button onclick={() => edit(unlinkCel(doc))} disabled={!isLinked(layer, doc.frame)} title="Lepas tautan cel aktif">Unlink</button>
        <button onclick={() => edit(deleteFrame(doc))} disabled={frameCount(doc) === 1} title="Hapus frame">🗑</button>
        <input class="ai-instruction" placeholder="Instruksi AI (opsional)" bind:value={aiInstruction} disabled={aiBusy} />
        <button
          onclick={aiNextFrame}
          disabled={aiBusy || !fitsAi(frame) || !isEditable(layer)}
          title={!fitsAi(frame) ? `Hanya untuk canvas ≤ ${MAX_AI_SIZE}×${MAX_AI_SIZE}` : "Generate frame berikutnya dengan Claude"}
        >{aiBusy ? "Generating…" : "✨ Next"}</button>
        <label title="Durasi frame aktif">ms <input type="number" min={MIN_DURATION} max={MAX_DURATION} value={doc.durations[doc.frame]} onchange={(e) => edit(setDuration(doc, doc.frame, e.currentTarget.valueAsNumber))} /></label>
      </div>
      <div class="group">
        <span class="group-label">Layer</span>
        <button onclick={() => edit(addLayer(doc))} title="Layer baru">＋</button>
        <button onclick={() => edit(deleteLayer(doc))} disabled={doc.layers.length === 1} title="Hapus layer">🗑</button>
        <label title="Opacity layer aktif (0–255)">Opacity <input type="number" min="0" max="255" value={layer.opacity} onchange={(e) => edit(setOpacity(doc, doc.layer, e.currentTarget.valueAsNumber))} /></label>
        <select value={layer.blend} onchange={(e) => edit(setBlend(doc, doc.layer, e.currentTarget.value as BlendMode))} title="Blend mode layer aktif">
          {#each BLEND_MODES as mode (mode)}<option value={mode}>{mode}</option>{/each}
        </select>
      </div>
      <div class="group">
        <label title="Onion skin: tampilkan frame sebelum (merah) / sesudah (biru)"><input type="checkbox" bind:checked={onionOn} /> Onion</label>
        {#if onionOn}
          <label title="Jumlah frame sebelum">◀ <input type="number" min="0" max={MAX_ONION} bind:value={onionBefore} /></label>
          <label title="Jumlah frame sesudah">▶ <input type="number" min="0" max={MAX_ONION} bind:value={onionAfter} /></label>
          <label title="Opacity onion skin (0–255)">α <input type="number" min="0" max="255" bind:value={onionOpacity} /></label>
        {/if}
      </div>
      <div class="group">
        <span class="group-label">Tag</span>
        {#if tag}
          <input class="tag-name" value={tag.name} onchange={(e) => edit(updateTag(doc, tagIndex, { name: e.currentTarget.value }))} title="Nama tag" />
          <label title="Frame awal tag">dari <input type="number" min="1" max={frameCount(doc)} value={tag.from + 1} onchange={(e) => edit(updateTag(doc, tagIndex, { from: e.currentTarget.valueAsNumber - 1 }))} /></label>
          <label title="Frame akhir tag">s/d <input type="number" min="1" max={frameCount(doc)} value={tag.to + 1} onchange={(e) => edit(updateTag(doc, tagIndex, { to: e.currentTarget.valueAsNumber - 1 }))} /></label>
          <select value={tag.direction} onchange={(e) => edit(updateTag(doc, tagIndex, { direction: e.currentTarget.value as Direction }))} title="Arah playback tag">
            {#each DIRECTIONS as d (d)}<option value={d}>{d}</option>{/each}
          </select>
          <button onclick={() => edit(deleteTag(doc, tagIndex))} title="Hapus tag">🗑</button>
        {:else}
          <button onclick={() => edit(addTag(doc))} title="Tag baru di frame aktif">＋</button>
        {/if}
      </div>
    </div>
    {#if timelineOpen}
      <Timeline
        {doc}
        onselect={(l, f) => (doc = { ...doc, layer: l, frame: f })}
        onmoveframe={(from, to) => edit(moveFrame(doc, from, to))}
        onmovelayer={(from, to) => edit(moveLayer(doc, from, to))}
        ontoggle={(i) => edit(toggleVisible(doc, i))}
        onlock={(i) => edit(toggleLocked(doc, i))}
        onrename={(i, name) => edit(renameLayer(doc, i, name))}
      />
    {/if}
  </footer>

  <div class="statusbar">
    <span>{TOOLS.find((t) => t.id === tool)?.label}</span>
    <span>{frame.width}×{frame.height}</span>
    <span>{zoom * 100}%</span>
    <span>{hover ? `x ${hover[0]}, y ${hover[1]}` : "—"}</span>
    {#if selection}<span>Seleksi {selection.width}×{selection.height}</span>{/if}
    <span>Layer "{layer.name}"</span>
    <span>Frame {doc.frame + 1}/{frameCount(doc)}</span>
  </div>
</main>

{#if sheet}<ImportSheet {sheet} onimport={(cols, rows, trim) => placeSheet(sheet!, cols, rows, trim)} onclose={() => (sheet = null)} />{/if}
{#if showAiSettings}<AiSettings onclose={() => (showAiSettings = false)} />{/if}
{#if aiError}<ErrorDialog {...aiError} onclose={() => (aiError = null)} />{/if}
{#if showGenerateSprite}
  <GenerateSprite bind:prompt={spritePrompt} busy={spriteBusy} ongenerate={aiSprite} onclose={() => (showGenerateSprite = false)} />
{/if}

<style>
  :global(html, body) { margin: 0; height: 100%; background: #1e1e1e; color: #ddd; font: 13px system-ui, sans-serif; }
  main {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    height: 100vh;
    overflow: hidden;
  }
  header { grid-column: 2; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 6px 10px; background: #252525; border-bottom: 1px solid #111; }
  aside { grid-row: 1 / 4; display: flex; flex-direction: column; gap: 6px; padding: 6px; background: #252525; border-right: 1px solid #111; overflow-y: auto; }
  section { min-height: 0; position: relative; }
  footer { grid-column: 2; display: flex; flex-direction: column; min-width: 0; background: #252525; border-top: 1px solid #111; }
  .controls { display: flex; flex-wrap: wrap; gap: 4px 0; align-items: center; padding: 4px 0; border-bottom: 1px solid #111; }
  .statusbar { grid-column: 1 / -1; display: flex; gap: 16px; padding: 3px 10px; font: 12px monospace; color: #aaa; background: #1a1a1a; border-top: 1px solid #111; }
  .group { display: flex; gap: 6px; align-items: center; padding: 0 10px; border-right: 1px solid #3a3a3a; }
  .group:last-child { border-right: none; }
  .group-label { color: #888; font-size: 11px; text-transform: uppercase; }
  button { background: #333; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
  button.active { background: #3d6bb3; border-color: #5a8ad6; }
  aside button { width: 36px; height: 36px; padding: 0; }
  .palette { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
  aside .swatch { width: 17px; height: 17px; border-radius: 2px; }
  .swatch.active { outline: 2px solid #fff; }
  button:disabled { opacity: 0.4; cursor: default; }
  aside input[type="color"] { width: 36px; height: 36px; padding: 0; border: none; background: none; }
  select { background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 2px 4px; }
  .tag-name { width: 80px; background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 2px 4px; }
  input[type="number"] { width: 56px; background: #1a1a1a; color: #ddd; border: 1px solid #444; padding: 2px 4px; color-scheme: dark; }
  .error { color: #f77; }
  .ai-instruction { width: 12em; }
</style>
