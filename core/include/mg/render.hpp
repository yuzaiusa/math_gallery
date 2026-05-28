#pragma once
// Iteration + band rendering, with runtime (fractal, precision) -> compiled
// kernel dispatch. The fractal family and precision tier are resolved ONCE per
// band via a function-pointer table; the per-pixel inner loop is branch-free
// (the family is selected at compile time with `if constexpr`).
#include <cmath>
#include <cstddef>
#include "fractals.hpp"

namespace mg {

// Smooth (fractional) escape value for one point. Returns -1 for in-set points.
// `R` is the precision type; `FRAC` selects the map at compile time.
template <class R, int FRAC>
inline float iterate(double cre, double cim, int maxIter, double escapeR2,
                     const Params& p) {
    R zr, zi, cr, ci;
    if constexpr (FRAC == F_JULIA) {
        zr = R(cre);          zi = R(cim);           // z0 = pixel
        cr = R(p.julia_re);   ci = R(p.julia_im);    // c  = fixed constant
    } else {
        zr = R(0.0);          zi = R(0.0);           // z0 = 0
        cr = R(cre);          ci = R(cim);           // c  = pixel
    }

    int n = 0;
    for (; n < maxIter; ++n) {
        double lr = lead(zr), li = lead(zi);
        if (lr * lr + li * li > escapeR2) break;

        if constexpr (FRAC == F_MANDELBROT || FRAC == F_JULIA)
            step_mandelbrot(zr, zi, cr, ci);
        else if constexpr (FRAC == F_TRICORN)
            step_tricorn(zr, zi, cr, ci);
        else if constexpr (FRAC == F_BURNING_SHIP)
            step_burning_ship(zr, zi, cr, ci);
        else if constexpr (FRAC == F_MULTIBROT)
            step_multibrot(zr, zi, cr, ci, p.degree);
    }

    if (n == maxIter) return -1.0f;

    double lr = lead(zr), li = lead(zi);
    double abs2 = lr * lr + li * li;
    int deg = (FRAC == F_MULTIBROT) ? p.degree : 2;
    double mu = (double)n + 1.0 - std::log(0.5 * std::log(abs2)) / std::log((double)deg);
    return (float)mu;
}

// Render rows [y0, y1) into `out` (row-major, (y1-y0)*width floats).
// Pixel-to-plane mapping matches the reference viewer exactly.
template <class R, int FRAC>
void render_band(double reMin, double reRange, double imMax, double imRange,
                 int width, int height, int y0, int y1,
                 int maxIter, double escapeR2, const Params& p, float* out) {
    for (int py = y0; py < y1; ++py) {
        double cim = imMax - (py + 0.5) / height * imRange;
        float* row = out + (std::size_t)(py - y0) * width;
        for (int px = 0; px < width; ++px) {
            double cre = reMin + (px + 0.5) / width * reRange;
            row[px] = iterate<R, FRAC>(cre, cim, maxIter, escapeR2, p);
        }
    }
}

using RenderFn = void (*)(double, double, double, double, int, int, int, int,
                          int, double, const Params&, float*);

template <int FRAC>
inline RenderFn pick_precision(int precision) {
    switch (precision) {
        case P_F64: return &render_band<double, FRAC>;
        case P_DD:  return &render_band<DD, FRAC>;
        case P_QD:  return &render_band<QD, FRAC>;
        default:    return nullptr;
    }
}

inline RenderFn pick_render(int fractal, int precision) {
    switch (fractal) {
        case F_MANDELBROT:   return pick_precision<F_MANDELBROT>(precision);
        case F_JULIA:        return pick_precision<F_JULIA>(precision);
        case F_MULTIBROT:    return pick_precision<F_MULTIBROT>(precision);
        case F_TRICORN:      return pick_precision<F_TRICORN>(precision);
        case F_BURNING_SHIP: return pick_precision<F_BURNING_SHIP>(precision);
        default:             return nullptr;
    }
}

// Pick a precision tier from the current horizontal span of the view, matching
// the thresholds used by the reference viewer.
inline int choose_precision(double reWidth) {
    if (reWidth < 1e-26) return P_QD;
    if (reWidth < 1e-11) return P_DD;
    return P_F64;
}

// Convenience entry point used by both the WASM and Python bindings.
inline void render_band_dispatch(int fractal, int precision,
                                 double reMin, double reRange,
                                 double imMax, double imRange,
                                 int width, int height, int y0, int y1,
                                 int maxIter, double escapeR2,
                                 const Params& p, float* out) {
    RenderFn fn = pick_render(fractal, precision);
    if (fn)
        fn(reMin, reRange, imMax, imRange, width, height, y0, y1,
           maxIter, escapeR2, p, out);
}

}  // namespace mg
