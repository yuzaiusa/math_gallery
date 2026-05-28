#pragma once
// Error-free floating-point transforms (Dekker/Knuth/Veltkamp).
// Ported 1:1 from the reference JS kernel (twoSum / twoProduct etc).
//
// CRITICAL: these rely on strict IEEE-754 rounding. The core MUST be built
// with -ffp-contract=off and without -ffast-math, or the `a*b - p` style
// error terms get fused into an FMA and silently produce wrong results.

#include <cmath>

namespace mg {

struct Double2 { double s, e; };  // value == s + e exactly

// Exact sum: s + e == a + b, no magnitude requirement.
inline Double2 two_sum(double a, double b) {
    double s = a + b;
    double v = s - a;
    double e = (a - (s - v)) + (b - v);
    return {s, e};
}

// Exact sum when |a| >= |b|.
inline Double2 quick_two_sum(double a, double b) {
    double s = a + b;
    double e = b - (s - a);
    return {s, e};
}

// Veltkamp split: hi + lo == x, hi has the high 26 bits.
inline Double2 dd_split(double x) {
    double t = 134217729.0 * x;  // 2^27 + 1
    double hi = t - (t - x);
    double lo = x - hi;
    return {hi, lo};
}

// Exact product: p + e == a * b.
inline Double2 two_product(double a, double b) {
    double p = a * b;
    Double2 as = dd_split(a);
    Double2 bs = dd_split(b);
    double e = ((as.s * bs.s - p) + as.s * bs.e + as.e * bs.s) + as.e * bs.e;
    return {p, e};
}

// --- helpers used only by the quad-double routines ---

// Exact sum of three floats -> (a, b, c) with value preserved.
inline void three_sum(double& a, double& b, double& c) {
    Double2 t = two_sum(a, b);
    Double2 u = two_sum(c, t.s);
    a = u.s;
    Double2 v = two_sum(t.e, u.e);
    b = v.s;
    c = v.e;
}

// Like three_sum but drops the smallest term into b.
inline void three_sum2(double& a, double& b, double c) {
    Double2 t = two_sum(a, b);
    Double2 u = two_sum(c, t.s);
    a = u.s;
    b = t.e + u.e;
}

// --- generic-name helpers for the f64 precision tier ---
// (DD/QD provide their own overloads; calling these unqualified from inside
//  namespace mg resolves the right one for each Real type.)
inline double sqr(double x)   { return x * x; }
inline double twice(double x) { return 2.0 * x; }
inline double cabs(double x)  { return std::fabs(x); }
inline double lead(double x)  { return x; }

}  // namespace mg
