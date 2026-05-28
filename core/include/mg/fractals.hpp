#pragma once
// Fractal family iteration steps, generic over the Real precision type
// (double / DD / QD). Each step advances z by one iteration of its map.
// The escape magnitude is tested by the caller via lead(z).
#include "twofloat.hpp"
#include "real_dd.hpp"
#include "real_qd.hpp"

namespace mg {

enum Fractal {
    F_MANDELBROT   = 0,  // z <- z^2 + c
    F_JULIA        = 1,  // z <- z^2 + k   (k fixed, z0 = pixel)
    F_MULTIBROT    = 2,  // z <- z^d + c   (integer d)
    F_TRICORN      = 3,  // z <- conj(z)^2 + c
    F_BURNING_SHIP = 4,  // z <- (|Re z| + i|Im z|)^2 + c
    FRACTAL_COUNT  = 5
};

enum Precision { P_F64 = 0, P_DD = 1, P_QD = 2, PRECISION_COUNT = 3 };

struct Params {
    int    degree   = 3;    // multibrot exponent (integer >= 2)
    double julia_re = 0.0;  // julia constant (real)
    double julia_im = 0.0;  // julia constant (imag)
};

template <class R>
inline void step_mandelbrot(R& zr, R& zi, const R& cr, const R& ci) {
    R zr2 = sqr(zr), zi2 = sqr(zi);
    R nzi = twice(zr * zi) + ci;
    zr = (zr2 - zi2) + cr;
    zi = nzi;
}

template <class R>
inline void step_tricorn(R& zr, R& zi, const R& cr, const R& ci) {
    R zr2 = sqr(zr), zi2 = sqr(zi);
    R nzi = ci - twice(zr * zi);   // conjugate flips the sign of the imag part
    zr = (zr2 - zi2) + cr;
    zi = nzi;
}

template <class R>
inline void step_burning_ship(R& zr, R& zi, const R& cr, const R& ci) {
    R ar = cabs(zr), ai = cabs(zi);
    R zr2 = sqr(ar), zi2 = sqr(ai);
    R nzi = twice(ar * ai) + ci;
    zr = (zr2 - zi2) + cr;
    zi = nzi;
}

// z^d via repeated complex multiply (integer d), then + c.
template <class R>
inline void step_multibrot(R& zr, R& zi, const R& cr, const R& ci, int d) {
    R pr = zr, pi = zi;
    for (int k = 1; k < d; ++k) {
        R nr = pr * zr - pi * zi;
        R ni = pr * zi + pi * zr;
        pr = nr;
        pi = ni;
    }
    zr = pr + cr;
    zi = pi + ci;
}

}  // namespace mg
