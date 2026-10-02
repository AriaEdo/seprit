#!/usr/bin/env python3
"""Replace small app icons (<= 64px) with the text-free logo.

The "Seprit" text in icon-source.png is unreadable at small sizes, so small
icons use icon-small-source.png instead. Run AFTER `bun tauri icon
src-tauri/icons/icon-source.png`, which regenerates everything from the
text version and would otherwise leave blurry text in small icons.

Requires: Python 3 + Pillow, macOS `iconutil` (for icon.icns).
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ICONS = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
FULL_SRC = ICONS / "icon-source.png"
SMALL_SRC = ICONS / "icon-small-source.png"
SMALL_MAX = 64  # sizes at or below this use the text-free logo

PNG_TARGETS = {
    "32x32.png": 32,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "StoreLogo.png": 50,
}
ICO_SIZES = [16, 24, 32, 48, 64, 256]
ICNS_SIZES = [16, 32, 128, 256, 512]


def main():
    for src in (FULL_SRC, SMALL_SRC):
        if not src.is_file():
            sys.exit(f"missing source: {src}")

    full = Image.open(FULL_SRC).convert("RGBA")
    small = Image.open(SMALL_SRC).convert("RGBA")

    def render(size):
        src = small if size <= SMALL_MAX else full
        return src.resize((size, size), Image.LANCZOS)

    for name, size in PNG_TARGETS.items():
        render(size).save(ICONS / name)
        print(f"wrote {name}")

    ico_images = [render(s) for s in ICO_SIZES]
    ico_images[-1].save(
        ICONS / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico_images[:-1],
    )
    print("wrote icon.ico")

    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for s in ICNS_SIZES:
            render(s).save(iconset / f"icon_{s}x{s}.png")
            render(s * 2).save(iconset / f"icon_{s}x{s}@2x.png")
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ICONS / "icon.icns")],
            check=True,
        )
    print("wrote icon.icns")


if __name__ == "__main__":
    main()
