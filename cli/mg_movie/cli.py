"""Render a deep-zoom fractal dive to an MP4.

Frames are computed by the native core (`mg_core`, GIL released) across a thread
pool and piped as raw RGB to ffmpeg. The color mapping mirrors the browser
viewer's colorMap (cube-root spread + cyclic HSL).
"""
import argparse
import math
import os
import shutil
import subprocess
import sys
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, getcontext

import numpy as np
from PIL import Image, ImageDraw, ImageFont

try:
    import mg_core
except ImportError:
    sys.exit("error: native module `mg_core` not found. Build/install it first "
             "(`pip install .` from the repo root).")

getcontext().prec = 60  # headroom for the QD (~63-digit) center decomposition

INITIAL_RE_WIDTH = 3.5  # matches the browser viewer's reset width

# Fractals with a perturbation deep-zoom path, and the zoom past which we use it.
PERTURB_FRACTALS = {"mandelbrot", "julia", "multibrot"}
PERTURB_MIN_ZOOM = 1e10


def decimal_to_qd(d):
    """Decompose a Decimal into a quad-double (4 non-overlapping doubles whose
    sum reproduces the value to ~63 digits). Decimal(float) is exact, so each
    remainder is computed without loss."""
    parts, r = [], d
    for _ in range(4):
        f = float(r)
        parts.append(f)
        r = r - Decimal(f)
    return parts

FRACTALS = {
    "mandelbrot":   mg_core.Fractal.MANDELBROT,
    "julia":        mg_core.Fractal.JULIA,
    "multibrot":    mg_core.Fractal.MULTIBROT,
    "tricorn":      mg_core.Fractal.TRICORN,
    "burning_ship": mg_core.Fractal.BURNING_SHIP,
}
PRECISIONS = {
    "f64": mg_core.Precision.F64,
    "dd":  mg_core.Precision.DD,
    "qd":  mg_core.Precision.QD,
}


def viewport(cx, cy, zoom, w, h):
    """Center+zoom -> (re_min, re_max, im_min, im_max), preserving aspect."""
    re_w = INITIAL_RE_WIDTH / zoom
    im_h = re_w * h / w
    return (cx - re_w / 2, cx + re_w / 2, cy - im_h / 2, cy + im_h / 2)


def zoom_schedule(z0, z1, frames):
    """Geometric (constant-speed) interpolation between two zoom levels."""
    if frames <= 1:
        return [z0]
    ratio = (z1 / z0) ** (1.0 / (frames - 1))
    return [z0 * ratio ** i for i in range(frames)]


def colorize(smooth, max_iter, cycles):
    """Vectorized port of the viewer's colorMap. Returns uint8 (H, W, 3)."""
    inset = smooth < 0
    t = np.clip(smooth / (max_iter - 1), 0.0, 1.0)
    t = np.cbrt(t)                       # spread the low-escape region
    h6 = np.mod(t * cycles, 1.0) * 6.0
    hi = np.floor(h6).astype(np.int32)
    x = 1.0 - np.abs(np.mod(h6, 2.0) - 1.0)
    one = np.ones_like(h6)
    zero = np.zeros_like(h6)
    conds = [hi == 0, hi == 1, hi == 2, hi == 3, hi == 4]  # else -> hi == 5
    r = np.select(conds, [one, x, zero, zero, x], default=one)
    g = np.select(conds, [x, one, one, x, zero], default=zero)
    b = np.select(conds, [zero, zero, x, one, one], default=x)
    rgb = np.stack([r, g, b], axis=-1)
    rgb[inset] = 0.0
    return np.clip(np.round(rgb * 255.0), 0, 255).astype(np.uint8)


# --- Lower-third caption overlay -------------------------------------------

_FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
_SUP = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")


def load_font(size):
    """A sans-serif TrueType font at `size` px; falls back to Pillow's bundled
    scalable default (>=10.1) if no system font is found."""
    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def fmt_zoom(z):
    """Scientific magnitude, e.g. 1e6 -> "×1.0×10⁶"."""
    exp = math.floor(math.log10(z)) if z > 0 else 0
    mant = z / (10.0 ** exp)
    return f"×{mant:.1f}×10{str(exp).translate(_SUP)}"


def displayed_zoom(zooms, i, frames, fps):
    """Zoom shown on frame `i`: ticks once per second (every `fps` frames) so
    the number doesn't flicker, and snaps to the exact end on the last frame."""
    if i >= frames - 1:
        return zooms[-1]
    return zooms[min((i // fps) * fps, frames - 1)]


def make_overlay(title, cre_dec, cim_dec, zoom_end, w, h):
    """Build a per-frame lower-third drawer. The title, center coordinates, fonts
    and geometry are fixed up front; the returned `draw(frame, zoom_str)` only
    stamps the changing zoom line. iMovie "line lower third" look: white text +
    accent line with a soft drop shadow, anchored lower-left."""
    pad = max(8, h // 25)
    title_font = load_font(max(12, h // 22))
    body_font = load_font(max(10, h // 28))
    shadow = max(1, h // 400)

    decimals = max(6, math.ceil(math.log10(zoom_end)) + 3) if zoom_end > 1 else 6
    coords = f"Re {cre_dec:+.{decimals}f}   Im {cim_dec:+.{decimals}f}"

    # Vertical stack measured from a probe so we can anchor to the bottom edge.
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    def text_h(font):
        b = probe.textbbox((0, 0), "Xg", font=font)
        return b[3] - b[1]

    th, bh = text_h(title_font), text_h(body_font)
    gap = max(2, h // 120)
    line_y_off = th + gap                       # baseline area for the accent line
    coords_y_off = line_y_off + gap + 2
    zoom_y_off = coords_y_off + bh + gap // 2
    block_h = zoom_y_off + bh
    top = h - pad - block_h
    line_w = max(probe.textlength(title, font=title_font),
                 probe.textlength(coords, font=body_font))

    def text(d, xy, s, font):
        x, y = xy
        d.text((x + shadow, y + shadow), s, font=font, fill=(0, 0, 0))
        d.text((x, y), s, font=font, fill=(255, 255, 255))

    def draw(frame, zoom_str):
        img = Image.fromarray(frame)
        d = ImageDraw.Draw(img)
        text(d, (pad, top), title, title_font)
        ly = top + line_y_off
        d.rectangle([pad, ly, pad + line_w, ly + 1], fill=(255, 255, 255))
        text(d, (pad, top + coords_y_off), coords, body_font)
        text(d, (pad, top + zoom_y_off), f"Zoom  {zoom_str}", body_font)
        return np.asarray(img)

    return draw


def build_parser():
    p = argparse.ArgumentParser(
        prog="mg-movie",
        description="Render a deep-zoom fractal dive to an MP4 video.")
    p.add_argument("-o", "--output", default="dive.mp4", help="output video path")
    p.add_argument("--fractal", choices=FRACTALS, default="mandelbrot")
    # Strings so deep-zoom centers keep full precision (parsed as Decimal -> QD).
    p.add_argument("--center-re", type=str, default="-0.743643887037151")
    p.add_argument("--center-im", type=str, default="0.13182590420533")
    p.add_argument("--zoom-start", type=float, default=1.0)
    p.add_argument("--zoom-end", type=float, default=1e6)
    p.add_argument("--frames", type=int, default=300)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--height", type=int, default=720)
    p.add_argument("--max-iter", type=int, default=4096)
    p.add_argument("--cycles", type=float, default=2.0, help="color cycles")
    p.add_argument("--escape-r2", type=float, default=4.0)
    p.add_argument("--precision", choices=PRECISIONS, default=None,
                   help="force a precision tier (default: auto by zoom depth)")
    p.add_argument("--degree", type=int, default=3, help="multibrot exponent")
    p.add_argument("--julia-re", type=float, default=-0.123)
    p.add_argument("--julia-im", type=float, default=0.745)
    p.add_argument("--crf", type=int, default=18, help="x264 quality (lower=better)")
    p.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    p.add_argument("--title", default=None,
                   help="if set, overlay a lower-third caption (title + center + zoom)")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("error: ffmpeg not found on PATH.")

    # libx264 + yuv420p require even dimensions.
    w, h = args.width - (args.width & 1), args.height - (args.height & 1)
    if (w, h) != (args.width, args.height):
        print(f"note: rounding size to even {w}x{h} for yuv420p", file=sys.stderr)

    fractal = int(FRACTALS[args.fractal])
    forced = int(PRECISIONS[args.precision]) if args.precision else None
    zooms = zoom_schedule(args.zoom_start, args.zoom_end, args.frames)

    cre_dec, cim_dec = Decimal(args.center_re), Decimal(args.center_im)
    cre_f64, cim_f64 = float(cre_dec), float(cim_dec)
    cre_qd, cim_qd = decimal_to_qd(cre_dec), decimal_to_qd(cim_dec)
    # Perturbation handles the deep frames (and removes the f64-center wall) for
    # the supported fractals, unless the user pinned a precision tier.
    perturb_ok = args.fractal in PERTURB_FRACTALS and forced is None

    overlay = (make_overlay(args.title, cre_dec, cim_dec, args.zoom_end, w, h)
               if args.title is not None else None)

    def render_one(idx):
        zoom = zooms[idx]
        re_w = INITIAL_RE_WIDTH / zoom
        if perturb_ok and zoom > PERTURB_MIN_ZOOM:
            im_h = re_w * h / w
            smooth = mg_core.render_frame_perturb(
                fractal, cre_qd, cim_qd, re_w, im_h, w, h,
                args.max_iter, args.escape_r2, args.degree, args.julia_re, args.julia_im)
        else:
            prec = forced if forced is not None else mg_core.choose_precision(re_w)
            rmin, rmax, imin, imax = viewport(cre_f64, cim_f64, zoom, w, h)
            smooth = mg_core.render_frame(
                fractal, prec, rmin, rmax, imin, imax, w, h,
                args.max_iter, args.escape_r2, args.degree, args.julia_re, args.julia_im)
        frame = colorize(smooth, args.max_iter, args.cycles)
        if overlay is not None:
            frame = overlay(frame, fmt_zoom(
                displayed_zoom(zooms, idx, args.frames, args.fps)))
        return frame.tobytes()

    cmd = [ffmpeg, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pixel_format", "rgb24",
           "-video_size", f"{w}x{h}", "-framerate", str(args.fps),
           "-i", "-",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(args.crf),
           "-movflags", "+faststart", args.output]

    print(f"Rendering {args.frames} frames ({w}x{h}) "
          f"{args.fractal} zoom {args.zoom_start:g}->{args.zoom_end:g} "
          f"on {args.workers} workers -> {args.output}")

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    window = max(1, args.workers) * 2
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            pending = deque()
            submit_idx = 0
            for done in range(args.frames):
                while submit_idx < args.frames and len(pending) < window:
                    pending.append(ex.submit(render_one, submit_idx))
                    submit_idx += 1
                proc.stdin.write(pending.popleft().result())
                if (done + 1) % 10 == 0 or done + 1 == args.frames:
                    print(f"\r  {done + 1}/{args.frames} frames", end="", flush=True)
        print()
    finally:
        proc.stdin.close()
        rc = proc.wait()
    if rc != 0:
        sys.exit(f"ffmpeg exited with code {rc}")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
