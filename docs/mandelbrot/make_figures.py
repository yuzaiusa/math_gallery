#!/usr/bin/env python3
"""Generate the illustrations for docs/mandelbrot/notes.md.

Pure numpy escape-time + the viewer's exact color map, so the figures look
native to the gallery. Run from anywhere:  python3 docs/mandelbrot/make_figures.py
Outputs PNGs into docs/mandelbrot/figures/.
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Arc, Circle

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "figures")
os.makedirs(OUT, exist_ok=True)

# --- site palette ----------------------------------------------------------
BG, FG, MUT = "#0d0d10", "#ece8e1", "#9aa1ad"
CYAN, AMBER, LINE = "#6cc6ff", "#f2b15c", "#2d323e"
PINK = "#ff86c8"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "text.color": FG, "axes.labelcolor": FG, "axes.edgecolor": LINE,
    "xtick.color": MUT, "ytick.color": MUT, "font.size": 12,
    "axes.titlecolor": FG, "font.family": "DejaVu Sans",
})


# --- core: escape-time + viewer color map ----------------------------------
def mandel_smooth(rmin, rmax, imin, imax, W, H, max_iter=400, R=512.0):
    re = np.linspace(rmin, rmax, W)
    im = np.linspace(imax, imin, H)              # top row = imax
    C = re[None, :] + 1j * im[:, None]
    Z = np.zeros_like(C)
    out = np.full(C.shape, -1.0)
    alive = np.ones(C.shape, bool)
    for i in range(max_iter):
        Z[alive] = Z[alive] * Z[alive] + C[alive]
        mag = np.abs(Z)
        esc = alive & (mag > R)
        if esc.any():
            out[esc] = i + 1 - np.log2(np.log(mag[esc]))
            alive &= ~esc
        if not alive.any():
            break
    return out


def colorize(smooth, max_iter=400, cycles=2.4):
    """Vectorized port of the viewer/CLI colorMap (cube-root + cyclic HSL)."""
    inset = smooth < 0
    t = np.clip(smooth / (max_iter - 1), 0.0, 1.0)
    t = np.cbrt(t)
    h6 = np.mod(t * cycles, 1.0) * 6.0
    x = 1.0 - np.abs(np.mod(h6, 2.0) - 1.0)
    hi = np.floor(h6).astype(int)
    one, zero = np.ones_like(h6), np.zeros_like(h6)
    r = np.select([hi == 0, hi == 1, hi == 2, hi == 3, hi == 4],
                  [one, x, zero, zero, x], default=one)
    g = np.select([hi == 0, hi == 1, hi == 2, hi == 3, hi == 4],
                  [x, one, one, x, zero], default=zero)
    b = np.select([hi == 0, hi == 1, hi == 2, hi == 3, hi == 4],
                  [zero, zero, x, one, one], default=x)
    rgb = np.stack([r, g, b], -1)
    rgb[inset] = 0.0
    return rgb


def set_image(ax, rmin, rmax, imin, imax, W, H, mi=400, cyc=2.4):
    sm = mandel_smooth(rmin, rmax, imin, imax, W, H, mi)
    ax.imshow(colorize(sm, mi, cyc), extent=[rmin, rmax, imin, imax],
              origin="upper", interpolation="bilinear", aspect="equal")


def arrow(ax, p0, p1, color, lw=1.8, style="-|>", ls="-", alpha=1.0):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle=style, mutation_scale=14,
                                 color=color, lw=lw, linestyle=ls, alpha=alpha,
                                 shrinkA=0, shrinkB=0, zorder=5))


def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=130, bbox_inches="tight", pad_inches=0.15)
    plt.close(fig)
    print("wrote", os.path.relpath(path))


# ===========================================================================
# F1 — the set with its named regions
# ===========================================================================
def fig_regions():
    fig, ax = plt.subplots(figsize=(9, 7))
    set_image(ax, -2.2, 0.7, -1.25, 1.25, 1300, 1200, mi=500, cyc=2.4)
    ax.set_xlim(-2.2, 0.7); ax.set_ylim(-1.25, 1.25)

    def tag(text, xy, xytext, col=FG):
        ax.annotate(text, xy=xy, xytext=xytext, color=col, fontsize=11.5,
                    ha="center", va="center", zorder=6,
                    arrowprops=dict(arrowstyle="-", color=col, lw=1, alpha=0.8),
                    bbox=dict(boxstyle="round,pad=0.3", fc=BG, ec=LINE, alpha=0.85))

    tag("main cardioid\n(attracting fixed point)", (-0.2, 0.0), (-0.2, 0.62))
    tag("period-2 bulb", (-1.0, 0.0), (-1.45, 0.55), CYAN)
    tag("period-3 bulb", (-0.122, 0.745), (0.15, 1.02), CYAN)
    tag("cusp (c = 1/4)", (0.25, 0.0), (0.5, 0.42), AMBER)
    tag("seahorse valley", (-0.75, 0.08), (-0.62, 0.78), AMBER)
    tag("elephant valley", (0.30, 0.06), (0.45, -0.5), AMBER)
    tag("antenna / needle\n(real spike to c = −2)", (-1.62, 0.0), (-1.7, 0.62))
    tag("a mini-Mandelbrot\n(satellite)", (-1.75, 0.0), (-1.95, -0.62), PINK)
    ax.set_xlabel("Re(c)"); ax.set_ylabel("Im(c)")
    ax.set_title("The Mandelbrot set and its landmarks", pad=12)
    save(fig, "01_regions.png")


# ===========================================================================
# F2 — the squaring map: z -> z^2 (double angle, square modulus) -> +c
# ===========================================================================
def fig_squaring():
    fig, ax = plt.subplots(figsize=(8.4, 8.4))
    ax.set_aspect("equal")
    for rr in (1.0, 2.0):
        ax.add_patch(Circle((0, 0), rr, fill=False, ec=LINE, lw=1.2, ls="--"))
    ax.text(0.05, 1.02, "|z| = 1", color=MUT, fontsize=9.5)
    ax.text(0.05, 2.03, "|z| = 2  (bailout)", color=MUT, fontsize=9.5)
    ax.axhline(0, color=LINE, lw=0.8); ax.axvline(0, color=LINE, lw=0.8)

    # z inside the unit disk: squaring SHRINKS it (|z| < 1) and doubles the angle;
    # then +c keeps the point inside the bailout circle — one step of a bounded orbit.
    z = 0.8 * (0.5 * np.sqrt(3) + 0.5j)     # = 0.8 · e^{i30°},  |z| = 0.8
    z2 = z * z                              # = 0.64 · e^{i60°}
    c = -0.5 + 0.5j
    znext = z2 + c
    th = np.angle(z)

    O = (0, 0)
    arrow(ax, O, (z.real, z.imag), CYAN, lw=2.3)
    arrow(ax, O, (z2.real, z2.imag), AMBER, lw=2.3)
    arrow(ax, (z2.real, z2.imag), (znext.real, znext.imag), PINK, lw=2.3)

    ax.add_patch(Arc(O, 1.4, 1.4, theta1=0, theta2=np.rad2deg(th), color=CYAN, lw=1.6))
    ax.add_patch(Arc(O, 1.0, 1.0, theta1=0, theta2=np.rad2deg(2 * th), color=AMBER, lw=1.6))
    ax.text(0.78, 0.16, "θ", color=CYAN, fontsize=14)
    ax.text(0.26, 0.55, "2θ", color=AMBER, fontsize=14)

    ax.scatter([z.real, z2.real, znext.real], [z.imag, z2.imag, znext.imag],
               color=[CYAN, AMBER, PINK], zorder=7, s=46)
    ax.annotate("z = 0.8·e^{iθ}\n|z| = 0.8  (inside |z| = 1)", (z.real, z.imag),
                (z.real + 0.18, z.imag - 0.34), color=CYAN, fontsize=11.5, va="top",
                arrowprops=dict(arrowstyle="-", color=CYAN, lw=0.8, alpha=0.7))
    ax.annotate("z²\n|z²| = 0.8² = 0.64\n(shrinks, since |z| < 1)\nangle doubled to 2θ",
                (z2.real, z2.imag), (z2.real + 0.5, z2.imag + 0.5),
                color=AMBER, fontsize=11.5, va="center", ha="left",
                arrowprops=dict(arrowstyle="-", color=AMBER, lw=0.8, alpha=0.7))
    ax.annotate("z² + c\n(still inside |z| = 2)", (znext.real, znext.imag),
                (znext.real - 1.75, znext.imag + 0.22), color=PINK, fontsize=11.5, va="center",
                arrowprops=dict(arrowstyle="-", color=PINK, lw=0.8, alpha=0.7))
    ax.text((z2.real + znext.real) / 2 - 0.2, (z2.imag + znext.imag) / 2 - 0.02,
            "+c", color=MUT, fontsize=11)

    ax.set_xlim(-2.5, 2.9); ax.set_ylim(-2.4, 2.4)
    ax.set_xlabel("Re"); ax.set_ylabel("Im")
    ax.set_title("One iteration:  square (modulus → modulus², angle → 2θ),  then shift by c\n"
                 "here |z| < 1, so squaring pulls inward — and the step stays inside the bailout circle",
                 pad=12, fontsize=11.5)
    save(fig, "02_squaring_map.png")


# ===========================================================================
# F3 — orbits: bounded vs escaping, and why c = -2 is the tip
# ===========================================================================
def fig_orbits():
    fig, axs = plt.subplots(1, 2, figsize=(13, 5.2))
    cases = [(0.0 + 0j, "c = 0  → fixed point 0", CYAN),
             (-1.0 + 0j, "c = −1  → 2-cycle {0, −1}", AMBER),
             (-2.0 + 0j, "c = −2  → lands on 2 (the tip, in M)", PINK),
             (0.30 + 0j, "c = 0.3  → escapes", "#8fe388")]
    ax = axs[0]
    for c, lab, col in cases:
        z, mags = 0j, []
        for _ in range(18):
            mags.append(abs(z)); z = z * z + c
            if abs(z) > 1e6:
                mags.append(abs(z)); break
        ax.plot(range(len(mags)), mags, "-o", color=col, lw=1.6, ms=4, label=lab)
    ax.axhline(2, color=FG, ls="--", lw=1, alpha=0.7)
    ax.text(12, 2.15, "bailout |z| = 2", color=FG, fontsize=10)
    ax.set_yscale("symlog"); ax.set_ylim(-0.1, 1e3)
    ax.set_xlabel("iteration n"); ax.set_ylabel("|zₙ|")
    ax.set_title("Magnitude of the orbit of 0"); ax.legend(fontsize=9, loc="upper left",
                 facecolor=BG, edgecolor=LINE, labelcolor=FG)

    ax = axs[1]
    ax.add_patch(Circle((0, 0), 2, fill=False, ec=LINE, ls="--", lw=1.2))
    ax.axhline(0, color=LINE, lw=0.7); ax.axvline(0, color=LINE, lw=0.7)
    for c, lab, col in [(-1.0 + 0j, "c = −1 (2-cycle)", AMBER),
                        (-0.5 + 0.55j, "c = −0.5+0.55i (spiral in)", CYAN),
                        (0.36 + 0.10j, "c = 0.36+0.1i (escapes)", "#8fe388")]:
        z, pts = 0j, []
        for _ in range(40):
            pts.append(z); z = z * z + c
            if abs(z) > 2.4:
                pts.append(z); break
        xs, ys = [p.real for p in pts], [p.imag for p in pts]
        ax.plot(xs, ys, "-o", color=col, ms=3, lw=1.2, label=lab)
    ax.set_xlim(-2.6, 2.6); ax.set_ylim(-2.6, 2.6); ax.set_aspect("equal")
    ax.set_xlabel("Re(z)"); ax.set_ylabel("Im(z)")
    ax.set_title("Orbits in the z-plane"); ax.legend(fontsize=9, loc="lower right",
                 facecolor=BG, edgecolor=LINE, labelcolor=FG)
    save(fig, "03_orbits.png")


# ===========================================================================
# F4 — bulbs labeled by rotation number p/q along the cardioid
# ===========================================================================
def cardioid_point(lam):              # boundary of main cardioid, multiplier lam
    return lam / 2 - lam * lam / 4


def fig_bulbs():
    fig, ax = plt.subplots(figsize=(9, 7.5))
    set_image(ax, -1.45, 0.55, -0.95, 0.95, 1300, 1240, mi=500, cyc=2.4)
    ax.set_xlim(-1.45, 0.55); ax.set_ylim(-0.95, 0.95)
    bulbs = [(1, 2), (1, 3), (2, 3), (1, 4), (3, 4), (2, 5), (3, 5),
             (1, 5), (4, 5), (1, 6), (5, 6)]
    for p, q in bulbs:
        lam = np.exp(2j * np.pi * p / q)
        c = cardioid_point(lam)
        out = c + 0.16 * np.exp(1j * np.angle(c - (-0.0 + 0j)))   # push label outward
        out = c * 1.18 + (0.04 if c.imag >= 0 else -0.04) * 1j
        ax.scatter([c.real], [c.imag], color=FG, s=14, zorder=6)
        ax.annotate(f"{p}/{q}", (c.real, c.imag), (out.real, out.imag),
                    color=FG, fontsize=10.5, ha="center", va="center", zorder=7,
                    arrowprops=dict(arrowstyle="-", color=FG, lw=0.8, alpha=0.7),
                    bbox=dict(boxstyle="round,pad=0.18", fc=BG, ec=LINE, alpha=0.85))
    ax.set_xlabel("Re(c)"); ax.set_ylabel("Im(c)")
    ax.set_title("Bulbs on the main cardioid carry a rotation number p/q\n"
                 "(the attached bulb has an attracting q-cycle)", pad=12, fontsize=12.5)
    save(fig, "04_bulbs_rational.png")


# ===========================================================================
# F5 — bifurcation diagram aligned to the real slice of M
# ===========================================================================
def fig_bifurcation():
    cs = np.linspace(-2.0, 0.25, 3000)
    x = np.zeros_like(cs)
    for _ in range(800):                      # transient
        x = x * x + cs
    pts_c, pts_x = [], []
    for _ in range(260):                      # sample the attractor
        x = x * x + cs
        ok = np.abs(x) < 4
        pts_c.append(cs[ok]); pts_x.append(x[ok])
    pc = np.concatenate(pts_c); px = np.concatenate(pts_x)

    fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 7), sharex=True,
                                 gridspec_kw=dict(height_ratios=[3, 1], hspace=0.08))
    a1.scatter(pc, px, s=0.12, color=CYAN, alpha=0.5, lw=0)
    a1.set_ylabel("attractor of  xₙ₊₁ = xₙ² + c")
    a1.set_ylim(-2.1, 2.1)
    a1.set_title("Period-doubling road to chaos along the real axis", pad=10)
    for c0, lab in [(-0.75, "1→2"), (-1.25, "2→4"), (-1.368, "4→8"),
                    (-1.401, "Feigenbaum\npoint"), (-1.75, "period-3\nwindow")]:
        a1.axvline(c0, color=AMBER, lw=0.8, ls=":", alpha=0.8)
        a1.text(c0, 1.75, lab, color=AMBER, fontsize=8.5, ha="center", va="top")

    # the real slice of the set just below the axis
    set_image(a2, -2.0, 0.25, -0.04, 0.04, 2200, 80, mi=600, cyc=2.0)
    a2.set_yticks([]); a2.set_ylabel("M on ℝ", fontsize=10)
    a2.set_xlabel("c")
    save(fig, "05_bifurcation.png")


# ===========================================================================
# F5a — the classic logistic-map bifurcation diagram
# ===========================================================================
def fig_logistic():
    rs = np.linspace(2.5, 4.0, 3000)
    x = np.full_like(rs, 0.5)
    for _ in range(800):                      # transient
        x = rs * x * (1 - x)
    pr, px = [], []
    for _ in range(260):                      # sample the attractor
        x = rs * x * (1 - x)
        pr.append(rs.copy()); px.append(x.copy())
    pr = np.concatenate(pr); px = np.concatenate(px)

    fig, ax = plt.subplots(figsize=(11, 6))
    ax.scatter(pr, px, s=0.10, color=CYAN, alpha=0.45, lw=0)
    ax.set_xlim(2.5, 4.0); ax.set_ylim(0, 1.16)
    ax.set_xlabel("growth parameter  r")
    ax.set_ylabel("long-term population  xₙ")
    ax.set_title("The logistic map  xₙ₊₁ = r·xₙ(1 − xₙ):  period-doubling into chaos", pad=10)
    marks = [(3.0, "r = 3\n1 → 2", 1.015),
             (1 + np.sqrt(6), "r = 1+√6 ≈ 3.449\n2 → 4", 1.075),
             (3.569946, "Feigenbaum r∞\n≈ 3.570", 1.015),
             (1 + 2 * np.sqrt(2), "period-3 window\nr = 1+2√2 ≈ 3.828", 1.075)]
    for r0, lab, y in marks:
        ax.axvline(r0, color=AMBER, lw=0.8, ls=":", alpha=0.85)
        ax.text(r0, y, lab, color=AMBER, fontsize=8.5, ha="center", va="bottom")
    ax.text(3.905, 0.06, "chaos", color=FG, fontsize=11, ha="center")
    save(fig, "05a_logistic.png")


# ===========================================================================
# F6 — schematic of the uniformizing map Φ : ℂ∖M  →  ℂ∖ closed unit disk
# ===========================================================================
def fig_conformal():
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 6))

    # left: M with equipotential contours (level sets of the escape potential)
    rmin, rmax, imin, imax, W, H = -2.3, 0.8, -1.3, 1.3, 1000, 900
    sm = mandel_smooth(rmin, rmax, imin, imax, W, H, 300)
    a1.imshow(colorize(sm, 300, 2.2), extent=[rmin, rmax, imin, imax],
              origin="upper", aspect="equal", interpolation="bilinear")
    pot = np.where(sm < 0, np.nan, sm)
    re = np.linspace(rmin, rmax, W); im = np.linspace(imax, imin, H)
    a1.contour(re, im, pot, levels=[3, 6, 12, 24, 48], colors=FG,
               linewidths=0.8, alpha=0.7)
    a1.set_xlim(rmin, rmax); a1.set_ylim(imin, imax)
    a1.set_title("c-plane:  M  +  equipotentials", fontsize=12)
    a1.set_xlabel("Re(c)"); a1.set_ylabel("Im(c)")

    # right: exterior of unit disk with circles + radial external rays
    a2.set_aspect("equal")
    a2.add_patch(Circle((0, 0), 1, fc="#05060a", ec=FG, lw=1.4, zorder=3))
    for R in [1.25, 1.6, 2.1, 2.8]:
        a2.add_patch(Circle((0, 0), R, fill=False, ec=FG, lw=0.8, alpha=0.7))
    for k in range(12):
        ang = 2 * np.pi * k / 12
        a2.plot([np.cos(ang), 3.4 * np.cos(ang)], [np.sin(ang), 3.4 * np.sin(ang)],
                color=AMBER, lw=0.9, alpha=0.85)
    a2.text(0, 0, "𝔻", color=FG, ha="center", va="center", fontsize=15)
    a2.set_xlim(-3.4, 3.4); a2.set_ylim(-3.4, 3.4)
    a2.set_title("w-plane:  exterior of the unit disk", fontsize=12)
    a2.set_xlabel("Re(w)"); a2.set_ylabel("Im(w)")

    fig.text(0.5, 0.5, "Φ  ⟶", color=CYAN, fontsize=20, ha="center", va="center")
    fig.suptitle("Douady–Hubbard:  Φ maps the complement of M conformally onto "
                 "the complement of the closed unit disk  ⟹  M is connected",
                 fontsize=12.5, y=1.0)
    save(fig, "06_conformal.png")


# ===========================================================================
# F7 — self-similarity: a mini-Mandelbrot deep on the antenna
# ===========================================================================
def fig_selfsimilar():
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 5.6))
    set_image(a1, -2.2, 0.7, -1.25, 1.25, 1100, 1000, mi=500, cyc=2.4)
    a1.set_xlim(-2.2, 0.7); a1.set_ylim(-1.25, 1.25)
    cx, w = -1.7499, 0.04
    a1.add_patch(plt.Rectangle((cx - w, -w * 0.9), 2 * w, 1.8 * w,
                 fill=False, ec=FG, lw=1.3))
    a1.set_title("the whole set"); a1.set_xlabel("Re(c)"); a1.set_ylabel("Im(c)")

    set_image(a2, cx - w, cx + w, -w * 0.9, w * 0.9, 1100, 1000, mi=1500, cyc=3.0)
    a2.set_xlim(cx - w, cx + w); a2.set_ylim(-w * 0.9, w * 0.9)
    a2.set_title(f"≈ {2.9/(2*w):.0f}× into the antenna near c ≈ −1.75:\na baby copy of the whole set")
    a2.set_xlabel("Re(c)")
    save(fig, "07_selfsimilar.png")


# ===========================================================================
# F8 — the cyclic smooth-escape color scheme
# ===========================================================================
def fig_colorscheme():
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 4.4),
                                 gridspec_kw=dict(height_ratios=[1, 2.2], hspace=0.45))
    # palette strip as t: 0 -> 1 with cycles applied
    t = np.linspace(0, 1, 1000)
    for cyc, row, lab in [(1.0, 0, "cycles = 1"), (2.65, 1, "cycles = 2.65")]:
        sm = (t ** 3) * (399)                 # invert the cube-root spread for display
        strip = colorize(np.tile(sm, (16, 1)), 400, cyc)
        a1.imshow(strip, extent=[0, 1, row, row + 0.9], aspect="auto",
                  origin="lower", interpolation="bilinear")
        a1.text(1.012, row + 0.45, lab, color=FG, va="center", fontsize=10)
    a1.set_xlim(0, 1.18); a1.set_ylim(0, 2)
    a1.set_yticks([]); a1.set_xlabel("normalized escape  t  (after cube-root spread)")
    a1.set_title("cyclic HSL palette", fontsize=12)

    # banded (integer) vs smooth, side by side, over a SQUARE patch so the bulbs
    # keep their true proportions (equal aspect; square region + square grid).
    rmin, rmax, imin, imax, N = -1.05, -0.45, 0.40, 1.00, 820   # 0.6 × 0.6
    sm = mandel_smooth(rmin, rmax, imin, imax, N, N, 600)
    banded = np.where(sm < 0, -1.0, np.floor(sm))
    a2.imshow(colorize(banded, 600, 6), extent=[0, 1, 0, 1],
              interpolation="nearest")
    a2.imshow(colorize(sm, 600, 6), extent=[1.06, 2.06, 0, 1],
              interpolation="bilinear")
    for x0, lab in [(0.5, "integer escape count\n→ hard bands"),
                    (1.56, "smooth escape ν\n→ continuous")]:
        a2.text(x0, 1.05, lab, color=FG, ha="center", va="bottom", fontsize=11)
    a2.set_xlim(0, 2.06); a2.set_ylim(0, 1.32)
    a2.set_aspect("equal")              # <- the fix: no horizontal/vertical stretch
    a2.set_xticks([]); a2.set_yticks([])
    save(fig, "08_colorscheme.png")


if __name__ == "__main__":
    fig_regions()
    fig_squaring()
    fig_orbits()
    fig_bulbs()
    fig_bifurcation()
    fig_logistic()
    fig_conformal()
    fig_selfsimilar()
    fig_colorscheme()
    print("done ->", OUT)
