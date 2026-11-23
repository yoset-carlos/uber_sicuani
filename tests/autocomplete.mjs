import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the shipped event handlers with a controlled network and clock.
const source = readFileSync(new URL("../public/assets/app.js", import.meta.url), "utf8");
function setup() {
  const nodes = new Map();
  const listeners = new Map();
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: "", textContent: "", innerHTML: "", hidden: true, isConnected: true,
      attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      replaceChildren() { this.innerHTML = ""; },
      addEventListener() {}, scrollIntoView() {},
      blur() { if (document.activeElement === this) document.activeElement = null; },
    });
    return nodes.get(id);
  };
  const document = {
    activeElement: null,
    querySelector: (selector) => node(selector.replace(/^#/, "")),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
  };
  const context = vm.createContext({
    document, Intl, console, window: { addEventListener() {} }, setInterval() {},
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { setItem() {} },
    mockApi: async (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
  });
  vm.runInContext(source.slice(0, source.lastIndexOf("(async () => {")), context);
  vm.runInContext('state.user = {id: "test", rol: "pasajero"}; api = mockApi; updateMap = () => {}; updateSelection = () => {}; updatePointTooltip = () => {};', context);
  const run = (code) => vm.runInContext(code, context);
  const type = (key, value) => {
    const input = node(key); input.value = value; document.activeElement = input;
    for (const fn of listeners.get("input")) fn({ target: input });
  };
  const flush = async () => {
    const pending = [...timers.values()]; timers.clear();
    for (const { fn } of pending) fn();
    await new Promise(setImmediate);
  };
  const settle = async (index, result) => { calls[index].resolve(result); await new Promise(setImmediate); };
  const key = (value) => {
    const event = { target: document.activeElement, key: value, preventDefault() {} };
    for (const fn of listeners.get("keydown")) fn(event);
  };
  return { node, calls, timers, run, type, flush, settle, key, listeners };
}
const item = { nombre: "Catedral de Sicuani", direccion: "Plaza de Armas, Sicuani", etiqueta: "Catedral de Sicuani, Plaza de Armas, Sicuani", lat: -14.2734769, lng: -71.226317 };
const found = { estado: "encontrado", resultados: [item] };

{
  const t = setup();
  t.type("origen", "ab"); await t.flush(); assert.equal(t.calls.length, 0);
  t.type("origen", "plaz"); t.type("origen", "plaza");
  assert.equal(t.timers.size, 1); assert.equal([...t.timers.values()][0].delay, 400);
  await t.flush(); assert.equal(t.calls.length, 1); assert.equal(t.calls[0].options.body.texto, "plaza");
  t.type("destino", "catedral"); await t.flush();
  await t.settle(0, found); assert.equal(t.node("origen-suggestions").hidden, true);
  await t.settle(1, found); assert.equal(t.node("destino").attrs["aria-expanded"], "true");
  t.key("ArrowDown"); assert.equal(t.node("destino").attrs["aria-activedescendant"], "destino-suggestion-0");
  t.key("Enter");
  assert.equal(t.node("destino").value, item.etiqueta);
  assert.equal(t.run("state.points.destino.lat"), item.lat);
  assert.equal(t.run("state.points.destino.resolviendo"), false);
  assert.equal(t.node("destino").attrs["aria-expanded"], "false");
}
{
  const t = setup();
  t.type("origen", "plaza"); await t.flush();
  await t.settle(0, { estado: "ocupado", reintentar_ms: 1250 });
  assert.equal([...t.timers.values()][0].delay, 1250);
  t.type("origen", "catedral"); await t.flush();
  await t.settle(1, found);
  t.key("Escape"); assert.equal(t.node("origen-suggestions").hidden, true);
  t.type("origen", "plaza"); await t.flush();
  t.run("closePlaceSearch()"); await t.settle(2, found);
  assert.equal(t.node("origen-suggestions").hidden, true);
}
{
  const t = setup();
  t.type("destino", "inexistente"); await t.flush();
  await t.settle(0, { estado: "sin_resultados", resultados: [] });
  assert.equal(t.node("destino-search-status").textContent, "No encontramos lugares");
  t.type("destino", "plaza"); await t.flush();
  t.calls[1].reject(new Error("offline")); await new Promise(setImmediate);
  assert.match(t.node("destino-search-status").textContent, /No pudimos buscar/);
}
console.log("Autocompletado: espera, respuestas tardías, cambio de campo, selección, teclado, reintento, cierre y errores aprobados.");
