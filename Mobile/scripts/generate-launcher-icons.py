#!/usr/bin/env python3
"""Generate padded iOS / Android launcher icons from the canonical Somafrik mark.

Does not alter the logo artwork. The mark is scaled down and centered so
Android adaptive masks (circle, squircle, rounded square) and iOS rounded
corners keep the full symbol visible. No mask is baked into the PNG.

Canvas is 1024×1024 (Expo / App Store / Play).

iOS / Expo `icon` (opaque white): ~78% content width.

Android adaptive foreground (transparent): slightly smaller than iOS.
A literal 64% width of the 108dp canvas overflows Pixel circular masks
after the 72/108 viewport crop (~28 px on the pen / book). 58% is the
largest ratio that keeps mortar + book + pen fully inside that circle
while remaining clearly larger than the previous 36% framing.
"""

from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_MARK = ROOT / "logo without text.png"
ASSETS = ROOT / "Mobile" / "assets"

CANVAS_SIZE = 1024
IOS_CONTENT_WIDTH_RATIO = 0.78
ANDROID_CONTENT_WIDTH_RATIO = 0.58
WHITE_THRESHOLD = 248
WHITE = (255, 255, 255)
SAFE_ZONE_RATIO = 66 / 108
VIEWPORT_RATIO = 72 / 108


def content_bbox(im: Image.Image, threshold: int = WHITE_THRESHOLD) -> tuple[int, int, int, int]:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 12:
                continue
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


def exterior_to_alpha(im: Image.Image, threshold: int = WHITE_THRESHOLD) -> Image.Image:
    """Keep interior whites (book pages); punch only edge-connected white to alpha."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    pix = rgba.load()
    seen = bytearray(w * h)

    def push(x: int, y: int, q: deque[tuple[int, int]]) -> None:
        if 0 <= x < w and 0 <= y < h and not seen[y * w + x]:
            seen[y * w + x] = 1
            q.append((x, y))

    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        push(x, 0, q)
        push(x, h - 1, q)
    for y in range(h):
        push(0, y, q)
        push(w - 1, y, q)
    while q:
        x, y = q.popleft()
        r, g, b, _a = pix[x, y]
        if r > threshold and g > threshold and b > threshold:
            pix[x, y] = (255, 255, 255, 0)
            push(x + 1, y, q)
            push(x - 1, y, q)
            push(x, y + 1, q)
            push(x, y - 1, q)
    return rgba


def place_mark(
    source: Image.Image,
    *,
    canvas_size: int,
    target_width_ratio: float,
    transparent: bool,
) -> Image.Image:
    crop = source.crop(content_bbox(source))
    bw, bh = crop.size
    scale = (target_width_ratio * canvas_size) / bw
    new_w = max(1, round(bw * scale))
    new_h = max(1, round(bh * scale))
    resized = crop.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (canvas_size - new_w) // 2
    top = (canvas_size - new_h) // 2
    if transparent:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 0))
        mark = exterior_to_alpha(resized)
        canvas.paste(mark, (left, top), mark)
        return canvas
    canvas = Image.new("RGB", (canvas_size, canvas_size), WHITE)
    canvas.paste(resized.convert("RGB"), (left, top))
    return canvas


def as_rgb_on_white(im: Image.Image) -> Image.Image:
    if im.mode == "RGB":
        return im
    bg = Image.new("RGB", im.size, WHITE)
    bg.paste(im, mask=im.split()[-1])
    return bg


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
    out = as_rgb_on_white(im)
    return Image.composite(out, square, mask)


def crop_center(im: Image.Image, ratio: float) -> Image.Image:
    w, h = im.size
    side = round(w * ratio)
    left = (w - side) // 2
    top = (h - side) // 2
    cropped = im.crop((left, top, left + side, top + side))
    return cropped.resize((w, h), Image.Resampling.LANCZOS)


def labeled_row(images: list[Image.Image], tile: int = 360, gap: int = 16) -> Image.Image:
    row = Image.new("RGB", (tile * len(images) + gap * (len(images) + 1), tile + gap * 2), (248, 250, 252))
    x = gap
    for im in images:
        tile_im = as_rgb_on_white(im).resize((tile, tile), Image.Resampling.LANCZOS)
        row.paste(tile_im, (x, gap))
        x += tile + gap
    return row


def assert_android_circle_safe(android_fg: Image.Image) -> None:
    """Fail closed if any mark pixel would be cropped by a Pixel circular mask."""
    rgb = as_rgb_on_white(android_fg)
    size = rgb.size[0]
    side = round(size * VIEWPORT_RATIO)
    inset = (size - side) // 2
    cx = inset + side / 2
    cy = inset + side / 2
    radius = side / 2
    px = rgb.load()
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]
            if r > WHITE_THRESHOLD and g > WHITE_THRESHOLD and b > WHITE_THRESHOLD:
                continue
            if (x - cx) ** 2 + (y - cy) ** 2 > radius * radius:
                raise SystemExit(
                    f"Android foreground clipped by circular viewport mask at ({x},{y})"
                )


def build_previews(
    original: Image.Image,
    ios_icon: Image.Image,
    android_fg: Image.Image,
    preview_dir: Path,
) -> None:
    preview_dir.mkdir(parents=True, exist_ok=True)
    size = ios_icon.size[0]
    original_square = Image.new("RGB", (size, size), WHITE)
    src = original.convert("RGB")
    scale = min(size / src.size[0], size / src.size[1])
    nw, nh = round(src.size[0] * scale), round(src.size[1] * scale)
    fitted = src.resize((nw, nh), Image.Resampling.LANCZOS)
    original_square.paste(fitted, ((size - nw) // 2, (size - nh) // 2))

    ios_radius = round(size * 0.2237)
    android_round_radius = round(size * 0.18)

    original_ios = apply_mask(original_square, rounded_rect_mask(size, ios_radius))
    original_android_circle = apply_mask(crop_center(original_square, VIEWPORT_RATIO), circle_mask(size))
    original_android_round = apply_mask(
        crop_center(original_square, VIEWPORT_RATIO),
        rounded_rect_mask(size, android_round_radius),
    )

    new_ios = apply_mask(ios_icon, rounded_rect_mask(size, ios_radius))
    new_android_circle = apply_mask(crop_center(android_fg, VIEWPORT_RATIO), circle_mask(size))
    new_android_round = apply_mask(
        crop_center(android_fg, VIEWPORT_RATIO),
        rounded_rect_mask(size, android_round_radius),
    )

    guide = as_rgb_on_white(android_fg)
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

    before = labeled_row([original_square, original_ios, original_android_circle, original_android_round])
    after = labeled_row([ios_icon, new_ios, new_android_circle, new_android_round])
    sheet = Image.new("RGB", (before.width, before.height + after.height + 24), (226, 232, 240))
    sheet.paste(before, (0, 8))
    sheet.paste(after, (0, before.height + 16))
    sheet.save(preview_dir / "launcher-icon-masks.png", format="PNG", optimize=True)

    original_square.save(preview_dir / "before-full.png")
    original_android_circle.save(preview_dir / "before-android-circle.png")
    original_android_round.save(preview_dir / "before-android-rounded-square.png")
    original_ios.save(preview_dir / "before-ios-rounded.png")
    as_rgb_on_white(ios_icon).save(preview_dir / "after-ios-full.png")
    new_ios.save(preview_dir / "after-ios-rounded.png")
    as_rgb_on_white(android_fg).save(preview_dir / "after-android-full.png")
    new_android_circle.save(preview_dir / "after-android-circle.png")
    new_android_round.save(preview_dir / "after-android-rounded-square.png")
    guide.save(preview_dir / "after-android-safe-zone-guide.png")
    build_launcher_home(android_fg, preview_dir / "after-android-launcher-home.png")
    build_ios_home(ios_icon, preview_dir / "after-ios-home.png")


def _load_label_font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def build_launcher_home(android_fg: Image.Image, dest: Path) -> None:
    """Simulate a Pixel-style launcher tile: circular adaptive icon + label."""
    tile = 208
    canvas_w, canvas_h = 512, 400
    wallpaper = (32, 33, 36)
    home = Image.new("RGB", (canvas_w, canvas_h), wallpaper)
    android_viewport = crop_center(as_rgb_on_white(android_fg), VIEWPORT_RATIO)
    icon_resized = android_viewport.resize((tile, tile), Image.Resampling.LANCZOS)
    mask = circle_mask(tile)
    circular = icon_resized.convert("RGBA")
    circular.putalpha(mask)
    left = (canvas_w - tile) // 2
    top = 64
    home_rgba = home.convert("RGBA")
    home_rgba.alpha_composite(circular, (left, top))
    home = home_rgba.convert("RGB")
    draw = ImageDraw.Draw(home)
    label = "Somafrik"
    font = _load_label_font(28)
    bbox = draw.textbbox((0, 0), label, font=font)
    text_w = bbox[2] - bbox[0]
    draw.text(((canvas_w - text_w) // 2, top + tile + 18), label, fill=(248, 250, 252), font=font)
    home.save(dest, format="PNG", optimize=True)


def build_ios_home(ios_icon: Image.Image, dest: Path) -> None:
    """Simulate an iOS home-screen tile: rounded square, no baked corner radius in source."""
    tile = 208
    canvas_w, canvas_h = 512, 400
    wallpaper = (18, 18, 20)
    home = Image.new("RGB", (canvas_w, canvas_h), wallpaper)
    radius = round(tile * 0.2237)
    icon_resized = as_rgb_on_white(ios_icon).resize((tile, tile), Image.Resampling.LANCZOS)
    mask = rounded_rect_mask(tile, radius)
    rounded = icon_resized.convert("RGBA")
    rounded.putalpha(mask)
    left = (canvas_w - tile) // 2
    top = 64
    home_rgba = home.convert("RGBA")
    home_rgba.alpha_composite(rounded, (left, top))
    home = home_rgba.convert("RGB")
    draw = ImageDraw.Draw(home)
    label = "Somafrik"
    font = _load_label_font(28)
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

    ios_icon = place_mark(
        source,
        canvas_size=CANVAS_SIZE,
        target_width_ratio=IOS_CONTENT_WIDTH_RATIO,
        transparent=False,
    )
    android_fg = place_mark(
        source,
        canvas_size=CANVAS_SIZE,
        target_width_ratio=ANDROID_CONTENT_WIDTH_RATIO,
        transparent=True,
    )
    assert_android_circle_safe(android_fg)

    ios_path = ASSETS / "somafrik-app-icon.png"
    android_path = ASSETS / "somafrik-android-adaptive-foreground.png"
    ios_icon.save(ios_path, format="PNG", optimize=True)
    android_fg.save(android_path, format="PNG", optimize=True)
    if args.previews:
        build_previews(source, ios_icon, android_fg, args.previews)

    print(f"wrote {ios_path.relative_to(ROOT)}")
    print(f"  iOS content width target={IOS_CONTENT_WIDTH_RATIO:.0%} of {CANVAS_SIZE}px, centered, opaque")
    print(f"wrote {android_path.relative_to(ROOT)}")
    print(
        f"  Android content width target={ANDROID_CONTENT_WIDTH_RATIO:.0%} "
        f"of {CANVAS_SIZE}px, transparent, viewport {VIEWPORT_RATIO:.1%}"
    )
    if args.previews:
        print(f"wrote previews under {args.previews}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
