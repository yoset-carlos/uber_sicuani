import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
const duration = 15 * 60 * 1000,
  interval = 5000;
const env = {
  ...process.env,
  REDIS_DATABASE: "15",
  REDIS_PREFIX: "sicuani-load-tests:" + randomUUID() + ":",
  PRACTICE_ENABLED: "0",
};
const fixtures = spawnSync("php", ["tests/fixtures.php"], {
  env,
  encoding: "utf8",
});
if (fixtures.status !== 0) throw new Error(fixtures.stderr || fixtures.stdout);
const { password } = JSON.parse(fixtures.stdout);
const server = spawn(
  "php",
  ["-S", "127.0.0.1:8083", "-t", "public", "public/router.php"],
  { env, stdio: "ignore" },
);
const origin = "http://127.0.0.1:8083";
async function request(client, path, body) {
  const headers = {
    Cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = client.csrf;
  }
  const response = await fetch(origin + "/api" + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(4500),
  });
  for (const c of response.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    client.cookies.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const json = await response.json();
  if (json.datos?.csrf) client.csrf = json.datos.csrf;
  if (!response.ok || !json.ok)
    throw new Error(`HTTP ${response.status} ${json.error?.codigo}`);
  return json.datos;
}
const clients = ["passenger", "driver1", "driver2"].map((name) => ({
  name,
  cookies: new Map(),
  csrf: "",
  inflight: false,
}));
const results = [],
  errors = [];
let maxInflight = 0,
  inflight = 0;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const c of clients) {
    await request(c, "/sesion");
    await request(c, "/login", { usuario: c.name, password });
  }
  const started = Date.now();
  console.log("Prueba de 15 minutos: 3 sesiones, un ciclo cada 5 segundos.");
  while (Date.now() - started < duration) {
    const cycle = Date.now();
    await Promise.all(
      clients.map(async (c) => {
        if (c.inflight) throw new Error("Solapamiento en una sesión");
        c.inflight = true;
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        const t = performance.now();
        try {
          await request(c, "/estado");
          results.push(performance.now() - t);
        } catch (e) {
          errors.push({
            client: c.name,
            message: e.message,
            elapsed: Date.now() - started,
          });
        } finally {
          inflight--;
          c.inflight = false;
        }
      }),
    );
    const wait = interval - (Date.now() - cycle);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  results.sort((a, b) => a - b);
  const report = {
    durationSeconds: Math.round((Date.now() - started) / 1000),
    sessions: 3,
    pollIntervalSeconds: 5,
    requests: results.length + errors.length,
    successful: results.length,
    errors,
    maxConcurrentRequests: maxInflight,
    overlappingRequestsPerSession: 0,
    latencyMs: {
      median: Math.round(results[Math.floor(results.length * 0.5)] ?? 0),
      p95: Math.round(results[Math.floor(results.length * 0.95)] ?? 0),
      max: Math.round(results.at(-1) ?? 0),
    },
    physicalDevices: false,
    environment:
      "PHP built-in server on Windows, Redis 8 in WSL2, isolated DB 15",
    createdAt: new Date().toISOString(),
  };
  await writeFile("storage/load-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  server.kill();
}
