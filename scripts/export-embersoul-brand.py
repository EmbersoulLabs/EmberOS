#!/usr/bin/env python3
"""Export EmberSoul Labs brand assets: SVG + transparent PNG to Desktop."""

from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image

SOURCE = Path(
    r"C:\Users\USER\.cursor\projects\c-Users-USER-Desktop-CEO-agent\assets"
    r"\c__Users_USER_AppData_Roaming_Cursor_User_workspaceStorage_9febc2acaa6008e29e4b2dfa98d52215_images"
    r"_EMBERSOUL_LABS-e0d73659-7605-4293-8883-c07899f205ee.png"
)
DESKTOP = Path.home() / "Desktop" / "EmberSoulLabs-Brand"

BLUE = "#1E90FF"
TEAL = "#00D4B4"
ORANGE = "#FFB020"

MARK_INNER = f"""
  <defs>
    <linearGradient id="flameGrad" x1="40" y1="220" x2="160" y2="20" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{BLUE}"/>
      <stop offset="45%" stop-color="{TEAL}"/>
      <stop offset="100%" stop-color="{ORANGE}"/>
    </linearGradient>
    <linearGradient id="haloGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{ORANGE}" stop-opacity="0.25"/>
      <stop offset="50%" stop-color="{ORANGE}"/>
      <stop offset="100%" stop-color="{ORANGE}" stop-opacity="0.25"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M100 28c-18 38-52 58-52 98 0 32 22 58 52 66 30-8 52-34 52-66 0-40-34-60-52-98z" fill="url(#flameGrad)" opacity="0.95"/>
  <path d="M100 52c-12 24-32 38-32 64 0 22 14 40 32 46 18-6 32-24 32-46 0-26-20-40-32-64z" fill="url(#flameGrad)"/>
  <path d="M100 78c-6 14-18 22-18 38 0 12 8 22 18 26 10-4 18-14 18-26 0-16-12-24-18-38z" fill="#FFFFFF" opacity="0.2"/>
  <ellipse cx="100" cy="188" rx="18" ry="22" fill="#050505"/>
  <ellipse cx="100" cy="46" rx="52" ry="14" stroke="url(#haloGrad)" stroke-width="2.5" transform="rotate(-8 100 46)" filter="url(#glow)"/>
  <path d="M58 130 C34 110 28 88 42 68" stroke="{BLUE}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="48" cy="118" r="4" fill="{BLUE}"/>
  <circle cx="40" cy="98" r="3.5" fill="{BLUE}"/>
  <circle cx="38" cy="78" r="3" fill="{BLUE}"/>
  <path d="M142 130 C166 110 172 88 158 68" stroke="{ORANGE}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="152" cy="118" r="4" fill="{ORANGE}"/>
  <circle cx="160" cy="98" r="3.5" fill="{ORANGE}"/>
  <circle cx="162" cy="78" r="3" fill="{ORANGE}"/>
  <ellipse cx="100" cy="210" rx="36" ry="8" fill="{BLUE}" opacity="0.25"/>
"""

TEXT_STYLE = """
  <style>
    .title { font-family: Montserrat, 'Segoe UI', Arial, sans-serif; font-weight: 700; letter-spacing: 0.08em; fill: url(#textGrad); }
    .subtitle { font-family: Montserrat, 'Segoe UI', Arial, sans-serif; font-weight: 500; letter-spacing: 0.35em; fill: #FFFFFF; }
  </style>
"""

TEXT_GRAD = f"""
  <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="{BLUE}"/>
    <stop offset="50%" stop-color="{TEAL}"/>
    <stop offset="100%" stop-color="{ORANGE}"/>
  </linearGradient>
"""

ASSETS: dict[str, str] = {
    "icon-mark": f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" fill="none">{MARK_INNER}</svg>',
    "logo-stacked": f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 420" fill="none">
  <defs>{TEXT_GRAD}</defs>
  {TEXT_STYLE}
  <g transform="translate(160 0)">{MARK_INNER}</g>
  <text x="260" y="300" text-anchor="middle" class="title" font-size="52">EMBERSOUL</text>
  <line x1="150" y1="330" x2="210" y2="330" stroke="#FFFFFF" stroke-width="1.5" opacity="0.8"/>
  <text x="260" y="355" text-anchor="middle" class="subtitle" font-size="22">LABS</text>
  <line x1="310" y1="330" x2="370" y2="330" stroke="#FFFFFF" stroke-width="1.5" opacity="0.8"/>
</svg>""",
    "logo-horizontal": f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 240" fill="none">
  <defs>{TEXT_GRAD}</defs>
  {TEXT_STYLE}
  <g transform="translate(0 -10) scale(0.85)">{MARK_INNER}</g>
  <text x="210" y="105" class="title" font-size="42">EMBERSOUL</text>
  <line x1="210" y1="125" x2="260" y2="125" stroke="#FFFFFF" stroke-width="1.5" opacity="0.8"/>
  <text x="290" y="148" class="subtitle" font-size="18">LABS</text>
  <line x1="350" y1="125" x2="400" y2="125" stroke="#FFFFFF" stroke-width="1.5" opacity="0.8"/>
</svg>""",
    "app-icon-dark": f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1a2744"/>
      <stop offset="100%" stop-color="#0a0f18"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>
  <g transform="translate(156 96) scale(1.35)">{MARK_INNER}</g>
</svg>""",
    "app-icon-light": f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="112" fill="#F5F5F5"/>
  <g transform="translate(156 96) scale(1.35)">{MARK_INNER}</g>
</svg>""",
}

PNG_SIZES = {
    "icon-mark": 1024,
    "logo-stacked": 1040,
    "logo-horizontal": 1440,
    "app-icon-dark": 1024,
    "app-icon-light": 1024,
}

EXTRACT_CROPS: dict[str, tuple[tuple[int, int, int, int], bool]] = {
    "extracted-main-logo": ((310, 15, 710, 315), True),
    "extracted-logo-horizontal": ((55, 385, 300, 465), True),
    "extracted-logo-stacked": ((395, 492, 575, 555), True),
    "extracted-icon-mark": ((85, 498, 195, 558), True),
    "extracted-app-icon-dark": ((662, 492, 782, 565), False),
    "extracted-app-icon-light": ((835, 492, 955, 565), False),
}


def remove_dark_bg(img: Image.Image, threshold: int = 30) -> Image.Image:
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if r <= threshold and g <= threshold and b <= threshold:
                px[x, y] = (0, 0, 0, 0)
    return img


def trim_transparent(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    left, top, right, bottom = bbox
    return img.crop((
        max(0, left - pad),
        max(0, top - pad),
        min(img.width, right + pad),
        min(img.height, bottom + pad),
    ))


def svg_to_png(svg_path: Path, png_path: Path, width: int) -> None:
    cmd = f'npx --yes @resvg/resvg-js-cli --fit-width {width} "{svg_path}" "{png_path}"'
    result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)


def main() -> None:
    DESKTOP.mkdir(parents=True, exist_ok=True)
    svg_dir = DESKTOP / "svg"
    png_dir = DESKTOP / "png"
    extract_dir = DESKTOP / "png-extracted"
    for d in (svg_dir, png_dir, extract_dir):
        d.mkdir(exist_ok=True)

    for name, svg in ASSETS.items():
        path = svg_dir / f"{name}.svg"
        path.write_text(svg, encoding="utf-8")
        print(f"Wrote {path}")

    for name, width in PNG_SIZES.items():
        svg_path = svg_dir / f"{name}.svg"
        png_path = png_dir / f"{name}.png"
        svg_to_png(svg_path, png_path, width)
        print(f"Wrote {png_path}")

    source = Image.open(SOURCE)
    for name, (box, transparent) in EXTRACT_CROPS.items():
        cropped = source.crop(box)
        if transparent:
            cropped = trim_transparent(remove_dark_bg(cropped))
        out = extract_dir / f"{name}.png"
        cropped.save(out, "PNG")
        print(f"Wrote {out}")

    icon = trim_transparent(remove_dark_bg(source.crop((85, 498, 195, 558)), threshold=24))
    scale = 1024 / icon.width
    icon_large = icon.resize((1024, max(1, int(icon.height * scale))), Image.Resampling.LANCZOS)
    icon_large.save(png_dir / "icon-mark-from-photo-1024.png", "PNG")
    print(f"Wrote {png_dir / 'icon-mark-from-photo-1024.png'}")

    (DESKTOP / "README.txt").write_text(
        "EmberSoul Labs Brand Assets\n"
        "===========================\n\n"
        "svg/            Vector SVG (scalable)\n"
        "png/            PNG rendered from SVG + high-res icon from photo\n"
        "png-extracted/  PNG cropped from brand identity sheet\n\n"
        "Palette: #1E90FF | #00D4B4 | #FFB020\n"
        "Font: Montserrat Bold / Medium\n",
        encoding="utf-8",
    )
    print(f"\nDone -> {DESKTOP}")


if __name__ == "__main__":
    main()
