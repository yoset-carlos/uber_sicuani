import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const properties = new Map();
const nodes = new Map();
const eventTarget = (extra = {}) => ({
  handlers: {},
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); },
  emit(type, event = {}) { for (const fn of this.handlers[type] || []) fn({ type, preventDefault() {}, ...event }); },
  ...extra,
});
for (const id of ["panel", "panel-scroll", "sheet-handle", "sheet-lower", "sheet-raise", "sheet-status"]) {
  nodes.set(id, eventTarget({
    dataset: {}, attrs: {}, captured: new Set(), scrollTop: 0,
    setAttribute(key, value) { this.attrs[key] = value; },
    setPointerCapture(id) { this.captured.add(id); },
    hasPointerCapture(id) { return this.captured.has(id); },
    releasePointerCapture(id) { this.captured.delete(id); },
    getBoundingClientRect() { return { height: parseFloat(properties.get("--sheet-size")) }; },
    contains(el) { return el === input; },
  }));
}
let visibleScrolls = 0;
const input = { matches: () => true, scrollIntoView() { visibleScrolls++; } };
const media = eventTarget({ matches: true });
const viewport = eventTarget({ height: 844, offsetTop: 0 });
const window = eventTarget({ visualViewport: viewport, innerHeight: 844, matchMedia: () => media });
const document = { documentElement: { style: { setProperty(key, value) { properties.set(key, value); } } }, querySelector: (selector) => nodes.get(selector.slice(1)), activeElement: null };
const context = vm.createContext({ window, document, requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame() {}, setTimeout: () => 1 });
vm.runInContext(readFileSync(new URL("../public/assets/sheet.js", import.meta.url), "utf8"), context);
const sheet = window.createRideSheet();
const node = (id) => nodes.get(id);
sheet.sync("home", "medium");
assert.equal(sheet.position, "medium");
assert.equal(parseFloat(properties.get("--sheet-size")), 844 * 0.58);
sheet.set("compact"); sheet.sync("home", "medium");
assert.equal(sheet.position, "compact", "Polling preserves the user's sheet height");
assert.equal(node("sheet-lower").disabled, true);
node("sheet-raise").emit("click"); assert.equal(sheet.position, "medium");
node("sheet-handle").emit("keydown", { key: "End" }); assert.equal(sheet.position, "expanded");
node("sheet-handle").emit("keydown", { key: "ArrowDown" }); assert.equal(sheet.position, "medium");
sheet.sync("offers", "expanded"); assert.equal(sheet.position, "expanded");
node("sheet-handle").emit("pointerdown", { pointerId: 1, pointerType: "touch", clientY: 100 });
node("sheet-handle").emit("pointermove", { pointerId: 1, clientY: 720 });
node("sheet-handle").emit("pointerup", { pointerId: 1 });
assert.equal(sheet.position, "compact", "Dragging the handle snaps to the nearest position");
node("panel").emit("focusin", { target: input });
assert.equal(sheet.position, "expanded"); assert.ok(visibleScrolls > 0);
document.activeElement = input; viewport.height = 420; viewport.emit("resize");
assert.ok(parseFloat(properties.get("--sheet-size")) <= 340, "Keyboard leaves room above the sheet");
assert.equal(properties.get("--app-height"), "420px");
media.matches = false; media.emit("change");
assert.equal(node("sheet-handle").tabIndex, -1, "Desktop does not expose mobile-only controls");
console.log("Panel móvil: posiciones, actualización, botones, teclado, arrastre, foco, teclado virtual y escritorio aprobados.");
