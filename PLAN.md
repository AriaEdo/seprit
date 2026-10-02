# Seprit — Rencana Pengerjaan

Aplikasi desktop untuk editing pixel sprite sheet.

## Keputusan stack

| Area | Pilihan | Alasan |
|---|---|---|
| Desktop shell | Tauri v2 | WebView OS, installer kecil, RAM hemat (vs Electron) |
| UI | SvelteKit 5 + TypeScript (adapter-static, `ssr = false`) | Tanpa virtual DOM, runtime kecil |
| Rendering | Canvas 2D | Cukup untuk pixel art |
| Model pixel | `Frame { width, height, data: Uint8ClampedArray }` (RGBA, layout = ImageData) | Immutable: tiap perubahan return frame baru (siap untuk undo) |
| Ukuran canvas | 1–512 px, bebas diatur user | — |
| Format proyek | `.sprt` (JSON: ukuran, palette, frames, FPS, loop) via dialog native Tauri | Bisa dibuka & diedit ulang |
| Export | PNG + JSON, WebP, TGA, TIFF, SVG sprite sheet (GIF dibatalkan) | — |
| API key AI | Disimpan di Keychain OS (crate `keyring`, sisi Rust); request AI dikirim dari Rust | Key tidak pernah ke WebView / file / localStorage |
| Provider AI | **Claude** → generate frame berikutnya (baca frame sebagai grid JSON). **OpenAI / Gemini** → generate sprite (image gen → downscale ke ukuran canvas, warna asli dipertahankan) | Sesuai kekuatan tiap model |

## Fase

### Fase 1 — Pixel canvas ✅ (selesai, diverifikasi user 2026-10-01)
- [x] Scaffold Tauri + SvelteKit
- [x] Canvas dengan checkerboard, grid (zoom ≥ 6x)
- [x] Ruler X & Y (mengikuti scroll/zoom, highlight pixel di bawah kursor)
- [x] Zoom 1–64x (Cmd/Ctrl + scroll, tombol, keyboard `-` / `=`)
- [x] Pencil (B) & eraser (E) dengan interpolasi Bresenham
- [x] Ubah ukuran canvas (anchor kiri atas)
- [x] Unit test `pixels.ts` (6 test)
- [x] Verifikasi manual oleh user di jendela aplikasi

### Fase 2 — Tools editor ✅ (diverifikasi user)
- [x] Color picker (I) & color chooser + palette PICO-8
- [x] Primitif: garis (L), kotak (U), lingkaran (O), fill (G) — outline saja, fill 4-arah exact match
- [x] Seleksi persegi (M) → Crop (tombol), Cmd/Ctrl+C, Cmd/Ctrl+V (di posisi kursor; clipboard internal), Esc batal; Cmd/Ctrl+X cut & Delete/Backspace hapus isi seleksi di layer aktif (seleksi tetap; ditolak bila layer terkunci/tersembunyi; 1 langkah undo) — total 110 test, diverifikasi user 2026-10-02
- [x] Tool Move ✋ (V): drag memindahkan isi seleksi di layer aktif + seleksinya; dibatasi di dalam canvas; pixel transparan tidak menimpa tujuan; 1 drag = 1 langkah undo (posisi seleksi tidak ikut undo); kursor tangan terbuka (`grab`), mengepal (`grabbing`) saat drag
- [x] Pindah ke tool selain Seleksi/Move → seleksi dihapus (bukan disembunyikan, agar Delete/Cut/Crop tidak mengenai area tak terlihat) — total 112 test; diverifikasi user 2026-10-02
- [x] Undo / redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y, tombol ↶ ↷) — 1 gesture = 1 langkah, maks 100 langkah
- [x] Unit test fungsi baru (total 19 test)
- [x] Verifikasi manual oleh user di jendela aplikasi

### Fase 3 — Animasi frame-by-frame ✅ (diverifikasi user)
- [x] Panel frame (thumbnail) di bawah canvas, tambah frame kosong (＋)
- [x] Drag untuk ubah urutan (pointer events, bukan HTML5 DnD), delete, duplicate
- [x] Play / stop, loop on/off, FPS 1–60 (default 8); mengedit saat play → otomatis stop
- [x] Undo/redo mencakup operasi frame; resize & crop berlaku ke semua frame
- [x] Unit test `frames.ts` (total 26 test)
- [x] Verifikasi manual oleh user (Fase 2 + 3)

### Fase 3b — Timeline layer × frame ala Aseprite ✅ (diverifikasi user)
- [x] Model `Doc { layers[] (bawah → atas), layer, frame }`; tiap layer punya 1 cel per frame; cel kosong berbagi objek
- [x] Layer: tambah, hapus, rename (double-click), visibility 👁, drag ubah urutan; semua masuk undo
- [x] Canvas menampilkan gabungan layer visible; picker ambil dari gabungan; layer tersembunyi tidak bisa digambar/paste
- [x] Komponen `Timeline.svelte` (grid layer × frame) menggantikan `FramePanel` / `FrameThumb`
- [x] Unit test (total 37 test)
- [x] Verifikasi manual oleh user
- [x] Hapus `FramePanel.svelte` & `FrameThumb.svelte` (tidak terpakai) — disetujui & dihapus 2026-10-02

### Fase 3c — Fitur layer & animasi lanjutan ✅ (diverifikasi user)
- [x] A. Opacity (0–255), blend mode (normal, multiply, screen, overlay, darken, lighten, addition, difference), lock 🔒 — total 43 test
- [x] B. Linked cel: `links` per layer, "Duplicate linked" (⧉🔗, semua layer), "Unlink" (cel aktif); `setCel` menulis ke semua frame yang tertaut; grup 1 anggota otomatis lepas — total 49 test
- [x] C. Durasi per frame (ms 1–65535, default 125) + FPS jadi tombol "Set semua"; tag `{name, from, to, direction: forward|reverse|pingpong}` tidak boleh tumpang-tindih, ikut bergeser saat insert/delete frame (insert tepat setelah akhir tag → tag memanjang), tetap di posisi saat drag frame; playback memutar tag di bawah frame aktif (tanpa tag → semua frame) — total 62 test
- [x] D. Onion skin (hanya tampilan, tidak masuk undo, default off): 0–5 frame sebelum/sesudah tanpa wrap, opacity 0–255 (frame jarak d → opacity/d), warna dicampur 50% ke merah (sebelum) / biru (sesudah), digambar di bawah frame aktif, disembunyikan saat play — total 66 test
- [x] Verifikasi manual oleh user

### Fase 4 — File (kode selesai; Export multi-format belum diverifikasi manual)
- [x] Save / Save As `.sprt` (dialog native Tauri; Cmd/Ctrl+S, Cmd/Ctrl+Shift+S) — format v1: JSON, pool cel unik (RGBA base64, dedup per isi), layer menunjuk indeks; durasi & tag ikut; nama file + • kalau belum disimpan
- [x] Open `.sprt` (Cmd/Ctrl+O; konfirmasi kalau ada perubahan belum disimpan; file divalidasi penuh, error ditampilkan di header; history di-reset) — total 80 test
- [x] Export PNG sprite sheet (tombol "Export PNG"; semua frame di-flatten (layer visible saja), 1 baris kiri → kanan, tanpa padding) — total 82 test; diverifikasi user 2026-10-02
- ~~Export GIF~~ — dibatalkan atas permintaan user (2026-10-01)
- [x] Export multi-format (menu "Export…" Cmd/Ctrl+E, format dari ekstensi): PNG + JSON Aseprite (array; rect frame, durasi, frameTags; JSON ditulis via command Rust `write_sheet_json` karena scope fs), WebP lossless / TGA / TIFF (crate `image` di Rust, `encode_image`), SVG (rect per run warna) — test TS + Rust; belum diverifikasi manual
- [x] Import gambar (menu File → Import Image…; PNG/JPG/GIF frame pertama/WebP, decode via WebView) → layer baru di frame aktif (1 langkah undo); diperkecil agar muat (rasio tetap, kiri atas, tidak diperbesar) dengan rata-rata blok berbobot alpha; alpha < 128 → transparan, selain itu warna asli gambar (tidak di-snap ke palette; diubah 2026-10-01) — total 88 test; warna import diverifikasi user 2026-10-01
- [x] Import sprite sheet bergaris kotak (2026-10-02): `removeGridLines` — kolom/baris ≥ 90% pixel gelap-opaque di rentang konten dianggap garis kotak, dihapus ±1 px (anti-aliasing), gambar di-crop ke dalam garis terluar agar slicing rata tidak bergeser; sheet tanpa garis tidak berubah — total 124 test; file ChatGPT 12 frame → tebakan grid 12 × 1 (dicek lewat skrip); diverifikasi user di aplikasi 2026-10-02 (grid 12 × 1 otomatis, tanpa sisa garis)
- [x] Hapus command template `greet` di `src-tauri/src/lib.rs`

### UI
- [x] Status bar bawah (lebar penuh): tool, ukuran canvas, zoom, posisi kursor, ukuran seleksi, layer, frame x/N — menggantikan baris status di `PixelCanvas`; diverifikasi user 2026-10-02
- [x] Menu File di bar menu OS (`src/lib/appMenu.ts`, API menu Tauri dari JS): Open, Save, Save As, Export PNG ditambahkan di atas menu File bawaan (Linux: dibuat baru); shortcut Cmd/Ctrl+O/S/Shift+S lewat accelerator menu; Export PNG Cmd/Ctrl+E, Import Image Cmd/Ctrl+I, Generate Sprite Cmd/Ctrl+G, AI Settings Cmd/Ctrl+, (ditambahkan 2026-10-02, diverifikasi user 2026-10-02), handler keydown-nya dihapus — diverifikasi user 2026-10-02
- [x] Tombol timeline 🎞 (biru = terbuka) di awal baris kontrol: buka/tutup grid timeline (baris kontrol tetap tampil); setting tampilan, tidak masuk undo/file — diverifikasi user 2026-10-02
- [x] Preview animasi (`AnimPreview.svelte`): panel di pojok kanan atas canvas, tombol buka/tutup di samping tombol timeline (default terbuka); menampilkan frame aktif hasil flatten (layer visible) dalam ukuran asli, skala 1×/2×/3× (klik untuk ganti); ikut Play utama (bergerak hanya saat play); setting tampilan, tidak masuk undo/file — diverifikasi user 2026-10-02

### Keamanan (audit 2026-10-02)
- [x] #1 CSP: `default-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'` + `dangerousDisableAssetCspModification: ["style-src"]` (nonce Tauri membuat `'unsafe-inline'` diabaikan → atribut `style` Svelte terblokir); script tetap di-hash otomatis oleh Tauri — belum diverifikasi manual
- [x] #2 Hapus plugin `opener` (tidak dipakai) dari Rust, Cargo, package.json, capabilities
- [x] `cargo audit` (2026-10-02): 2 celah diperbaiki lewat update patch di Cargo.lock — `h2` 0.4.14 → 0.4.19 (RUSTSEC-2026-0258), `rustls` 0.23.42 → 0.23.45 (RUSTSEC-2026-0285, perlu `--precise`; ikut naik aws-lc-rs/sys, rustls-webpki). Sisa 3 warning dibiarkan (dependensi transitif Tauri): `proc-macro-error` unmaintained, `glib` unsound (hanya Linux/GTK), `chacha20`
- Diterima: `cookie@0.6.0` (low, hanya SSR; app `ssr = false`); `write_sheet_json` boleh menulis .json di samping .png mana pun (hanya bisa dieksploitasi bila WebView dibobol)

### Fase 5 — Integrasi AI (keputusan disetujui user 2026-10-01; kerjakan per langkah, verifikasi user tiap langkah sebelum lanjut)
Umum:
- Rust: crate `keyring` (Keychain) + `reqwest`; semua request AI dari Rust, key tidak pernah kembali ke WebView
- Model: Claude `claude-opus-5-5` (alternatif lebih murah: `claude-sonnet-5-5`). Model image OpenAI/Gemini: cek ID terbaru di dokumentasi resmi saat implementasi, jangan dari ingatan. Baca skill `claude-api` sebelum menulis kode Claude
- Saat request: tombol disabled + status "Generating…"; error tampil di modal `ErrorDialog.svelte` (gaya sama dengan dialog lain; diubah 2026-10-02, diverifikasi user 2026-10-02) — pesan dari status code/body apa adanya (plain code, bukan model)

- [x] A. Pengaturan (diverifikasi user 2026-10-01 — crate `keyring` v3, service `seprit`; provider sprite disimpan di localStorage karena bukan rahasia; `src-tauri/src/ai_keys.rs`, `src/lib/aiKeys.ts`, `src/lib/AiSettings.svelte`): dialog dari menu "AI Settings…"; 3 field key (Anthropic, OpenAI, Gemini) + pilihan provider sprite (OpenAI | Gemini); key dikirim ke Rust → Keychain; WebView hanya tahu status "tersimpan ✓ / kosong"; tombol hapus per key
- [x] B. (diverifikasi user 2026-10-01 — `src-tauri/src/ai_frame.rs` (7 cargo test), `src/lib/aiFrame.ts` (total 95 test); grid = 1 string per baris, `0`–`f` indeks palette, `.` transparan; structured output JSON schema, effort `medium`, `fallbacks: "default"`; tombol "✨ Next" + input instruksi di grup Frame; disabled juga bila layer aktif terkunci/tersembunyi; hasil dibuang bila layer berubah selama request) Generate frame berikutnya (Claude): input = frame aktif (flatten) + instruksi teks opsional; output = grid indeks palette (16 warna PICO-8 + transparan), validasi ketat (Rust & TS); hanya untuk canvas ≤ 64×64 (lebih besar → tombol disabled); hasil → frame baru setelah frame aktif, di layer aktif (layer lain kosong), 1 langkah undo
- [x] C. (diverifikasi user 2026-10-02 dengan Gemini & OpenAI — `src-tauri/src/ai_sprite.rs` (5 cargo test), `src/lib/GenerateSprite.svelte`; menu "Generate Sprite…"; OpenAI `gpt-image-2.5-flare` (latar transparan, PNG), Gemini `gemini-3.1-flash-image` via Interactions API (1K, JPEG — PNG ditolak API, diganti 2026-10-02, prompt + "latar polos" → area yang terhubung ke pixel kiri atas dibuang dengan toleransi warna `BG_TOLERANCE` = 24); rasio = yang didukung provider paling dekat dengan canvas; ID model dicek di dokumentasi resmi 2026-10-01; error ditampilkan di modal, prompt tetap disimpan untuk dicoba lagi) Generate sprite dari prompt (OpenAI / Gemini, sesuai pilihan di pengaturan): hasil → layer baru di frame aktif lewat `imageToCel` (sama seperti Import), 1 langkah undo

### Optimasi render ✅ (diverifikasi user 2026-10-02)
- [x] 1. Canvas tampilan hanya seluas area terlihat (`PixelCanvas.svelte`): `div.stage` (ukuran × zoom) untuk scroll & pointer, canvas diposisikan di area terlihat; checker & grid hanya di area terlihat; render ulang saat scroll / `ResizeObserver` viewport — sebelumnya canvas = ukuran × zoom (512 px @ 64× = 32768², melebihi batas WebView)
- [x] 2. Checkerboard pakai `createPattern` (tile 2×2 kotak, di-cache per ukuran kotak; 1 `fillRect` per render)
- [x] 3. `flatten` dihitung sekali: `AnimPreview` menerima `frame={view}` dari halaman, bukan `doc`

- [x] 4. `flatten` di-memo per indeks frame (dipakai ulang bila referensi cel, opacity & blend layer visible + ukuran sama; hasil tidak boleh dimutasi) + fast path `composite` tanpa `subarray` per pixel — benchmark 512², 8 layer semi-transparan, onion 5+5: 1 event goresan ±600 ms → 41 ms; total 125 test — belum diverifikasi manual

### Rapikan kode (2026-10-02)
- [x] `+page.svelte`: helper `errText`, `loadDoc` (dipakai New & Open), `confirmDiscard`; `setZoom` & `clampFps` pakai `clampInt` — perilaku tetap; 125 test lolos, `svelte-check` 0 error
- [x] Bug: Backspace/Delete saat `<select>` fokus tidak lagi menghapus isi seleksi; Cmd/Ctrl+Y redo juga saat Caps Lock
- Disetujui user 2026-10-02 (cek manual New/Open/shortcut tidak dikonfirmasi eksplisit)
- [x] `PixelCanvas.svelte`: blit (salin pixel ke canvas offscreen) dipisah dari render → gerak mouse / zoom / seleksi tidak lagi menyalin ulang data gambar; render tidak bergantung pada `hover` (ruler digambar ulang oleh handler pointer); tanpa salinan ekstra di `blit`; `hover` diperbarui hanya saat pindah pixel; `pointercancel` tetap commit undo — 125 test lolos, `svelte-check` 0 error; tanpa unit test komponen, peningkatan kecepatan tidak diukur
- Disetujui user 2026-10-02 (cek manual tidak dikonfirmasi eksplisit)

## Struktur file saat ini

- `src/lib/pixels.ts` — fungsi pixel murni (create, paint, line/rect/ellipse, fill, copy/paste region, resize, hex↔rgba, guessGrid/removeGridLines)
- `src/lib/history.ts` — stack undo/redo generik (snapshot `Doc`)
- `src/lib/frames.ts` — `Doc { layers, layer, frame, … }` (layer, cel, link, durasi, tag) + operasi frame/layer, flatten
- `src/lib/sprt.ts` — serialize/parse `.sprt` (validasi penuh)
- `src/lib/projectFile.ts` — dialog open/save + baca/tulis file (plugin dialog & fs)
- `src/lib/exportFormats.ts` — JSON Aseprite & SVG; `src-tauri/src/encode.rs` — encode WebP/TGA/TIFF (Rust)
- `src/lib/ruler.ts` — gambar ruler
- `src/lib/appMenu.ts` — menu File di bar menu OS
- `src/lib/aiKeys.ts` + `src/lib/AiSettings.svelte` — dialog AI Settings; `src-tauri/src/ai_keys.rs` — simpan key di Keychain (Rust)
- `src/lib/aiFrame.ts` — frame ↔ grid indeks palette untuk Claude; `src-tauri/src/ai_frame.rs` — request Claude (Rust)
- `src/lib/GenerateSprite.svelte` — dialog prompt sprite; `src-tauri/src/ai_sprite.rs` — request OpenAI/Gemini (Rust)
- `src/lib/ErrorDialog.svelte` — modal error
- `src/lib/ImportSheet.svelte` — dialog grid (kolom × baris) saat import sprite sheet
- `src/lib/AnimPreview.svelte` — preview ukuran asli frame aktif (ikut Play)
- `src/lib/Timeline.svelte` — grid layer × frame
- `src/lib/PixelCanvas.svelte` — canvas, zoom, input pointer
- `src/routes/+page.svelte` — layout & toolbar
- Test: `src/lib/*.test.ts` (124 test, Vitest); test Rust di `ai_frame.rs` (7), `ai_sprite.rs` (5), `encode.rs` (4) — total 16 `cargo test`

## Perintah

- `bun tauri dev` — jalankan aplikasi
- `bun run test` — unit test
- `bun run check` — type check
