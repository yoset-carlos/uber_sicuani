"use strict";
// The sheet belongs to the application shell, so polling never replaces it.
window.createRideSheet = function ({ onLayout = () => {} } = {}) {
  const root = document.documentElement;
  const panel = document.querySelector("#panel");
  const scroll = document.querySelector("#panel-scroll");
  const handle = document.querySelector("#sheet-handle");
  const lower = document.querySelector("#sheet-lower");
  const raise = document.querySelector("#sheet-raise");
  const status = document.querySelector("#sheet-status");
  const media = window.matchMedia("(max-width: 800px)");
  const positions = ["compact", "medium", "expanded"];
  const fractions = [0.22, 0.58, 0.9];
  let position = "expanded";
  let screen = "";
  let drag = null;
  let suppressClick = false;
  let layoutFrame;
  const viewportHeight = () => window.visualViewport?.height || window.innerHeight;
  const heights = () => fractions.map((fraction) => Math.max(96, Math.min(viewportHeight() * fraction, viewportHeight() - 80)));
  function layout(height) {
    const mobile = media.matches;
    const size = height ?? heights()[positions.indexOf(position)];
    root.style.setProperty("--app-height", `${viewportHeight()}px`);
    root.style.setProperty("--viewport-top", `${window.visualViewport?.offsetTop || 0}px`);
    root.style.setProperty("--sheet-size", `${size}px`);
    panel.dataset.sheet = position;
    handle.setAttribute("aria-expanded", String(position !== "compact"));
    lower.disabled = position === "compact";
    raise.disabled = position === "expanded";
    handle.tabIndex = mobile ? 0 : -1;
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => onLayout(mobile, height === undefined));
  }
  function set(next, announce = true) {
    if (!positions.includes(next)) return;
    position = next;
    layout();
    if (announce && media.matches) status.textContent = { compact: "Panel compacto. Puedes usar el mapa.", medium: "Panel a media altura.", expanded: "Panel ampliado." }[position];
  }
  function step(direction) {
    set(positions[Math.max(0, Math.min(2, positions.indexOf(position) + direction))]);
  }
  lower.addEventListener("click", () => step(-1));
  raise.addEventListener("click", () => step(1));
  handle.addEventListener("click", () => {
    if (suppressClick) { suppressClick = false; return; }
    step(position === "expanded" ? -1 : 1);
  });
  handle.addEventListener("keydown", (event) => {
    const action = { ArrowUp: () => step(1), ArrowDown: () => step(-1), Home: () => set("compact"), End: () => set("expanded") }[event.key];
    if (action) { event.preventDefault(); action(); }
  });
  handle.addEventListener("pointerdown", (event) => {
    if (!media.matches || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag = { id: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const change = drag.y - event.clientY;
    if (Math.abs(change) > 6) drag.moved = true;
    if (drag.moved) {
      const sizes = heights();
      layout(Math.max(sizes[0], Math.min(sizes[2], drag.height + change)));
    }
  });
  function finish(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const previous = drag;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (previous.moved && event.type !== "pointercancel") {
      const height = panel.getBoundingClientRect().height;
      const sizes = heights();
      const closest = sizes.reduce((best, value, index) => Math.abs(value - height) < Math.abs(sizes[best] - height) ? index : best, 0);
      suppressClick = true;
      set(positions[closest]);
      setTimeout(() => { suppressClick = false; }, 0);
    } else layout();
  }
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  panel.addEventListener("focusin", (event) => {
    if (!media.matches || !event.target.matches("input:not([type=checkbox]):not([type=radio]),textarea,select")) return;
    set("expanded", false);
    requestAnimationFrame(() => event.target.scrollIntoView({ block: "nearest" }));
  });
  function resize() {
    layout();
    if (media.matches && panel.contains(document.activeElement) && document.activeElement.matches("input,textarea,select")) {
      requestAnimationFrame(() => document.activeElement.scrollIntoView({ block: "nearest" }));
    }
  }
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("scroll", resize);
  media.addEventListener("change", resize);
  layout();
  return {
    set,
    sync(nextScreen, preferred) {
      if (nextScreen === screen) return;
      screen = nextScreen;
      scroll.scrollTop = 0;
      set(preferred, false);
    },
    get position() { return position; },
  };
};
