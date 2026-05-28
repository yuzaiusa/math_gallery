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

let state = { reMin: -2.5, reMax: 1.0, imMin: -1.75, imMax: 1.75 };
let imageData = null;
let rawCache = null;   // Float32Array of smooth-escape values, width*height

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
  workers[i].postMessage({ type: 'strip', epoch: renderEpoch, y0: s.y0, y1: s.y1, params: currentParams });
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
  const { reMin, reMax, imMin, imMax } = state;

  const reWidth = reMax - reMin;
  const precision = choosePrecision(reWidth);

  const zoom = INITIAL_RE_WIDTH / reWidth;
  const centerRe = (reMin + reMax) / 2;
  const centerIm = (imMin + imMax) / 2;
  const sigFigs = Math.max(6, Math.ceil(Math.log10(zoom)) + 4);
  centerReInput.value = centerRe.toPrecision(sigFigs);
  centerImInput.value = centerIm.toPrecision(sigFigs);
  zoomInput.value = zoom.toPrecision(6);
  statusEl.textContent = PREC_NAME[precision];

  imageData = ctx.createImageData(canvas.width, canvas.height);
  rawCache = new Float32Array(canvas.width * canvas.height);
  renderMaxIter = maxIter;
  renderCycles = colorCycles;

  currentParams = {
    fractal,
    precision,
    reMin,
    reRange: reMax - reMin,
    imMax,
    imRange: imMax - imMin,
    canvasW: canvas.width,
    canvasH: canvas.height,
    maxIter,
    escapeR2: 4,
    degree: Math.max(2, parseInt(degreeInput.value, 10) || 3),
    juliaRe: parseFloat(juliaReInput.value) || 0,
    juliaIm: parseFloat(juliaImInput.value) || 0,
  };

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
  const reRange = state.reMax - state.reMin;
  const imRange = state.imMax - state.imMin;
  const newReMin = state.reMin + (x / cw) * reRange;
  const newReMax = state.reMin + ((x + w) / cw) * reRange;
  const newImMax = state.imMax - (y / ch) * imRange;
  const newImMin = state.imMax - ((y + h) / ch) * imRange;
  state = { reMin: newReMin, reMax: newReMax, imMin: newImMin, imMax: newImMax };
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
    singleTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, state: { ...state } };
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
      const reRange = state.reMax - state.reMin;
      const imRange = state.imMax - state.imMin;
      const pivotRe = state.reMin + cx * reRange;
      const pivotIm = state.imMax - cy * imRange;
      state.reMin = pivotRe + (state.reMin - pivotRe) * scale;
      state.reMax = pivotRe + (state.reMax - pivotRe) * scale;
      state.imMin = pivotIm + (state.imMin - pivotIm) * scale;
      state.imMax = pivotIm + (state.imMax - pivotIm) * scale;
      startRender();
    }
    lastTouchDist = dist; lastTouchCenter = center; singleTouchStart = null;
  } else if (e.touches.length === 1 && singleTouchStart) {
    const dx = e.touches[0].clientX - singleTouchStart.x;
    const dy = e.touches[0].clientY - singleTouchStart.y;
    const s = singleTouchStart.state;
    const reRange = s.reMax - s.reMin;
    const imRange = s.imMax - s.imMin;
    const dRe = (dx / canvas.width) * reRange;
    const dIm = (dy / canvas.height) * imRange;
    state.reMin = s.reMin - dRe; state.reMax = s.reMax - dRe;
    state.imMin = s.imMin + dIm; state.imMax = s.imMax + dIm;
    startRender();
  }
}, { passive: false });

overlay.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) { lastTouchDist = null; lastTouchCenter = null; }
  if (e.touches.length === 0) { singleTouchStart = null; }
}, { passive: false });

// --- Viewport helpers ---

function setViewCentered(centerRe, centerIm, reWidth) {
  const imHeight = reWidth * canvas.height / canvas.width;
  state.reMin = centerRe - reWidth / 2;
  state.reMax = centerRe + reWidth / 2;
  state.imMin = centerIm - imHeight / 2;
  state.imMax = centerIm + imHeight / 2;
}

function navigateTo(centerRe, centerIm, zoom) {
  setViewCentered(centerRe, centerIm, INITIAL_RE_WIDTH / zoom);
  startRender();
}

function resetView() {
  const fractal = parseInt(fractalSelect.value, 10) || 0;
  const c = DEFAULT_CENTER[fractal] || { re: -0.75, im: 0 };
  setViewCentered(c.re, c.im, INITIAL_RE_WIDTH);
  startRender();
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
  const centerRe = parseFloat(centerReInput.value);
  const centerIm = parseFloat(centerImInput.value);
  const zoom = parseFloat(zoomInput.value);
  if (isNaN(centerRe) || isNaN(centerIm) || isNaN(zoom) || zoom <= 0) return;
  navigateTo(centerRe, centerIm, zoom);
}

zoomBtn.addEventListener('click', applyInputs);
[centerReInput, centerImInput, zoomInput].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') applyInputs(); });
});

function rezoom(factor) {
  const centerRe = parseFloat(centerReInput.value);
  const centerIm = parseFloat(centerImInput.value);
  const zoom = parseFloat(zoomInput.value);
  if (isNaN(centerRe) || isNaN(centerIm) || isNaN(zoom) || zoom <= 0) return;
  navigateTo(centerRe, centerIm, zoom * factor);
}
zoom2xBtn.addEventListener('click', () => rezoom(2));
zoom05xBtn.addEventListener('click', () => rezoom(0.5));

// --- Save (PNG with annotation) ---

document.getElementById('save-btn').addEventListener('click', () => {
  const centerRe = (state.reMin + state.reMax) / 2;
  const centerIm = (state.imMin + state.imMax) / 2;
  const zoom = INITIAL_RE_WIDTH / (state.reMax - state.reMin);
  const fractalName = fractalSelect.options[fractalSelect.selectedIndex].text;

  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const oc = offscreen.getContext('2d');
  oc.drawImage(canvas, 0, 0);

  const lines = [
    fractalName,
    `Re = ${centerRe.toPrecision(12)}`,
    `Im = ${centerIm.toPrecision(12)}`,
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
  const dRe = (state.reMax - state.reMin) * fracX;
  const dIm = (state.imMax - state.imMin) * fracY;
  state.reMin += dRe; state.reMax += dRe;
  state.imMin += dIm; state.imMax += dIm;
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
    navigateTo(parseFloat(el.dataset.re), parseFloat(el.dataset.im), parseFloat(el.dataset.zoom));
  });
});

// --- Init + resize ---

function initCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight - document.getElementById('controls').offsetHeight;
  canvas.width = w; canvas.height = h;
  overlay.width = w; overlay.height = h;
  // keep the current center/scale, refit imaginary axis to the new aspect
  const reWidth = state.reMax - state.reMin;
  const reCenter = (state.reMin + state.reMax) / 2;
  const imCenter = (state.imMin + state.imMax) / 2;
  setViewCentered(reCenter, imCenter, reWidth);
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
