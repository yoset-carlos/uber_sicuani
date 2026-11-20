import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  REDIS_DATABASE: "15",
  REDIS_PREFIX: "sicuani-outage-tests:" + randomUUID() + ":",
};
const fixtureProcess = spawnSync("php", ["tests/fixtures.php"], {
  env,
  encoding: "utf8",
});
if (fixtureProcess.status !== 0)
  throw new Error(fixtureProcess.stderr || fixtureProcess.stdout);
const { password } = JSON.parse(fixtureProcess.stdout);
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const unavailablePort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
let server;
async function launch(extra = {}) {
  server = spawn(
    "php",
    ["-S", "127.0.0.1:8084", "-t", "public", "public/router.php"],
    { env: { ...env, ...extra }, stdio: "ignore" },
  );
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8084")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("No se pudo iniciar el servidor de prueba");
}
async function attemptLogin() {
  const session = await fetch("http://127.0.0.1:8084/api/sesion");
  const csrf = (await session.json()).datos.csrf;
  const cookie = session.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const response = await fetch("http://127.0.0.1:8084/api/login", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ usuario: "passenger", password }),
  });
  return { response, json: await response.json() };
}
async function stop() {
  if (server && !server.killed) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await closed;
  }
}
try {
  await launch({ REDIS_PORT: String(unavailablePort) });
  let result = await attemptLogin();
  assert.equal(result.response.status, 503);
  assert.equal(result.json.error.codigo, "SERVICIO_NO_DISPONIBLE");
  console.log(
    "PASS: Redis inaccesible produce 503 y un error JSON recuperable",
  );
  assert.ok(!JSON.stringify(result.json).includes("tcp://"));
  assert.ok(!JSON.stringify(result.json).includes(password));
  console.log("PASS: El error no expone conexión ni contraseña");
  await stop();
  await launch();
  result = await attemptLogin();
  assert.equal(result.response.status, 200);
  assert.equal(result.json.datos.usuario.rol, "pasajero");
  console.log("PASS: El servicio recuperado permite volver a iniciar sesión");
  console.log(
    "3 verificaciones de indisponibilidad/recuperación aprobadas. No se detuvo el Redis real.",
  );
} finally {
  await stop();
}
