import { spawn, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  REDIS_DATABASE: "15",
  REDIS_PREFIX: "sicuani-http-tests:" + randomUUID() + ":",
  PRACTICE_ENABLED: "1",
};
const fixtures = spawnSync("php", ["tests/fixtures.php"], {
  env,
  encoding: "utf8",
});
if (fixtures.status !== 0) throw new Error(fixtures.stderr || fixtures.stdout);
const { users, password } = JSON.parse(fixtures.stdout);
const server = spawn(
  "php",
  ["-S", "127.0.0.1:8082", "-t", "public", "public/router.php"],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLogs = "";
server.stderr.on("data", (s) => (serverLogs += s));
server.stdout.on("data", (s) => (serverLogs += s));
const origin = "http://127.0.0.1:8082";
let count = 0;
function check(v, name) {
  assert.ok(v, name);
  console.log("PASS: " + name);
  count++;
}
class Browser {
  cookies = new Map();
  csrf = "";
  async request(path, body, token = true) {
    const headers = {
      Accept: "application/json",
      Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      if (token) headers["X-CSRF-Token"] = this.csrf;
    }
    const r = await fetch(origin + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const [kv] = cookie.split(";");
      const ix = kv.indexOf("=");
      this.cookies.set(kv.slice(0, ix), kv.slice(ix + 1));
    }
    const json = await r.json();
    if (json.datos?.csrf) this.csrf = json.datos.csrf;
    return { status: r.status, ...json };
  }
  async login(user) {
    await this.request("/sesion");
    const r = await this.request("/login", { usuario: user, password });
    assert.equal(r.status, 200);
    return r;
  }
}
const bodyNonce = (body) => ({ ...body, peticion_id: randomUUID() });
try {
  for (let n = 0; n < 40; n++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const page = await fetch(origin);
  const pageHtml = await page.text();
  check(
    page.status === 200 && pageHtml.includes("Uber Sicuani"),
    "Página principal sirve HTML",
  );
  check(page.headers.get("cache-control") === "no-cache", "HTML revalida la versión de la interfaz");
  for (const asset of ["app.js", "sheet.js", "app.css"]) {
    const bytes = readFileSync(new URL(`../public/assets/${asset}`, import.meta.url));
    const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const path = `/assets/${asset}?v=${version}`;
    check(pageHtml.includes(path), `${asset} usa una URL vinculada a su contenido actual`);
    check(Buffer.from(await (await fetch(origin + path)).arrayBuffer()).equals(bytes), `${asset} versionado sirve el contenido actualizado`);
  }
  for (const path of [
    "/.env",
    "/composer.json",
    "/src/bootstrap.php",
    "/storage/demo-credentials.json",
  ]) {
    const r = await fetch(origin + path);
    check(
      !(await r.text()).includes('"password"') &&
        r.headers.get("content-type")?.includes("text/html"),
      "Ruta privada no expone archivos: " + path,
    );
  }
  const p = new Browser(),
    d1 = new Browser(),
    d2 = new Browser(),
    s = new Browser(),
    lab = new Browser();
  const registration = new Browser();
  await registration.request("/sesion");
  const driverRegistration = {
    nombre: "Registro Chofer",
    telefono: "989321001",
    usuario: "registro_chofer",
    password,
    rol: "conductor",
    placa: "REG-123",
    color: "Blanco",
    marca: "Toyota",
    modelo: "Yaris",
  };
  check(
    (
      await registration.request("/registro", {
        ...driverRegistration,
        rol: "admin",
      })
    ).status === 422,
    "Registro rechaza roles distintos de pasajero/conductor",
  );
  check(
    (
      await registration.request("/registro", {
        ...driverRegistration,
        placa: "",
      })
    ).status === 422,
    "Registro de chofer exige datos del vehículo",
  );
  check(
    (
      await registration.request("/registro", {
        ...driverRegistration,
        placa: ["invalida"],
      })
    ).status === 422,
    "Datos del vehículo validan su tipo",
  );
  const signedUp = await registration.request("/registro", {
    ...driverRegistration,
    aprobado: "1",
    practica: true,
  });
  check(
    signedUp.status === 200 &&
      signedUp.datos.pendiente_aprobacion === true &&
      signedUp.datos.cuenta.aprobado === "0",
    "Chofer se registra pendiente sin poder autoaprobarse",
  );
  check(
    (await registration.request("/estado")).status === 401,
    "Registro pendiente no inicia una sesión de conductor",
  );
  const pendingLogin = await registration.request("/login", {
    usuario: driverRegistration.usuario,
    password,
  });
  check(
    pendingLogin.status === 403 &&
      pendingLogin.error.codigo === "PENDIENTE_APROBACION",
    "Chofer pendiente recibe explicación al intentar acceder",
  );
  const adminCreated = spawnSync("php", ["scripts/create-admin.php"], {
    env, encoding: "utf8", input: JSON.stringify({ nombre: "Administrador Prueba", usuario: "admin_test", telefono: "989321009", password }),
  });
  check(adminCreated.status === 0, "Se crea administrador por consola");
  const admin = new Browser();
  await admin.login("admin_test");
  check((await registration.request("/admin/solicitudes")).status === 401, "Sin sesión no se pueden consultar solicitudes");
  const list = await admin.request("/admin/solicitudes");
  const driverId = list.datos.find((u) => u.usuario === driverRegistration.usuario)?.id;
  check(list.status === 200 && !!driverId, "Administrador ve al chofer pendiente");
  check((await admin.request(`/admin/solicitudes/${driverId}/rechazar`, { motivo: "x" })).status === 422, "Rechazo exige motivo");
  check((await admin.request(`/admin/solicitudes/${driverId}/rechazar`, { motivo: "Revisar placa" })).status === 200, "Administrador rechaza con motivo");
  const rejected = await registration.request("/login", { usuario: driverRegistration.usuario, password });
  check(rejected.status === 403 && rejected.error.codigo === "RECHAZADO" && rejected.error.mensaje.includes("Revisar placa"), "Chofer rechazado ve el motivo");
  check((await admin.request("/admin/solicitudes")).datos.some((u) => u.id === driverId && u.revision_estado === "rechazado"), "Administrador puede revisar rechazo");
  const secondDriver = await registration.request("/registro", { ...driverRegistration, usuario: "otro_chofer", telefono: "989321008" });
  const secondId = secondDriver.datos.cuenta.id;
  check((await admin.request(`/admin/solicitudes/${secondId}/aprobar`, {})).status === 200, "Administrador aprueba desde la web");
  check((await admin.request(`/admin/solicitudes/${secondId}/aprobar`, {})).status === 409, "Decisión repetida no sobrescribe");
  check((await registration.request("/login", { usuario: "otro_chofer", password })).status === 200, "Chofer aprobado puede entrar");
  check((await registration.request("/admin/solicitudes")).status === 403, "Chofer no accede al panel administrativo");
  await registration.request("/logout", {});
  const approved = spawnSync(
    "php",
    ["scripts/approve-driver.php", driverRegistration.usuario],
    { env, encoding: "utf8" },
  );
  check(
    approved.status === 0,
    "Responsable aprueba por CLI una cuenta de chofer existente",
  );
  const driverLogin = await registration.login(driverRegistration.usuario);
  check(
    driverLogin.datos.usuario.rol === "conductor" &&
      driverLogin.datos.usuario.aprobado === "1",
    "Chofer aprobado entra por el acceso común",
  );
  check(
    (await registration.request("/practica")).status === 403,
    "Autorregistro no concede permisos de laboratorio",
  );
  const passengerRegistration = new Browser();
  await passengerRegistration.request("/sesion");
  const passengerData = {
    nombre: "Registro Pasajero",
    telefono: "989321002",
    usuario: "registro_pasajero",
    password,
    rol: "pasajero",
  };
  const passengerSignedUp = await passengerRegistration.request(
    "/registro",
    passengerData,
  );
  check(
    passengerSignedUp.status === 200 &&
      passengerSignedUp.datos.usuario.rol === "pasajero",
    "Pasajero se registra sin datos de vehículo y accede",
  );
  check((await passengerRegistration.request("/admin/solicitudes")).status === 403, "Pasajero no accede al panel administrativo");
  check((await admin.request(`/admin/solicitudes/${driverId}/aprobar`, {}, false)).status === 403, "Revisión requiere CSRF");
  check(
    (await passengerRegistration.request("/registro", passengerData)).status ===
      422,
    "Autorregistro mantiene unicidad de teléfono y usuario",
  );
  const wrongApproval = spawnSync(
    "php",
    ["scripts/approve-driver.php", passengerData.usuario],
    { env, encoding: "utf8" },
  );
  check(
    wrongApproval.status !== 0,
    "Herramienta de aprobación no convierte pasajeros en choferes",
  );
  check((await p.request("/estado")).status === 401, "API requiere sesión");
  await p.request("/sesion");
  check((await p.request("/mapa/buscar", { texto: "Sicuani" })).status === 401, "Búsqueda requiere sesión");
  check(
    (await p.request("/login", { usuario: "passenger", password }, false))
      .status === 403,
    "Login requiere CSRF",
  );
  await Promise.all([
    p.login("passenger"),
    d1.login("driver1"),
    d2.login("driver2"),
    s.login("second"),
    lab.login("lab"),
  ]);
  check((await p.request("/mapa/buscar", { texto: "Sicuani" }, false)).status === 403, "Búsqueda requiere CSRF");
  check((await d1.request("/mapa/buscar", { texto: "Sicuani" })).status === 403, "Conductor no puede buscar direcciones");
  check((await p.request("/mapa/buscar", { texto: ["Sicuani"] })).status === 422, "Búsqueda valida texto");
  check((await p.request("/mapa/buscar", { texto: "ab" })).status === 422, "Búsqueda requiere tres caracteres");
  check(
    (await p.request("/sesion")).datos.usuario.rol === "pasajero",
    "Sesión reconoce rol pasajero",
  );
  check(
    (await p.request("/viajes/pendientes")).status === 403,
    "Pasajero no consulta solicitudes de conductor",
  );
  check(
    (await d1.request("/disponibilidad", { disponible: false })).datos
      .disponible === "0",
    "Conductor puede desactivar disponibilidad",
  );
  check(
    (await d1.request("/disponibilidad", { disponible: true })).datos
      .disponible === "1",
    "Conductor puede activar disponibilidad",
  );
  check(
    (await p.request("/disponibilidad", { disponible: true })).status === 403,
    "Pasajero no modifica disponibilidad",
  );
  check(
    (await p.request("/viajes", { peticion_id: ["invalida"] })).status === 422,
    "Tipos inválidos producen JSON de validación",
  );
  const points = {
    origen: { nombre: "Plaza de Sicuani", lat: -14.2714, lng: -71.2292 },
    destino: { nombre: "Estadio", lat: -14.2755, lng: -71.2351 },
  };
  check(
    (
      await p.request(
        "/viajes",
        bodyNonce({ ...points, origen: { ...points.origen, lat: 200 } }),
      )
    ).status === 422,
    "API valida coordenadas",
  );
  const request = bodyNonce(points);
  let response = await p.request("/viajes", request);
  check(response.status === 200, "Pasajero crea viaje");
  const id = response.datos.id;
  check(
    (await p.request("/viajes", request)).datos.id === id,
    "HTTP reintento conserva viaje",
  );
  check(
    (await s.request("/viajes/" + id)).status === 403,
    "Otro pasajero no consulta viaje",
  );
  const visibleToBoth = await Promise.all([d1.request("/estado"), d2.request("/estado")]);
  check(
    visibleToBoth.every((result) => result.datos.pendientes.some((trip) => trip.id === id)),
    "La misma solicitud aparece en las dos sesiones de choferes disponibles",
  );
  check(
    (await d1.request("/estado")).datos.pendientes.some((trip) => trip.id === id) &&
      (await d2.request("/estado")).datos.pendientes.some((trip) => trip.id === id),
    "Consultar una solicitud no la consume ni la oculta al otro chofer",
  );
  await d2.request("/disponibilidad", { disponible: false });
  check(
    (await d2.request("/estado")).datos.pendientes.length === 0 &&
      (await d1.request("/estado")).datos.pendientes.some((trip) => trip.id === id),
    "Un chofer no disponible no recibe solicitudes; el disponible sí",
  );
  await d2.request("/disponibilidad", { disponible: true });
  check(
    (await d2.request("/estado")).datos.pendientes.some((trip) => trip.id === id),
    "Al activar disponibilidad, el segundo chofer recibe la solicitud pendiente",
  );
  const reserved = await Promise.all([
    d1.request(`/viajes/${id}/reservar`, bodyNonce({})),
    d2.request(`/viajes/${id}/reservar`, bodyNonce({})),
  ]);
  check(
    reserved.every((x) => x.status === 200),
    "Dos choferes pueden preparar propuestas simultáneamente",
  );
  const driver = d1;
  const otherDriver = d2;
  check(
    (await otherDriver.request("/estado")).datos.viaje.estado === "reservado",
    "El segundo chofer conserva su preparación independiente",
  );
  response = await driver.request(
    `/viajes/${id}/ofertar`,
    bodyNonce({ importe: 1050 }),
  );
  check(response.status === 200, "Conductor propone precio");
  const offer = response.datos.oferta.id;
  const secondOffer = await otherDriver.request(`/viajes/${id}/ofertar`, bodyNonce({ importe: 1250 }));
  check(secondOffer.status === 200, "El segundo chofer también puede proponer precio");
  const comparison = (await p.request("/estado")).datos.viaje;
  check(comparison.ofertas.length === 2 && !comparison.conductor, "Pasajero compara dos propuestas sin chofer asignado");
  check(!secondOffer.datos.ofertas && !secondOffer.datos.participaciones, "Cada chofer solo ve su propia propuesta");
  response = await p.request(`/viajes/${id}/contraofertar`, bodyNonce({ oferta_id: offer, importe: 900 }));
  const counterOffer = response.datos.ofertas.find((item) => item.importe === 900);
  check(response.status === 200 && counterOffer, "Pasajero negocia una propuesta sin reemplazar las demás");
  const counter = counterOffer.id;
  check(
    (
      await driver.request(
        `/viajes/${id}/aceptar-oferta`,
        bodyNonce({ oferta_id: counter }),
      )
    ).datos.precio === 900,
    "Conductor acepta la contraoferta por HTTP",
  );
  check(!(await otherDriver.request("/estado")).datos.viaje, "Aceptar libera al chofer no elegido");
  check((await otherDriver.request(`/viajes/${id}`)).datos.estado === "no_elegido", "El otro chofer recibe el cierre de su propuesta");
  check((await p.request(`/viajes/${id}/aceptar-oferta`, bodyNonce({ oferta_id: secondOffer.datos.oferta.id }))).status === 409, "No se pueden confirmar dos choferes");
  check(
    (await p.request(`/viajes/${id}/iniciar`, bodyNonce({}))).status === 403,
    "Pasajero no inicia viaje",
  );
  await driver.request(`/viajes/${id}/iniciar`, bodyNonce({}));
  check(
    (
      await p.request(
        `/viajes/${id}/registrar-incidencia`,
        bodyNonce({ motivo: "otro", comentario: "Prueba HTTP" }),
      )
    ).status === 200,
    "Incidencia se registra por HTTP",
  );
  response = await driver.request(`/viajes/${id}/finalizar`, bodyNonce({}));
  check(
    response.datos.estado === "finalizado" &&
      response.datos.pago === "pendiente",
    "Finalización con pago pendiente por HTTP",
  );
  check(
    (
      await driver.request(
        `/viajes/${id}/registrar-pago`,
        bodyNonce({ metodo: "efectivo" }),
      )
    ).datos.pago === "efectivo",
    "Pago simulado Efectivo por HTTP",
  );
  check(
    (await p.request("/viajes/historial")).datos.length === 1,
    "Historial HTTP conserva viaje",
  );
  check(
    (await p.request("/practica")).status === 403,
    "Laboratorio bloqueado para cuenta ordinaria",
  );
  check(
    (await lab.request("/practica", { accion: "crear-grupo" })).status === 200,
    "Laboratorio autorizado crea grupo",
  );
  await lab.request("/practica", { accion: "agregar" });
  check(
    (await lab.request("/practica", { accion: "leer" })).status === 200,
    "Laboratorio autorizado lee grupo",
  );
  check(
    (await lab.request("/practica", { accion: "arbitraria" })).status === 422,
    "Laboratorio restringe comandos permitidos",
  );
  await p.request("/logout", {});
  check(
    (await p.request("/estado")).status === 401,
    "Cerrar sesión revoca acceso",
  );
  console.log(
    `\n${count} verificaciones HTTP aprobadas. Fixtures conservados en DB 15.`,
  );
} catch (e) {
  console.error(serverLogs);
  throw e;
} finally {
  server.kill();
}
