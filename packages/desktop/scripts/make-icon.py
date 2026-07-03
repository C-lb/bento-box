#!/usr/bin/env python3
"""Generate the Event Editor app icon (icns + ico) from a single drawn master.

Design: matches the web favicon (packages/web/app/icon.svg). A charcoal rounded
square tile with a lowercase "ee" wordmark in white DM Sans, tightly tracked.
One neutral system, no decorative colour.
"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
FONT = os.path.join(HERE, "..", "..", "web", "assets", "fonts", "DMSans-Medium.ttf")
os.makedirs(OUT, exist_ok=True)

S = 1024
CHARCOAL = (26, 29, 35, 255)  # #1a1d23, matches favicon rect fill
WHITE = (255, 255, 255, 255)

# favicon ratios (64px viewBox): rx 15, font-size 34, letter-spacing -2
RADIUS = 0.234   # 15/64
FONT_PX = 0.531  # 34/64
TRACK = 2 / 64   # letter-spacing -2


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # tile
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * RADIUS), fill=CHARCOAL)

    # "ee" wordmark: draw glyphs left-to-right with negative tracking on a scratch
    # layer, then crop to ink and centre on the tile (robust vertical centring).
    font = ImageFont.truetype(FONT, int(S * FONT_PX))
    tracking = -int(S * TRACK)
    scratch = Image.new("RGBA", (S * 2, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scratch)
    x, baseline = 0, int(S * 0.5)
    for ch in "ee":
        sd.text((x, baseline), ch, font=font, fill=WHITE, anchor="ls")
        x += int(sd.textlength(ch, font=font)) + tracking

    bbox = scratch.getbbox()
    glyphs = scratch.crop(bbox)
    gw, gh = glyphs.size
    img.alpha_composite(glyphs, ((S - gw) // 2, (S - gh) // 2))

    # apply outer rounded mask so corners are clean
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded_mask(S, int(S * RADIUS)))
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
