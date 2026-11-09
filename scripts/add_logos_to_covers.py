#!/usr/bin/env python3
"""
scripts/add_logos_to_covers.py

Overlays the Google Developer Experts (GDE) logo and Google AI Classroom project
logo onto all 10 blog cover images in docs/blogs/images/.

Design & Layout Specifications:
- GDE Logo: https://developers.google.com/community/experts/images/gd_experts_lockup_horizontal_color.png?hl=zh-tw
- Project Logo: web-app/src/assets/logo.jpg (Classroom Mortarboard Cap + Circuit Traces)
- Placement: Sleek floating top-right badge (332x64 px) with 14px rounded corners,
  white background, subtle slate border, and soft drop shadow.
- Canvas preservation: 1376x768 px untouched, zero overlap with blog title text.
- Optimization: RGB PNG with optimize=True for fast DEV.to loading.
"""

import os
import glob
import urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BLOG_IMAGES_DIR = os.path.join(REPO_ROOT, "docs", "blogs", "images")
GDE_LOCAL_PATH = os.path.join(BLOG_IMAGES_DIR, "gde_lockup_horizontal_color.png")
PROJ_LOGO_PATH = os.path.join(REPO_ROOT, "web-app", "src", "assets", "logo.jpg")

GDE_REMOTE_URL = "https://developers.google.com/community/experts/images/gd_experts_lockup_horizontal_color.png?hl=zh-tw"


def ensure_gde_logo():
    if not os.path.exists(GDE_LOCAL_PATH):
        print(f"Downloading GDE logo from {GDE_REMOTE_URL}...")
        urllib.request.urlretrieve(GDE_REMOTE_URL, GDE_LOCAL_PATH)
    return Image.open(GDE_LOCAL_PATH).convert("RGBA")


def prepare_project_logo():
    raw = Image.open(PROJ_LOGO_PATH).convert("RGBA")
    # Crop to content bbox
    cropped = raw.crop((0, 21, 1024, 764))
    arr = np.array(cropped, dtype=float)
    # Clamp near-white JPEG compression artifacts to pure white for seamless blending
    dist_from_white = np.sqrt(
        (255 - arr[:, :, 0]) ** 2
        + (255 - arr[:, :, 1]) ** 2
        + (255 - arr[:, :, 2]) ** 2
    )
    arr[dist_from_white < 20, :3] = 255
    return Image.fromarray(arr.astype("uint8"))


def create_branding_badge(h_content=44, pad_x=16, pad_y=10, gap=14):
    gde = ensure_gde_logo()
    proj = prepare_project_logo()

    gde_w = int(gde.width * (h_content / gde.height))
    gde_resized = gde.resize((gde_w, h_content), Image.Resampling.LANCZOS)

    proj_w = int(proj.width * (h_content / proj.height))
    proj_resized = proj.resize((proj_w, h_content), Image.Resampling.LANCZOS)

    divider_w = 1
    badge_w = pad_x + proj_w + gap + divider_w + gap + gde_w + pad_x
    badge_h = h_content + 2 * pad_y

    badge = Image.new("RGBA", (badge_w, badge_h), (255, 255, 255, 250))
    draw = ImageDraw.Draw(badge)
    draw.rounded_rectangle(
        [(0, 0), (badge_w - 1, badge_h - 1)],
        radius=14,
        fill=(255, 255, 255, 250),
        outline=(226, 232, 240, 255),
        width=1,
    )

    # Paste Project Logo
    x_proj = pad_x
    y_proj = pad_y
    badge.paste(proj_resized, (x_proj, y_proj), proj_resized)

    # Subtle vertical divider
    x_div = x_proj + proj_w + gap
    draw.line(
        [(x_div, pad_y + 4), (x_div, badge_h - pad_y - 4)],
        fill=(203, 213, 225, 255),
        width=1,
    )

    # Paste GDE Logo
    x_gde = x_div + gap
    y_gde = pad_y
    badge.paste(gde_resized, (x_gde, y_gde), gde_resized)

    # Soft drop-shadow
    shadow = Image.new("RGBA", (badge_w + 24, badge_h + 24), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    s_draw.rounded_rectangle(
        [(8, 8), (badge_w + 15, badge_h + 15)],
        radius=14,
        fill=(0, 0, 0, 115),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=7))

    return badge, shadow, badge_w, badge_h


def process_all_covers():
    badge, shadow, badge_w, badge_h = create_branding_badge()
    print(f"Created branding badge: {badge_w}x{badge_h} px")

    covers = sorted(glob.glob(os.path.join(BLOG_IMAGES_DIR, "blog*_cover_*.png")))
    if not covers:
        raise RuntimeError(f"No cover images found in {BLOG_IMAGES_DIR}")

    for cover_path in covers:
        base = Image.open(cover_path).convert("RGBA")
        orig_w, orig_h = base.size

        pos_x = orig_w - badge_w - 36
        pos_y = 32

        base.paste(shadow, (pos_x - 8, pos_y - 4), shadow)
        base.paste(badge, (pos_x, pos_y), badge)

        # Save as RGB optimized PNG
        rgb_output = base.convert("RGB")
        rgb_output.save(cover_path, format="PNG", optimize=True)
        size_kb = os.path.getsize(cover_path) / 1024
        print(f"Updated {os.path.basename(cover_path)}: {orig_w}x{orig_h} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    process_all_covers()
