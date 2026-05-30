/* Render every [data-tex] element with KaTeX (loaded just before this script).
   The element's LaTeX lives in its `data-tex` attribute; add `data-display` for
   block/display math. Any text already inside the element is a graceful fallback
   if KaTeX fails to load. */
(() => {
  "use strict";
  function render() {
    if (!window.katex) return;
    document.querySelectorAll("[data-tex]").forEach((el) => {
      try {
        window.katex.render(el.getAttribute("data-tex"), el, {
          throwOnError: false,
          displayMode: el.dataset.display !== undefined,
        });
      } catch (e) {
        console.error("katex render failed:", e);
      }
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", render);
  else render();
})();
