#!/usr/bin/env python3
"""Render the gallery's long-form Markdown notes into styled static HTML pages
that match the site (site.css + article.css), with KaTeX math.

Approach: protect $...$ / $$...$$ math from Markdown, convert with python-markdown
(tables, fenced code, GitHub-style heading slugs), reinsert the math as KaTeX
\\(...\\) / \\[...\\] delimiters for client-side auto-render, wrap in the page
template. Run:  python3 docs/build_pages.py
"""
import os
import re
import shutil
import subprocess
import markdown

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
REPO = "https://github.com/yuzaiusa/math_gallery/blob/main"

TOK_OPEN, TOK_CLOSE = "xMATHx", "xENDx"   # ASCII placeholder, markdown-safe


def gh_slug(value, separator="-"):
    """GitHub-compatible heading slug (matches the manual TOC anchors)."""
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value, flags=re.U)
    return re.sub(r"\s", separator, value)


def protect_math(text):
    store = []

    def stash(m, disp):
        store.append((disp, m.group(1)))
        return f"{TOK_OPEN}{len(store) - 1}{TOK_CLOSE}"

    text = re.sub(r"\$\$(.+?)\$\$", lambda m: stash(m, True), text, flags=re.S)
    text = re.sub(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)", lambda m: stash(m, False), text)
    return text, store


def restore_math(html, store):
    for i, (disp, tex) in enumerate(store):
        tex = tex.strip()
        repl = (f"\\[{tex}\\]" if disp else f"\\({tex}\\)")
        html = html.replace(f"{TOK_OPEN}{i}{TOK_CLOSE}", repl)
    return html


def add_figcaptions(html):
    # <p><img src=.. alt="X" ..></p>  ->  <figure>...<figcaption>X</figcaption></figure>
    pat = re.compile(r'<p>\s*<img([^>]*?)alt="([^"]*)"([^>]*?)>\s*</p>')
    return pat.sub(lambda m: f'<figure><img{m.group(1)}alt="{m.group(2)}"{m.group(3)}>'
                            f'<figcaption>{m.group(2)}</figcaption></figure>', html)


def md_to_html(md_text):
    protected, store = protect_math(md_text)
    html = markdown.markdown(
        protected,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list", "toc"],
        extension_configs={"toc": {"slugify": gh_slug, "permalink": False}},
    )
    html = restore_math(html, store)
    return add_figcaptions(html)


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,340;0,9..144,360;0,9..144,380;1,9..144,340&family=Newsreader:ital,opsz,wght@0,6..72,360;0,6..72,420;1,6..72,360&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="../../assets/site.css">
  <link rel="stylesheet" href="../../assets/article.css">
</head>
<body class="topic {accent}">
  <div class="shell">
    <a class="back" href="../../index.html"><span class="arrow">&larr;</span> Math Gallery</a>
    <article class="article">
      <p class="eyebrow">{eyebrow}</p>
{body}
    </article>
    <footer class="colophon">
      <span>{foot}</span>
      <span><a href="../../index.html">&larr; back to the gallery</a></span>
    </footer>
  </div>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
  <script>
    document.addEventListener("DOMContentLoaded", () => {{
      if (!window.renderMathInElement) return;
      renderMathInElement(document.querySelector(".article"), {{
        delimiters: [
          {{ left: "\\\\[", right: "\\\\]", display: true }},
          {{ left: "\\\\(", right: "\\\\)", display: false }},
        ],
        throwOnError: false,
      }});
    }});
  </script>
</body>
</html>
"""


def build(md_rel, out_rel, *, title, desc, eyebrow, foot, accent="fractals",
          strip=(), link_rewrites=()):
    md = open(os.path.join(ROOT, md_rel), encoding="utf-8").read()
    for pat in strip:
        md = re.sub(pat, "", md, flags=re.S)
    body = md_to_html(md)
    for old, new in link_rewrites:
        body = body.replace(old, new)
    body = "\n".join("      " + ln for ln in body.splitlines())
    page = TEMPLATE.format(title=title, desc=desc, eyebrow=eyebrow, foot=foot,
                           accent=accent, body=body)
    out = os.path.join(ROOT, out_rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(page)
    print("wrote", out_rel)


if __name__ == "__main__":
    # 1) The Mandelbrot mathematics page (replaces the placeholder).
    build(
        "docs/mandelbrot/notes.md", "pages/equations/index.html",
        title="The Mathematics of the Mandelbrot Set - Math Gallery",
        desc="How the Mandelbrot set works: dynamics, escape, bifurcation, "
             "connectedness, hyperbolic components, and how the viewer renders it.",
        eyebrow="Collection I - Fractals · Notes",
        foot="Notes accompany the interactive viewer.",
        strip=(
            r"\*A working draft.*?web page\.\*\n*",      # leading draft disclaimer
            r"\n---\n\n\*Draft ends.*$",                 # trailing draft note
        ),
        link_rewrites=(
            ('href="../perturbation.md"', 'href="../perturbation/index.html"'),
        ),
    )
    # ship the figures alongside the page (referenced as figures/0X.png)
    shutil.copytree(os.path.join(ROOT, "docs/mandelbrot/figures"),
                    os.path.join(ROOT, "pages/equations/figures"), dirs_exist_ok=True)
    print("copied figures -> pages/equations/figures")

    # 2) The perturbation deep-zoom page.
    build(
        "docs/perturbation.md", "pages/perturbation/index.html",
        title="Deep-Zoom Rendering: Perturbation Theory - Math Gallery",
        desc="How the viewer renders extremely deep Mandelbrot/Julia zooms with "
             "perturbation theory.",
        eyebrow="Collection I - Fractals · Deep zoom",
        foot="The renderer behind the deep-dive films.",
        link_rewrites=(
            ('href="../', f'href="{REPO}/'),             # source links -> GitHub
        ),
    )
    print("done")
