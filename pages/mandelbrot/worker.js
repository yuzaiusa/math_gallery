// Strip-rendering worker. Each worker owns its own single-threaded WASM
// instance (no SharedArrayBuffer — GitHub Pages can't set COOP/COEP headers)
// and renders horizontal strips handed to it by main.js.
import createModule from './wasm/core.js';

let Module = null;

createModule().then((m) => {
  Module = m;
  postMessage({ type: 'ready' });
});

onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'strip' || !Module) return;

  const p = msg.params;
  const rows = msg.y1 - msg.y0;
  const n = rows * p.canvasW;
  const bytes = n * 4;

  const ptr = Module._malloc(bytes);
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
};
