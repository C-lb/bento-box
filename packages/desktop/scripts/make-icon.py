#!/usr/bin/env python3
"""Generate the Event Editor app icon (icns + ico) from a single drawn master.

Design (anti-vibecode: one accent over a neutral system): a charcoal rounded
square tile with a white photo/image glyph (frame, sun, mountains) and one warm
amber accent on the sun. Reads as a photo/event editor at every size.
"""
import os
import subprocess
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024
CHARCOAL = (22, 24, 29, 255)
WHITE = (245, 245, 247, 255)
AMBER = (232, 163, 61, 255)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # tile
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=CHARCOAL)

    # photo frame (rounded rect outline)
    m = int(S * 0.20)
    fx0, fy0, fx1, fy1 = m, int(S * 0.27), S - m, S - int(S * 0.27)
    stroke = int(S * 0.045)
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=int(S * 0.06),
                        outline=WHITE, width=stroke)

    # clip inner content to the frame's inner area
    inner = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    di = ImageDraw.Draw(inner)
    pad = stroke // 2 + 2
    ix0, iy0, ix1, iy1 = fx0 + pad, fy0 + pad, fx1 - pad, fy1 - pad

    # sun (accent)
    r = int(S * 0.055)
    cx, cy = ix0 + int((ix1 - ix0) * 0.30), iy0 + int((iy1 - iy0) * 0.30)
    di.ellipse([cx - r, cy - r, cx + r, cy + r], fill=AMBER)

    # mountains (white triangles) rising from the frame's bottom edge
    base = iy1
    di.polygon([(ix0, base), (ix0 + int((ix1 - ix0) * 0.42), iy0 + int((iy1 - iy0) * 0.50)),
                (ix0 + int((ix1 - ix0) * 0.66), base)], fill=WHITE)
    di.polygon([(ix0 + int((ix1 - ix0) * 0.40), base),
                (ix0 + int((ix1 - ix0) * 0.74), iy0 + int((iy1 - iy0) * 0.62)),
                (ix1, base)], fill=WHITE)

    cmask = Image.new("L", (S, S), 0)
    dc = ImageDraw.Draw(cmask)
    dc.rounded_rectangle([ix0, iy0, ix1, iy1], radius=int(S * 0.045), fill=255)
    img.paste(inner, (0, 0), Image.composite(inner.split()[3], Image.new("L", (S, S), 0), cmask))

    # apply outer rounded mask so corners are clean
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded_mask(S, int(S * 0.22)))
    return out


def main():
    master = draw_master()
    master.save(os.path.join(OUT, "icon.png"))

    # .icns via iconutil (macOS)
    iconset = os.path.join(OUT, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    specs = [
        (16, "16x16"), (32, "16x16@2x"), (32, "32x32"), (64, "32x32@2x"),
        (128, "128x128"), (256, "128x128@2x"), (256, "256x256"), (512, "256x256@2x"),
        (512, "512x512"), (1024, "512x512@2x"),
    ]
    for px, name in specs:
        master.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, f"icon_{name}.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "icon.icns")], check=True)

    # .ico (Windows) - multi-size
    master.save(os.path.join(OUT, "icon.ico"),
                sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    print("wrote", os.path.join(OUT, "icon.icns"), "and icon.ico and icon.png")


if __name__ == "__main__":
    main()
