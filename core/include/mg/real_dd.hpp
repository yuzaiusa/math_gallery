#pragma once
// Double-double arithmetic (~32 decimal digits). Ported from the JS dd kernel.
#include "twofloat.hpp"

namespace mg {

struct DD {
    double hi, lo;  // value == hi + lo
    DD() : hi(0.0), lo(0.0) {}
    DD(double h) : hi(h), lo(0.0) {}          // implicit: lets R(0.0) work generically
    DD(double h, double l) : hi(h), lo(l) {}
};

inline DD operator+(const DD& a, const DD& b) {
    Double2 s = two_sum(a.hi, b.hi);
    double e = s.e + a.lo + b.lo;
    Double2 r = two_sum(s.s, e);
    return {r.s, r.e};
}

inline DD operator-(const DD& a, const DD& b) {
    return a + DD(-b.hi, -b.lo);
}

inline DD operator*(const DD& a, const DD& b) {
    Double2 p = two_product(a.hi, b.hi);
    Double2 r = two_sum(p.s, p.e + (a.hi * b.lo + a.lo * b.hi));
    return {r.s, r.e};
}

inline DD sqr(const DD& a) {
    Double2 p = two_product(a.hi, a.hi);
    Double2 r = two_sum(p.s, p.e + 2.0 * a.hi * a.lo);
    return {r.s, r.e};
}

inline DD twice(const DD& a) { return {2.0 * a.hi, 2.0 * a.lo}; }
inline DD cabs(const DD& a)  { return a.hi < 0.0 ? DD(-a.hi, -a.lo) : a; }
inline double lead(const DD& a) { return a.hi; }

}  // namespace mg
