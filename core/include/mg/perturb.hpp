#pragma once
// Perturbation-theory rendering for deep zoom (Mandelbrot, Julia, Multibrot).
//
// Instead of iterating every pixel's coordinate in high precision (which is
// slow and, more importantly, requires the per-pixel coordinate to be stored in
// high precision), we iterate ONE high-precision "reference orbit" from the view
// center and express every other pixel as a small f64 perturbation off it:
//
//   reference (high precision):  X_0 = 0 (or seed),  X_{n+1} = X_n^d + C
//   pixel (f64 perturbation):    z_n = X_n + e_n,  e_{n+1} = (X+e)^d - X^d + dc
//
// where dc = c - C is the pixel's tiny offset from the center (exact in f64 even
// at extreme zoom). Glitches (where |z| << |X|, so X+e loses all precision) are
// handled by Zhuoran rebasing for Mandelbrot/Multibrot (whose reference starts
// at 0) and by a direct QD recompute for Julia.
#include <cmath>
#include <vector>

#include "fractals.hpp"
#include "real_qd.hpp"

namespace mg {

struct Cd { double re, im; };
inline Cd cmul(Cd a, Cd b) { return {a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re}; }
inline double cnorm2(Cd a) { return a.re * a.re + a.im * a.im; }

inline float perturb_smooth(int n, double z2, int degree) {
    return (float)((double)n + 1.0 - std::log(0.5 * std::log(z2)) / std::log((double)degree));
}

// (X+e)^d - X^d  via the binomial expansion (no catastrophic cancellation).
inline Cd perturb_power_step(Cd X, Cd e, int d) {
    Cd Xp[9];
    Xp[0] = {1.0, 0.0};
    for (int i = 1; i <= d; ++i) Xp[i] = cmul(Xp[i - 1], X);
    Cd ep = e;                 // e^k, starts at e^1
    long long c = d;           // C(d,k), starts at C(d,1)=d
    Cd s = {0.0, 0.0};
    for (int k = 1; k <= d; ++k) {
        Cd t = cmul(Xp[d - k], ep);
        s.re += (double)c * t.re;
        s.im += (double)c * t.im;
        ep = cmul(ep, e);
        c = c * (d - k) / (k + 1);
    }
    return s;
}

struct RefOrbit {
    std::vector<double> xr, xi;  // X_0 .. X_{len-1} as doubles
    int len = 0;
};

// Compute the reference orbit from the high-precision center, stored as doubles.
// Mandelbrot/Multibrot: X_0 = 0, c = center. Julia: X_0 = center seed, c = k.
template <int FRAC>
RefOrbit compute_reference(const QD& Cre, const QD& Cim, const QD& kr, const QD& ki,
                           int degree, int maxIter, double escapeR2) {
    RefOrbit ref;
    ref.xr.reserve(maxIter + 1);
    ref.xi.reserve(maxIter + 1);

    QD zr, zi, cr, ci;
    if constexpr (FRAC == F_JULIA) { zr = Cre; zi = Cim; cr = kr; ci = ki; }
    else                          { zr = QD(0.0); zi = QD(0.0); cr = Cre; ci = Cim; }

    for (int n = 0;; ++n) {
        ref.xr.push_back(zr.x[0]);
        ref.xi.push_back(zi.x[0]);
        double lr = zr.x[0], li = zi.x[0];
        if (lr * lr + li * li > escapeR2) break;
        if (n >= maxIter) break;
        if constexpr (FRAC == F_MULTIBROT) step_multibrot(zr, zi, cr, ci, degree);
        else                               step_mandelbrot(zr, zi, cr, ci);  // mandel + julia
    }
    ref.len = (int)ref.xr.size();
    return ref;
}

// Direct QD iterate of a single point (used as the Julia glitch fallback, and a
// safety net). c and z0 are full high-precision coordinates.
template <int FRAC>
float iterate_qd_coord(const QD& cre, const QD& cim, const QD& z0r, const QD& z0i,
                       const QD& kr, const QD& ki, int degree, int maxIter, double escapeR2) {
    QD zr = z0r, zi = z0i, cr, ci;
    if constexpr (FRAC == F_JULIA) { cr = kr; ci = ki; }
    else                          { cr = cre; ci = cim; }

    int n = 0;
    for (; n < maxIter; ++n) {
        double lr = zr.x[0], li = zi.x[0];
        if (lr * lr + li * li > escapeR2) break;
        if constexpr (FRAC == F_MULTIBROT) step_multibrot(zr, zi, cr, ci, degree);
        else                               step_mandelbrot(zr, zi, cr, ci);
    }
    if (n == maxIter) return -1.0f;
    double abs2 = zr.x[0] * zr.x[0] + zi.x[0] * zi.x[0];
    int deg = (FRAC == F_MULTIBROT) ? degree : 2;
    return perturb_smooth(n, abs2, deg);
}

// Glitch threshold (Pauldelbrot): a pixel is glitched when |z|^2 < GLITCH * |X|^2.
constexpr double PERTURB_GLITCH = 1e-6;

// QD fallback: recompute one pixel exactly at its full high-precision coordinate.
template <int FRAC>
float perturb_fallback(double dcr, double dci, const QD& Cre, const QD& Cim,
                       const QD& kr, const QD& ki, int degree, int maxIter, double escapeR2) {
    if constexpr (FRAC == F_JULIA) {
        QD z0r = Cre + QD(dcr), z0i = Cim + QD(dci);   // seed = center + offset
        return iterate_qd_coord<F_JULIA>(Cre, Cim, z0r, z0i, kr, ki, degree, maxIter, escapeR2);
    } else {
        QD cr = Cre + QD(dcr), ci = Cim + QD(dci);     // c = center + offset
        return iterate_qd_coord<FRAC>(cr, ci, QD(0.0), QD(0.0), kr, ki, degree, maxIter, escapeR2);
    }
}

// One pixel via perturbation. dcr/dci is the pixel's f64 offset from the center.
// Mandel/Multibrot rebase (X_0 = 0) to keep the perturbation small in f64; any
// fractal falls back to an exact QD recompute if a Pauldelbrot glitch is detected
// (the perturbation has lost too much precision) or the reference is exhausted.
// `glitches` (optional) counts fallbacks for diagnostics.
template <int FRAC>
float perturb_pixel(const double* xr, const double* xi, int refLen,
                    double dcr, double dci,
                    const QD& Cre, const QD& Cim, const QD& kr, const QD& ki,
                    int degree, int maxIter, double escapeR2, long* glitches = nullptr) {
    const int deg = (FRAC == F_MULTIBROT) ? degree : 2;
    Cd dc = {dcr, dci};
    Cd e = (FRAC == F_JULIA) ? dc : Cd{0.0, 0.0};  // Julia: e_0 = pixel offset
    int m = 0;

    for (int n = 0; n < maxIter; ++n) {
        Cd Z = {xr[m] + e.re, xi[m] + e.im};   // z_n
        double z2 = cnorm2(Z);
        if (z2 > escapeR2) return perturb_smooth(n, z2, deg);

        double Xn2 = xr[m] * xr[m] + xi[m] * xi[m];
        bool glitch = (z2 < PERTURB_GLITCH * Xn2);
        bool ref_end = (m >= refLen - 1);

        if (glitch || ref_end) {
            if constexpr (FRAC == F_JULIA) {
                // Julia's reference starts at the seed (not 0), so rebasing to 0
                // doesn't apply; recompute exactly in QD.
                if (glitches) ++*glitches;
                return perturb_fallback<F_JULIA>(dcr, dci, Cre, Cim, kr, ki, degree, maxIter, escapeR2);
            } else if (glitch) {
                // Precision lost: this pixel needs an exact recompute.
                if (glitches) ++*glitches;
                return perturb_fallback<FRAC>(dcr, dci, Cre, Cim, kr, ki, degree, maxIter, escapeR2);
            } else {
                // Reference exhausted but precision is fine: rebase to X_0 = 0.
                e = Z; m = 0;
            }
        }

        Cd X = {xr[m], xi[m]};
        if constexpr (FRAC == F_JULIA) {
            Cd Xe = cmul(X, e), e2 = cmul(e, e);
            e.re = 2.0 * Xe.re + e2.re;
            e.im = 2.0 * Xe.im + e2.im;
        } else if (deg == 2) {
            Cd Xe = cmul(X, e), e2 = cmul(e, e);
            e.re = 2.0 * Xe.re + e2.re + dc.re;
            e.im = 2.0 * Xe.im + e2.im + dc.im;
        } else {
            Cd s = perturb_power_step(X, e, deg);
            e.re = s.re + dc.re;
            e.im = s.im + dc.im;
        }
        ++m;
    }
    return -1.0f;  // in set
}

// Render rows [y0, y1) of the view using a precomputed reference orbit (raw
// double buffers xr/xi of length refLen). re_span/im_span are the full view
// extents; the center is high precision.
template <int FRAC>
void render_band_perturb_ref(const double* xr, const double* xi, int refLen,
                             const QD& Cre, const QD& Cim, const QD& kr, const QD& ki,
                             double re_span, double im_span,
                             int width, int height, int y0, int y1,
                             int maxIter, double escapeR2, int degree, float* out) {
    for (int py = y0; py < y1; ++py) {
        double dci = (0.5 - (py + 0.5) / height) * im_span;
        float* row = out + (std::size_t)(py - y0) * width;
        for (int px = 0; px < width; ++px) {
            double dcr = ((px + 0.5) / width - 0.5) * re_span;
            row[px] = perturb_pixel<FRAC>(xr, xi, refLen, dcr, dci, Cre, Cim, kr, ki,
                                          degree, maxIter, escapeR2);
        }
    }
}

// Runtime-fractal dispatch for rendering a band from a precomputed reference.
inline void render_band_perturb_raw(int fractal,
        const double* xr, const double* xi, int refLen,
        const QD& Cre, const QD& Cim, const QD& kr, const QD& ki,
        double re_span, double im_span, int width, int height, int y0, int y1,
        int maxIter, double escapeR2, int degree, float* out) {
    switch (fractal) {
        case F_MANDELBROT:
            render_band_perturb_ref<F_MANDELBROT>(xr, xi, refLen, Cre, Cim, kr, ki,
                re_span, im_span, width, height, y0, y1, maxIter, escapeR2, degree, out); break;
        case F_JULIA:
            render_band_perturb_ref<F_JULIA>(xr, xi, refLen, Cre, Cim, kr, ki,
                re_span, im_span, width, height, y0, y1, maxIter, escapeR2, degree, out); break;
        case F_MULTIBROT:
            render_band_perturb_ref<F_MULTIBROT>(xr, xi, refLen, Cre, Cim, kr, ki,
                re_span, im_span, width, height, y0, y1, maxIter, escapeR2, degree, out); break;
        default: break;  // perturbation supports Mandelbrot/Julia/Multibrot only
    }
}

// Compute the reference orbit for the given fractal into RefOrbit.
inline RefOrbit compute_reference_dispatch(int fractal,
        const QD& Cre, const QD& Cim, const QD& kr, const QD& ki,
        int degree, int maxIter, double escapeR2) {
    switch (fractal) {
        case F_MANDELBROT: return compute_reference<F_MANDELBROT>(Cre, Cim, kr, ki, degree, maxIter, escapeR2);
        case F_JULIA:      return compute_reference<F_JULIA>(Cre, Cim, kr, ki, degree, maxIter, escapeR2);
        case F_MULTIBROT:  return compute_reference<F_MULTIBROT>(Cre, Cim, kr, ki, degree, maxIter, escapeR2);
        default:           return RefOrbit{};
    }
}

// One-shot: build the reference and render a band (used by the Python binding).
inline void render_band_perturb_dispatch(int fractal,
        const QD& Cre, const QD& Cim, const QD& kr, const QD& ki,
        double re_span, double im_span, int width, int height, int y0, int y1,
        int maxIter, double escapeR2, int degree, float* out) {
    RefOrbit r = compute_reference_dispatch(fractal, Cre, Cim, kr, ki, degree, maxIter, escapeR2);
    if (r.len == 0) return;
    render_band_perturb_raw(fractal, r.xr.data(), r.xi.data(), r.len, Cre, Cim, kr, ki,
        re_span, im_span, width, height, y0, y1, maxIter, escapeR2, degree, out);
}

}  // namespace mg
