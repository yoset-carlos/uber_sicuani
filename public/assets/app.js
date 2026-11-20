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
  j && ["finalizado", "cancelado", "sin_conductor"].includes(j.estado);
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
};
let map,
  tiles,
  markers = {},
  line,
  pollTimer,
  noticeTimer,
  dialogAction,
  lastPoll;
let renderedMode = "";
let addressQueue = Promise.resolve();
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
      if ($("#action-dialog").open) closeDialog();
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
function updateMap({ fit = true } = {}) {
  if (!map) return;
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
      { color: "#181c19", weight: 4, dashArray: "7 7" },
    ).addTo(map);
    if (fit)
      map.fitBounds(line.getBounds(), {
        padding: [65, 65],
        maxZoom: 16,
        animate: false,
      });
  } else if (fit && points.origen)
    map.setView([points.origen.lat, points.origen.lng], 16, { animate: false });
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
function heading(eyebrow, title, subtitle = "") {
  return `<div class="panel-heading"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}</div>`;
}
function field(name, label, type = "text", attrs = "") {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${attrs}></div>`;
}
function route(j) {
  return `<div class="route-summary">${["origen", "destino"].map((k) => `<div class="route-stop"><span class="route-symbol ${k === "destino" ? "destination" : ""}" aria-hidden="true"></span><div><small>${k === "origen" ? "Recogida" : "Destino"}</small><p>${esc(j[k].nombre)}</p></div></div>`).join("")}</div>`;
}
function authView() {
  const register = state.auth === "register";
  return (
    heading(
      "Muévete por Sicuani",
      register ? "Empieza tu próximo viaje" : "Qué bueno verte por aquí",
      register
        ? "Elige si quieres viajar o conducir."
        : "Inicia sesión para viajar o conducir.",
    ) +
    `${state.registrationMessage ? `<div class="info-well" role="status"><p>${esc(state.registrationMessage)}</p></div>` : ""}<form id="auth-form" class="auth-form form-grid">${register ? `<div class="field"><label for="registration-role">Tipo de cuenta</label><select id="registration-role" name="rol" required><option value="pasajero">Pasajero — quiero viajar</option><option value="conductor">Chofer — quiero conducir</option></select></div>` + field("nombre", "Nombre completo", "text", 'required minlength="2" maxlength="80" autocomplete="name"') + field("telefono", "Celular", "tel", 'required inputmode="tel" placeholder="987 654 321" autocomplete="tel"') : ""}${field("usuario", "Usuario", "text", `required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(state.suggestedUsername)}"`)}${field("password", "Contraseña", "password", `required ${register ? 'minlength="8" maxlength="72" ' : ""}autocomplete="${register ? "new-password" : "current-password"}"`)}${register ? `<fieldset id="vehicle-fields" class="vehicle-fields form-grid" hidden disabled><legend>Datos de tu vehículo</legend><p class="hint">Tu cuenta de chofer quedará pendiente de aprobación manual.</p>${field("placa", "Placa", "text", 'required maxlength="60" autocomplete="off"')}${field("color", "Color", "text", 'required maxlength="60" autocomplete="off"')}${field("marca", "Marca", "text", 'required maxlength="60" autocomplete="off"')}${field("modelo", "Modelo", "text", 'required maxlength="60" autocomplete="off"')}</fieldset>` : ""}<p id="form-error" class="error-text" role="alert" hidden></p><button type="submit" class="primary">${register ? "Crear cuenta" : "Iniciar sesión"}</button></form><div class="auth-switch"><p class="small">${register ? "¿Ya tienes una cuenta?" : "¿Es tu primer viaje?"}</p><button type="button" class="secondary full" id="switch-auth">${register ? "Iniciar sesión" : "Crear una cuenta"}</button></div><p class="auth-note">Viajes de práctica. Los pagos en efectivo y Yape son simulados.</p>`
  );
}
function newTripView() {
  return (
    heading(
      `Hola, ${esc(state.user.nombre.split(" ")[0])}`,
      "¿A dónde vamos?",
      "Elige tus puntos y encuentra un conductor.",
    ) +
    `<form id="trip-form" class="form-grid"><div class="route-fields">${["origen", "destino"].map((k) => `<div class="route-field"><span class="route-symbol ${k === "destino" ? "destination" : ""}" aria-hidden="true"></span><div class="grow"><label for="${k}">${k === "origen" ? "Punto de recogida" : "Tu destino"}</label><input id="${k}" name="${k}" required minlength="2" maxlength="120" placeholder="${k === "origen" ? "¿Dónde te recogemos?" : "¿A dónde quieres ir?"}" value="${esc(state.points[k]?.nombre)}" autocomplete="off"><p class="point-status" id="${k}-status"></p></div><button class="point-button" type="button" data-point="${k}" aria-label="Marcar ${k} en el mapa" aria-pressed="false">${icon("MapPinIcon")}</button></div>`).join("")}</div><div class="selection-help"><button type="button" class="secondary compact" id="gps">${icon("MapPinIcon")} Usar mi ubicación</button><p class="hint">Selecciona Recogida o Destino y toca el mapa. Puedes volver a tocar para cambiar el punto o arrastrar su marcador. La dirección se completa automáticamente y puedes editarla.</p></div><div class="payment-row">${icon("BanknotesIcon")}<div class="grow"><strong>Efectivo o Yape</strong><p class="muted small">Pago simulado al finalizar</p></div></div><p id="form-error" class="error-text" role="alert" hidden></p><button class="primary" type="submit" data-change>Solicitar viaje</button></form><p class="auth-note">El conductor propone el precio. Tú decides si lo aceptas.</p>`
  );
}
function driverHome() {
  return (
    heading(
      "Conduce por Sicuani",
      "Tu próxima oportunidad",
      "Activa tu disponibilidad para ver las solicitudes.",
    ) +
    `<div class="availability"><label for="available"><input id="available" name="disponible" type="checkbox" ${state.user.disponible === "1" ? "checked" : ""}><span>${state.user.disponible === "1" ? "Disponible" : "No disponible"}</span></label>${icon("TruckIcon")}</div><div class="row between small"><h2>Solicitudes</h2><p class="muted number">${state.pending.length} disponibles</p></div><div>${state.pending.length ? state.pending.map((j) => `<article class="request-card">${route(j)}<div class="row between"><p class="small muted">Búsqueda <span class="countdown" data-deadline="${j.busqueda_hasta}"></span></p></div><button type="button" class="secondary" data-action="reservar" data-id="${j.id}" data-change>Reservar solicitud</button></article>`).join("") : `<div class="empty-state"><h3>${state.user.disponible === "1" ? "Por ahora no hay solicitudes" : "Estás fuera de servicio"}</h3><p class="muted">${state.user.disponible === "1" ? "Las nuevas solicitudes aparecerán aquí automáticamente." : "Activa Disponible cuando quieras recibir viajes."}</p></div>`}</div><div class="info-well"><h3>Un viaje a la vez</h3><p>Al reservar tendrás un minuto para proponer tu precio.</p></div>`
  );
}
function tripView(j) {
  const driver = state.user.rol === "conductor";
  const myOffer = (j.oferta?.autor || j.conductor) === state.user.id;
  const stateName = labels[j.estado];
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
    html += `<div class="info-well"><h3>Estamos buscando un conductor</h3><p>Recibirás su propuesta de precio aquí. Puedes esperar hasta 10 minutos.</p></div>`;
  if (j.estado === "reservado")
    html += driver
      ? `<form id="price-form" class="form-grid">${field("importe", "Tu precio en soles", "number", 'required min="1" max="1000" step="0.01" placeholder="S/ 0.00" inputmode="decimal"')}<button type="submit" class="primary" data-change>Enviar propuesta</button></form>`
      : `<div class="info-well"><h3>Un conductor reservó tu solicitud</h3><p>Está preparando una propuesta. Te mostraremos el vehículo y el precio cuando la envíe.</p></div>`;
  if (j.estado === "ofertado")
    html += myOffer
      ? `<p class="muted">Esperando la respuesta ${driver ? "del pasajero" : "del conductor"}. La negociación termina cuando se agote el tiempo.</p>`
      : `<div class="stack tight trip-actions"><button type="button" class="primary" data-action="aceptar-oferta" data-id="${j.id}" data-change>Aceptar por ${money(j.oferta.importe)}</button><form id="counteroffer-form" class="form-grid">${field("importe", "Tu contraoferta en soles", "number", 'required min="1" max="1000" step="0.01" placeholder="S/ 0.00" inputmode="decimal"')}<p id="form-error" class="error-text" role="alert" hidden></p><button type="submit" class="secondary" data-change>Enviar contraoferta</button></form><button type="button" class="secondary" data-action="rechazar-oferta" data-id="${j.id}" data-change>Rechazar propuesta</button></div>`;
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
    html += `<button type="button" class="text-button" data-dialog="cancelar" data-id="${j.id}" data-change>Cancelar viaje</button>`;
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
function paymentView(j, driver) {
  return `<div class="payment-row">${icon("BanknotesIcon")}<div class="grow"><strong>${j.pago === "pendiente" ? "Pago pendiente" : `${j.pago === "yape" ? "Yape" : "Efectivo"} recibido`}</strong><p class="small muted">${money(j.precio)} · Simulación</p></div></div>${driver && j.pago === "pendiente" ? `<div class="row"><button type="button" class="secondary grow" data-pay="efectivo" data-id="${j.id}" data-change>Efectivo recibido</button><button type="button" class="secondary grow" data-pay="yape" data-id="${j.id}" data-change>Yape recibido</button></div><p class="hint">Registra el método al simular la recepción. Puedes dejarlo pendiente y actualizarlo desde Actividad.</p>` : ""}`;
}
function historyView() {
  return (
    heading("Tus viajes", "Actividad", "Cada recorrido, en un solo lugar.") +
    (state.user.rol === "conductor"
      ? `<p class="small muted number">${state.finished} ${state.finished === 1 ? "viaje finalizado" : "viajes finalizados"}</p>`
      : "") +
    (!state.history.length
      ? `<div class="empty-state"><h3>Aún no tienes viajes</h3><p class="muted">Tu actividad aparecerá aquí cuando solicites o confirmes un viaje.</p><button type="button" class="secondary" data-view="home">${state.user.rol === "conductor" ? "Ver solicitudes" : "Solicitar un viaje"}</button></div>`
      : `<div>${state.history.map((j) => `<article class="history-item"><div class="row between"><p class="history-date">${date(j.creado)}</p><strong>${j.precio ? money(j.precio) : "Sin tarifa"}</strong></div>${route(j)}<p class="small muted">${esc(labels[j.estado])}${j.conductor_info ? ` · ${esc(j.conductor_info.nombre)}` : ""}</p>${j.estado === "finalizado" ? paymentView(j, state.user.rol === "conductor") : ""}</article>`).join("")}</div>`)
  );
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
    state.trip?.pago,
    state.trip?.incidencias?.length,
    state.pending.map((j) => j.id),
    state.reviews,
    state.history,
    state.practice,
  ]);
  if (!force && signature === state.signature) return;
  state.signature = signature;
  const logged = !!state.user;
  $("#navigation").hidden = !logged;
  $("#menu-toggle").hidden = !logged;
  $("#account-name").textContent = state.user?.nombre || "";
  $("#account-role").textContent =
    state.user?.rol === "administrador" ? "Administrador" : state.user?.rol === "conductor" ? "Conductor" : "Pasajero";
  $('#navigation button[data-view="history"]').hidden = state.user?.rol === "administrador";
  document.querySelectorAll("[data-view]").forEach((b) => {
    if (b.dataset.view === state.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $('#navigation button[data-view="home"]').textContent =
    state.user?.rol === "administrador" ? "Solicitudes" : state.user?.rol === "conductor" ? "Conducir" : "Viajar";
  if (logged && state.user.practica === "1" && !$("#practice-link")) {
    const b = document.createElement("button");
    b.id = "practice-link";
    b.type = "button";
    b.dataset.view = "practice";
    b.textContent = "Laboratorio Redis";
    $("#account-menu").append(b);
  } else if (!logged) $("#practice-link")?.remove();
  panel.innerHTML = !logged
    ? authView()
    : state.user.rol === "administrador"
      ? adminView()
    : state.view === "history"
      ? historyView()
      : state.view === "practice"
        ? practiceView()
        : state.trip
          ? tripView(state.trip)
          : state.user.rol === "pasajero"
            ? newTripView()
            : driverHome();
  const mode = `${state.user?.id}:${state.view}:${state.auth}:${state.trip?.id}:${state.trip?.estado}`;
  if (mode !== renderedMode) {
    renderedMode = mode;
    $("#panel").scrollTop = 0;
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
  if (result.viaje) state.trip = result.viaje;
  else if (state.trip && !terminal(state.trip))
    state.trip = await api("/viajes/" + state.trip.id);
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
function closeDialog() {
  $("#action-dialog").close();
  dialogAction = null;
}
function openReason(type, id) {
  dialogAction = { type, id };
  $("#dialog-title").textContent =
    type === "cancelar" ? "Cancelar viaje" : "Reportar incidencia";
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
    if (b.id === "switch-auth") {
      state.auth = state.auth === "login" ? "register" : "login";
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
      $("#account-menu").hidden = true;
      $("#menu-toggle").setAttribute("aria-expanded", "false");
      if (state.view === "history")
        state.history = await api("/viajes/historial");
      if (state.view === "home") await refresh();
      if (state.view === "practice") state.practice = await api("/practica");
      render(true);
    }
    if (b.id === "menu-toggle") {
      const open = $("#account-menu").hidden;
      $("#account-menu").hidden = !open;
      b.setAttribute("aria-expanded", String(open));
    }
    if (b.id === "logout") {
      await api("/logout", { method: "POST", body: {} });
      location.href = "/";
    }
    if (b.dataset.point) {
      state.selecting = b.dataset.point;
      updateSelection();
      if (innerWidth <= 800) $("#map").scrollIntoView({ block: "start" });
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
        ? { oferta_id: state.trip.oferta.id }
        : {};
      await mutate(`/viajes/${b.dataset.id}/${b.dataset.action}`, body);
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
  }
});
document.addEventListener("input", (e) => {
  if (["origen", "destino"].includes(e.target.id)) {
    const k = e.target.id;
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
document.addEventListener("change", async (e) => {
  if (e.target.id === "registration-role") {
    const vehicle = $("#vehicle-fields");
    const driver = e.target.value === "conductor";
    vehicle.hidden = !driver;
    vehicle.disabled = !driver;
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
    if (form.id === "auth-form") {
      submit.disabled = true;
      const result = await api(
        state.auth === "login" ? "/login" : "/registro",
        { method: "POST", body: data },
      );
      if (result.pendiente_aprobacion) {
        state.csrf = result.csrf;
        state.user = null;
        state.auth = "login";
        state.suggestedUsername = result.cuenta.usuario;
        state.registrationMessage =
          "Tu cuenta de chofer fue registrada. El responsable del proyecto debe aprobarla antes de que puedas conducir.";
        render(true);
        return;
      }
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
    if (form.id === "counteroffer-form")
      await mutate(`/viajes/${state.trip.id}/contraofertar`, {
        importe: Math.round(Number(data.importe) * 100),
        oferta_id: state.trip.oferta.id,
      });
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
    const error = $("#form-error", form) || $("#dialog-error", form);
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
    $("#account-menu").hidden = true;
    $("#menu-toggle").setAttribute("aria-expanded", "false");
    state.selecting = null;
    updateSelection();
  }
});
$("#action-dialog").addEventListener("cancel", () => (dialogAction = null));
setInterval(tick, 1000);
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
