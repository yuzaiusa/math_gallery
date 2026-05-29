/* ===========================================================================
   Math Gallery — live specimen heroes
   Decorative, real-time math rendered onto <canvas data-hero="...">.
   Independent of the WASM core (this is ambient motion, not deep precision).

     <canvas data-hero="mandelbrot"></canvas>
     <canvas data-hero="lorenz"></canvas>

   Each hero is DPR-aware, pauses when scrolled off-screen (IntersectionObserver),
   and renders a single static frame when the user prefers reduced motion.
   =========================================================================== */
(() => {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* size a canvas to its CSS box at device resolution; returns true if changed */
  function fit(canvas) {
    const w = Math.max(1, Math.round(canvas.clientWidth * DPR));
    const h = Math.max(1, Math.round(canvas.clientHeight * DPR));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  /* run `frame(t)` via RAF only while the canvas is on-screen (or once if reduced) */
  function animate(canvas, frame) {
    if (REDUCED) { frame(8.0); return; }
    let raf = 0, start = 0, visible = false;
    const loop = (now) => {
      if (!start) start = now;
      frame((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(loop);
      else if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
    }, { threshold: 0.01 });
    io.observe(canvas);
  }

  /* ----------------------------------------------------------------------- *
   *  MANDELBROT — WebGL escape-time shader, breathing auto-zoom into the
   *  seahorse valley, smooth cyclic-HSL coloring mirroring the viewer/CLI.
   * ----------------------------------------------------------------------- */
  const VERT = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

  const FRAG = `
    precision highp float;
    uniform vec2  u_res;
    uniform vec2  u_center;
    uniform float u_hw;       // half-width in complex units (x axis)
    uniform float u_cycles;
    uniform float u_phase;
    const int MAXITER = 280;

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      float aspect = u_res.x / u_res.y;
      vec2 c = u_center + vec2((uv.x - 0.5) * 2.0 * u_hw,
                               (uv.y - 0.5) * 2.0 * u_hw / aspect);
      vec2 z = vec2(0.0);
      float sn = 0.0;
      bool escaped = false;
      for (int i = 0; i < MAXITER; i++) {
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        float d2 = dot(z, z);
        if (d2 > 256.0) {
          float log_zn = log(d2) * 0.5;
          float nu = log(log_zn / log(2.0)) / log(2.0);
          sn = float(i) + 1.0 - nu;
          escaped = true;
          break;
        }
      }
      if (!escaped) { gl_FragColor = vec4(0.02, 0.02, 0.03, 1.0); return; }

      float t = clamp(sn / float(MAXITER - 1), 0.0, 1.0);
      t = pow(t, 1.0 / 3.0);                       // cube-root spread
      float h6 = fract(t * u_cycles + u_phase) * 6.0;
      float x  = 1.0 - abs(mod(h6, 2.0) - 1.0);
      vec3 col;
      if      (h6 < 1.0) col = vec3(1.0, x, 0.0);
      else if (h6 < 2.0) col = vec3(x, 1.0, 0.0);
      else if (h6 < 3.0) col = vec3(0.0, 1.0, x);
      else if (h6 < 4.0) col = vec3(0.0, x, 1.0);
      else if (h6 < 5.0) col = vec3(x, 0.0, 1.0);
      else               col = vec3(1.0, 0.0, x);
      gl_FragColor = vec4(col, 1.0);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    return s;
  }

  function mandelbrot(canvas) {
    const gl = canvas.getContext("webgl", { antialias: false, depth: false });
    if (!gl) { canvas.style.background = "#05060a"; return; }

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n) => gl.getUniformLocation(prog, n);
    const u_res = U("u_res"), u_center = U("u_center"), u_hw = U("u_hw"),
          u_cycles = U("u_cycles"), u_phase = U("u_phase");

    const CENTER = [-0.745428, 0.113009];   // textbook seahorse valley
    const HW0 = 1.65, HW1 = 6.0e-4;          // breathing zoom range (f32-safe)
    const PERIOD = 30.0;

    gl.uniform2f(u_center, CENTER[0], CENTER[1]);
    gl.uniform1f(u_cycles, 2.4);

    animate(canvas, (t) => {
      fit(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const zp = (1 - Math.cos(t * 2 * Math.PI / PERIOD)) / 2;  // 0→1→0 ease
      const hw = HW0 * Math.pow(HW1 / HW0, zp);
      gl.uniform2f(u_res, canvas.width, canvas.height);
      gl.uniform1f(u_hw, hw);
      gl.uniform1f(u_phase, t * 0.013 + zp * 0.35);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  }

  /* ----------------------------------------------------------------------- *
   *  LORENZ — Canvas2D RK4 integration; a bright comet traces the attractor
   *  while a fading ghost of the whole butterfly accumulates behind it.
   * ----------------------------------------------------------------------- */
  function lorenz(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const SIGMA = 10, RHO = 28, BETA = 8 / 3;
    const ANGLE = 0.62, ca = Math.cos(ANGLE), sa = Math.sin(ANGLE);
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#f2b15c";

    let st = { x: 0.9, y: 0, z: 1.0 };
    const deriv = (s) => ({
      x: SIGMA * (s.y - s.x),
      y: s.x * (RHO - s.z) - s.y,
      z: s.x * s.y - BETA * s.z,
    });
    function step(dt) {
      const a = deriv(st);
      const b = deriv({ x: st.x + a.x*dt/2, y: st.y + a.y*dt/2, z: st.z + a.z*dt/2 });
      const c = deriv({ x: st.x + b.x*dt/2, y: st.y + b.y*dt/2, z: st.z + b.z*dt/2 });
      const d = deriv({ x: st.x + c.x*dt,   y: st.y + c.y*dt,   z: st.z + c.z*dt });
      st = {
        x: st.x + dt/6*(a.x + 2*b.x + 2*c.x + d.x),
        y: st.y + dt/6*(a.y + 2*b.y + 2*c.y + d.y),
        z: st.z + dt/6*(a.z + 2*b.z + 2*c.z + d.z),
      };
    }
    /* project (x,y,z) → canvas px: rotate about vertical, z is "up" */
    function project() {
      const px = st.x * ca - st.y * sa;
      const s = Math.min(canvas.width, canvas.height) / 58;
      return [canvas.width / 2 + px * s, canvas.height * 0.93 - (st.z) * s];
    }

    let prev = null, primed = false;
    function clear() {
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      prev = null;
    }
    function drawSegments(n, dt, alpha) {
      ctx.lineWidth = Math.max(1, DPR * 0.9);
      ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        step(dt);
        const [x, y] = project();
        if (prev) {
          ctx.strokeStyle = accent;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        prev = [x, y];
      }
      ctx.globalAlpha = 1;
    }

    if (REDUCED) {
      animate(canvas, () => {
        fit(canvas); clear();
        st = { x: 0.9, y: 0, z: 1.0 };
        drawSegments(9000, 0.005, 0.5);   // one static, fully-drawn butterfly
      });
      return;
    }

    animate(canvas, () => {
      if (fit(canvas) || !primed) { clear(); primed = true; }
      // fade the previous frame slightly → glowing ghost trail
      ctx.fillStyle = "rgba(5, 6, 10, 0.055)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawSegments(14, 0.006, 0.9);       // advance the comet head
    });
  }

  /* ----------------------------------------------------------------------- */
  const HEROES = { mandelbrot, lorenz };
  function mount() {
    document.querySelectorAll("canvas[data-hero]").forEach((c) => {
      const fn = HEROES[c.dataset.hero];
      if (fn) try { fn(c); } catch (e) { console.error("hero failed:", c.dataset.hero, e); }
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
