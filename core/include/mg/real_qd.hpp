#pragma once
// Quad-double arithmetic (~64 decimal digits). Ported from the JS qd kernel
// (the "sloppy" add/mul variants from the Hida/Li/Bailey QD library, which are
// accurate enough for fractal iteration).
#include "twofloat.hpp"

namespace mg {

struct QD {
    double x[4];  // value == x[0]+x[1]+x[2]+x[3], components non-overlapping
    QD() : x{0.0, 0.0, 0.0, 0.0} {}
    QD(double v) : x{v, 0.0, 0.0, 0.0} {}
    QD(double a, double b, double c, double d) : x{a, b, c, d} {}
};

// Renormalize 5 overlapping floats into a canonical QD.
inline QD qd_renorm(double c0, double c1, double c2, double c3, double c4) {
    double s0;
    { Double2 r = quick_two_sum(c3, c4); s0 = r.s; c4 = r.e; }
    { Double2 r = quick_two_sum(c2, s0); s0 = r.s; c3 = r.e; }
    { Double2 r = quick_two_sum(c1, s0); s0 = r.s; c2 = r.e; }
    { Double2 r = quick_two_sum(c0, s0); c0 = r.s; c1 = r.e; }

    double s1 = c1, s2 = 0.0, s3 = 0.0;
    s0 = c0;

    if (s1 != 0.0) {
        { Double2 r = quick_two_sum(s1, c2); s1 = r.s; s2 = r.e; }
        if (s2 != 0.0) {
            { Double2 r = quick_two_sum(s2, c3); s2 = r.s; s3 = r.e; }
            if (s3 != 0.0) s3 += c4;
            else { Double2 r = quick_two_sum(s2, c4); s2 = r.s; s3 = r.e; }
        } else {
            { Double2 r = quick_two_sum(s1, c3); s1 = r.s; s2 = r.e; }
            if (s2 != 0.0) { Double2 r = quick_two_sum(s2, c4); s2 = r.s; s3 = r.e; }
            else           { Double2 r = quick_two_sum(s1, c4); s1 = r.s; s2 = r.e; }
        }
    } else {
        { Double2 r = quick_two_sum(s0, c2); s0 = r.s; s1 = r.e; }
        if (s1 != 0.0) {
            { Double2 r = quick_two_sum(s1, c3); s1 = r.s; s2 = r.e; }
            if (s2 != 0.0) { Double2 r = quick_two_sum(s2, c4); s2 = r.s; s3 = r.e; }
            else           { Double2 r = quick_two_sum(s1, c4); s1 = r.s; s2 = r.e; }
        } else {
            { Double2 r = quick_two_sum(s0, c3); s0 = r.s; s1 = r.e; }
            if (s1 != 0.0) { Double2 r = quick_two_sum(s1, c4); s1 = r.s; s2 = r.e; }
            else           { Double2 r = quick_two_sum(s0, c4); s0 = r.s; s1 = r.e; }
        }
    }
    return {s0, s1, s2, s3};
}

inline QD operator+(const QD& a, const QD& b) {
    Double2 S0 = two_sum(a.x[0], b.x[0]);
    Double2 S1 = two_sum(a.x[1], b.x[1]);
    Double2 S2 = two_sum(a.x[2], b.x[2]);
    Double2 S3 = two_sum(a.x[3], b.x[3]);
    double s0 = S0.s, t0 = S0.e;
    double s1 = S1.s, t1 = S1.e;
    double s2 = S2.s, t2 = S2.e;
    double s3 = S3.s, t3 = S3.e;

    { Double2 r = two_sum(s1, t0); s1 = r.s; t0 = r.e; }
    three_sum(s2, t0, t1);
    three_sum2(s3, t0, t2);
    t0 = t0 + t1 + t3;

    return qd_renorm(s0, s1, s2, s3, t0);
}

inline QD operator-(const QD& a, const QD& b) {
    return a + QD(-b.x[0], -b.x[1], -b.x[2], -b.x[3]);
}

inline QD operator*(const QD& a, const QD& b) {
    Double2 P0 = two_product(a.x[0], b.x[0]);
    Double2 P1 = two_product(a.x[0], b.x[1]);
    Double2 P2 = two_product(a.x[1], b.x[0]);
    Double2 P3 = two_product(a.x[0], b.x[2]);
    Double2 P4 = two_product(a.x[1], b.x[1]);
    Double2 P5 = two_product(a.x[2], b.x[0]);

    double p0 = P0.s, q0 = P0.e;
    double p1 = P1.s, q1 = P1.e;
    double p2 = P2.s, q2 = P2.e;
    double p3 = P3.s, q3 = P3.e;
    double p4 = P4.s, q4 = P4.e;
    double p5 = P5.s, q5 = P5.e;

    three_sum(p1, p2, q0);
    three_sum(p2, q1, q2);
    three_sum(p3, p4, p5);

    Double2 s = two_sum(p2, p3);
    double s0 = s.s, t0 = s.e;
    Double2 s1t1 = two_sum(q1, p4);
    double s1 = s1t1.s, t1 = s1t1.e;
    double s2 = q2 + p5;
    { Double2 r = two_sum(s1, t0); s1 = r.s; t0 = r.e; }
    s2 += t0 + t1;

    s1 += a.x[0]*b.x[3] + a.x[1]*b.x[2] + a.x[2]*b.x[1] + a.x[3]*b.x[0]
          + q0 + q3 + q4 + q5;

    return qd_renorm(p0, p1, s0, s1, s2);
}

inline QD sqr(const QD& a) {
    Double2 P0 = two_product(a.x[0], a.x[0]);
    Double2 P1 = two_product(2.0 * a.x[0], a.x[1]);
    Double2 P2 = two_product(2.0 * a.x[0], a.x[2]);
    Double2 P3 = two_product(a.x[1], a.x[1]);

    double p0 = P0.s, q0 = P0.e;
    double p1 = P1.s, q1 = P1.e;
    double p2 = P2.s, q2 = P2.e;
    double p3 = P3.s, q3 = P3.e;

    { Double2 r = two_sum(q0, p1); p1 = r.s; q0 = r.e; }
    { Double2 r = two_sum(q0, q1); q0 = r.s; q1 = r.e; }
    { Double2 r = two_sum(p2, p3); p2 = r.s; p3 = r.e; }

    Double2 s = two_sum(p2, q0);
    double s0 = s.s, t0 = s.e;
    Double2 s1t1 = two_sum(p3, q1);
    double s1 = s1t1.s, t1 = s1t1.e;
    { Double2 r = two_sum(s1, t0); s1 = r.s; t0 = r.e; }
    t0 += t1;

    { Double2 r = quick_two_sum(s1, t0); s1 = r.s; t0 = r.e; }
    { Double2 r = quick_two_sum(s0, s1); p2 = r.s; t1 = r.e; }
    { Double2 r = quick_two_sum(t1, t0); p3 = r.s; q0 = r.e; }

    double p4 = 2.0 * a.x[0] * a.x[3];
    double p5 = 2.0 * a.x[1] * a.x[2];
    { Double2 r = two_sum(p4, p5); p4 = r.s; p5 = r.e; }
    q2 += p5;
    { Double2 r = two_sum(p4, q2); p4 = r.s; q2 = r.e; }
    p4 += q3 + q0;

    return qd_renorm(p0, p1, p2, p3, p4);
}

inline QD twice(const QD& a) { return {2.0*a.x[0], 2.0*a.x[1], 2.0*a.x[2], 2.0*a.x[3]}; }
inline QD cabs(const QD& a)  {
    return a.x[0] < 0.0 ? QD(-a.x[0], -a.x[1], -a.x[2], -a.x[3]) : a;
}
inline double lead(const QD& a) { return a.x[0]; }

}  // namespace mg
