#!/usr/bin/env python3
"""Generate padded iOS / Android launcher icons from the canonical Somafrik mark.

Does not alter the logo artwork. The mark is scaled down and centered on a
white square so Android adaptive masks (circle, squircle, rounded square) and
iOS rounded corners keep the full symbol visible.

Android adaptive icons are 108dp with a 66dp-diameter safe zone. The
foreground asset is more padded than the iOS icon. Expo `icon` is also the
Android legacy fallback, so the iOS asset itself must survive a circle mask.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_MARK = ROOT / "logo without text.png"
ASSETS = ROOT / "Mobile" / "assets"

# Expo `icon` is also the Android legacy / Play fallback. A 70% wide mark has a
# bounding circle ~81% and is cropped by circle / squircle launcher masks.
# Target ~50% width so the square asset still fits the 72/108 Android viewport.
IOS_CONTENT_WIDTH_RATIO = 0.50
# Android adaptive: 108dp canvas, 72dp viewport, 66dp-diameter safe zone.
# 0.54 still looked cropped on OEM launchers (extra inset on top of the mask).
# 0.42 keeps the full mark inside aggressive circular crops.
ANDROID_BOUNDING_CIRCLE_RATIO = 0.42
WHITE_THRESHOLD = 248
WHITE = (255, 255, 255)
SAFE_ZONE_RATIO = 66 / 108
VIEWPORT_RATIO = 72 / 108


def content_bbox(im: Image.Image, threshold: int = WHITE_THRESHOLD) -> tuple[int, int, int, int]:
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > threshold and g > threshold and b > threshold:
                continue
            if x < minx:
                minx = x
            if y < miny:
                miny = y
            if x > maxx:
                maxx = x
            if y > maxy:
                maxy = y
    if maxx < 0:
        raise SystemExit("canonical mark has no visible content")
    return minx, miny, maxx + 1, maxy + 1


def place_mark(
    source: Image.Image,
    *,
    canvas_size: int,
    target_width_ratio: float | None = None,
    target_circle_ratio: float | None = None,
) -> Image.Image:
    crop = source.crop(content_bbox(source))
    bw, bh = crop.size
    if target_circle_ratio is not None:
        half_diag = math.hypot(bw, bh) / 2
        scale = (target_circle_ratio / 2 * canvas_size) / half_diag
    elif target_width_ratio is not None:
        scale = (target_width_ratio * canvas_size) / bw
    else:
        raise ValueError("need a scale target")
    new_w = max(1, round(bw * scale))
    new_h = max(1, round(bh * scale))
    resized = crop.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (canvas_size, canvas_size), WHITE)
    left = (canvas_size - new_w) // 2
    top = (canvas_size - new_h) // 2
    canvas.paste(resized, (left, top))
    return canvas


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def apply_mask(im: Image.Image, mask: Image.Image, bg=(245, 247, 250)) -> Image.Image:
    square = Image.new("RGB", im.size, bg)
    out = Image.new("RGB", im.size, bg)
    out.paste(im, (0, 0))
    return Image.composite(out, square, mask)


def crop_center(im: Image.Image, ratio: float) -> Image.Image:
    w, h = im.size
    side = round(w * ratio)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side)).resize((w, h), Image.Resampling.LANCZOS)


def labeled_row(images: list[Image.Image], tile: int = 360, gap: int = 16) -> Image.Image:
    row = Image.new("RGB", (tile * len(images) + gap * (len(images) + 1), tile + gap * 2), (248, 250, 252))
    x = gap
    for im in images:
        tile_im = im.resize((tile, tile), Image.Resampling.LANCZOS)
        row.paste(tile_im, (x, gap))
        x += tile + gap
    return row


def build_previews(
    original: Image.Image,
    ios_icon: Image.Image,
    android_fg: Image.Image,
    preview_dir: Path,
) -> None:
    preview_dir.mkdir(parents=True, exist_ok=True)
    size = original.size[0]
    viewport = crop_center
    ios_radius = round(size * 0.2237)
    android_round_radius = round(size * 0.18)

    original_ios = apply_mask(original, rounded_rect_mask(size, ios_radius))
    original_android_circle = apply_mask(viewport(original, VIEWPORT_RATIO), circle_mask(size))
    original_android_round = apply_mask(
        viewport(original, VIEWPORT_RATIO),
        rounded_rect_mask(size, android_round_radius),
    )

    new_ios = apply_mask(ios_icon, rounded_rect_mask(size, ios_radius))
    new_android_circle = apply_mask(viewport(android_fg, VIEWPORT_RATIO), circle_mask(size))
    new_android_round = apply_mask(
        viewport(android_fg, VIEWPORT_RATIO),
        rounded_rect_mask(size, android_round_radius),
    )

    # Safe-zone guide on the Android foreground (full 108dp canvas).
    guide = android_fg.copy()
    draw = ImageDraw.Draw(guide)
    inset_safe = round(size * (1 - SAFE_ZONE_RATIO) / 2)
    inset_view = round(size * (1 - VIEWPORT_RATIO) / 2)
    draw.ellipse(
        (inset_view, inset_view, size - inset_view - 1, size - inset_view - 1),
        outline=(148, 163, 184),
        width=4,
    )
    draw.ellipse(
        (inset_safe, inset_safe, size - inset_safe - 1, size - inset_safe - 1),
        outline=(37, 99, 235),
        width=5,
    )

    before = labeled_row([original, original_ios, original_android_circle, original_android_round])
    after = labeled_row([ios_icon, new_ios, new_android_circle, new_android_round])
    sheet = Image.new("RGB", (before.width, before.height + after.height + 24), (226, 232, 240))
    sheet.paste(before, (0, 8))
    sheet.paste(after, (0, before.height + 16))
    sheet.save(preview_dir / "launcher-icon-masks.png", format="PNG", optimize=True)

    original.save(preview_dir / "before-full.png")
    original_android_circle.save(preview_dir / "before-android-circle.png")
    original_android_round.save(preview_dir / "before-android-rounded-square.png")
    original_ios.save(preview_dir / "before-ios-rounded.png")
    ios_icon.save(preview_dir / "after-ios-full.png")
    new_ios.save(preview_dir / "after-ios-rounded.png")
    android_fg.save(preview_dir / "after-android-full.png")
    new_android_circle.save(preview_dir / "after-android-circle.png")
    new_android_round.save(preview_dir / "after-android-rounded-square.png")
    guide.save(preview_dir / "after-android-safe-zone-guide.png")
    build_launcher_home(android_fg, preview_dir / "after-android-launcher-home.png")


def build_launcher_home(android_fg: Image.Image, dest: Path) -> None:
    """Simulate a Pixel-style launcher tile: circular adaptive icon + label."""
    tile = 208
    canvas_w, canvas_h = 512, 400
    wallpaper = (32, 33, 36)
    home = Image.new("RGB", (canvas_w, canvas_h), wallpaper)
    android_viewport = crop_center(android_fg, VIEWPORT_RATIO)
    icon_resized = android_viewport.resize((tile, tile), Image.Resampling.LANCZOS)
    mask = circle_mask(tile)
    circular = icon_resized.convert("RGBA")
    circular.putalpha(mask)
    left = (canvas_w - tile) // 2
    top = 64
    home_rgba = home.convert("RGBA")
    home_rgba.alpha_composite(circular.convert("RGBA"), (left, top))
    home = home_rgba.convert("RGB")
    draw = ImageDraw.Draw(home)
    label = "Somafrik"
    font = None
    for candidate in (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
    ):
        if candidate.exists():
            font = ImageFont.truetype(str(candidate), 28)
            break
    if font is None:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), label, font=font)
    text_w = bbox[2] - bbox[0]
    draw.text(((canvas_w - text_w) // 2, top + tile + 18), label, fill=(248, 250, 252), font=font)
    home.save(dest, format="PNG", optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--previews",
        type=Path,
        help="optional directory for before/after mask composites (not committed)",
    )
    args = parser.parse_args()

    if not CANONICAL_MARK.exists():
        print(f"missing canonical mark: {CANONICAL_MARK}", file=sys.stderr)
        return 1
    source = Image.open(CANONICAL_MARK).convert("RGB")
    canvas_size = source.size[0]
    if source.size[0] != source.size[1]:
        print("canonical mark must be square", file=sys.stderr)
        return 1

    ios_icon = place_mark(source, canvas_size=canvas_size, target_width_ratio=IOS_CONTENT_WIDTH_RATIO)
    android_fg = place_mark(
        source,
        canvas_size=canvas_size,
        target_circle_ratio=ANDROID_BOUNDING_CIRCLE_RATIO,
    )

    ios_path = ASSETS / "somafrik-app-icon.png"
    android_path = ASSETS / "somafrik-android-adaptive-foreground.png"
    ios_icon.save(ios_path, format="PNG", optimize=True)
    android_fg.save(android_path, format="PNG", optimize=True)
    if args.previews:
        build_previews(source, ios_icon, android_fg, args.previews)

    print(f"wrote {ios_path.relative_to(ROOT)}")
    print(f"  iOS content width target={IOS_CONTENT_WIDTH_RATIO:.0%} of canvas, centered")
    print(f"wrote {android_path.relative_to(ROOT)}")
    print(
        f"  Android bounding circle target={ANDROID_BOUNDING_CIRCLE_RATIO:.0%} "
        f"of canvas (safe zone {SAFE_ZONE_RATIO:.1%})"
    )
    if args.previews:
        print(f"wrote previews under {args.previews}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
