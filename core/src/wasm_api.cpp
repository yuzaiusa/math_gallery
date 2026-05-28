// WebAssembly C API (compiled only under Emscripten). A flat extern "C"
// surface keeps the JS<->WASM boundary a single call that writes smooth-escape
// floats straight into the WASM heap, which JS reads via HEAPF32 with no copy.
#include <emscripten/emscripten.h>

#include "mg/render.hpp"

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

}  // extern "C"
