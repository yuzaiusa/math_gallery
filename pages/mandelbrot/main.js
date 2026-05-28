const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const octx = overlay.getContext('2d');

const progressBar = document.getElementById('progress-bar');
const progressWrap = document.getElementById('progress-wrap');
const statusEl = document.getElementById('status');
const maxIterInput = document.getElementById('max-iter');
const colorCyclesInput = document.getElementById('color-cycles');
const resetBtn = document.getElementById('reset-btn');
const centerReInput = document.getElementById('center-re');
const centerImInput = document.getElementById('center-im');
const zoomInput = document.getElementById('zoom-input');
const zoomBtn = document.getElementById('zoom-btn');
const zoom2xBtn = document.getElementById('zoom2x-btn');
const zoom05xBtn = document.getElementById('zoom05x-btn');
const fractalSelect = document.getElementById('fractal');
const degreeLabel = document.getElementById('degree-label');
const degreeInput = document.getElementById('degree');
const juliaLabel = document.getElementById('julia-label');
const juliaReInput = document.getElementById('julia-re');
const juliaImInput = document.getElementById('julia-im');

// Fractal / precision ids must match the C++ enums (fractals.hpp).
const FRAC = { MANDELBROT: 0, JULIA: 1, MULTIBROT: 2, TRICORN: 3, BURNING_SHIP: 4 };
const PREC = { F64: 0, DD: 1, QD: 2 };
const PREC_NAME = ['', '[DD precision]', '[QD precision]'];

const INITIAL_RE_WIDTH = 3.5;
const DEFAULT_CENTER = {
  [FRAC.MANDELBROT]:   { re: -0.75, im: 0 },
  [FRAC.JULIA]:        { re: 0, im: 0 },
  [FRAC.MULTIBROT]:    { re: 0, im: 0 },
  [FRAC.TRICORN]:      { re: -0.25, im: 0 },
  [FRAC.BURNING_SHIP]: { re: -0.5, im: -0.5 },
};

// Fractals that have a perturbation deep-zoom path (the rest stay on direct
// DD/QD kernels), and the zoom past which we switch to it.
const PERTURB_FRACTALS = new Set([FRAC.MANDELBROT, FRAC.JULIA, FRAC.MULTIBROT]);
const PERTURB_MIN_ZOOM = 1e10;

// The view: center stored in QD (so deep zoom isn't capped by the f64 coordinate
// wall), real-axis width a plain double. The imaginary extent follows the aspect.
let view = { cre: [-0.75, 0, 0, 0], cim: [0, 0, 0, 0], reWidth: INITIAL_RE_WIDTH };
let imageData = null;
let rawCache = null;   // Float32Array of smooth-escape values, width*height

function imHeightFor(reWidth) { return reWidth * canvas.height / canvas.width; }

// Pick precision tier from the view's real-axis width (mirrors choose_precision).
function choosePrecision(reWidth) {
  if (reWidth < 1e-26) return PREC.QD;
  if (reWidth < 1e-11) return PREC.DD;
  return PREC.F64;
}

// --- Color mapping ---

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  const hi = Math.floor(h * 6);
  if      (hi === 0) { r = c; g = x; b = 0; }
  else if (hi === 1) { r = x; g = c; b = 0; }
  else if (hi === 2) { r = 0; g = c; b = x; }
  else if (hi === 3) { r = 0; g = x; b = c; }
  else if (hi === 4) { r = x; g = 0; b = c; }
  else               { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function colorMap(smoothVal, maxIter, cycles) {
  if (smoothVal < 0) return [0, 0, 0]; // in-set: black
  let t = Math.max(0, Math.min(1, smoothVal / (maxIter - 1)));
  t = Math.cbrt(t); // spread low-escape region
  const hue = (t * cycles) % 1.0;
  return hslToRgb(hue, 1.0, 0.5);
}

function recolor() {
  if (!rawCache || !imageData) return;
  const maxIter = parseInt(maxIterInput.value, 10) || 4096;
  const colorCycles = parseFloat(colorCyclesInput.value) || 1;
  const len = canvas.width * canvas.height;
  for (let px = 0; px < len; px++) {
    const [r, g, b] = colorMap(rawCache[px], maxIter, colorCycles);
    const i = px * 4;
    imageData.data[i] = r; imageData.data[i + 1] = g;
    imageData.data[i + 2] = b; imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

// --- Worker pool ---

const N_WORKERS = Math.min(navigator.hardwareConcurrency || 4, 8);
const workers = [];
const wReady = [];
const wBusy = [];

let renderEpoch = 0;
let stripQueue = [];
let stripsTotal = 0;
let stripsDone = 0;
let currentParams = null;
let currentMsgType = 'strip';   // 'strip' (direct) or 'strip-perturb'
let renderMaxIter = 4096;
let renderCycles = 1;

function initWorkers() {
  for (let i = 0; i < N_WORKERS; i++) {
    const w = new Worker('worker.js', { type: 'module' });
    const idx = i;
    w.onmessage = (e) => onWorkerMsg(idx, e.data);
    workers.push(w);
    wReady.push(false);
    wBusy.push(false);
  }
}

function onWorkerMsg(i, msg) {
  if (msg.type === 'ready') {
    wReady[i] = true;
    wBusy[i] = false;
    assignNext(i);
    return;
  }
  if (msg.type === 'strip') {
    wBusy[i] = false;
    if (msg.epoch === renderEpoch) {
      paintStrip(msg);
      stripsDone++;
      progressBar.style.width = (stripsDone / stripsTotal * 100) + '%';
      if (stripsDone >= stripsTotal) progressWrap.style.visibility = 'hidden';
    }
    assignNext(i);
  }
}

function assignNext(i) {
  if (!wReady[i] || wBusy[i] || stripQueue.length === 0) return;
  const s = stripQueue.shift();
  wBusy[i] = true;
  workers[i].postMessage({ type: currentMsgType, epoch: renderEpoch, y0: s.y0, y1: s.y1, params: currentParams });
}

function paintStrip(msg) {
  const { y0, y1, data } = msg;
  const w = canvas.width;
  rawCache.set(data, y0 * w);
  let i = y0 * w * 4;
  const end = (y1 - y0) * w;
  for (let px = 0; px < end; px++) {
    const [r, g, b] = colorMap(data[px], renderMaxIter, renderCycles);
    imageData.data[i++] = r; imageData.data[i++] = g;
    imageData.data[i++] = b; imageData.data[i++] = 255;
  }
  ctx.putImageData(imageData, 0, 0, 0, y0, w, y1 - y0);
}

// --- Render ---

function startRender() {
  const maxIter = parseInt(maxIterInput.value, 10) || 4096;
  const colorCycles = parseFloat(colorCyclesInput.value) || 1;
  const fractal = parseInt(fractalSelect.value, 10) || 0;

  const reWidth = view.reWidth;
  const imHeight = imHeightFor(reWidth);
  const precision = choosePrecision(reWidth);
  const zoom = INITIAL_RE_WIDTH / reWidth;
  const usePerturb = PERTURB_FRACTALS.has(fractal) && zoom > PERTURB_MIN_ZOOM;

  // Display: enough digits to resolve the view; QD string past the f64 limit.
  const sigFigs = Math.max(6, Math.ceil(Math.log10(zoom)) + 4);
  if (zoom > 1e9) {
    centerReInput.value = qdToString(view.cre, sigFigs);
    centerImInput.value = qdToString(view.cim, sigFigs);
  } else {
    centerReInput.value = view.cre[0].toPrecision(Math.min(sigFigs, 15));
    centerImInput.value = view.cim[0].toPrecision(Math.min(sigFigs, 15));
  }
  zoomInput.value = zoom.toPrecision(6);
  statusEl.textContent = usePerturb ? '[perturbation deep zoom]' : PREC_NAME[precision];

  imageData = ctx.createImageData(canvas.width, canvas.height);
  rawCache = new Float32Array(canvas.width * canvas.height);
  renderMaxIter = maxIter;
  renderCycles = colorCycles;

  const degree = Math.max(2, parseInt(degreeInput.value, 10) || 3);
  const juliaRe = parseFloat(juliaReInput.value) || 0;
  const juliaIm = parseFloat(juliaImInput.value) || 0;

  if (usePerturb) {
    currentMsgType = 'strip-perturb';
    currentParams = {
      fractal, degree, juliaRe, juliaIm,
      creQD: view.cre.slice(), cimQD: view.cim.slice(),
      reSpan: reWidth, imSpan: imHeight,
      canvasW: canvas.width, canvasH: canvas.height,
      maxIter, escapeR2: 4,
    };
  } else {
    currentMsgType = 'strip';
    const reMin = view.cre[0] - reWidth / 2;
    const imMax = view.cim[0] + imHeight / 2;
    currentParams = {
      fractal,
      precision,
      reMin,
      reRange: reWidth,
      imMax,
      imRange: imHeight,
      canvasW: canvas.width,
      canvasH: canvas.height,
      maxIter,
      escapeR2: 4,
      degree, juliaRe, juliaIm,
    };
  }

  // Build strip queue (~6 strips per worker for load balancing + progressive paint).
  const stripRows = Math.max(8, Math.round(canvas.height / (N_WORKERS * 6)));
  renderEpoch++;
  stripQueue = [];
  for (let y = 0; y < canvas.height; y += stripRows) {
    stripQueue.push({ y0: y, y1: Math.min(y + stripRows, canvas.height) });
  }
  stripsTotal = stripQueue.length;
  stripsDone = 0;

  progressBar.style.width = '0%';
  progressWrap.style.visibility = 'visible';

  for (let i = 0; i < N_WORKERS; i++) assignNext(i);
}

// --- Zoom interaction (drag) ---

let dragStart = null;
let dragRect = null;

function onDragMove(e) {
  if (!dragStart) return;
  const rect = overlay.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const dx = mx - dragStart.x;
  const dy = my - dragStart.y;
  const aspectHW = canvas.height / canvas.width;
  const w = Math.min(Math.abs(dx), Math.abs(dy) / aspectHW);
  const h = w * aspectHW;
  const x = dx >= 0 ? dragStart.x : dragStart.x - w;
  const y = dy >= 0 ? dragStart.y : dragStart.y - h;
  dragRect = { x, y, w, h };
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.strokeStyle = 'rgba(255, 40, 40, 0.95)';
  octx.lineWidth = 1.5;
  octx.setLineDash([4, 3]);
  octx.strokeRect(x, y, w, h);
}

function onDragEnd() {
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  if (!dragStart || !dragRect) {
    dragStart = null;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }
  const { x, y, w, h } = dragRect;
  const cw = canvas.width, ch = canvas.height;
  const reWidth = view.reWidth;
  const imHeight = imHeightFor(reWidth);
  const rectCx = x + w / 2, rectCy = y + h / 2;
  const dRe = (rectCx / cw - 0.5) * reWidth;
  const dIm = (0.5 - rectCy / ch) * imHeight;
  view.cre = qdAdd(view.cre, [dRe, 0, 0, 0]);
  view.cim = qdAdd(view.cim, [dIm, 0, 0, 0]);
  view.reWidth = (w / cw) * reWidth;
  dragStart = null;
  dragRect = null;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  startRender();
}

overlay.addEventListener('mousedown', (e) => {
  const rect = overlay.getBoundingClientRect();
  dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  dragRect = null;
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
});

// --- Touch (pan + pinch) ---

let lastTouchDist = null, lastTouchCenter = null, singleTouchStart = null;
const touchDist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
const touchCenter = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

overlay.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    lastTouchDist = touchDist(e.touches[0], e.touches[1]);
    lastTouchCenter = touchCenter(e.touches[0], e.touches[1]);
    singleTouchStart = null;
  } else if (e.touches.length === 1) {
    singleTouchStart = {
      x: e.touches[0].clientX, y: e.touches[0].clientY,
      view: { cre: view.cre.slice(), cim: view.cim.slice(), reWidth: view.reWidth },
    };
    lastTouchDist = null; lastTouchCenter = null;
  }
}, { passive: false });

overlay.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dist = touchDist(e.touches[0], e.touches[1]);
    const center = touchCenter(e.touches[0], e.touches[1]);
    if (lastTouchDist && lastTouchCenter) {
      const scale = lastTouchDist / dist;
      const rect = overlay.getBoundingClientRect();
      const cx = (center.x - rect.left) / canvas.width;
      const cy = (center.y - rect.top) / canvas.height;
      const reWidth = view.reWidth;
      const imHeight = imHeightFor(reWidth);
      // Scale the view about the pinch pivot; the center shifts toward it.
      const dRe = (cx - 0.5) * reWidth * (1 - scale);
      const dIm = (0.5 - cy) * imHeight * (1 - scale);
      view.cre = qdAdd(view.cre, [dRe, 0, 0, 0]);
      view.cim = qdAdd(view.cim, [dIm, 0, 0, 0]);
      view.reWidth = reWidth * scale;
      startRender();
    }
    lastTouchDist = dist; lastTouchCenter = center; singleTouchStart = null;
  } else if (e.touches.length === 1 && singleTouchStart) {
    const dx = e.touches[0].clientX - singleTouchStart.x;
    const dy = e.touches[0].clientY - singleTouchStart.y;
    const s = singleTouchStart.view;
    const imHeight = imHeightFor(s.reWidth);
    const dRe = (dx / canvas.width) * s.reWidth;
    const dIm = (dy / canvas.height) * imHeight;
    view.cre = qdAdd(s.cre, [-dRe, 0, 0, 0]);
    view.cim = qdAdd(s.cim, [dIm, 0, 0, 0]);
    view.reWidth = s.reWidth;
    startRender();
  }
}, { passive: false });

overlay.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) { lastTouchDist = null; lastTouchCenter = null; }
  if (e.touches.length === 0) { singleTouchStart = null; }
}, { passive: false });

// --- Viewport helpers ---

// centerRe/centerIm are QD values (length-4 arrays); zoom is a plain double.
function navigateTo(centerRe, centerIm, zoom) {
  view.cre = centerRe.slice();
  view.cim = centerIm.slice();
  view.reWidth = INITIAL_RE_WIDTH / zoom;
  startRender();
}

function resetView() {
  const fractal = parseInt(fractalSelect.value, 10) || 0;
  const c = DEFAULT_CENTER[fractal] || { re: -0.75, im: 0 };
  navigateTo([c.re, 0, 0, 0], [c.im, 0, 0, 0], 1);
}

// --- Controls ---

resetBtn.addEventListener('click', () => {
  maxIterInput.value = 4096;
  colorCyclesInput.value = 1;
  resetView();
});

maxIterInput.addEventListener('change', startRender);
colorCyclesInput.addEventListener('change', recolor);
degreeInput.addEventListener('change', startRender);
juliaReInput.addEventListener('change', startRender);
juliaImInput.addEventListener('change', startRender);

function updateFractalUI() {
  const fractal = parseInt(fractalSelect.value, 10) || 0;
  degreeLabel.style.display = fractal === FRAC.MULTIBROT ? '' : 'none';
  juliaLabel.style.display = fractal === FRAC.JULIA ? '' : 'none';
}

fractalSelect.addEventListener('change', () => {
  updateFractalUI();
  resetView();   // a deep zoom from one fractal is meaningless for another
});

function applyInputs() {
  const zoom = parseFloat(zoomInput.value);
  if (isNaN(zoom) || zoom <= 0) return;
  // Parse the center strings in full QD precision so pasted deep-zoom
  // coordinates aren't truncated to f64.
  navigateTo(qdFromString(centerReInput.value), qdFromString(centerImInput.value), zoom);
}

zoomBtn.addEventListener('click', applyInputs);
[centerReInput, centerImInput, zoomInput].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') applyInputs(); });
});

function rezoom(factor) {
  // Operate on the live view (keeps the QD center exact; no text round-trip).
  view.reWidth /= factor;
  startRender();
}
zoom2xBtn.addEventListener('click', () => rezoom(2));
zoom05xBtn.addEventListener('click', () => rezoom(0.5));

// --- Save (PNG with annotation) ---

document.getElementById('save-btn').addEventListener('click', () => {
  const zoom = INITIAL_RE_WIDTH / view.reWidth;
  const sigFigs = Math.max(12, Math.ceil(Math.log10(zoom)) + 4);
  const reStr = zoom > 1e9 ? qdToString(view.cre, sigFigs) : view.cre[0].toPrecision(12);
  const imStr = zoom > 1e9 ? qdToString(view.cim, sigFigs) : view.cim[0].toPrecision(12);
  const fractalName = fractalSelect.options[fractalSelect.selectedIndex].text;

  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const oc = offscreen.getContext('2d');
  oc.drawImage(canvas, 0, 0);

  const lines = [
    fractalName,
    `Re = ${reStr}`,
    `Im = ${imStr}`,
    `Zoom = ${zoom.toPrecision(6)}`,
  ];
  const fontSize = Math.max(10, Math.round(canvas.width / 110));
  oc.font = `${fontSize}px monospace`;
  oc.textAlign = 'right';
  oc.textBaseline = 'top';
  const padding = Math.round(fontSize * 0.6);
  lines.forEach((line, i) => {
    const x = canvas.width - padding;
    const y = padding + i * (fontSize + 4);
    oc.fillStyle = 'rgba(0,0,0,0.45)';
    oc.fillText(line, x + 1, y + 1);
    oc.fillStyle = '#ff4444';
    oc.fillText(line, x, y);
  });

  const a = document.createElement('a');
  a.download = `${fractalName.replace(/\s+/g, '_').toLowerCase()}_zoom${zoom.toPrecision(4)}.png`;
  a.href = offscreen.toDataURL('image/png');
  a.click();
});

// --- D-pad + keyboard navigation ---

function panBy(fracX, fracY) {
  view.cre = qdAdd(view.cre, [view.reWidth * fracX, 0, 0, 0]);
  view.cim = qdAdd(view.cim, [imHeightFor(view.reWidth) * fracY, 0, 0, 0]);
  startRender();
}

document.getElementById('dpad-zoom2x-btn').addEventListener('click', () => rezoom(2));
document.getElementById('dpad-zoom05x-btn').addEventListener('click', () => rezoom(0.5));
document.getElementById('pan-up').addEventListener('click', () => panBy(0, 0.1));
document.getElementById('pan-down').addEventListener('click', () => panBy(0, -0.1));
document.getElementById('pan-left').addEventListener('click', () => panBy(-0.1, 0));
document.getElementById('pan-right').addEventListener('click', () => panBy(0.1, 0));

document.addEventListener('keydown', (e) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  e.preventDefault();
  if (e.key === 'ArrowUp') panBy(0, 0.1);
  else if (e.key === 'ArrowDown') panBy(0, -0.1);
  else if (e.key === 'ArrowLeft') panBy(-0.1, 0);
  else if (e.key === 'ArrowRight') panBy(0.1, 0);
});

// --- Interesting points ---

document.getElementById('interesting-title').addEventListener('click', () => {
  const list = document.getElementById('interesting-list');
  const title = document.getElementById('interesting-title');
  const icon = document.getElementById('interesting-toggle-icon');
  const open = list.classList.toggle('open');
  title.classList.toggle('open', open);
  icon.innerHTML = open ? '&#9660;' : '&#9654;';
});

document.querySelectorAll('.ipoint').forEach(el => {
  el.addEventListener('click', () => {
    if (el.dataset.fractal) fractalSelect.value = el.dataset.fractal;
    else fractalSelect.value = String(FRAC.MANDELBROT);
    updateFractalUI();
    if (el.dataset.maxiter) maxIterInput.value = el.dataset.maxiter;
    if (el.dataset.cycles)  colorCyclesInput.value = el.dataset.cycles;
    if (el.dataset.degree)  degreeInput.value = el.dataset.degree;
    if (el.dataset.juliare) juliaReInput.value = el.dataset.juliare;
    if (el.dataset.juliaim) juliaImInput.value = el.dataset.juliaim;
    navigateTo(qdFromString(el.dataset.re), qdFromString(el.dataset.im), parseFloat(el.dataset.zoom));
  });
});

// --- Init + resize ---

function initCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight - document.getElementById('controls').offsetHeight;
  canvas.width = w; canvas.height = h;
  overlay.width = w; overlay.height = h;
  // The imaginary extent is derived from reWidth and the aspect at render time,
  // so a resize needs no view adjustment.
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { initCanvas(); startRender(); }, 200);
});

updateFractalUI();
initWorkers();
initCanvas();
// Render kicks off as each worker reports 'ready'; set the initial queue now.
startRender();
