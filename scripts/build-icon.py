#!/usr/bin/env python3
"""
Generates the Windows application icon.

Kept as a script rather than a checked-in binary nobody can edit: the icon is
derived from the same marks the interface uses, so changing the brand means
changing a few numbers here rather than opening an image editor.

    python3 scripts/build-icon.py

Requires Pillow. Writes desktop/csharp/ReticleX.App/Assets/reticlex.ico and
assets/icon.png.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent

BACKGROUND_TOP = (21, 27, 36, 255)
BACKGROUND_BOTTOM = (7, 9, 12, 255)
MINT = (0, 255, 136, 255)
MINT_SOFT = (0, 255, 136, 54)

# Drawn at this size and downsampled, so every icon size gets clean edges.
MASTER = 1024
ICON_SIZES = [256, 128, 64, 48, 32, 24, 16]


def draw_master() -> Image.Image:
    image = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Vertical gradient behind a rounded square.
    gradient = Image.new("RGBA", (1, MASTER))
    for y in range(MASTER):
        t = y / (MASTER - 1)
        gradient.putpixel((0, y), tuple(
            round(BACKGROUND_TOP[i] + (BACKGROUND_BOTTOM[i] - BACKGROUND_TOP[i]) * t)
            for i in range(4)
        ))
    gradient = gradient.resize((MASTER, MASTER))

    mask = Image.new("L", (MASTER, MASTER), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, MASTER - 1, MASTER - 1), radius=int(MASTER * 0.22), fill=255)
    image.paste(gradient, (0, 0), mask)

    centre = MASTER / 2
    ring_radius = MASTER * 0.305

    # A soft ring, then the broken accent ring on top of it.
    draw.ellipse(
        (centre - ring_radius, centre - ring_radius, centre + ring_radius, centre + ring_radius),
        outline=MINT_SOFT, width=int(MASTER * 0.040))
    for start, end in ((205, 335), (25, 155)):
        draw.arc(
            (centre - ring_radius, centre - ring_radius, centre + ring_radius, centre + ring_radius),
            start=start, end=end, fill=MINT, width=int(MASTER * 0.026))

    # Four arms and a centre dot: the default reticle, scaled up.
    arm_half = MASTER * 0.0235
    gap = MASTER * 0.105
    reach = MASTER * 0.400
    radius = MASTER * 0.016

    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if dx:
            box = (centre + dx * gap, centre - arm_half, centre + dx * reach, centre + arm_half)
        else:
            box = (centre - arm_half, centre + dy * gap, centre + arm_half, centre + dy * reach)
        draw.rounded_rectangle(_ordered(box), radius=radius, fill=MINT)

    dot = MASTER * 0.052
    draw.ellipse((centre - dot, centre - dot, centre + dot, centre + dot), fill=MINT)

    return image


def _ordered(box):
    x0, y0, x1, y1 = box
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def main() -> int:
    master = draw_master()

    png_path = ROOT / "assets" / "icon.png"
    png_path.parent.mkdir(parents=True, exist_ok=True)
    master.resize((512, 512), Image.LANCZOS).save(png_path, "PNG")

    ico_path = ROOT / "desktop" / "csharp" / "ReticleX.App" / "Assets" / "reticlex.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    master.save(ico_path, "ICO", sizes=[(size, size) for size in ICON_SIZES])

    print(f"build-icon: {ico_path} ({ico_path.stat().st_size} bytes, {len(ICON_SIZES)} sizes)")
    print(f"build-icon: {png_path} ({png_path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
