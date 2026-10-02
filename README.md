# Tauri + SvelteKit + TypeScript

This template should help get you started developing with Tauri, SvelteKit and TypeScript in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## App Icons

Icon sources live in `src-tauri/icons/`:

- `icon-source.png` — full logo with the "Seprit" text, used for sizes above 64px.
- `icon-small-source.png` — logo without text, used for sizes ≤ 64px (the text is unreadable that small).

After changing either source, regenerate all icons:

```bash
bun run icons
```

This runs `tauri icon` on the full logo, removes the unused Android/iOS output, then runs `scripts/gen-small-icons.py` to swap in the text-free logo for small sizes (including inside `icon.ico` and `icon.icns`).

Requires macOS (`iconutil`) and Python 3 with Pillow (`pip3 install pillow`).
