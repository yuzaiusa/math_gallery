# Deep-Zoom Rendering: Perturbation Theory

This document explains how the fractal viewer renders extremely deep zooms, the
math behind it, and why it replaces the original double‑double / quad‑double
("DD/QD") approach for deep views.

It covers Mandelbrot, Julia, and Multibrot — the families that currently use the
perturbation path. Tricorn and Burning Ship still use the direct DD/QD kernels
(their `conj`/`abs` maps make perturbation considerably harder).

---

## 1. Background: the direct DD/QD renderer and where it breaks

The original renderer (still used for shallow views and for Tricorn/Burning Ship)
iterates **every pixel independently**. For the Mandelbrot map `z ← z² + c` it
computes, per pixel,

```
z₀ = 0,   z_{n+1} = z_n² + c
```

until `|z_n| > 2` (escaped) or `n` reaches `maxIter` (assumed in‑set). To stay
accurate as you zoom in, it escalates the arithmetic precision of the `z`
iteration: native `double` (f64), then **double‑double** (~32 digits), then
**quad‑double** (~64 digits). Those are implemented in
[`core/include/mg/real_dd.hpp`](../core/include/mg/real_dd.hpp) and
[`real_qd.hpp`](../core/include/mg/real_qd.hpp) using error‑free transforms
(`two_sum`, `two_product`) ported from the original JS viewer; the kernels live
in [`core/include/mg/render.hpp`](../core/include/mg/render.hpp).

This approach has **two independent limits**:

1. **Speed.** Every pixel pays the high‑precision cost. A quad‑double multiply is
   tens of floating‑point operations, so a frame of millions of pixels at QD
   precision is very slow — impractical for an interactive viewer or for
   rendering movie frames.

2. **A hard coordinate wall around zoom ≈ 1e14.** This is the subtle one. The
   per‑pixel coordinate is computed in `double`:

   ```
   c_re = reMin + (px + 0.5)/width · reRange
   ```

   `reMin` is an order‑1 number (e.g. `-0.743643887…`), while at zoom `Z` the
   per‑pixel step is `reRange/width = 3.5 / (Z·width)`. Adjacent pixels are only
   distinguishable if that step exceeds the spacing of representable doubles near
   `reMin`, which is `ulp(reMin) ≈ 2.2e-16`. Setting

   ```
   3.5 / (Z·width) > 2.2e-16   ⟹   Z < ~1e13–1e14   (for width ~10³)
   ```

   Beyond that, **every pixel rounds to the same `c`** and the image collapses —
   *regardless of how precise the `z` iteration is*. Raising the iteration to
   DD/QD does not help, because the input coordinate is already degenerate in
   f64. (This is why deep zooms in the stage‑1 viewer "struggled" near 1e14.)

Perturbation theory fixes **both** limits at once.

---

## 2. The key idea

Instead of iterating each pixel's coordinate in high precision, we iterate **one**
high‑precision **reference orbit** from the view center `C`, and express every
other pixel as a **small perturbation** off it, iterated in fast `double`:

```
reference (high precision, computed once):   X₀ = 0,   X_{n+1} = X_n² + C
pixel       (f64, computed per pixel):        z_n = X_n + e_n
```

The crucial quantity is the pixel's **offset from the center**, `δc = c − C`. At
zoom `Z`, `δc` ranges over `±reRange/2 ≈ ±1.75/Z`. As a *standalone* double this
is fine all the way down to ~1e‑300 — the precision problem in §1 only arose from
*adding* that tiny offset to the order‑1 `reMin`. Perturbation never does that
addition in low precision: it keeps `δc` separate and small, and only `C` (and
its orbit) needs high precision.

So the structure flips:

- **Reference orbit** `X_n`: high precision to *compute* (we use QD), stored as
  plain `double[]` — that is enough for the perturbation, see below.
- **Per‑pixel iteration**: entirely `double` → fast, and unbounded in zoom depth
  because `δc` stays representable.

---

## 3. The perturbation recurrence (Mandelbrot)

Subtract the reference recurrence from the pixel recurrence:

```
e_{n+1} = z_{n+1} − X_{n+1}
        = (z_n² + c) − (X_n² + C)
        = (z_n² − X_n²) + (c − C)
        = (z_n − X_n)(z_n + X_n) + δc
        = e_n · (2X_n + e_n) + δc
        = 2·X_n·e_n + e_n² + δc                      with   e₀ = 0
```

This identity is **algebraically exact** — it holds for any `e_n`, not just small
ones. What makes it *useful* is the floating‑point behavior:

- `X_n` is stored as a `double`. In the term `2·X_n·e_n`, the relative error of
  `X_n` (~1e‑16) is multiplied by the tiny `e_n`, contributing only ~`1e-16·|e_n|`
  of absolute error — negligible.
- `δc` is a small, fully‑accurate `double`.
- `e_n` is small, so `2·X_n·e_n + e_n²` is computed cleanly in `double`.

The escape test uses the reconstructed value `z_n = X_n + e_n` and the standard
bailout `|z_n| > 2`. The smooth (fractional) iteration count is unchanged from the
direct renderer:

```
μ = n + 1 − log₂( ½·log|z_n|² )
```

so coloring is identical and continuous with the direct path.

---

## 4. Glitches, rebasing, and the QD fallback

The one place `double` precision genuinely fails is when the reconstructed
`z_n = X_n + e_n` is **much smaller than `X_n`** — then forming `X_n + e_n` is a
catastrophic cancellation and `e_n` loses its meaning. This is a **glitch**
(Pauldelbrot's criterion: `|z_n|² < ε·|X_n|²`, with `ε = 1e-6` in the code).

We handle glitches two ways, depending on the fractal:

### Rebasing — Mandelbrot and Multibrot

Their reference starts at `X₀ = 0`. Zhuoran's **rebasing** observes that when the
orbit passes near zero we can simply *re‑reference to the start*: set the
perturbation to the current value and restart the reference index.

```
if  |z_n|² < |e_n|²   or   the reference is exhausted:
       e ← z_n ;   m ← 0          (m is the local reference index)
```

Because `X₀ = 0`, after rebasing `z_n = X₀ + e = e` is consistent, and the next
step `e' = 2·X₀·e + e² + δc = e² + δc` continues correctly. Rebasing keeps the
whole computation in fast `double` and resolves the vast majority of glitches.

### Exact QD fallback — Julia (and a safety net)

Julia's reference orbit starts at the **seed** (the view center in the z‑plane),
not at 0, so rebasing‑to‑zero doesn't apply. Instead, a glitched Julia pixel is
**recomputed exactly** at its full high‑precision coordinate using a QD direct
iteration ([`iterate_qd_coord`](../core/include/mg/perturb.hpp)). This is slow
per pixel, but glitches are rare when zooming into the set's interior, so only a
small fraction of pixels take this path. The same fallback also acts as a safety
net for Mandelbrot/Multibrot pixels that a rebase cannot rescue.

---

## 5. The fractal family

Only the per‑iteration step differs; the reference‑orbit + perturbation +
glitch‑handling scaffolding is shared.

| Family | Map | Reference start | Perturbation step `e_{n+1}` |
|---|---|---|---|
| **Mandelbrot** | `z² + c` | `X₀ = 0`, ref `c = C` | `2·X·e + e² + δc` |
| **Multibrot** (deg `d`) | `zᵈ + c` | `X₀ = 0`, ref `c = C` | `Σ_{k=1..d} C(d,k)·X^{d−k}·eᵏ + δc` |
| **Julia** | `z² + k` | `X₀ = seed = C`, ref `c = k` | `2·X·e + e²` (e₀ = pixel offset, `δc = 0`) |

Notes:

- **Multibrot** evaluates `(X+e)ᵈ − Xᵈ` via its **binomial expansion**
  `d·X^{d−1}·e + … + eᵈ`, *not* by computing the two powers `(X+e)ᵈ` and `Xᵈ`
  separately and subtracting (which would reintroduce catastrophic cancellation
  for small `e`). The expansion has no cancellation. Integer degrees only (no
  transcendental powers).
- **Julia**'s deep‑zoom variable is the *initial point* `z₀ = pixel`, so the
  perturbation seed is `e₀ = pixel − seed = δ` and there is no `+δc` term (the
  constant `k` cancels between reference and pixel).

---

## 6. Why the coordinate wall is gone

The reference orbit must be accurate to `≈ −log₁₀(reRange)` digits — i.e. enough
to resolve the view. We compute it in **quad‑double (~64 digits)**, which keeps
the center accurate to roughly **zoom ≈ 1e50** before the reference itself loses
resolution. (Double‑double would reach ~1e26; QD is used so the headroom is
large.) The per‑pixel `double` perturbation adds no further limit because `δc`
stays representable far beyond that.

In short, the wall moved from **~1e14 (f64 coordinate)** to **~1e50 (QD
reference)**, and the per‑pixel cost dropped from **DD/QD to f64**.

---

## 7. When each path is used

| View | Path |
|---|---|
| Shallow zoom (≲ 1e10), any fractal | Direct f64 kernel (`render.hpp`) — simplest, fastest |
| Tricorn / Burning Ship, any zoom | Direct f64 → DD → QD by depth (`render.hpp`) |
| Mandelbrot / Julia / Multibrot, deep zoom | **Perturbation** (`perturb.hpp`) |

The perturbation recurrence is exact at all zooms, but at shallow zoom `δc` is
large and rebasing/fallback triggers constantly with no speed benefit, so the
direct kernel is preferred there.

---

## 8. Implementation map

- **`core/include/mg/perturb.hpp`** — the whole perturbation core:
  - `compute_reference<FRAC>()` — iterates the center in QD, stores `X_n` as
    `double[]`.
  - `perturb_pixel<FRAC>()` — one pixel: f64 perturbation loop with rebasing
    (Mandelbrot/Multibrot) or glitch→QD fallback (Julia / safety net).
  - `perturb_power_step()` — binomial `(X+e)ᵈ − Xᵈ` for Multibrot.
  - `iterate_qd_coord<FRAC>()` — exact QD recompute used by the fallback.
  - `render_band_perturb_raw()` / `_dispatch()` — render rows `[y0, y1)`.
- **`core/src/wasm_api.cpp`** — `mg_perturb_reference` (compute the reference once)
  and `mg_render_band_perturb` (render a strip). A browser worker computes the
  reference once per frame, then renders its strips.
- **`core/bindings/py_module.cpp`** — `render_frame_perturb(...)` for the Python
  movie CLI (computes the reference and renders the whole frame in one call).
- The center is passed across both boundaries as two **QD values** (4 `double`s
  each); `re_span`/`im_span` are ordinary `double`s.

**Data flow per frame:** high‑precision center → `compute_reference` (QD, once) →
`double[]` reference orbit → per‑pixel f64 perturbation (with occasional QD
fallback) → smooth‑escape buffer → color map.

> Build note: the core must be compiled with `-ffp-contract=off` and without
> `-ffast-math`. The QD reference and the error‑free transforms depend on strict
> IEEE‑754 rounding; FMA contraction silently breaks them.

---

## 9. Validation

The perturbation output is checked against **arbitrary‑precision `mpmath`** ground
truth: it agrees for Mandelbrot, Julia, and Multibrot at zoom 1e6, and for
Mandelbrot at **1e20 and 1e30** on generic boundary points — classification exact,
smooth values matching to ~`5e-8` relative error. The WebAssembly build is
**bit‑identical** to the native module at every tested depth, so the browser
viewer and the Python CLI compute the same image.

---

## 10. Limitations and future work

- **Periodic / Misiurewicz reference points.** If the view center lands *exactly*
  on a periodic point (e.g. `c = i`), the reference orbit is an exactly‑periodic
  repelling cycle — a degenerate reference that amplifies f64 round‑off in `e`,
  causing a small smooth‑value drift (classification stays correct). This is a
  measure‑zero edge case for real navigation and is what series approximation /
  multi‑reference glitch correction would fix.
- **Series approximation (deferred).** A truncated power series in `δc` can skip
  the first thousands of iterations for *all* pixels at extreme zoom, a large
  speedup. It also tightens the periodic‑point case. Intentionally left out of
  this stage to keep the base correct and simple.
- **Tricorn / Burning Ship.** Not yet on the perturbation path; their `conj`/`abs`
  maps need a different (and trickier) perturbation formulation and glitch test.
