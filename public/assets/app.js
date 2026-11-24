"use strict";
const $ = (q, root = document) => root.querySelector(q);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (cents) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    (cents ?? 0) / 100,
  );
const date = (seconds) =>
  new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(seconds * 1000));
const labels = {
  pendiente: "Buscando conductor",
  reservado: "Conductor preparando precio",
  ofertado: "Tienes una propuesta",
  confirmado: "Viaje confirmado",
  en_curso: "Viaje en curso",
  finalizado: "Viaje finalizado",
  cancelado: "Viaje cancelado",
  sin_conductor: "No encontramos conductores",
  no_elegido: "Solicitud cerrada",
};
const reasons = {
  cambio_de_planes: "Cambio de planes",
  error_de_puntos: "Error de origen o destino",
  no_disponible: "Conductor o pasajero no disponible",
  otro: "Otro",
  punto_acordado: "Problema con el punto acordado",
  problema_durante_viaje: "Problema durante el viaje",
  falta_de_inicio: "No se inició dentro de 30 minutos",
  viaje_finalizado: "Viaje finalizado",
};
const terminal = (j) =>
  j && ["finalizado", "cancelado", "sin_conductor", "no_elegido"].includes(j.estado);
const state = {
  user: null,
  csrf: "",
  view: "home",
  trip: null,
  pending: [],
  reviews: [],
  history: [],
  points: { origen: null, destino: null },
  selecting: null,
  auth: "login",
  signature: "",
  busy: false,
  online: true,
  offset: 0,
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  icons: {},
  practice: null,
  finished: 0,
  registrationMessage: "",
  suggestedUsername: "",
  authRole: "pasajero",
  authStep: 1,
  pendingAccount: null,
  selectedOffer: null,
  counterOpen: false,
  payMethod: "efectivo",
  chat: { tripId: null, messages: [], open: false, outbox: [] },
  rating: { tripId: null, stars: 0, tags: [], comment: "" },
  ratingPrompted: new Set(),
  mapOpen: false,
};
let map,
  tiles,
  markers = {},
  line,
  pollTimer,
  noticeTimer,
  dialogAction,
  lastPoll,
  chatTimer,
  chatLoad;
let renderedMode = "";
let addressQueue = Promise.resolve();
let placeSearch = null;
let placeSearchTimer;
const panel = $("#panel-content");
const icon = (name) => `<span data-icon="${name}" aria-hidden="true"></span>`;
function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    const paths = state.icons[el.dataset.icon];
    if (paths)
      el.innerHTML = `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${paths.map((d) => `<path fill-rule="evenodd" clip-rule="evenodd" d="${d}"></path>`).join("")}</svg>`;
  });
}
function notice(message, error = false) {
  const el = $("#notice");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el.hidden = true), 6500);
}
class HttpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(method === "POST"
          ? { "Content-Type": "application/json", "X-CSRF-Token": state.csrf }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    setOnline(false);
    throw new HttpError(
      "No pudimos conectar. Revisa tu conexión; al volver recuperaremos tu viaje.",
      0,
      "RED",
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(
      "El servicio no respondió correctamente. Inténtalo nuevamente.",
      503,
      "SERVICIO",
    );
  }
  if (!response.ok || !payload.ok) {
    if (response.status === 503) setOnline(false);
    if (response.status === 401 && state.user) {
      state.user = null;
      state.trip = null;
      state.history = [];
      state.pending = [];
      state.points = { origen: null, destino: null };
      state.view = "home";
      state.practice = null;
      state.signature = "";
      state.chat = { tripId: null, messages: [], open: false, outbox: [] };
      clearTimeout(chatTimer);
      if ($("#action-dialog").open) closeDialog();
      if ($("#rating-dialog").open) $("#rating-dialog").close();
      try {
        state.csrf = (await api("/sesion")).csrf;
      } catch {
        /* Keep the reconnect action available if the service is down. */
      }
      render();
    }
    throw new HttpError(
      payload.error?.mensaje || "No se pudo completar la acción.",
      response.status,
      payload.error?.codigo,
    );
  }
  setOnline(true);
  return payload.datos;
}
function setOnline(value) {
  state.online = value;
  let banner = $("#connection-banner");
  if (!value && !banner) {
    banner = document.createElement("div");
    banner.id = "connection-banner";
    banner.className = "offline-banner";
    banner.role = "status";
    banner.innerHTML =
      '<p>Sin conexión con el servicio. Tus acciones estarán disponibles al reconectar.</p><button type="button" id="retry-connection" class="text-button">Reintentar conexión</button>';
    panel.prepend(banner);
  }
  if (banner) banner.hidden = value;
  panel
    .querySelectorAll("button[data-change],.primary,#available")
    .forEach((b) => {
      b.disabled = state.busy || !value;
    });
}
function initMap() {
  if (!window.L) {
    notice("No se pudo cargar el mapa. Recarga la página.", true);
    return;
  }
  map = L.map("map", { zoomControl: false }).setView([-14.2714, -71.2292], 15);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  setTiles();
  const choose = (position) => {
    if (state.selecting && state.user?.rol === "pasajero" && !state.trip) {
      setPoint(state.selecting, position.lat, position.lng);
      updateSelection();
      // On mobile the map is a temporary full-screen picker: return to the form once the point is marked.
      if (state.mapOpen && innerWidth <= 800) setTimeout(() => closeMap(), 450);
    }
  };
  map.on("click", (e) => choose(e.latlng));
  map.on("keypress", (e) => {
    if (e.originalEvent.key === "Enter") choose(map.getCenter());
  });
}
function setTiles() {
  if (!map) return;
  if (tiles) map.removeLayer(tiles);
  tiles = L.tileLayer(state.tileUrl, {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  tiles.on("tileerror", () => ($("#tile-warning").hidden = false));
  tiles.on("tileload", () => ($("#tile-warning").hidden = true));
}
function setPoint(key, lat, lng) {
  closePlaceSearch();
  const input = $(`#${key}`);
  const point = { lat, lng, nombre: "", resolviendo: true };
  state.points[key] = point;
  if (input) {
    input.value = "";
    input.placeholder = "Buscando dirección…";
  }
  saveDraft();
  updateMap({ fit: false });
  updateSelection();
  resolvePointAddress(key, point);
}
function closePlaceSearch() {
  clearTimeout(placeSearchTimer);
  placeSearch = null;
  for (const key of ["origen", "destino"]) {
    const input = $(`#${key}`);
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    const list = $(`#${key}-suggestions`);
    if (list) { list.hidden = true; list.replaceChildren(); }
    const status = $(`#${key}-search-status`);
    if (status) status.textContent = "";
  }
}
function paintPlaceSearch(search, message) {
  if (placeSearch !== search) return;
  const input = $(`#${search.key}`);
  const list = $(`#${search.key}-suggestions`);
  if (!input || !list) return;
  list.innerHTML = search.items.map((item, index) =>
    `<li id="${search.key}-suggestion-${index}" role="option" aria-selected="${index === search.active}" data-place-index="${index}"><strong>${esc(item.nombre)}</strong>${item.direccion ? `<span>${esc(item.direccion)}</span>` : ""}</li>`
  ).join("");
  list.hidden = !search.items.length;
  input.setAttribute("aria-expanded", String(!list.hidden));
  if (search.active >= 0) input.setAttribute("aria-activedescendant", `${search.key}-suggestion-${search.active}`);
  else input.removeAttribute("aria-activedescendant");
  $(`#${search.key}-search-status`).textContent = message;
}
function schedulePlaceSearch(input) {
  closePlaceSearch();
  const text = input.value.trim();
  if (text.length < 3 || state.user?.rol !== "pasajero" || state.trip) return;
  const search = { key: input.id, text, uid: state.user.id, items: [], active: -1 };
  placeSearch = search;
  const current = () => placeSearch === search && input.isConnected && document.activeElement === input && input.value.trim() === text && state.user?.id === search.uid && !state.trip;
  paintPlaceSearch(search, "Buscando…");
  const run = async () => {
    if (!current()) return;
    try {
      const result = await api("/mapa/buscar", { method: "POST", body: { texto: text } });
      if (!current()) return;
      if (result.estado === "ocupado") {
        placeSearchTimer = setTimeout(run, Math.max(1200, result.reintentar_ms || 1250));
        return;
      }
      search.items = result.resultados || [];
      paintPlaceSearch(search, result.estado === "no_disponible"
        ? "No pudimos buscar. Puedes marcar el punto en el mapa"
        : search.items.length ? `${search.items.length} ${search.items.length === 1 ? "sugerencia disponible" : "sugerencias disponibles"}` : "No encontramos lugares");
    } catch {
      if (current()) paintPlaceSearch(search, "No pudimos buscar. Puedes marcar el punto en el mapa");
    }
  };
  placeSearchTimer = setTimeout(run, 400);
}
function choosePlace(index) {
  const search = placeSearch;
  const item = search?.items[index];
  if (!item) return;
  const input = $(`#${search.key}`);
  state.points[search.key] = { nombre: item.etiqueta, lat: item.lat, lng: item.lng, resolviendo: false };
  input.value = item.etiqueta;
  state.selecting = search.key;
  closePlaceSearch();
  input.blur();
  window.rideSheet?.set("medium");
  saveDraft();
  updateMap({ fit: false });
  updatePointTooltip(search.key);
  updateSelection();
  map?.setView([item.lat, item.lng], 16, { animate: false });
}
function resolvePointAddress(key, point) {
  addressQueue = addressQueue
    .catch(() => {})
    .then(async () => {
      if (state.points[key] !== point || !point.resolviendo || state.trip)
        return;
      const uid = state.user?.id;
      try {
        let result = await api("/mapa/direccion", {
          method: "POST",
          body: { lat: point.lat, lng: point.lng },
        });
        if (result.estado === "ocupado") {
          await new Promise((resolve) =>
            setTimeout(resolve, result.reintentar_ms),
          );
          if (
            state.points[key] !== point ||
            !point.resolviendo ||
            state.trip ||
            state.user?.id !== uid
          )
            return;
          result = await api("/mapa/direccion", {
            method: "POST",
            body: { lat: point.lat, lng: point.lng },
          });
        }
        if (
          state.points[key] !== point ||
          !point.resolviendo ||
          state.user?.id !== uid
        )
          return;
        point.nombre = result.nombre || "";
      } catch {
        /* Keep the selected point and let the passenger enter a reference. */
      } finally {
        if (
          state.points[key] === point &&
          point.resolviendo &&
          state.user?.id === uid
        ) {
          point.resolviendo = false;
          const input = $(`#${key}`);
          if (input) {
            input.value = point.nombre;
            input.placeholder = point.nombre
              ? ""
              : "Escribe la dirección o referencia";
          }
          updatePointTooltip(key);
          updateSelection();
          saveDraft();
        }
      }
    });
}
function updatePointTooltip(key) {
  const marker = markers[key];
  if (!marker) return;
  const label = document.createElement("span");
  label.textContent =
    state.points[key]?.nombre ||
    (state.points[key]?.resolviendo
      ? "Buscando dirección…"
      : "Punto seleccionado");
  if (marker.getTooltip()) marker.setTooltipContent(label);
  else
    marker.bindTooltip(label, {
      permanent: true,
      direction: "top",
      offset: [0, -12],
      className: "point-label",
    });
}
function saveDraft() {
  if (!state.user) return;
  try {
    localStorage.setItem(
      "sicuani:draft:" + state.user.id,
      JSON.stringify(state.points),
    );
  } catch {
    /* Private browser storage may be unavailable. */
  }
}
function restoreDraft() {
  state.points = { origen: null, destino: null };
  try {
    const p = JSON.parse(
      localStorage.getItem("sicuani:draft:" + state.user.id),
    );
    if (
      p &&
      ["origen", "destino"].every(
        (k) =>
          p[k] === null ||
          (Number.isFinite(p[k]?.lat) &&
            Number.isFinite(p[k]?.lng) &&
            typeof p[k]?.nombre === "string"),
      )
    )
      state.points = p;
    for (const key of ["origen", "destino"]) {
      const point = state.points[key];
      if (
        point &&
        (!point.nombre.trim() ||
          /^(Recogida|Destino):\s*-?\d+\.\d+,\s*-?\d+\.\d+$/.test(point.nombre))
      ) {
        point.nombre = "";
        point.resolviendo = true;
        point.needsAddress = true;
      } else if (point) {
        point.resolviendo = false;
      }
    }
  } catch {}
}
function fitVisibleRoute() {
  if (!map || map.getSize().y <= 180) return;
  if (line) map.fitBounds(line.getBounds(), {
    paddingTopLeft: innerWidth <= 800 ? [48, document.body.dataset.map === "open" ? 190 : 100] : [65, 65],
    paddingBottomRight: innerWidth <= 800 ? [48, 48] : [65, 65],
    maxZoom: 16,
    animate: false,
  });
  else {
    const origin = (state.trip || state.points).origen;
    if (origin) map.setView([origin.lat, origin.lng], 16, { animate: false });
  }
}
function updateMap({ fit = true } = {}) {
  if (!map) return;
  map.invalidateSize({ pan: false });
  const points = state.trip || state.points;
  for (const key of ["origen", "destino"]) {
    if (markers[key]) map.removeLayer(markers[key]);
    const pt = points[key];
    if (!pt) continue;
    const pin = L.divIcon({
      className: "",
      html: `<div class="map-pin ${key === "destino" ? "end" : ""}"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const marker = L.marker([pt.lat, pt.lng], {
      icon: pin,
      draggable: !state.trip && state.user?.rol === "pasajero",
      keyboard: true,
      title: key === "origen" ? "Origen" : "Destino",
    }).addTo(map);
    if (pt.nombre) {
      const label = document.createElement("span");
      label.textContent = pt.nombre;
      marker.bindTooltip(label, {
        permanent: true,
        direction: "top",
        offset: [0, -12],
        className: "point-label",
      });
    }
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      setPoint(key, pos.lat, pos.lng);
    });
    marker.on("dragstart", () => {
      state.selecting = key;
      updateSelection();
    });
    marker.on("click", () => {
      if (!state.trip) {
        state.selecting = key;
        updateSelection();
      }
    });
    markers[key] = marker;
  }
  if (line) {
    map.removeLayer(line);
    line = null;
  }
  if (points.origen && points.destino) {
    line = L.polyline(
      [
        [points.origen.lat, points.origen.lng],
        [points.destino.lat, points.destino.lng],
      ],
      { color: "#5F66F5", weight: 4, dashArray: "7 7" },
    ).addTo(map);
  }
  if (fit) fitVisibleRoute();
  setTimeout(() => map.invalidateSize(), 0);
}
function updateSelection() {
  if (state.trip || state.view !== "home" || state.user?.rol !== "pasajero")
    state.selecting = null;
  const instruction = $("#map-instruction");
  instruction.hidden = !state.selecting;
  instruction.textContent = state.selecting
    ? `Toca el mapa para marcar ${state.selecting === "origen" ? "tu origen" : "tu destino"}`
    : "";
  for (const key of ["origen", "destino"]) {
    const b = $(`[data-point="${key}"]`);
    if (b) b.setAttribute("aria-pressed", String(state.selecting === key));
    const status = $(`#${key}-status`);
    if (status)
      status.textContent = state.points[key]?.resolviendo
        ? "Buscando dirección…"
        : state.points[key]
          ? state.points[key].nombre
            ? "Punto marcado · Puedes moverlo en el mapa"
            : "Escribe una dirección o referencia"
          : "Sin marcar";
  }
}
const svgIcons = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  chat: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 20 12z"/>',
  send: '<path d="M5 12h13"/><path d="m12 5 7 7-7 7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
  car: '<path d="M5 16v-5l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><path d="M7 11h10"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5z"/>',
  login: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="m9 16 4-4-4-4"/><path d="M13 12H4"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 14.5h2"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 16 4-4-4-4"/><path d="M19 12H9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const svg = (name, extra = "") =>
  `<svg class="ico ${extra}" viewBox="0 0 24 24" aria-hidden="true">${svgIcons[name]}</svg>`;
const firstName = (name = "") => String(name).trim().split(/\s+/)[0] || "";
const initials = (name = "") =>
  String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
const clock = (seconds) =>
  new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(seconds * 1000));
const chip = (text, tone = "blue") => `<span class="chip chip-${tone}">${text}</span>`;
const ratingLabels = ["", "Malo", "Regular", "Bueno", "Muy bueno", "Excelente"];
const goodTags = ["Puntual", "Amable", "Auto limpio", "Buena conducción"];
const badTags = ["Llegó tarde", "Manejo brusco", "Auto sucio", "Otro"];
const vehicleText = (c) => [`${c.marca || ""} ${c.modelo || ""}`.trim(), c.color].filter(Boolean).join(" · ");
const tripsText = (c) => `${c.viajes ?? 0} ${c.viajes === 1 ? "viaje" : "viajes"}`;
const ratingText = (c) => (c.promedio ? `<span class="rating-inline">${svg("star", "filled")}${String(c.promedio).replace(".", ",")}</span>` : "");
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}
function heading(eyebrow, title, subtitle = "") {
  return `<div class="panel-heading"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}</div>`;
}
function titleBlock(title, subtitle = "", aside = "") {
  return `<div class="title-block"><div class="grow"><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}</div>${aside}</div>`;
}
function field(name, label, type = "text", attrs = "") {
  if (type === "password") {
    return `<div class="field"><label for="${name}">${label}</label><div class="password-wrap"><input id="${name}" name="${name}" type="password" ${attrs}><button type="button" class="password-toggle" data-toggle-password="${name}" aria-label="Mostrar contraseña" aria-pressed="false">${icon("EyeIcon")}</button></div></div>`;
  }
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${attrs}></div>`;
}
function authField(name, label, type, attrs, iconName, hint = "") {
  const toggle = type === "password" ? `<button type="button" class="password-toggle" data-toggle-password="${name}" aria-label="Mostrar contraseña" aria-pressed="false">${icon("EyeIcon")}</button>` : "";
  return `<div class="field auth-field"><label for="${name}">${label}</label><div class="input-icon ${toggle ? "has-toggle" : ""}">${iconName ? svg(iconName) : ""}<input id="${name}" name="${name}" type="${type}" ${attrs}${hint ? ` aria-describedby="${name}-hint"` : ""}>${toggle}</div>${hint ? `<p class="hint" id="${name}-hint">${hint}</p>` : ""}</div>`;
}
function route(j) {
  return `<div class="route-summary">${["origen", "destino"].map((k) => `<div class="route-stop"><span class="route-symbol ${k === "destino" ? "destination" : ""}" aria-hidden="true"></span><div><small>${k === "origen" ? "Recogida" : "Destino"}</small><p>${esc(j[k].nombre)}</p></div></div>`).join("")}</div>`;
}
function routeCard(j) {
  return `<div class="route-card-stops"><p class="route-card-stop"><span class="route-symbol" aria-hidden="true"></span><span class="sr-only">Recogida: </span>${esc(j.origen.nombre)}</p><span class="route-card-divider" aria-hidden="true"></span><p class="route-card-stop"><span class="route-symbol destination" aria-hidden="true"></span><span class="sr-only">Destino: </span>${esc(j.destino.nombre)}</p></div><button type="button" class="map-toggle" id="show-map" aria-label="Ver recorrido en el mapa">${svg("map")}<span>Mapa</span></button>`;
}
function authView() {
  if (state.auth === "pending") return pendingView();
  if (state.auth === "register") return registerView();
  return `<div class="auth-hero"><img src="/assets/login-bg.jpg" alt="Pasajera con manta andina y su celular, y chofer junto a un auto blanco en la plaza de Sicuani" width="1170" height="780"></div>
    <div class="auth-brand"><span class="auth-logo"><img src="/assets/logo-mark.png" alt="Logo de Uber Sicuani" width="68" height="68"></span><h1>Uber Sicuani</h1><p>Tu ciudad. Tu próximo destino.</p></div>
    <form id="auth-form" class="auth-card" novalidate>
      <div class="auth-card-title"><h2>Iniciar sesión</h2><p>Ingresa con tu usuario para viajar o conducir</p></div>
      ${state.registrationMessage ? `<p class="success-box" role="status">${esc(state.registrationMessage)}</p>` : ""}
      <p id="form-error" class="alert-box" role="alert" hidden></p>
      ${authField("usuario", "Usuario", "text", `required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Ej. ruben.quispe" value="${esc(state.suggestedUsername)}"`, "user")}
      ${authField("password", "Contraseña", "password", 'required autocomplete="current-password" placeholder="Tu contraseña"', "lock")}
      <button type="submit" class="primary">${svg("login")}<span>Entrar</span></button>
      <p class="secure-note">${svg("shield")}Contraseña protegida con cifrado</p>
    </form>
    <p class="auth-foot">¿Es tu primera vez? <button type="button" class="link-button" id="switch-auth">Crear una cuenta</button></p>
    <p class="auth-note">Viajes de práctica. Los pagos en efectivo y Yape son simulados.</p>`;
}
function registerView() {
  const driver = state.authRole === "conductor";
  const vehicle = driver && state.authStep === 2;
  const roleButton = (role, title, text, iconName) =>
    `<button type="button" role="radio" class="segment" data-role="${role}" aria-checked="${state.authRole === role}">${svg(iconName)}<span><span>${title}</span><small>${text}</small></span></button>`;
  return `<button type="button" class="round-button on-dark auth-back" id="switch-auth" aria-label="Volver a iniciar sesión">${svg("back")}</button>
    <div class="auth-brand compact"><span class="auth-logo"><img src="/assets/logo-mark.png" alt="Logo de Uber Sicuani" width="46" height="46"></span><h1>Crea tu cuenta</h1><p>Elige cómo usarás Uber Sicuani</p></div>
    <form id="auth-form" class="auth-card">
      <div role="radiogroup" aria-label="Tipo de cuenta" class="segments">${roleButton("pasajero", "Pasajero", "Quiero viajar", "user")}${roleButton("conductor", "Chofer", "Quiero conducir", "car")}</div>
      <input type="hidden" name="rol" value="${driver ? "conductor" : "pasajero"}">
      ${driver ? `<div class="progress" aria-label="Progreso del registro"><div class="progress-bars"><span class="on"></span><span class="${vehicle ? "on" : ""}"></span></div><p>${vehicle ? "Paso 2 de 2 · Tu vehículo" : "Paso 1 de 2 · Tus datos"}</p></div>` : ""}
      <div class="form-grid" id="personal-fields" ${vehicle ? "hidden" : ""}>
        ${authField("nombre", "Nombre completo", "text", 'required minlength="2" maxlength="80" autocomplete="name" placeholder="Ej. Rubén Quispe"', "user")}
        <div class="field auth-field"><label for="telefono">Celular</label><div class="phone-row"><span class="phone-prefix" aria-hidden="true">+51</span><input id="telefono" name="telefono" type="tel" required inputmode="tel" pattern="[0-9 ]{9,11}" autocomplete="tel-national" placeholder="987 654 321"></div></div>
        ${authField("usuario", "Usuario", "text", 'required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="De 3 a 32 caracteres"', "user")}
        ${authField("password", "Contraseña", "password", 'required minlength="8" maxlength="72" autocomplete="new-password" placeholder="Mínimo 8 caracteres"', "lock", "Usa de 8 a 72 caracteres.")}
      </div>
      <fieldset class="form-grid vehicle-fields" id="vehicle-fields" ${vehicle ? "" : "hidden disabled"}>
        <legend class="sr-only">Datos de tu vehículo</legend>
        ${authField("placa", "Placa", "text", 'required maxlength="60" autocomplete="off" placeholder="Ej. X3F-482" class="plate-input"', "")}
        <div class="two-cols">${authField("marca", "Marca", "text", 'required maxlength="60" autocomplete="off" placeholder="Toyota"', "")}${authField("modelo", "Modelo", "text", 'required maxlength="60" autocomplete="off" placeholder="Yaris"', "")}</div>
        ${authField("color", "Color", "text", 'required maxlength="60" autocomplete="off" placeholder="Blanco"', "")}
        <p class="info-box">${svg("clock")}Tu cuenta quedará en revisión. Podrás conducir cuando el administrador la apruebe.</p>
      </fieldset>
      <p id="form-error" class="alert-box" role="alert" hidden></p>
      ${vehicle ? `<div class="button-row"><button type="button" class="secondary" id="auth-step-back">Atrás</button><button type="submit" class="primary">Enviar solicitud</button></div>` : `<button type="submit" class="primary">${driver ? "Continuar" : "Crear cuenta"}</button>`}
      <p class="secure-note">${svg("shield")}Contraseña protegida con cifrado</p>
    </form>
    <p class="auth-foot">¿Ya tienes una cuenta? <button type="button" class="link-button" id="switch-auth-foot">Inicia sesión</button></p>`;
}
function pendingView() {
  const p = state.pendingAccount || { estado: "pendiente" };
  const rejected = p.estado === "rechazado";
  const name = firstName(p.nombre);
  return `<div class="auth-brand compact"><span class="auth-logo"><img src="/assets/logo-mark.png" alt="Logo de Uber Sicuani" width="46" height="46"></span><p class="auth-brand-name">Uber Sicuani</p></div>
    <div class="auth-card">
      ${rejected
        ? `<span class="status-icon bad">${svg("alert")}</span><h1 class="auth-title">Tu solicitud de chofer fue rechazada</h1><div class="alert-box"><p><strong>Motivo:</strong> ${esc(p.motivo || "Sin detalle.")}</p></div><p class="muted">Habla con el administrador. Puede aprobarla después de revisarla otra vez.</p>`
        : `<span class="status-icon">${svg("clock")}</span><h1 class="auth-title">Tu cuenta de chofer está en revisión</h1><p class="muted">${name ? `Hola, ${esc(name)}. ` : ""}Ya recibimos tus datos.</p>
          <ol class="steps" aria-label="Estado de tu solicitud"><li class="done">${svg("check")}<span>Enviada</span></li><li class="current" aria-current="step"><span class="step-dot"></span><span>En revisión</span></li><li><span class="step-dot"></span><span>Aprobada</span></li></ol>
          <p class="muted small">Podrás conducir cuando el administrador apruebe tu cuenta. Vuelve a revisar más tarde.</p>`}
      <form id="status-form" class="form-grid" novalidate>
        <p id="form-error" class="alert-box" role="alert" hidden></p>
        ${authField("usuario", "Usuario", "text", `required autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(p.usuario || state.suggestedUsername)}"`, "user")}
        ${authField("password", "Contraseña", "password", 'required autocomplete="current-password"', "lock")}
        <button type="submit" class="primary">Revisar estado</button>
      </form>
      <button type="button" class="text-button" id="use-other-account">Usar otra cuenta</button>
    </div>`;
}
function newTripView() {
  return (
    heading(
      `Hola, ${esc(state.user.nombre.split(" ")[0])}`,
      "¿A dónde vamos?",
      "Elige tus puntos y encuentra un conductor.",
    ) +
    `<form id="trip-form" class="form-grid"><div class="route-fields">${["origen", "destino"].map((k) => `<div class="route-field"><span class="route-symbol ${k === "destino" ? "destination" : ""}" aria-hidden="true"></span><div class="grow"><label for="${k}">${k === "origen" ? "Punto de recogida" : "Tu destino"}</label><input id="${k}" name="${k}" required minlength="2" maxlength="120" placeholder="${k === "origen" ? "¿Dónde te recogemos?" : "¿A dónde quieres ir?"}" value="${esc(state.points[k]?.nombre)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${k}-suggestions" aria-describedby="${k}-status ${k}-search-status"><ul id="${k}-suggestions" class="place-suggestions" role="listbox" aria-label="Sugerencias de ${k === "origen" ? "recogida" : "destino"}" hidden></ul><p id="${k}-search-status" class="place-search-status" role="status" aria-live="polite"></p><p class="point-status" id="${k}-status"></p></div><button class="point-button" type="button" data-point="${k}" aria-label="Marcar ${k} en el mapa" aria-pressed="false">${icon("MapPinIcon")}</button></div>`).join("")}</div><div class="selection-help"><button type="button" class="secondary compact" id="gps">${icon("MapPinIcon")} Usar mi ubicación</button><p class="hint">Escribe una dirección y elige una sugerencia, o selecciona Recogida o Destino y toca el mapa. Puedes mover el marcador y editar la referencia.</p></div><div class="payment-row">${icon("BanknotesIcon")}<div class="grow"><strong>Efectivo o Yape</strong><p class="muted small">Pago simulado al finalizar</p></div><div class="payment-pills" aria-label="Medios de pago"><span class="pill-badge pill-cash">Efectivo</span><span class="pill-badge pill-yape">Yape</span></div></div><p id="form-error" class="error-text" role="alert" hidden></p><button class="primary" type="submit" data-change>Solicitar viaje</button></form><p class="auth-note">El conductor propone el precio. Tú decides si lo aceptas.</p>`
  );
}
function requestCard(j) {
  const id = esc(j.id);
  return `<article class="request-card" aria-labelledby="request-${id}-destination">
    <div class="request-destination">
      <span class="request-stop-icon" aria-hidden="true">${icon("MapPinIcon")}</span>
      <div><p class="request-label">Destino</p><h3 id="request-${id}-destination">${esc(j.destino.nombre)}</h3></div>
    </div>
    <div class="request-pickup">
      <span class="route-symbol" aria-hidden="true"></span>
      <div><p class="request-label">Recogida</p><p class="request-address">${esc(j.origen.nombre)}</p></div>
    </div>
    <p class="request-expiry">${icon("ClockIcon")}<span>Vence en <span class="countdown" data-deadline="${esc(j.busqueda_hasta)}"></span></span></p>
    <div class="request-action">
      <button type="button" class="primary" data-action="reservar" data-id="${id}" data-change aria-describedby="request-${id}-help">${j.version === 2 ? "Proponer mi precio" : "Reservar y proponer precio"}</button>
      <p class="request-help" id="request-${id}-help">${j.version === 2 ? "Tienes 1 minuto para preparar tu precio. El pasajero elige entre las propuestas." : "Al reservar, tienes 1 minuto para proponer tu precio."}</p>
    </div>
  </article>`;
}
function driverHome() {
  const count = state.pending.length;
  return (
    heading(
      "Conduce por Sicuani",
      "Tu próxima oportunidad",
      "Activa tu disponibilidad para ver las solicitudes.",
    ) +
    `<div class="availability"><label for="available"><input id="available" name="disponible" type="checkbox" ${state.user.disponible === "1" ? "checked" : ""}><span>${state.user.disponible === "1" ? "Disponible" : "No disponible"}</span></label>${icon("TruckIcon")}</div>
    <section class="requests-section" aria-labelledby="requests-heading">
      <div class="requests-heading"><h2 id="requests-heading">Solicitudes de viaje</h2><p class="muted number">${count} ${count === 1 ? "disponible" : "disponibles"}</p></div>
      <div class="requests-list">${count ? state.pending.map(requestCard).join("") : `<div class="empty-state"><h3>${state.user.disponible === "1" ? "Por ahora no hay solicitudes" : "Estás fuera de servicio"}</h3><p class="muted">${state.user.disponible === "1" ? "Las nuevas solicitudes aparecerán aquí automáticamente." : "Activa Disponible cuando quieras recibir viajes."}</p></div>`}</div>
    </section>`
  );
}
function searchingWell() {
  return `<div class="info-well"><div class="radar-wrap" aria-hidden="true"><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-center-dot">${icon("TruckIcon")}</div></div><h3>Buscando conductores</h3><p>Varios choferes pueden enviar su precio. Las propuestas aparecerán aquí automáticamente.</p></div>`;
}
function offerCard(offer, { best = false, featured = false, selected = false } = {}) {
  const c = offer.conductor_info;
  const own = offer.autor === state.user.id;
  const id = esc(offer.id);
  const body = `<img class="offer-car" src="/assets/car-offer.png" alt="" width="${featured ? 84 : 72}" height="${featured ? 42 : 36}">
    <span class="offer-main"><span class="offer-name">${esc(c.nombre)}</span><span class="offer-vehicle">${esc(vehicleText(c))}${featured ? "" : ` · ${esc(c.placa)}`}</span>
      ${featured ? `<span class="offer-tags"><span class="plate small-plate">${esc(c.placa)}</span>${best ? chip("Mejor precio", "green") : ""}${own ? chip("Tu contraoferta", "purple") : ""}</span>` : own ? `<span class="offer-tags">${chip("Tu contraoferta", "purple")}</span>` : ""}</span>
    <span class="offer-side"><span class="offer-price">${money(offer.importe)}</span>${featured ? `<span class="offer-meta">${tripsText(c)}${ratingText(c)}</span>` : ""}<span class="offer-meta">Vence <span class="countdown" data-deadline="${offer.vence}"></span></span></span>`;
  if (own)
    return `<div class="offer ${featured ? "featured" : ""} own" aria-label="Tu contraoferta a ${esc(c.nombre)}, esperando su respuesta">${body}</div>`;
  return `<button type="button" class="offer ${featured ? "featured" : ""}" data-select-offer="${id}" aria-pressed="${selected}" aria-label="${esc(c.nombre)}, ${esc(vehicleText(c))}, ${money(offer.importe)}">${body}</button>`;
}
function passengerOffers(j) {
  const offers = j.ofertas || [];
  const count = `${offers.length} ${offers.length === 1 ? "propuesta" : "propuestas"}`;
  const live = chip("En vivo", "blue");
  if (!offers.length)
    return titleBlock("Buscando conductores", `La búsqueda vence en <strong class="countdown" data-deadline="${j.busqueda_hasta}"></strong>`, live) + searchingWell();
  const sorted = [...offers].sort((a, b) => a.importe - b.importe || Number(a.id) - Number(b.id));
  const choosable = sorted.filter((o) => o.autor !== state.user.id);
  const best = choosable[0] || sorted[0];
  const selected = choosable.find((o) => o.id === state.selectedOffer) || choosable[0] || null;
  const others = sorted.filter((o) => o !== best);
  const name = selected ? firstName(selected.conductor_info.nombre) : "";
  let html = titleBlock("Elige tu chofer", `${count} · La búsqueda vence en <strong class="countdown" data-deadline="${j.busqueda_hasta}"></strong>`, live);
  html += `<section class="offer-group" aria-labelledby="best-heading"><h2 class="section-label" id="best-heading">Recomendada</h2>${offerCard(best, { best: choosable.length > 1 && best === choosable[0], featured: true, selected: best === selected })}</section>`;
  if (others.length)
    html += `<section class="offer-group" aria-labelledby="others-heading"><h2 class="section-label" id="others-heading">Otras propuestas</h2>${others.map((o) => offerCard(o, { selected: o === selected })).join("")}</section>`;
  if (!selected)
    return html + `<p class="hint" role="status">Esperando la respuesta del chofer a tu contraoferta. Las nuevas propuestas aparecerán aquí.</p>`;
  const sid = esc(selected.id);
  html += `<div class="counter-panel" id="counter-panel" ${state.counterOpen ? "" : "hidden"}>
      <form class="form-grid offer-counteroffer" data-offer-id="${sid}"><div class="field"><label for="offer-${sid}-amount">Tu precio para ${esc(name)} en soles</label><input id="offer-${sid}-amount" name="importe" type="number" required min="1" max="1000" step="0.01" placeholder="S/ 0.00" inputmode="decimal"></div>
      <div class="quick-chips" aria-label="Ajuste rápido de precio">${[[-1, "- S/ 1.00"], [1, "+ S/ 1.00"], [2, "+ S/ 2.00"]].map(([d, l]) => `<button type="button" class="chip-btn" data-quick-delta="${d}" data-base-price="${selected.importe}" data-target-input="offer-${sid}-amount">${l}</button>`).join("")}</div>
      <p class="error-text" role="alert" hidden></p><button type="submit" class="secondary" data-change>Enviar contraoferta</button></form>
      <button type="button" class="text-button" data-action="rechazar-oferta" data-id="${j.id}" data-offer-id="${sid}" data-change>Rechazar la propuesta de ${esc(name)}</button>
    </div>
    <div class="dock"><button type="button" class="primary grow" data-action="aceptar-oferta" data-id="${j.id}" data-offer-id="${sid}" data-change>Aceptar a ${esc(name)} · ${money(selected.importe)}</button><button type="button" class="secondary dock-side" id="toggle-counter" aria-expanded="${state.counterOpen}" aria-controls="counter-panel">Contraoferta</button></div>`;
  return html;
}
function cmpStreamId(a = "0-0", b = "0-0") {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  return am - bm || as - bs;
}
const seenKey = (tripId) => `sicuani:chat-visto:${state.user?.id}:${tripId}`;
function unread(j) {
  if (state.chat.tripId !== j.id) return 0;
  const seen = storageGet(seenKey(j.id)) || "0-0";
  return state.chat.messages.filter((m) => m.autor !== state.user.id && cmpStreamId(m.id, seen) > 0).length;
}
function otherParty(j) {
  const driver = state.user.rol === "conductor";
  return driver ? { ...j.pasajero_info, rol: "pasajero" } : { ...j.conductor_info, rol: "conductor" };
}
function personCard(j, { car = false } = {}) {
  const o = otherParty(j);
  const driver = o.rol === "conductor";
  return `<div class="person-card">${car && driver ? `<img class="person-car" src="/assets/car-offer.png" alt="" width="96" height="48">` : `<span class="avatar" aria-hidden="true">${esc(initials(o.nombre))}</span>`}<div class="grow"><p class="person-name">${esc(o.nombre)}</p><p class="small">${driver ? esc(vehicleText(o)) : "Pasajero"}</p>${driver ? `<p class="small person-meta">${tripsText(o)}${ratingText(o)}</p>` : ""}</div>${driver ? `<span class="plate">${esc(o.placa)}</span>` : ""}</div>`;
}
function amountRow(label, amount, detail) {
  return `<div class="amount-row"><div class="grow"><p class="small">${label}</p><p class="small muted">${detail}</p></div><strong class="price">${money(amount)}</strong></div>`;
}
function chatPreview(j) {
  const o = otherParty(j);
  const name = esc(firstName(o.nombre));
  const theirs = state.chat.tripId === j.id ? state.chat.messages.filter((m) => m.autor !== state.user.id) : [];
  const last = theirs[theirs.length - 1];
  const count = unread(j);
  return `<button type="button" class="chat-preview" data-open-chat>${svg("chat")}<span class="grow"><span class="chat-preview-title">${last ? `Mensaje de ${name}` : `Chat con ${name}`}</span><span class="chat-preview-text">${last ? esc(last.texto) : "Aún no hay mensajes. Escríbele para coordinar la recogida."}</span></span>${count ? `<span class="badge" aria-label="${count} sin leer">${count}</span>` : ""}</button>`;
}
function incidentList(j) {
  return j.incidencias?.length
    ? `<div class="stack tight"><h3>Incidencias registradas</h3>${j.incidencias.map((i) => `<div class="info-well"><p><strong>${esc(reasons[i.motivo])}</strong></p><p>${esc(i.comentario)}</p><p>${date(i.fecha)}</p></div>`).join("")}</div>`
    : "";
}
function availabilityToggle() {
  return `<div class="availability"><label for="available"><input id="available" name="disponible" type="checkbox" ${state.user.disponible === "1" ? "checked" : ""}>Disponible para próximos viajes</label></div>`;
}
function confirmedView(j, driver) {
  const o = otherParty(j);
  const name = esc(firstName(o.nombre));
  let html = `<div class="row between">${chip("Confirmado", "green")}<span class="small muted">Inicio antes de <span class="countdown" data-deadline="${j.inicio_hasta}"></span></span></div>`;
  html += titleBlock(driver ? `Recoge a ${name}` : `${name} va a recogerte`, driver ? `Ve a ${esc(j.origen.nombre)}. Avísale por chat cuando llegues.` : `Espéralo en ${esc(j.origen.nombre)}. Revisa la placa antes de subir.`);
  html += personCard(j, { car: true });
  html += amountRow("Precio acordado", j.precio, driver ? "Cobras al finalizar · Efectivo o Yape" : "Pagas al finalizar · Efectivo o Yape");
  html += chatPreview(j);
  html += driver
    ? `<button type="button" class="primary" data-action="iniciar" data-id="${j.id}" data-change>Iniciar viaje</button><button type="button" class="secondary" data-open-chat>Escribir a ${name}</button>`
    : `<button type="button" class="primary" data-open-chat>${svg("chat")}<span>Escribir a ${name}</span></button>`;
  html += `<button type="button" class="text-button danger-text" data-dialog="cancelar" data-id="${j.id}" data-change>Cancelar viaje</button>`;
  if (driver) html += availabilityToggle();
  return html;
}
function rideView(j, driver) {
  const o = otherParty(j);
  const name = esc(firstName(o.nombre));
  const steps = ["Confirmado", "Recogido", "En curso", "Pago"];
  let html = `<div class="row between">${chip("En curso", "blue")}</div>`;
  html += titleBlock(driver ? `Lleva a ${name} a ${esc(j.destino.nombre)}` : `Vas camino a ${esc(j.destino.nombre)}`, driver ? `Iniciaste el viaje a las ${clock(j.iniciado)}.` : `${name} te recogió e inició el viaje a las ${clock(j.iniciado)}.`);
  html += `<ol class="steps" aria-label="Progreso del viaje">${steps.map((s, i) => (i < 2 ? `<li class="done">${svg("check")}<span>${s}</span></li>` : i === 2 ? `<li class="current" aria-current="step"><span class="step-dot"></span><span>${s}</span></li>` : `<li><span class="step-dot"></span><span>${s}</span></li>`)).join("")}</ol>`;
  html += personCard(j);
  html += amountRow(driver ? "Cobrarás al llegar" : "Pagarás al llegar", j.precio, "Efectivo o Yape · Pago simulado");
  if (!driver) html += `<p class="hint">Si algo no está bien durante el trayecto, repórtalo. El chofer finaliza el viaje al llegar.</p>`;
  const count = unread(j);
  html += `<button type="button" class="secondary" data-open-chat>${svg("chat")}<span>Escribir a ${name}</span>${count ? `<span class="badge" aria-label="${count} sin leer">${count}</span>` : ""}</button>`;
  if (driver) html += `<button type="button" class="primary" data-action="finalizar" data-id="${j.id}" data-change>Finalizar viaje</button>`;
  html += `<button type="button" class="text-button danger-text" data-dialog="incidencia" data-id="${j.id}" data-change>Reportar incidencia</button>`;
  html += incidentList(j);
  if (driver) html += availabilityToggle();
  return html;
}
const methodName = (m) => (m === "yape" ? "Yape" : "Efectivo");
function arrivalView(j, driver) {
  const o = otherParty(j);
  const name = esc(firstName(o.nombre));
  const paid = j.pago !== "pendiente";
  const c = j.conductor_info || {};
  let html = `<div class="row between">${paid ? chip("Finalizado", "green") : chip("Finalizado · pago pendiente", "yellow")}</div>`;
  html += titleBlock(driver ? "Viaje finalizado" : `Llegaste a ${esc(j.destino.nombre)}`, paid ? (driver ? `Registraste el pago de ${name}.` : "Gracias por viajar con Uber Sicuani.") : driver ? `Cobra a ${name} y registra cómo te pagó.` : `Paga a ${name} en efectivo o por Yape. ${name} registrará el pago al recibirlo.`);
  html += `<div class="total-card"><p class="small">${paid ? "Total pagado" : "Total a pagar"}</p><strong class="price big">${money(j.precio)}</strong><p class="small muted">${paid ? `${methodName(j.pago)} · Pago simulado` : "Efectivo o Yape · Pago simulado"}</p></div>`;
  if (driver && !paid) {
    const chosen = state.payMethod || "efectivo";
    html += `<form id="pay-form" class="stack tight"><fieldset class="method-list"><legend class="section-label">¿Cómo te pagó?</legend>${[["efectivo", "Efectivo recibido", "Te pagó directamente"], ["yape", "Yape recibido", "Te yapeó a tu número"]].map(([v, t, d]) => `<label class="method"><input type="radio" name="metodo" value="${v}" ${chosen === v ? "checked" : ""}><span class="method-radio" aria-hidden="true"></span><span class="grow"><span class="method-title">${t}</span><span class="method-detail">${d}</span></span>${svg("wallet")}</label>`).join("")}</fieldset><button type="submit" class="primary" data-change><span>Registrar pago con <span id="pay-method-name">${methodName(chosen)}</span></span></button><p class="hint">Puedes dejarlo pendiente y registrarlo luego desde Actividad.</p></form>`;
  }
  if (paid)
    html += `<div class="success-box" role="status">${svg("check")}<div><strong>Pago registrado</strong><p class="small">${money(j.precio)} con ${methodName(j.pago)} · Viaje con ${esc(o.nombre)}</p></div></div>`;
  html += `<dl class="summary"><div><dt>Desde</dt><dd>${esc(j.origen.nombre)}</dd></div><div><dt>Hasta</dt><dd>${esc(j.destino.nombre)}</dd></div>${c.marca ? `<div><dt>Vehículo</dt><dd>${esc(`${c.marca} ${c.modelo}`)} · ${esc(c.placa)}</dd></div>` : ""}</dl>`;
  if (j.calificacion)
    html += `<div class="thanks">${svg("star", "filled")}<p>${driver ? `${name} te calificó con ${j.calificacion.estrellas} de 5` : `Gracias por calificar a ${name} con ${j.calificacion.estrellas} de 5`}</p></div>`;
  else if (!driver) html += `<button type="button" class="secondary" data-rate="${j.id}">${svg("star")}<span>Calificar a ${name}</span></button>`;
  html += `<p class="hint">El viaje quedó guardado en Actividad. El chat ${driver ? "con el pasajero" : "con el chofer"} se cerró.</p>`;
  html += incidentList(j);
  html += `<button type="button" class="${driver || paid ? "primary" : "secondary"}" id="new-trip">${driver ? "Ver solicitudes" : "Pedir otro viaje"}</button>`;
  return html;
}
function chatView() {
  const j = state.trip;
  if (!j || !["confirmado", "en_curso", "finalizado"].includes(j.estado))
    return `<div class="empty-state"><h3>El chat no está disponible</h3><p class="muted">Solo puedes escribir durante un viaje confirmado.</p><button type="button" class="secondary" data-view="home">Volver al viaje</button></div>`;
  const o = otherParty(j);
  const name = esc(firstName(o.nombre));
  const isOpen = state.chat.open && ["confirmado", "en_curso"].includes(j.estado);
  const mine = (m) => m.autor === state.user.id;
  const bubbles = state.chat.messages.map((m) => mine(m)
    ? `<div class="bubble-row mine"><p class="bubble">${esc(m.texto)}</p><span class="bubble-meta">${clock(m.fecha)} · Enviado</span></div>`
    : `<div class="bubble-row"><p class="bubble">${esc(m.texto)}</p><span class="bubble-meta">${name} · ${clock(m.fecha)}</span></div>`).join("");
  const outbox = state.chat.outbox.map((m) => `<div class="bubble-row mine ${m.estado === "error" ? "failed" : ""}"><p class="bubble">${esc(m.texto)}</p><span class="bubble-meta">${m.estado === "error" ? `No se envió · <button type="button" class="link-button" data-chat-retry="${m.local}">Reintentar</button>` : "Enviando…"}</span></div>`).join("");
  const quick = state.user.rol === "conductor" ? ["Ya llegué", "Llego en 2 minutos", "¿Dónde estás?"] : ["Ya estoy aquí", "Llego en 2 minutos", "¿Dónde estás?"];
  return `<div class="chat">
    <header class="chat-header"><button type="button" class="round-button" data-view="home" aria-label="Volver al viaje">${svg("back")}</button><span class="avatar" aria-hidden="true">${esc(initials(o.nombre))}</span><div class="grow"><h1 class="chat-title">${esc(o.nombre)}</h1><p class="small">${o.rol === "conductor" ? `${esc(vehicleText(o))} · ${esc(o.placa)}` : "Pasajero"}</p></div>${isOpen ? chip(j.estado === "en_curso" ? "En curso" : "Confirmado", j.estado === "en_curso" ? "blue" : "green") : chip("Cerrado", "neutral")}</header>
    <div class="chat-log" role="log" aria-label="Mensajes del viaje" aria-live="polite"><p class="chat-banner">${j.estado === "en_curso" ? "Viaje en curso" : j.estado === "finalizado" ? "Viaje finalizado" : "Viaje confirmado"} · ${money(j.precio)} · El chat se cierra al finalizar el viaje</p>${bubbles}${outbox}${!bubbles && !outbox ? `<p class="chat-empty">Escribe a ${name} para coordinar la recogida.</p>` : ""}</div>
    ${isOpen ? `<div class="chat-composer"><div class="quick-replies" aria-label="Respuestas rápidas">${quick.map((q) => `<button type="button" class="quick-reply" data-quick-reply="${esc(q)}">${esc(q)}</button>`).join("")}</div><form id="chat-form" class="chat-form"><label for="chat-input" class="sr-only">Escribe un mensaje a ${name}</label><input id="chat-input" name="texto" type="text" maxlength="500" placeholder="Escribe un mensaje…" autocomplete="off" required><button type="submit" class="send-button" aria-label="Enviar mensaje">${svg("send")}</button></form></div>` : `<p class="chat-closed" role="status">El chat se cerró porque el viaje terminó.</p>`}
  </div>`;
}
function ratingContent() {
  const r = state.rating;
  const j = state.trip;
  const c = j?.conductor_info || {};
  const tags = r.stars >= 4 ? goodTags : badTags;
  return `<div class="rating-head"><span class="avatar large" aria-hidden="true">${esc(initials(c.nombre))}</span><p class="person-name">${esc(c.nombre)}</p><p class="small muted">${esc(`${c.marca || ""} ${c.modelo || ""}`)} · ${esc(c.placa)} · ${money(j?.precio)}</p></div>
    <h2 id="rating-title">¿Cómo fue el viaje?</h2>
    <fieldset class="stars"><legend class="sr-only">Calificación de 1 a 5 estrellas</legend>${[1, 2, 3, 4, 5].map((n) => `<label class="star ${n <= r.stars ? "on" : ""}"><input type="radio" name="estrellas" value="${n}" ${n === r.stars ? "checked" : ""} required><span class="sr-only">${n} de 5, ${ratingLabels[n]}</span>${svg("star")}</label>`).join("")}</fieldset>
    <p class="rating-label" aria-live="polite">${r.stars ? ratingLabels[r.stars] : "Toca una estrella"}</p>
    ${r.stars ? `<fieldset class="tag-list"><legend class="section-label">${r.stars >= 4 ? "¿Qué te gustó?" : "¿Qué podemos mejorar?"}</legend>${tags.map((t) => `<label class="tag"><input type="checkbox" name="etiquetas" value="${esc(t)}" ${r.tags.includes(t) ? "checked" : ""}><span>${esc(t)}</span></label>`).join("")}</fieldset>
    <div class="field"><label for="rating-comment">Comentario (opcional)</label><textarea id="rating-comment" name="comentario" maxlength="500" rows="2">${esc(r.comment)}</textarea></div>` : ""}
    <p class="error-text" id="rating-error" role="alert" hidden></p>
    <button type="submit" class="primary" ${r.stars ? "" : "disabled"}>Enviar calificación</button>
    <button type="button" class="text-button" id="rating-skip">Ahora no</button>`;
}
function openRating(j) {
  state.rating = { tripId: j.id, stars: 0, tags: [], comment: "" };
  $("#rating-content").innerHTML = ratingContent();
  if (!$("#rating-dialog").open) $("#rating-dialog").showModal();
}
function paymentView(j, driver) {
  return `<div class="payment-row">${icon("BanknotesIcon")}<div class="grow"><strong>${j.pago === "pendiente" ? "Pago pendiente" : `${j.pago === "yape" ? "Yape" : "Efectivo"} recibido`}</strong><p class="small muted">${money(j.precio)} · Simulación</p></div></div>${driver && j.pago === "pendiente" ? `<div class="row"><button type="button" class="secondary grow" data-pay="efectivo" data-id="${j.id}" data-change>Efectivo recibido</button><button type="button" class="secondary grow" data-pay="yape" data-id="${j.id}" data-change>Yape recibido</button></div><p class="hint">Registra el método al simular la recepción. Puedes dejarlo pendiente y actualizarlo desde Actividad.</p>` : ""}`;
}
function historyView() {
  return (
    titleBlock("Actividad", "Cada recorrido, en un solo lugar.") +
    (state.user.rol === "conductor"
      ? `<p class="small muted number">${state.finished} ${state.finished === 1 ? "viaje finalizado" : "viajes finalizados"}</p>`
      : "") +
    (!state.history.length
      ? `<div class="empty-state"><h3>Aún no tienes viajes</h3><p class="muted">Tu actividad aparecerá aquí cuando solicites o confirmes un viaje.</p><button type="button" class="secondary" data-view="home">${state.user.rol === "conductor" ? "Ver solicitudes" : "Solicitar un viaje"}</button></div>`
      : `<div>${state.history.map((j) => `<article class="history-item"><div class="row between"><p class="history-date">${date(j.creado)}</p><strong>${j.precio ? money(j.precio) : "Sin tarifa"}</strong></div>${route(j)}<p class="small muted">${esc(labels[j.estado])}${j.conductor_info ? ` · ${esc(j.conductor_info.nombre)}` : ""}${j.calificacion ? ` · <span class="rating-inline">${svg("star", "filled")}${j.calificacion.estrellas} de 5</span>` : ""}</p>${j.estado === "finalizado" ? paymentView(j, state.user.rol === "conductor") : ""}</article>`).join("")}</div>`)
  );
}
function accountView() {
  const u = state.user;
  const role = u.rol === "administrador" ? "Administrador" : u.rol === "conductor" ? "Chofer" : "Pasajero";
  return titleBlock("Cuenta", "Tus datos en Uber Sicuani.") +
    `<div class="person-card"><span class="avatar large" aria-hidden="true">${esc(initials(u.nombre))}</span><div class="grow"><p class="person-name">${esc(u.nombre)}</p><p class="small">@${esc(u.usuario)}</p></div>${chip(role, "purple")}</div>
    ${u.rol === "conductor" ? `<dl class="summary"><div><dt>Vehículo</dt><dd>${esc(vehicleText(u))}</dd></div><div><dt>Placa</dt><dd>${esc(u.placa)}</dd></div><div><dt>Estado</dt><dd>${u.disponible === "1" ? "Disponible" : "No disponible"}</dd></div></dl>` : ""}
    ${u.practica === "1" ? `<button type="button" class="secondary" data-view="practice">Laboratorio Redis</button>` : ""}
    <button type="button" class="secondary" id="logout">${svg("logout")}<span>Cerrar sesión</span></button>
    <p class="auth-note">Proyecto académico · Sin cobros reales. Los pagos en efectivo y Yape son simulados.</p>`;
}
function tripView(j) {
  const driver = state.user.rol === "conductor";
  if (j.estado === "pendiente" && j.version === 2 && !driver)
    return passengerOffers(j) + `<button type="button" class="text-button danger-text" data-dialog="cancelar" data-id="${j.id}" data-change>Cancelar solicitud</button>`;
  if (j.estado === "confirmado") return confirmedView(j, driver);
  if (j.estado === "en_curso") return rideView(j, driver);
  if (j.estado === "finalizado") return arrivalView(j, driver);
  return legacyTripView(j);
}
function legacyTripView(j) {
  const driver = state.user.rol === "conductor";
  if (j.estado === "no_elegido") {
    const message = {
      no_elegido: "El pasajero eligió la propuesta de otro chofer.",
      rechazada: "La propuesta fue rechazada. Puedes buscar otra solicitud.",
      reserva_vencida: "Se agotó el minuto para preparar tu precio.",
      oferta_vencida: "Tu propuesta venció sin confirmarse.",
      retirada: "Retiraste tu propuesta de esta solicitud.",
      cambio_de_planes: "El pasajero canceló la solicitud.",
    }[j.motivo_propuesta] || "La solicitud ya no está disponible para tu propuesta.";
    return heading(`Viaje #${esc(j.id)}`, "Solicitud cerrada", message) + route(j) + '<button type="button" class="primary" id="new-trip">Ver solicitudes</button>';
  }
  const myOffer = (j.oferta?.autor || j.conductor) === state.user.id;
  const stateName = j.version === 2 && j.estado === "reservado" ? "Prepara tu propuesta"
    : j.version === 2 && j.estado === "pendiente" && j.ofertas?.length ? "Elige tu chofer" : labels[j.estado];
  const deadline = {
    pendiente: j.busqueda_hasta,
    reservado: j.reserva_hasta,
    ofertado: j.oferta?.vence,
    confirmado: j.inicio_hasta,
  }[j.estado];
  let html =
    heading(
      `Viaje #${esc(j.id)}`,
      myOffer && j.estado === "ofertado"
        ? "Esperando una respuesta"
        : esc(stateName),
    ) +
    `<div class="row between"><span class="status-label ${terminal(j) ? "neutral" : ""}">${icon(j.estado === "finalizado" ? "CheckCircleIcon" : "ClockIcon")}${esc(stateName)}</span>${deadline ? `<span class="countdown" data-deadline="${deadline}" aria-label="Tiempo restante"></span>` : ""}</div>`;
  if (["ofertado", "confirmado", "en_curso", "finalizado"].includes(j.estado)) {
    const c = j.conductor_info || state.user;
    html += `<div class="vehicle-card"><div class="vehicle-art"><img src="/assets/car-white.png" alt="Auto blanco, imagen de referencia" width="224" height="112" decoding="async"></div><div class="row between"><div class="vehicle-data"><h2>${j.estado === "ofertado" ? (myOffer ? "Tu propuesta" : "Propuesta recibida") : "Viaje Sicuani"}</h2><p class="small">${esc(c.marca)} ${esc(c.modelo)} · ${esc(c.color)}</p></div><strong class="price">${money(j.precio ?? j.oferta?.importe)}</strong></div><div class="row between"><p class="small">${driver ? `Pasajero: ${esc(j.pasajero_info.nombre)}` : esc(c.nombre)}</p><span class="plate">${esc(c.placa)}</span></div></div>`;
  }
  html += ["ofertado", "confirmado", "en_curso", "finalizado"].includes(
    j.estado,
  )
    ? `<details class="route-details"><summary>Ver recorrido</summary>${route(j)}</details>`
    : route(j);
  if (j.estado === "pendiente")
    html += j.version === 2 ? passengerOffers(j) : `<div class="info-well"><div class="radar-wrap" aria-hidden="true"><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-center-dot">${icon("TruckIcon")}</div></div><h3>Estamos buscando un conductor</h3><p>Recibirás su propuesta de precio aquí. Puedes esperar hasta 10 minutos.</p></div>`;
  if (j.estado === "reservado")
    html += driver
      ? `<p class="hint">${j.version === 2 ? "Otros choferes también pueden proponer su precio. El pasajero elige con quién viajar." : "Prepara tu precio antes de que termine el plazo."}</p><form id="price-form" class="form-grid">${field("importe", "Tu precio en soles", "number", 'required min="1" max="1000" step="0.01" placeholder="S/ 0.00" inputmode="decimal"')}<button type="submit" class="primary" data-change>Enviar propuesta</button></form>`
      : `<div class="info-well"><h3>Un conductor reservó tu solicitud</h3><p>Está preparando una propuesta. Te mostraremos el vehículo y el precio cuando la envíe.</p></div>`;
  if (j.estado === "ofertado")
    html += myOffer
      ? `<p class="muted">Esperando la respuesta ${driver ? "del pasajero" : "del conductor"}. La negociación termina cuando se agote el tiempo.</p>`
      : `<div class="stack tight trip-actions"><button type="button" class="primary" data-action="aceptar-oferta" data-id="${j.id}" data-change>Aceptar por ${money(j.oferta.importe)}</button><form id="counteroffer-form" class="form-grid">${field("importe", "Tu contraoferta en soles", "number", 'required min="1" max="1000" step="0.01" placeholder="S/ 0.00" inputmode="decimal"')}<div class="quick-chips" aria-label="Ajuste rápido de precio"><button type="button" class="chip-btn" data-quick-delta="-1" data-base-price="${j.oferta?.importe || 5}" data-target-input="importe">- S/ 1.00</button><button type="button" class="chip-btn" data-quick-delta="1" data-base-price="${j.oferta?.importe || 5}" data-target-input="importe">+ S/ 1.00</button><button type="button" class="chip-btn" data-quick-delta="2" data-base-price="${j.oferta?.importe || 5}" data-target-input="importe">+ S/ 2.00</button></div><p id="form-error" class="error-text" role="alert" hidden></p><button type="submit" class="secondary" data-change>Enviar contraoferta</button></form><button type="button" class="secondary" data-action="rechazar-oferta" data-id="${j.id}" data-change>Rechazar propuesta</button></div>`;
  if (j.estado === "confirmado")
    html += driver
      ? `<p class="muted">Coordina la recogida antes de iniciar el viaje simulado.</p><button type="button" class="primary" data-action="iniciar" data-id="${j.id}" data-change>Iniciar viaje</button>`
      : `<div class="info-well"><h3>Tu conductor está confirmado</h3><p>Identifica el vehículo por su placa y color. El conductor marcará el inicio.</p></div>`;
  if (j.estado === "en_curso") {
    html += driver
      ? `<button type="button" class="primary" data-action="finalizar" data-id="${j.id}" data-change>Finalizar viaje</button>`
      : `<div class="info-well"><h3>Ya estás en camino</h3><p>El conductor finalizará el viaje. Si pierdes conexión, recuperaremos este mismo estado al volver.</p></div>`;
    html += `<button type="button" class="secondary" data-dialog="incidencia" data-id="${j.id}" data-change>Reportar incidencia</button>`;
  }
  if (!terminal(j) && j.estado !== "en_curso")
    html += `<button type="button" class="text-button" data-dialog="cancelar" data-id="${j.id}" data-change>${driver && j.version === 2 && ["reservado", "ofertado"].includes(j.estado) ? "Retirar propuesta" : "Cancelar viaje"}</button>`;
  if (terminal(j)) {
    if (j.estado === "finalizado") html += paymentView(j, driver);
    else if (j.estado === "cancelado")
      html += `<div class="info-well"><p>${esc(reasons[j.motivo] || j.motivo)}</p>${j.comentario_cancelacion ? `<p>${esc(j.comentario_cancelacion)}</p>` : ""}</div>`;
    else
      html += `<p class="muted">No se confirmó un conductor dentro de los plazos. Puedes volver a solicitar con los mismos puntos.</p>`;
    html += `<button type="button" class="${driver || j.estado === "finalizado" ? "secondary" : "primary"}" id="new-trip">${driver ? "Ver solicitudes" : j.estado === "sin_conductor" ? "Volver a solicitar" : "Preparar otro viaje"}</button>`;
  }
  if (j.incidencias?.length)
    html += `<div class="stack tight"><h3>Incidencias registradas</h3>${j.incidencias.map((i) => `<div class="info-well"><p><strong>${esc(reasons[i.motivo])}</strong></p><p>${esc(i.comentario)}</p><p>${date(i.fecha)}</p></div>`).join("")}</div>`;
  if (driver && !terminal(j))
    html += `<div class="availability"><label for="available"><input id="available" name="disponible" type="checkbox" ${state.user.disponible === "1" ? "checked" : ""}>Disponible para próximos viajes</label></div>`;
  return html;
}
function practiceView() {
  return (
    heading(
      "Laboratorio privado",
      "Redis Streams",
      "Práctica a demanda, separada de los eventos de viajes.",
    ) +
    `<div class="practice-actions">${[
      ["crear-grupo", "Crear grupo"],
      ["agregar", "Agregar evento"],
      ["leer", "Leer con XREADGROUP"],
      ["pendientes", "Ver XPENDING"],
      ["consultar", "Consultar eventos"],
    ]
      .map(
        ([a, l]) =>
          `<button type="button" class="secondary compact" data-practice="${a}" data-change>${l}</button>`,
      )
      .join(
        "",
      )}</div><form id="ack-form" class="form-grid">${field("ids", "IDs para confirmar, separados por coma", "text", 'required placeholder="123456789-0"')}<button type="submit" class="secondary" data-change>Confirmar con XACK</button></form><pre class="practice-result" aria-live="polite">${esc(state.practice === null ? "Selecciona una acción para ver sus resultados." : JSON.stringify(state.practice, null, 2))}</pre>`
  );
}
function adminView() {
  const cards = state.reviews.map((u) => `<article class="review-card"><div class="row between"><strong>${esc(u.nombre)}</strong><span class="review-status">${u.revision_estado === "rechazado" ? "Rechazado" : "Pendiente"}</span></div><p class="small muted">@${esc(u.usuario)} · ${esc(u.telefono)}</p><p>${esc(u.marca)} ${esc(u.modelo)} · ${esc(u.color)} · ${esc(u.placa)}</p>${u.revision_motivo ? `<p class="small">Motivo anterior: ${esc(u.revision_motivo)}</p>` : ""}<form class="review-form form-grid" data-id="${esc(u.id)}"><div class="field"><label for="review-reason-${esc(u.id)}">Motivo de rechazo</label><textarea id="review-reason-${esc(u.id)}" name="motivo" maxlength="500" placeholder="Escribe el motivo si rechazas la solicitud"></textarea></div><p class="error-text" role="alert" hidden></p><div class="review-actions"><button class="primary" type="submit" name="decision" value="aprobar">Aprobar</button>${u.revision_estado === "rechazado" ? "" : '<button class="secondary" type="submit" name="decision" value="rechazar">Rechazar</button>'}</div></form></article>`).join("");
  return `<div class="stack"><div><p class="eyebrow">Administración</p><h1>Solicitudes de choferes</h1><p class="muted">Revisa los datos antes de tomar una decisión.</p></div>${cards || '<div class="empty-state"><h3>No hay solicitudes por revisar</h3><p class="muted">Las solicitudes nuevas aparecerán aquí.</p></div>'}</div>`;
}
function currentScreen() {
  if (!state.user) return `auth:${state.auth}`;
  if (state.user.rol === "administrador") return "admin";
  if (state.view !== "home") return state.view;
  return state.trip ? `trip:${state.trip.id}:${state.trip.estado}:${state.trip.ofertas?.length ? "offers" : "waiting"}` : `home:${state.user.rol}`;
}
function capturePanelState() {
  const detailsKey = (el) => el.querySelector("form")?.dataset.offerId || el.querySelector("summary")?.textContent;
  return {
    controls: [...panel.querySelectorAll("input[id],textarea[id],select[id]")].map((el) => ({ id: el.id, value: el.value, checked: el.checked })),
    open: [...panel.querySelectorAll("details[open]")].map(detailsKey),
    focused: panel.contains(document.activeElement) ? document.activeElement.id : null,
    start: panel.contains(document.activeElement) ? document.activeElement.selectionStart : null,
    end: panel.contains(document.activeElement) ? document.activeElement.selectionEnd : null,
    scroll: $("#panel-scroll").scrollTop,
  };
}
function restorePanelState(draft) {
  const sheetPosition = window.rideSheet?.position;
  for (const saved of draft.controls) {
    const el = document.getElementById(saved.id);
    if (el && panel.contains(el)) { el.value = saved.value; if ("checked" in el) el.checked = saved.checked; }
  }
  panel.querySelectorAll("details").forEach((el) => {
    const key = el.querySelector("form")?.dataset.offerId || el.querySelector("summary")?.textContent;
    el.open = draft.open.includes(key);
  });
  const focused = draft.focused && document.getElementById(draft.focused);
  if (focused && panel.contains(focused)) {
    focused.focus({ preventScroll: true });
    if (draft.start !== null && typeof focused.setSelectionRange === "function") {
      try { focused.setSelectionRange(draft.start, draft.end); } catch { /* Number inputs do not expose a text selection. */ }
    }
  }
  $("#panel-scroll").scrollTop = draft.scroll;
  if (sheetPosition) window.rideSheet.set(sheetPosition, false);
}
function render(force = false) {
  const signature = JSON.stringify([
    state.user?.id,
    state.user?.disponible,
    state.finished,
    state.view,
    state.auth,
    state.trip?.id,
    state.trip?.estado,
    state.trip?.oferta?.id,
    state.trip?.ofertas?.map((offer) => [offer.id, offer.autor, offer.conductor, offer.importe, offer.vence, offer.estado,
      offer.conductor_info?.nombre, offer.conductor_info?.marca, offer.conductor_info?.modelo, offer.conductor_info?.color, offer.conductor_info?.placa]),
    state.trip?.pago,
    state.trip?.incidencias?.length,
    state.pending.map((j) => j.id),
    state.reviews,
    state.history,
    state.practice,
    state.trip?.calificacion?.estrellas,
    state.trip?.ofertas?.map((offer) => [offer.conductor_info?.viajes, offer.conductor_info?.promedio]),
    state.selectedOffer,
    state.counterOpen,
    state.authRole,
    state.authStep,
    state.pendingAccount,
    state.chat.tripId,
    state.chat.open,
    state.chat.messages.map((m) => m.id),
    state.chat.outbox.map((m) => [m.local, m.estado]),
  ]);
  if (!force && signature === state.signature) return;
  const mode = currentScreen();
  const draft = mode === renderedMode ? capturePanelState() : null;
  const chatLogAtBottom = (() => {
    const log = $(".chat-log");
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  })();
  state.signature = signature;
  closePlaceSearch();
  const logged = !!state.user;
  const admin = state.user?.rol === "administrador";
  document.body.dataset.screen = logged ? "app" : "auth";
  document.body.dataset.view = logged ? (admin ? "admin" : state.view) : state.auth;
  $("#navigation").hidden = !logged;
  $('#navigation [data-view="history"]').hidden = admin;
  $('#navigation [data-view="account"]').hidden = false;
  document.querySelectorAll("#navigation [data-view]").forEach((b) => {
    const current = b.dataset.view === state.view || (b.dataset.view === "home" && admin && state.view === "home");
    if (current) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("#home-label").textContent = admin ? "Solicitudes" : state.user?.rol === "conductor" ? "Conducir" : "Viajar";
  const showRoute = logged && !admin && state.view === "home" && !!state.trip;
  $("#route-card").hidden = !showRoute;
  document.body.dataset.route = showRoute ? "1" : "0";
  if (showRoute) $("#route-card").innerHTML = routeCard(state.trip);
  const picking = logged && state.user.rol === "pasajero" && state.view === "home" && !state.trip;
  if (!showRoute && !picking) state.mapOpen = false;
  // Mobile follows the design: the map stays out of sight until "Mapa" or a point button opens it.
  document.body.dataset.map = state.mapOpen ? "open" : "hidden";
  $("#show-map")?.setAttribute("aria-pressed", String(!!state.mapOpen));
  $("#back").hidden = !state.mapOpen && (!logged || state.view === "home" || state.view === "chat");
  $("#back").setAttribute("aria-label", state.mapOpen ? "Cerrar mapa" : "Volver");
  panel.innerHTML = !logged
    ? authView()
    : admin && state.view === "account"
      ? accountView()
    : admin
      ? adminView()
    : state.view === "history"
      ? historyView()
      : state.view === "practice"
        ? practiceView()
        : state.view === "account"
          ? accountView()
          : state.view === "chat"
            ? chatView()
            : state.trip
              ? tripView(state.trip)
              : state.user.rol === "pasajero"
                ? newTripView()
                : driverHome();
  const expanded = !logged || admin || state.view !== "home" || !!state.trip;
  window.rideSheet?.sync(`${state.user?.id}:${mode}`, expanded ? "expanded" : "medium");
  if (mode !== renderedMode) {
    renderedMode = mode;
    $("#panel-scroll").scrollTop = 0;
    window.scrollTo(0, 0);
  }
  hydrateIcons();
  updateSelection();
  updateMap();
  if (state.user?.rol === "pasajero" && state.view === "home" && !state.trip) {
    for (const key of ["origen", "destino"]) {
      const point = state.points[key];
      if (point?.needsAddress) {
        delete point.needsAddress;
        resolvePointAddress(key, point);
      }
    }
  }
  tick();
  setOnline(state.online);
  if (draft) restorePanelState(draft);
  if (state.view === "chat") {
    const log = $(".chat-log");
    if (log && (chatLogAtBottom || !draft)) log.scrollTop = log.scrollHeight;
    markChatSeen();
  }
  maybePromptRating();
}
function tick() {
  const now = Date.now() / 1000 + state.offset;
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const left = Math.max(0, Math.ceil(Number(el.dataset.deadline) - now));
    el.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  });
}
async function refreshData() {
  if (!state.user) return;
  const result = await api("/estado");
  state.offset = result.servidor - Date.now() / 1000;
  state.user = result.usuario;
  state.pending = result.pendientes;
  state.finished = result.finalizados;
  if (state.user.rol === "administrador") state.reviews = await api("/admin/solicitudes");
  const previous = state.trip?.id;
  if (result.viaje) state.trip = result.viaje;
  // A finished trip keeps refreshing until the driver registers the payment.
  else if (state.trip && (!terminal(state.trip) || (state.trip.estado === "finalizado" && state.trip.pago === "pendiente")))
    state.trip = await api("/viajes/" + state.trip.id);
  if (state.trip?.id !== previous) {
    state.selectedOffer = null;
    state.counterOpen = false;
  }
  await loadChat().catch(() => {});
  render();
}
function refresh() {
  if (lastPoll) return lastPoll;
  const promise = refreshData();
  lastPoll = promise;
  promise
    .finally(() => {
      if (lastPoll === promise) lastPoll = null;
    })
    .catch(() => {});
  return promise;
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!state.user || document.hidden) return;
  pollTimer = setTimeout(async () => {
    try {
      if (!state.busy) await refresh();
    } catch (e) {
      if (e.status !== 401) setOnline(false);
    } finally {
      schedulePoll();
    }
  }, 5000);
}
async function mutate(path, body = {}) {
  if (state.busy)
    throw new Error("Hay una acción en curso. Espera un momento.");
  if (!state.online)
    throw new HttpError(
      "Sin conexión. Recupera el servicio antes de guardar los cambios.",
      0,
      "RED",
    );
  state.busy = true;
  setOnline(state.online);
  let key = "";
  if (path.startsWith("/viajes")) {
    const fingerprint = JSON.stringify([state.user.id, path, body]);
    const storageKey = "sicuani:retry";
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey));
    } catch {}
    key = saved?.fingerprint === fingerprint ? saved.id : crypto.randomUUID();
    body = { ...body, peticion_id: key };
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ fingerprint, id: key }),
      );
    } catch {}
  }
  try {
    if (lastPoll) await lastPoll.catch(() => {});
    const value = await api(path, { method: "POST", body });
    if (key) forgetRetry();
    if (path === "/disponibilidad") state.user = value;
    else state.trip = value;
    await refresh();
    return value;
  } catch (e) {
    if (key && e.status && e.status !== 503) forgetRetry();
    notice(e.message, true);
    if (e.status === 409) {
      await refresh().catch(() => {});
    }
    throw e;
  } finally {
    state.busy = false;
    setOnline(state.online);
    schedulePoll();
  }
}
function forgetRetry() {
  try {
    sessionStorage.removeItem("sicuani:retry");
  } catch {
    /* Storage is optional. */
  }
}
async function loadChat() {
  const j = state.trip;
  if (!j || !state.user || state.user.rol === "administrador" || !["confirmado", "en_curso", "finalizado"].includes(j.estado)) return;
  if (state.chat.tripId !== j.id) state.chat = { tripId: j.id, messages: [], open: false, outbox: [] };
  // A finished trip only needs its history when the chat is on screen.
  if (j.estado === "finalizado" && state.view !== "chat" && state.chat.messages.length) return;
  if (chatLoad) return chatLoad;
  const last = state.chat.messages[state.chat.messages.length - 1]?.id;
  const promise = api(`/viajes/${j.id}/chat${last ? `?desde=${encodeURIComponent(last)}` : ""}`)
    .then((result) => {
      if (state.chat.tripId !== j.id) return;
      const known = new Set(state.chat.messages.map((m) => m.id));
      state.chat.messages.push(...result.mensajes.filter((m) => !known.has(m.id)));
      state.chat.open = result.abierto;
    })
    .finally(() => {
      if (chatLoad === promise) chatLoad = null;
    });
  chatLoad = promise;
  return promise;
}
function markChatSeen() {
  const last = state.chat.messages[state.chat.messages.length - 1];
  if (last && state.chat.tripId) storageSet(seenKey(state.chat.tripId), last.id);
}
function scheduleChatPoll() {
  clearTimeout(chatTimer);
  if (state.view !== "chat" || document.hidden || !state.user) return;
  chatTimer = setTimeout(async () => {
    try {
      await loadChat();
      render();
    } catch {
      /* The regular poll reports connection problems. */
    } finally {
      scheduleChatPoll();
    }
  }, 3000);
}
async function sendChat(text, retry = null) {
  const j = state.trip;
  if (!j) return;
  const item = retry || { local: crypto.randomUUID(), texto: text, estado: "enviando", nonce: crypto.randomUUID() };
  item.estado = "enviando";
  if (!retry) state.chat.outbox.push(item);
  render(true);
  try {
    await api(`/viajes/${j.id}/chat`, { method: "POST", body: { texto: item.texto, peticion_id: item.nonce } });
    if (chatLoad) await chatLoad.catch(() => {});
    await loadChat();
    state.chat.outbox = state.chat.outbox.filter((m) => m !== item);
  } catch (e) {
    item.estado = "error";
    if (e.code === "CHAT_CERRADO") state.chat.open = false;
    notice(e.message, true);
  }
  render(true);
}
const skipRatingKey = (tripId) => `sicuani:calificar-luego:${state.user?.id}:${tripId}`;
function maybePromptRating() {
  const j = state.trip;
  if (!j || state.user?.rol !== "pasajero" || state.view !== "home" || j.estado !== "finalizado" || j.calificacion) return;
  if (state.ratingPrompted.has(j.id) || storageGet(skipRatingKey(j.id))) return;
  if ($("#action-dialog").open || $("#rating-dialog").open) return;
  state.ratingPrompted.add(j.id);
  openRating(j);
  hydrateIcons();
}
function paintRating() {
  const form = $("#rating-form");
  const comment = $("#rating-comment", form);
  if (comment) state.rating.comment = comment.value;
  $("#rating-content").innerHTML = ratingContent();
  hydrateIcons();
}
function closeMap() {
  if (!state.mapOpen) return;
  state.mapOpen = false;
  if (!state.trip) state.selecting = null;
  render(true);
  updateSelection();
}
function closeDialog() {
  $("#action-dialog").close();
  dialogAction = null;
}
function openReason(type, id) {
  dialogAction = { type, id };
  $("#dialog-title").textContent =
    type === "cancelar" ? (state.user?.rol === "conductor" && state.trip?.version === 2 && ["reservado", "ofertado"].includes(state.trip.estado) ? "Retirar propuesta" : "Cancelar viaje") : "Reportar incidencia";
  $("#dialog-submit").textContent =
    type === "cancelar" ? "Cancelar viaje" : "Registrar incidencia";
  const options =
    type === "cancelar"
      ? ["cambio_de_planes", "error_de_puntos", "no_disponible", "otro"]
      : ["punto_acordado", "problema_durante_viaje", "otro"];
  $("#dialog-content").innerHTML =
    `<div class="form-grid"><div class="field"><label for="motivo">Motivo</label><select id="motivo" name="motivo" required><option value="">Selecciona un motivo</option>${options.map((r) => `<option value="${r}">${reasons[r]}</option>`).join("")}</select></div><div class="field"><label for="comentario">Comentario${type === "cancelar" ? " (obligatorio si eliges Otro)" : ""}</label><textarea id="comentario" name="comentario" maxlength="500" ${type !== "cancelar" ? 'required minlength="3"' : ""}></textarea></div></div>`;
  $("#dialog-error").hidden = true;
  $("#action-dialog").showModal();
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  try {
    if (b.dataset.selectOffer) {
      state.selectedOffer = b.dataset.selectOffer;
      render(true);
      $(`[data-select-offer="${CSS.escape(b.dataset.selectOffer)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (b.id === "toggle-counter") {
      state.counterOpen = !state.counterOpen;
      render(true);
      if (state.counterOpen) $("#counter-panel input")?.focus();
      return;
    }
    if (b.id === "back" && state.mapOpen && !state.trip) {
      closeMap();
      return;
    }
    if (b.id === "show-map" || (b.id === "back" && state.mapOpen)) {
      state.mapOpen = b.id === "show-map" ? !state.mapOpen : false;
      render(true);
      requestAnimationFrame(() => {
        map?.invalidateSize({ pan: false });
        fitVisibleRoute();
      });
      return;
    }
    if (b.id === "back") {
      state.view = "home";
      clearTimeout(chatTimer);
      render(true);
      await refresh();
      return;
    }
    if (b.hasAttribute("data-open-chat")) {
      state.view = "chat";
      render(true);
      await loadChat();
      render(true);
      scheduleChatPoll();
      $("#chat-input")?.focus({ preventScroll: true });
      return;
    }
    if (b.dataset.quickReply) {
      await sendChat(b.dataset.quickReply);
      return;
    }
    if (b.dataset.chatRetry) {
      const item = state.chat.outbox.find((m) => m.local === b.dataset.chatRetry);
      if (item) await sendChat(item.texto, item);
      return;
    }
    if (b.dataset.rate) {
      openRating(state.trip);
      hydrateIcons();
      return;
    }
    if (b.id === "rating-skip") {
      storageSet(skipRatingKey(state.rating.tripId), "1");
      $("#rating-dialog").close();
      return;
    }
    if (b.dataset.role) {
      state.authRole = b.dataset.role;
      state.authStep = 1;
      render(true);
      $(`[data-role="${b.dataset.role}"]`)?.focus();
      return;
    }
    if (b.id === "auth-step-back") {
      state.authStep = 1;
      render(true);
      $("#nombre")?.focus();
      return;
    }
    if (b.id === "use-other-account" || b.id === "switch-auth-foot") {
      state.auth = "login";
      state.pendingAccount = null;
      state.suggestedUsername = "";
      state.registrationMessage = "";
      render(true);
      return;
    }
    if (b.dataset.quickDelta) {
      const targetId = b.dataset.targetInput;
      const input = targetId ? document.getElementById(targetId) : null;
      if (input) {
        const entered = input.value.trim();
        const base = entered !== "" && Number.isFinite(Number(entered))
          ? Number(entered)
          : Number(b.dataset.basePrice) / 100;
        const delta = Number(b.dataset.quickDelta) || 0;
        const nextVal = Math.min(1000, Math.max(1, base + delta));
        input.value = nextVal.toFixed(2);
        input.focus();
        const details = b.closest("details");
        if (details && !details.open) details.open = true;
      }
      return;
    }
    if (b.dataset.togglePassword || b.classList.contains("password-toggle")) {
      const targetId = b.dataset.togglePassword;
      const input = targetId ? document.getElementById(targetId) : b.closest(".password-wrap")?.querySelector("input");
      if (input) {
        const isPass = input.type === "password";
        input.type = isPass ? "text" : "password";
        b.setAttribute("aria-label", isPass ? "Ocultar contraseña" : "Mostrar contraseña");
        b.setAttribute("aria-pressed", String(isPass));
        b.innerHTML = icon(isPass ? "EyeSlashIcon" : "EyeIcon");
        hydrateIcons();
      }
      return;
    }
    if (b.id === "switch-auth") {
      state.auth = state.auth === "login" ? "register" : "login";
      state.authStep = 1;
      state.pendingAccount = null;
      state.registrationMessage = "";
      state.suggestedUsername = "";
      render();
    }
    if (b.id === "retry-connection") {
      const session = await api("/sesion");
      state.csrf = session.csrf;
      state.user = session.usuario;
      if (state.user) await refresh();
      else setOnline(true);
      notice("Conexión recuperada");
    }
    if (b.dataset.view) {
      state.view = b.dataset.view;
      if (state.view !== "chat") clearTimeout(chatTimer);
      if (state.view === "history")
        state.history = await api("/viajes/historial");
      if (state.view === "home") await refresh();
      if (state.view === "practice") state.practice = await api("/practica");
      render(true);
    }
    if (b.id === "logout") {
      await api("/logout", { method: "POST", body: {} });
      location.href = "/";
    }
    if (b.dataset.point) {
      state.selecting = b.dataset.point;
      updateSelection();
      if (innerWidth <= 800) {
        state.mapOpen = true;
        render(true);
        requestAnimationFrame(() => {
          map?.invalidateSize({ pan: false });
          const point = state.points[state.selecting];
          if (point) map?.setView([point.lat, point.lng], 16, { animate: false });
        });
      }
      $("#map").focus({ preventScroll: true });
    }
    if (b.id === "gps") {
      if (!navigator.geolocation) {
        notice(
          "Tu navegador no admite ubicación. Marca el origen en el mapa.",
          true,
        );
        return;
      }
      b.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPoint("origen", pos.coords.latitude, pos.coords.longitude);
          state.selecting = "origen";
          map?.setView([pos.coords.latitude, pos.coords.longitude], 16, {
            animate: false,
          });
          notice("Buscando la dirección de recogida");
          b.disabled = false;
        },
        () => {
          notice(
            "No pudimos acceder a tu ubicación. Marca el origen en el mapa.",
            true,
          );
          b.disabled = false;
        },
        { timeout: 10000, maximumAge: 30000 },
      );
    }
    if (b.dataset.action) {
      const body = b.dataset.action.includes("oferta")
        ? { oferta_id: b.dataset.offerId || state.trip.oferta.id }
        : {};
      await mutate(`/viajes/${b.dataset.id}/${b.dataset.action}`, body);
      if (b.dataset.action.includes("oferta")) {
        state.counterOpen = false;
        state.selectedOffer = null;
        render(true);
      }
    }
    if (b.dataset.dialog) openReason(b.dataset.dialog, b.dataset.id);
    if (b.dataset.pay) {
      await mutate(`/viajes/${b.dataset.id}/registrar-pago`, {
        metodo: b.dataset.pay,
      });
      if (state.view === "history") {
        state.history = await api("/viajes/historial");
        render(true);
      }
      notice("Pago simulado registrado");
    }
    if (b.id === "new-trip") {
      if (state.trip && state.user.rol === "pasajero") {
        state.points = {
          origen: state.trip.origen,
          destino: state.trip.destino,
        };
        saveDraft();
      }
      state.trip = null;
      state.selecting = null;
      render(true);
      await refresh();
    }
    if (b.id === "close-dialog") closeDialog();
    if (b.dataset.practice) {
      state.practice = await api("/practica", {
        method: "POST",
        body: { accion: b.dataset.practice },
      });
      render(true);
    }
  } catch (e) {
    if (!b.dataset.action && !b.dataset.pay) notice(e.message, true);
  }
});
document.addEventListener("focusin", (e) => {
  if (
    ["origen", "destino"].includes(e.target.id) &&
    state.user?.rol === "pasajero" &&
    !state.trip
  ) {
    state.selecting = e.target.id;
    updateSelection();
    schedulePlaceSearch(e.target);
  }
});
document.addEventListener("input", (e) => {
  if (["origen", "destino"].includes(e.target.id)) {
    const k = e.target.id;
    schedulePlaceSearch(e.target);
    if (state.points[k]) {
      state.points[k].resolviendo = false;
      state.points[k].nombre = e.target.value;
      saveDraft();
      const tooltip = markers[k]?.getTooltip();
      if (tooltip) {
        const label = document.createElement("span");
        label.textContent = e.target.value;
        tooltip.setContent(label);
      }
      updateSelection();
    }
  }
});

document.addEventListener("focusout", (e) => {
  if (e.target.id === placeSearch?.key) closePlaceSearch();
});
document.addEventListener("pointerdown", (e) => {
  const option = e.target.closest("[data-place-index]");
  if (option && placeSearch) {
    e.preventDefault();
  }
});
document.addEventListener("click", (e) => {
  const option = e.target.closest("[data-place-index]");
  if (option && placeSearch) choosePlace(Number(option.dataset.placeIndex));
});
document.addEventListener("keydown", (e) => {
  const search = placeSearch;
  if (!search || e.target.id !== search.key) return;
  if (e.key === "Escape") { e.preventDefault(); closePlaceSearch(); return; }
  if (e.key === "Enter" && search.items.length) {
    e.preventDefault();
    choosePlace(search.active < 0 ? 0 : search.active);
  }
  if (["ArrowDown", "ArrowUp"].includes(e.key) && search.items.length) {
    e.preventDefault();
    search.active = (search.active + (e.key === "ArrowDown" ? 1 : search.active < 0 ? 0 : -1) + search.items.length) % search.items.length;
    paintPlaceSearch(search, `${search.items.length} ${search.items.length === 1 ? "sugerencia disponible" : "sugerencias disponibles"}`);
    $(`#${search.key}-suggestion-${search.active}`)?.scrollIntoView({ block: "nearest" });
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.name === "metodo" && e.target.closest("#pay-form")) {
    state.payMethod = e.target.value;
    $("#pay-method-name").textContent = methodName(e.target.value);
  }
  if (e.target.closest("#rating-form")) {
    const form = $("#rating-form");
    if (e.target.name === "estrellas") {
      const stars = Number(e.target.value);
      const group = stars >= 4 ? goodTags : badTags;
      state.rating.stars = stars;
      state.rating.tags = state.rating.tags.filter((t) => group.includes(t));
      paintRating();
      $(`#rating-form input[name="estrellas"][value="${stars}"]`)?.focus();
    }
    if (e.target.name === "etiquetas")
      state.rating.tags = new FormData(form).getAll("etiquetas");
  }
  if (e.target.id === "available") {
    try {
      await mutate("/disponibilidad", { disponible: e.target.checked });
    } catch {
      e.target.checked = state.user.disponible === "1";
    }
  }
  if (e.target.id === "motivo")
    $("#comentario").required =
      dialogAction?.type !== "cancelar" || e.target.value === "otro";
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const submit = $('button[type="submit"]', form);
  try {
    if (form.classList.contains("review-form")) {
      const decision = e.submitter?.value;
      const reason = data.motivo.trim();
      if (decision === "rechazar" && reason.length < 3) throw new Error("Escribe un motivo de al menos 3 caracteres.");
      e.submitter.disabled = true;
      await api(`/admin/solicitudes/${encodeURIComponent(form.dataset.id)}/${decision}`, { method: "POST", body: { motivo: reason } });
      await refresh();
      notice(decision === "aprobar" ? "Chofer aprobado." : "Solicitud rechazada.");
      return;
    }
    if (form.id === "auth-form" || form.id === "status-form") {
      const login = state.auth !== "register";
      if (login && (!String(data.usuario || "").trim() || !data.password))
        throw new Error("Escribe tu usuario y tu contraseña.");
      if (!login && state.authRole === "conductor" && state.authStep === 1) {
        state.authStep = 2;
        render(true);
        $("#placa")?.focus();
        return;
      }
      submit.disabled = true;
      let result;
      try {
        result = await api(login ? "/login" : "/registro", { method: "POST", body: data });
      } catch (err) {
        if (login && ["PENDIENTE_APROBACION", "RECHAZADO"].includes(err.code)) {
          const rejected = err.code === "RECHAZADO";
          state.pendingAccount = { ...(state.pendingAccount || {}), estado: rejected ? "rechazado" : "pendiente", motivo: rejected ? err.message.split("Motivo:").slice(1).join("Motivo:").trim() : "", usuario: data.usuario };
          const again = state.auth === "pending";
          state.auth = "pending";
          render(true);
          if (again) notice(rejected ? "Tu solicitud sigue rechazada." : "Tu cuenta sigue en revisión.");
          return;
        }
        throw err;
      }
      if (result.pendiente_aprobacion) {
        state.csrf = result.csrf;
        state.user = null;
        state.auth = "pending";
        state.authStep = 1;
        state.pendingAccount = { estado: "pendiente", nombre: result.cuenta.nombre, usuario: result.cuenta.usuario };
        state.suggestedUsername = result.cuenta.usuario;
        render(true);
        return;
      }
      state.auth = "login";
      state.authRole = "pasajero";
      state.authStep = 1;
      state.pendingAccount = null;
      state.user = result.usuario;
      state.csrf = result.csrf;
      state.registrationMessage = "";
      state.suggestedUsername = "";
      state.view = "home";
      state.trip = null;
      state.pending = [];
      state.history = [];
      state.practice = null;
      restoreDraft();
      state.signature = "";
      await refresh();
      render();
      schedulePoll();
    }
    if (form.id === "trip-form") {
      for (const k of ["origen", "destino"]) {
        if (!state.points[k])
          throw new Error(
            `Marca ${k === "origen" ? "el origen" : "el destino"} en el mapa.`,
          );
        state.points[k].nombre = data[k].trim();
      }
      saveDraft();
      await mutate("/viajes", state.points);
    }
    if (form.id === "price-form")
      await mutate(`/viajes/${state.trip.id}/ofertar`, {
        importe: Math.round(Number(data.importe) * 100),
      });
    if (form.id === "counteroffer-form" || form.classList.contains("offer-counteroffer"))
      await mutate(`/viajes/${state.trip.id}/contraofertar`, {
        importe: Math.round(Number(data.importe) * 100),
        oferta_id: form.dataset.offerId || state.trip.oferta.id,
      });
    if (form.id === "pay-form") {
      await mutate(`/viajes/${state.trip.id}/registrar-pago`, { metodo: data.metodo });
      notice("Pago simulado registrado");
    }
    if (form.id === "chat-form") {
      const text = String(data.texto || "").trim();
      if (!text) return;
      $("#chat-input").value = "";
      await sendChat(text);
      $("#chat-input")?.focus({ preventScroll: true });
    }
    if (form.id === "rating-form") {
      const values = new FormData(form);
      submit.disabled = true;
      await mutate(`/viajes/${state.rating.tripId}/calificar`, {
        estrellas: Number(values.get("estrellas")),
        etiquetas: values.getAll("etiquetas"),
        comentario: String(values.get("comentario") || "").trim(),
      });
      $("#rating-dialog").close();
      notice("¡Gracias por tu calificación!");
    }
    if (form.id === "dialog-form") {
      submit.disabled = true;
      await mutate(
        `/viajes/${dialogAction.id}/${dialogAction.type === "cancelar" ? "cancelar" : "registrar-incidencia"}`,
        data,
      );
      closeDialog();
      notice("Estado del viaje actualizado");
    }
    if (form.id === "ack-form") {
      state.practice = await api("/practica", {
        method: "POST",
        body: {
          accion: "confirmar",
          ids: data.ids
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      render(true);
    }
  } catch (err) {
    const error = $("#form-error", form) || $("#dialog-error", form) || $("#rating-error", form) || $(".error-text", form);
    if (error) {
      error.textContent = err.message;
      error.hidden = false;
    } else notice(err.message, true);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
    if (e.submitter?.isConnected) e.submitter.disabled = false;
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(pollTimer);
  } else if (state.user) {
    refresh()
      .catch(() => {})
      .finally(schedulePoll);
    scheduleChatPoll();
  }
});
window.addEventListener("online", () => {
  refresh()
    .catch(() => {})
    .finally(schedulePoll);
});
window.addEventListener("offline", () => setOnline(false));
window.addEventListener("focus", () => {
  if (state.user && !state.busy)
    refresh()
      .catch(() => {})
      .finally(schedulePoll);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    state.selecting = null;
    updateSelection();
  }
});
$("#action-dialog").addEventListener("cancel", () => (dialogAction = null));
setInterval(tick, 1000);
window.rideSheet = window.createRideSheet?.({ onLayout: (mobile, settled) => {
  map?.invalidateSize({ pan: false });
  if (mobile && settled && !state.selecting) fitVisibleRoute();
} });
(async () => {
  try {
    const [session, icons] = await Promise.all([
      api("/sesion"),
      fetch("/assets/icons.json").then((r) => r.json()),
    ]);
    state.icons = icons;
    state.csrf = session.csrf;
    state.user = session.usuario;
    state.tileUrl = session.teselas;
    state.offset = session.servidor - Date.now() / 1000;
    initMap();
    if (state.user) {
      restoreDraft();
      await refresh();
    }
    render();
    schedulePoll();
  } catch (e) {
    render(true);
    notice(e.message, true);
  }
})();
