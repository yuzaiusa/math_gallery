// WebAssembly C API (compiled only under Emscripten). A flat extern "C"
// surface keeps the JS<->WASM boundary a single call that writes smooth-escape
// floats straight into the WASM heap, which JS reads via HEAPF32 with no copy.
#include <emscripten/emscripten.h>

#include "mg/render.hpp"
#include "mg/perturb.hpp"

extern "C" {

// Render rows [y0, y1) of the view into `out` ((y1-y0)*width floats).
EMSCRIPTEN_KEEPALIVE
void mg_render_band(int fractal, int precision,
                    double re_min, double re_range,
                    double im_max, double im_range,
                    int width, int height, int y0, int y1,
                    int max_iter, double escape_r2,
                    int degree, double julia_re, double julia_im,
                    float* out) {
    mg::Params p;
    p.degree = degree;
    p.julia_re = julia_re;
    p.julia_im = julia_im;
    mg::render_band_dispatch(fractal, precision,
        re_min, re_range, im_max, im_range,
        width, height, y0, y1, max_iter, escape_r2, p, out);
}

// Convenience so JS can pick the precision tier with the same thresholds.
EMSCRIPTEN_KEEPALIVE
int mg_choose_precision(double re_width) {
    return mg::choose_precision(re_width);
}

// --- Perturbation (deep zoom) ---
// The worker computes the reference orbit ONCE per render (mg_perturb_reference),
// then renders each strip with mg_render_band_perturb. center is passed as two QD
// values (4 doubles each); out_xr/out_xi must hold maxIter+1 doubles.

EMSCRIPTEN_KEEPALIVE
int mg_perturb_reference(int fractal, int degree, double julia_re, double julia_im,
                         const double* cre_qd, const double* cim_qd,
                         int max_iter, double escape_r2,
                         double* out_xr, double* out_xi) {
    mg::QD Cre(cre_qd[0], cre_qd[1], cre_qd[2], cre_qd[3]);
    mg::QD Cim(cim_qd[0], cim_qd[1], cim_qd[2], cim_qd[3]);
    mg::QD kr(julia_re), ki(julia_im);
    mg::RefOrbit r = mg::compute_reference_dispatch(fractal, Cre, Cim, kr, ki,
                                                    degree, max_iter, escape_r2);
    for (int i = 0; i < r.len; ++i) { out_xr[i] = r.xr[i]; out_xi[i] = r.xi[i]; }
    return r.len;
}

EMSCRIPTEN_KEEPALIVE
void mg_render_band_perturb(int fractal, int degree, double julia_re, double julia_im,
                            const double* cre_qd, const double* cim_qd,
                            const double* xr, const double* xi, int ref_len,
                            double re_span, double im_span,
                            int width, int height, int y0, int y1,
                            int max_iter, double escape_r2, float* out) {
    mg::QD Cre(cre_qd[0], cre_qd[1], cre_qd[2], cre_qd[3]);
    mg::QD Cim(cim_qd[0], cim_qd[1], cim_qd[2], cim_qd[3]);
    mg::QD kr(julia_re), ki(julia_im);
    mg::render_band_perturb_raw(fractal, xr, xi, ref_len, Cre, Cim, kr, ki,
        re_span, im_span, width, height, y0, y1, max_iter, escape_r2, degree, out);
}

}  // extern "C"
