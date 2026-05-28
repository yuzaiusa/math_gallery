// Strip-rendering worker. Each worker owns its own single-threaded WASM
// instance (no SharedArrayBuffer — GitHub Pages can't set COOP/COEP headers)
// and renders horizontal strips handed to it by main.js.
//
// Two paths: 'strip' uses the direct f64/DD/QD kernel; 'strip-perturb' uses the
// perturbation deep-zoom kernel, which needs a high-precision reference orbit
// computed once per render epoch (cached here per worker).
import createModule from './wasm/core.js';

let Module = null;

createModule().then((m) => {
  Module = m;
  postMessage({ type: 'ready' });
});

// Reference orbit + QD center for the current perturbation epoch. Recomputing it
// is cheap next to a full strip, so each worker keeps its own copy.
let ref = { epoch: -1, crePtr: 0, cimPtr: 0, xrPtr: 0, xiPtr: 0, len: 0 };

function freeRef() {
  if (ref.crePtr) Module._free(ref.crePtr);
  if (ref.cimPtr) Module._free(ref.cimPtr);
  if (ref.xrPtr)  Module._free(ref.xrPtr);
  if (ref.xiPtr)  Module._free(ref.xiPtr);
  ref = { epoch: -1, crePtr: 0, cimPtr: 0, xrPtr: 0, xiPtr: 0, len: 0 };
}

function ensureReference(p, epoch) {
  if (ref.epoch === epoch) return;
  freeRef();
  const crePtr = Module._malloc(4 * 8);
  const cimPtr = Module._malloc(4 * 8);
  const xrPtr  = Module._malloc((p.maxIter + 1) * 8);
  const xiPtr  = Module._malloc((p.maxIter + 1) * 8);
  // Re-read HEAPF64 after the mallocs (memory growth may replace the buffer),
  // then write the QD center (4 doubles each).
  const f64 = Module.HEAPF64;
  f64.set(p.creQD, crePtr / 8);
  f64.set(p.cimQD, cimPtr / 8);
  const len = Module._mg_perturb_reference(
    p.fractal, p.degree, p.juliaRe, p.juliaIm,
    crePtr, cimPtr, p.maxIter, p.escapeR2, xrPtr, xiPtr);
  ref = { epoch, crePtr, cimPtr, xrPtr, xiPtr, len };
}

onmessage = (e) => {
  const msg = e.data;
  if (!Module) return;

  if (msg.type === 'strip') {
    const p = msg.params;
    const rows = msg.y1 - msg.y0;
    const n = rows * p.canvasW;
    const ptr = Module._malloc(n * 4);
    Module._mg_render_band(
      p.fractal, p.precision,
      p.reMin, p.reRange, p.imMax, p.imRange,
      p.canvasW, p.canvasH, msg.y0, msg.y1,
      p.maxIter, p.escapeR2,
      p.degree, p.juliaRe, p.juliaIm,
      ptr);

    // Re-read HEAPF32 *after* the call: ALLOW_MEMORY_GROWTH may have replaced
    // the backing ArrayBuffer. Copy out into a transferable buffer.
    const out = new Float32Array(n);
    out.set(new Float32Array(Module.HEAPF32.buffer, ptr, n));
    Module._free(ptr);

    postMessage({ type: 'strip', epoch: msg.epoch, y0: msg.y0, y1: msg.y1, data: out },
                [out.buffer]);
    return;
  }

  if (msg.type === 'strip-perturb') {
    const p = msg.params;
    ensureReference(p, msg.epoch);
    const rows = msg.y1 - msg.y0;
    const n = rows * p.canvasW;
    const ptr = Module._malloc(n * 4);
    Module._mg_render_band_perturb(
      p.fractal, p.degree, p.juliaRe, p.juliaIm,
      ref.crePtr, ref.cimPtr, ref.xrPtr, ref.xiPtr, ref.len,
      p.reSpan, p.imSpan,
      p.canvasW, p.canvasH, msg.y0, msg.y1,
      p.maxIter, p.escapeR2,
      ptr);

    const out = new Float32Array(n);
    out.set(new Float32Array(Module.HEAPF32.buffer, ptr, n));
    Module._free(ptr);

    postMessage({ type: 'strip', epoch: msg.epoch, y0: msg.y0, y1: msg.y1, data: out },
                [out.buffer]);
    return;
  }
};
