// Quad-double arithmetic for the viewer (~63 decimal digits). The view CENTER is
// stored in QD so deep zooms aren't capped by the ~1e14 f64-coordinate wall; the
// view width stays a plain double (tiny but representable at any depth). Only
// qd_add is needed for navigation (pan delta = fraction*width added to the QD
// center); qd_mul + QD_TENTH back the decimal parse/format of center strings.
//
// Primitives (twoSum/twoProduct/qdRenorm/qdAdd/qdSub/qdMul) are ported verbatim
// from the original viewer's worker.js. A QD value is a length-4 array
// [e0,e1,e2,e3] whose true value is e0+e1+e2+e3 (components non-overlapping).

// --- error-free transforms ---
function twoSum(a, b) {
  const s = a + b;
  const v = s - a;
  const e = (a - (s - v)) + (b - v);
  return [s, e];
}
function quickTwoSum(a, b) {
  const s = a + b;
  const e = b - (s - a);
  return [s, e];
}
function ddSplit(x) {
  const t = 134217729 * x; // 2^27 + 1
  const hi = t - (t - x);
  const lo = x - hi;
  return [hi, lo];
}
function twoProduct(a, b) {
  const p = a * b;
  const [ahi, alo] = ddSplit(a);
  const [bhi, blo] = ddSplit(b);
  const e = ((ahi * bhi - p) + ahi * blo + alo * bhi) + alo * blo;
  return [p, e];
}
function threeSum(a, b, c) {
  let [t1, t2] = twoSum(a, b);
  let t3;
  [a, t3] = twoSum(c, t1);
  [b, c]  = twoSum(t2, t3);
  return [a, b, c];
}
function threeSum2(a, b, c) {
  let [t1, t2] = twoSum(a, b);
  let t3;
  [a, t3] = twoSum(c, t1);
  b = t2 + t3;
  return [a, b];
}

// Renormalize 5 overlapping floats -> canonical QD (Hida/Li/Bailey).
function qdRenorm(c0, c1, c2, c3, c4) {
  let s0;
  [s0, c4] = quickTwoSum(c3, c4);
  [s0, c3] = quickTwoSum(c2, s0);
  [s0, c2] = quickTwoSum(c1, s0);
  [c0, c1] = quickTwoSum(c0, s0);

  let s1 = c1, s2 = 0, s3 = 0;
  s0 = c0;

  if (s1 !== 0) {
    [s1, s2] = quickTwoSum(s1, c2);
    if (s2 !== 0) {
      [s2, s3] = quickTwoSum(s2, c3);
      if (s3 !== 0) s3 += c4;
      else [s2, s3] = quickTwoSum(s2, c4);
    } else {
      [s1, s2] = quickTwoSum(s1, c3);
      if (s2 !== 0) [s2, s3] = quickTwoSum(s2, c4);
      else           [s1, s2] = quickTwoSum(s1, c4);
    }
  } else {
    [s0, s1] = quickTwoSum(s0, c2);
    if (s1 !== 0) {
      [s1, s2] = quickTwoSum(s1, c3);
      if (s2 !== 0) [s2, s3] = quickTwoSum(s2, c4);
      else           [s1, s2] = quickTwoSum(s1, c4);
    } else {
      [s0, s1] = quickTwoSum(s0, c3);
      if (s1 !== 0) [s1, s2] = quickTwoSum(s1, c4);
      else           [s0, s1] = quickTwoSum(s0, c4);
    }
  }
  return [s0, s1, s2, s3];
}

function qdAdd(a, b) {
  let [s0, t0] = twoSum(a[0], b[0]);
  let [s1, t1] = twoSum(a[1], b[1]);
  let [s2, t2] = twoSum(a[2], b[2]);
  let [s3, t3] = twoSum(a[3], b[3]);

  [s1, t0] = twoSum(s1, t0);
  [s2, t0, t1] = threeSum(s2, t0, t1);
  [s3, t0] = threeSum2(s3, t0, t2);
  t0 = t0 + t1 + t3;

  return qdRenorm(s0, s1, s2, s3, t0);
}

function qdNeg(a) { return [-a[0], -a[1], -a[2], -a[3]]; }
function qdSub(a, b) { return qdAdd(a, qdNeg(b)); }

function qdMul(a, b) {
  let [p0, q0] = twoProduct(a[0], b[0]);
  let [p1, q1] = twoProduct(a[0], b[1]);
  let [p2, q2] = twoProduct(a[1], b[0]);
  let [p3, q3] = twoProduct(a[0], b[2]);
  let [p4, q4] = twoProduct(a[1], b[1]);
  let [p5, q5] = twoProduct(a[2], b[0]);

  [p1, p2, q0] = threeSum(p1, p2, q0);
  [p2, q1, q2] = threeSum(p2, q1, q2);
  [p3, p4, p5] = threeSum(p3, p4, p5);

  let [s0, t0] = twoSum(p2, p3);
  let [s1, t1] = twoSum(q1, p4);
  let s2 = q2 + p5;
  [s1, t0] = twoSum(s1, t0);
  s2 += t0 + t1;

  s1 += a[0]*b[3] + a[1]*b[2] + a[2]*b[1] + a[3]*b[0] + q0 + q3 + q4 + q5;

  return qdRenorm(p0, p1, s0, s1, s2);
}

// --- constants ---
const QD_TEN = [10, 0, 0, 0];                       // exact
const QD_TENTH = [0.1, -5.551115123125783e-18,      // 1/10 to ~63 digits
                  3.0814879110195775e-34, -1.7105694144590053e-50];

// --- decimal <-> QD ---
// Parse a decimal string ("-0.743643887037151", "4.1e-9", ...) into a QD.
// Digits accumulate as an integer mantissa (exact via qdMul by 10), then scaled
// by the decimal exponent (multiply by QD_TENTH for negative powers of ten).
function qdFromString(str) {
  let s = String(str).trim();
  if (!s) return [0, 0, 0, 0];
  let neg = false;
  if (s[0] === '+') s = s.slice(1);
  else if (s[0] === '-') { neg = true; s = s.slice(1); }

  let exp = 0;
  const eIdx = s.search(/[eE]/);
  if (eIdx >= 0) { exp = parseInt(s.slice(eIdx + 1), 10) || 0; s = s.slice(0, eIdx); }

  let fracLen = 0;
  const dot = s.indexOf('.');
  if (dot >= 0) { fracLen = s.length - dot - 1; s = s.slice(0, dot) + s.slice(dot + 1); }

  let val = [0, 0, 0, 0];
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) continue;
    val = qdAdd(qdMul(val, QD_TEN), [d, 0, 0, 0]);
  }

  let e = exp - fracLen;
  for (; e > 0; e--) val = qdMul(val, QD_TEN);
  for (; e < 0; e++) val = qdMul(val, QD_TENTH);

  return neg ? qdNeg(val) : val;
}

// Split a non-negative QD into [floor, fraction] with the fraction in [0,1).
// The leading double f[0] can round across an integer boundary (e.g. 4.999…965
// stores as [5, -3.5e-17]), so the integer is corrected using full-QD sign tests
// rather than a lossy f[0]/f[0]+f[1] compare — otherwise sub-1e-16 digits vanish.
function qdSplitInt(v) {
  let d = Math.floor(v[0]);
  let r = qdSub(v, [d, 0, 0, 0]);
  if (r[0] < 0) {                                  // f[0] rounded up over the integer
    d -= 1; r = qdAdd(r, [1, 0, 0, 0]);
  } else {                                         // f[0] rounded down below it
    const r1 = qdSub(r, [1, 0, 0, 0]);
    if (r1[0] > 0) { d += 1; r = r1; }
  }
  return [d, r];
}

// Format a QD as a decimal string with `frac` digits after the point. Assumes a
// bounded magnitude (fractal coordinates satisfy |v| < ~16), so no exponent
// handling is needed; digits are peeled off one at a time via qdMul by 10.
function qdToString(a, frac) {
  const neg = (a[0] + a[1]) < 0;
  let x = neg ? qdNeg(a) : a.slice();

  // Round (not truncate) at the last shown place: the nearest QD to a decimal
  // sits just above or below it, so plain truncation would surface trailing 9s
  // (e.g. 0.745 -> 0.74499…). A half-ULP nudge rounds half away from zero.
  x = qdAdd(x, [0.5 * Math.pow(10, -frac), 0, 0, 0]);

  let [ip, f] = qdSplitInt(x);
  let out = String(ip) + '.';
  for (let i = 0; i < frac; i++) {
    f = qdMul(f, QD_TEN);
    let [d, r] = qdSplitInt(f);
    if (d < 0) d = 0; else if (d > 9) d = 9;
    out += d;
    f = r;
  }
  return (neg ? '-' : '') + out;
}

// f64 magnitude of a QD (used only for thresholds/display), good to ~1 ulp.
function qdToNumber(a) { return ((a[3] + a[2]) + a[1]) + a[0]; }
