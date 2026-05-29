# Math Gallery

Interactive visualizations of mathematical objects. The first piece is a **Fractal
Viewer** (Mandelbrot, Julia, Multibrot, Tricorn, Burning Ship) that runs in the
browser, plus a command-line tool that renders deep-zoom dive **movies**.

Both front ends share one C++ core: it compiles to **WebAssembly** for the viewer
and to a **pybind11** extension for the CLI, so the browser and the movie tool
produce identical math. Deep zooms (Mandelbrot / Julia / Multibrot) use
**perturbation theory** to push well past the `~1e14` double-precision wall — see
[`docs/perturbation.md`](docs/perturbation.md).

Live site: deployed to GitHub Pages from `main` (see [Deployment](#github-pages-deployment)).

## Repository layout

```
index.html                  Gallery landing page (topic-grouped, live heroes)
assets/                     Shared front-end: site.css, heroes.js
  films/                    Committed muted-loop preview clips (*_preview.mp4)
pages/mandelbrot/           Fractal viewer (HTML + JS + WASM)
  index.html  main.js  worker.js  qd.js  points_of_interest.json
  wasm/                     core.js + core.wasm  (built, gitignored)
pages/films/                Deep-dive films gallery (data-driven from points.json)
pages/equations/            Equations / explainer (placeholder)
pages/lorenz/               Lorenz teaser ("coming soon")
movies/points.json          Film catalogue — source of truth for the films page
core/include/mg/            Header-only C++ core (precision tiers, fractals, perturbation)
core/src/wasm_api.cpp       WASM C entry points
core/bindings/py_module.cpp pybind11 bindings (module name: mg_core)
cli/mg_movie/cli.py         Movie CLI (entry point: mg-movie)
CMakeLists.txt              Dual build: Emscripten (WASM) or pybind11 (Python)
pyproject.toml              Python package build (scikit-build-core)
.github/workflows/          GitHub Pages deploy
```

## Prerequisites

| Tool | Used for | Notes |
|------|----------|-------|
| **CMake ≥ 3.18** | both builds | Homebrew / apt / etc. |
| **C++17 compiler** | Python module | Apple clang, GCC, MSVC |
| **Python ≥ 3.9** | the CLI | with `pip` |
| **Emscripten (emsdk)** | the WASM viewer | provides `emcmake`/`emcc` |
| **ffmpeg** | CLI movie encoding | must be on `PATH` |

The dd/qd kernels rely on strict IEEE-754 rounding; the build **must not** enable
`-ffast-math` or FP contraction. This is enforced in `CMakeLists.txt`
(`-ffp-contract=off`) — don't override it.

Install Emscripten once:

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
```

## Run the viewer locally

The viewer needs the WebAssembly artifacts, which are **not committed** (CI rebuilds
them). Build them, copy them into the page, then serve over HTTP.

```bash
# 1. Activate Emscripten in this shell
source ~/emsdk/emsdk_env.sh

# 2. Build the WASM core -> build/wasm/core.js + core.wasm
emcmake cmake -B build/wasm -S .
cmake --build build/wasm -j

# 3. Drop the artifacts where the page loads them
mkdir -p pages/mandelbrot/wasm
cp build/wasm/core.js build/wasm/core.wasm pages/mandelbrot/wasm/

# 4. Serve the repo root (WASM requires http(s), not file://)
python3 -m http.server 8000
```

Open <http://localhost:8000/> for the gallery, or
<http://localhost:8000/pages/mandelbrot/index.html> for the viewer directly.

Each browser worker owns its own single-threaded WASM instance (no
SharedArrayBuffer, since GitHub Pages can't set the COOP/COEP headers).

## Build and use the movie CLI

Installing the Python package compiles the native `mg_core` extension via
scikit-build-core (CMake runs automatically) and exposes the `mg-movie` command.

```bash
# From the repo root
python3 -m pip install .          # or: pip install -e .  for development
```

Render a dive (output defaults to `dive.mp4`):

```bash
mg-movie --fractal mandelbrot \
  --center-re -0.743643887037151 --center-im 0.13182590420533 \
  --zoom-start 1 --zoom-end 1e12 --frames 300 --fps 30 \
  --width 1280 --height 720 --max-iter 4096 --cycles 2 \
  -o dive.mp4
```

Deep zooms past `~1e10` on Mandelbrot / Julia / Multibrot automatically switch to
the perturbation renderer, so `--center-re/--center-im` accept **high-precision
strings** (parsed exactly, not truncated to `double`):

```bash
mg-movie --fractal mandelbrot \
  --center-re "-0.745" \
  --center-im "0.0904476357491141345697686786423804724431598172" \
  --zoom-start 1e6 --zoom-end 1e20 --frames 600 -o deepdive.mp4
```

Key options (`mg-movie --help` for the full list):

| Option | Default | Meaning |
|--------|---------|---------|
| `--fractal` | `mandelbrot` | `mandelbrot`, `julia`, `multibrot`, `tricorn`, `burning_ship` |
| `--center-re`, `--center-im` | deep-dive point | view center (string; high precision OK) |
| `--zoom-start`, `--zoom-end` | `1`, `1e6` | geometric zoom schedule endpoints |
| `--frames`, `--fps` | `300`, `30` | frame count and playback rate |
| `--width`, `--height` | `1280`, `720` | frame size (rounded to even for yuv420p) |
| `--max-iter` | `4096` | iteration cap |
| `--cycles` | `2.0` | color cycles |
| `--degree` | `3` | Multibrot exponent |
| `--julia-re`, `--julia-im` | `-0.123`, `0.745` | Julia constant `k` |
| `--precision` | auto | force `f64`/`dd`/`qd` (disables perturbation) |
| `--crf` | `18` | x264 quality (lower = better) |
| `--workers` | CPU count | render thread pool size |
| `--title` | none | overlay a lower-third caption (title + center + zoom) |

### Quick local module build (no install)

For fast iteration on the core you can compile the extension in place instead of
`pip install`:

```bash
c++ -O3 -std=c++17 -ffp-contract=off -shared -fPIC -undefined dynamic_lookup \
  -I"$(python3 -c 'import pybind11;print(pybind11.get_include())')" \
  -I"$(python3 -c 'import sysconfig;print(sysconfig.get_path("include"))')" \
  -I"$(python3 -c 'import numpy;print(numpy.get_include())')" \
  -Icore/include core/bindings/py_module.cpp \
  -o "mg_core$(python3-config --extension-suffix)"
```

Run from a directory where `mg_core` is importable (e.g. the repo root), then
`python3 -m mg_movie.cli ...` or import `mg_core` directly.

## Deep-dive films gallery

The **Deep-dive films** page (`pages/films/index.html`) is data-driven: it renders
one card per entry in [`movies/points.json`](movies/points.json) at runtime — no HTML
editing needed to add a film. Each entry looks like:

```json
{
  "id": 1, "name": "Seahorse Valley", "fractal": "mandelbrot",
  "re": "-0.748548706415072803150", "im": "0.100524966248010897607",
  "zoom": 3e16, "maxiter": 4096, "cycles": 2.65,
  "file": "seahorse_valley.mp4",
  "preview_start_second": 3, "preview_end_second": 8,
  "text": "A descent into the seahorse-tailed filaments…",
  "url": "https://youtu.be/HI7p6k_pDJk"
}
```

The page shows the `fractal / Re / Im / zoom / cycles / maxIter` parameters and `text`,
plays a short looping **preview** as the thumbnail, and click-to-plays the full film
from YouTube (`url`) via a lazy `youtube-nocookie` embed. The preview is a small muted
loop committed at `assets/films/<file-without-.mp4>_preview.mp4` — large originals in
`movies/` stay gitignored (the films live on YouTube), while the preview clips are kept
via the `!assets/films/*.mp4` exception in `.gitignore`.

### Publishing a new film — the `sync-films` skill

Adding a film is automated by a Claude Code skill (`sync-films`, in
`~/.claude/skills/sync-films/`). Workflow:

1. Render the dive (e.g. with `mg-movie`) and upload it to YouTube.
2. Drop the rendered `.mp4` into `movies/` (filename must match the entry's `file`).
3. Add the entry to `movies/points.json` (with `url`, `preview_start_second`,
   `preview_end_second`, and the parameters above).
4. In Claude Code, run **`/sync-films`** (or say "add the new film").

The skill diffs `movies/points.json` against the committed version, verifies each new
entry's source `.mp4` exists, cuts the preview clip from the `preview_start/end_second`
range into `assets/films/`, then commits, pushes, and verifies the GitHub Pages deploy.
It only *adds* new entries (matched by `id`) and never edits existing ones or commits
the large originals.

## GitHub Pages deployment

Deployment is automated by [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).
On every push to `main` (or a manual **Run workflow** via `workflow_dispatch`), CI:

1. installs Emscripten,
2. builds the WASM core from source (`emcmake cmake … && cmake --build …`),
3. assembles `_site/` — landing page, shared `assets/`, the viewer/films/equations/
   lorenz pages, `movies/points.json`, and the freshly built `core.js` / `core.wasm` —
   and publishes it to GitHub Pages.

The `.wasm`/`.js` artifacts are **never committed**; CI always rebuilds them, so a
core change reaches production just by pushing. (This is why the
`EXPORTED_RUNTIME_METHODS` / `EXPORTED_FUNCTIONS` lists in `CMakeLists.txt` are the
source of truth for what the browser can call.)

One-time setup: in the repository **Settings → Pages**, set **Source** to
**GitHub Actions**.

## License

See repository for license details.
