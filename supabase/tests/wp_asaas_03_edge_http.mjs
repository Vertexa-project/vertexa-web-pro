// WP-ASAAS-03A1 — smoke HTTP local do boundary asaas-outbound. Sem Asaas real (nenhuma das
// cenas abaixo alcança asaasFetch — isso é Gate 14, contra o deploy remoto real). Sem print
// de secret. Cobre A03-13/14 (environment fail-closed), A03-15 (anon), A03-16 (authenticated
// não-admin), A03-17 (API key ausente).
import { createHmac } from "node:crypto";
import http from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const DOCKER_DB = process.env.WPASAAS03_DOCKER_DB || "supabase_db_vertexa-wp09b1";
const PGRST = process.env.WPASAAS03_PGRST || "pgrst-wp09b1";
const EDGE_NAME = "wp-asaas03-edge-runtime";
const EDGE_IMAGE = "public.ecr.aws/supabase/edge-runtime:v1.74.3";
const PROXY_PORT = Number(process.env.WPASAAS03_PROXY_PORT || 55634);
const EDGE_PORT = Number(process.env.WPASAAS03_EDGE_PORT || 55641);
const FUNCTIONS_DIR = path.resolve(fileURLToPath(new URL("../functions", import.meta.url)));
const FAKE_API_KEY = "fake-asaas-sandbox-key-never-real-0000000000";

function fail(msg) {
  throw new Error(msg);
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function lit(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function pgrstJwtSecret() {
  const env = execFileSync("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", PGRST], { encoding: "utf8" });
  const line = env.split(/\r?\n/).find((l) => l.startsWith("PGRST_JWT_SECRET="));
  if (!line) fail("pgrst jwt secret ausente");
  return line.slice("PGRST_JWT_SECRET=".length);
}

function mintToken(secret, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase-demo", exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function startProxy(listenPort, targetPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const p = (req.url || "/").replace(/^\/rest\/v1/, "") || "/";
      const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
      const proxied = http.request({ hostname: "127.0.0.1", port: targetPort, path: p, method: req.method, headers }, (pr) => {
        res.writeHead(pr.statusCode || 500, pr.headers);
        pr.pipe(res);
      });
      proxied.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "proxy_error" }));
      });
      req.pipe(proxied);
    });
    server.listen(listenPort, "0.0.0.0", () => resolve(server));
    server.on("error", reject);
  });
}

function dockerRm(name) {
  try {
    execFileSync("docker", ["rm", "-f", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    /* already gone */
  }
}

function startEdge(envVars) {
  dockerRm(EDGE_NAME);
  const args = ["run", "--rm", "-d", "--name", EDGE_NAME, "-p", `${EDGE_PORT}:9000`, "--add-host", "host.docker.internal:host-gateway"];
  for (const [k, v] of Object.entries(envVars)) {
    args.push("-e", `${k}=${v}`);
  }
  args.push("-v", `${FUNCTIONS_DIR}:/home/deno/functions:ro`, EDGE_IMAGE, "start", "--main-service", "/home/deno/functions/asaas-outbound", "--port", "9000");
  const id = execFileSync("docker", args, { encoding: "utf8" }).trim();
  if (!id) fail("edge-runtime não iniciou");
}

async function waitReady() {
  const url = `http://127.0.0.1:${EDGE_PORT}/`;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(url, { method: "POST", body: "{}" });
      if ([200, 400, 401, 403, 405, 503].includes(res.status)) return;
    } catch {
      /* still booting */
    }
    await sleep(1000);
  }
  let logs = "";
  try {
    logs = execFileSync("docker", ["logs", "--tail", "40", EDGE_NAME], { encoding: "utf8" });
  } catch {
    logs = "sem logs";
  }
  fail(`EDGE_RUNTIME_BLOCKED: sem HTTP pronto (${logs.split(/\r?\n/).slice(0, 8).join(" | ")})`);
}

async function post(headers, body) {
  return fetch(`http://127.0.0.1:${EDGE_PORT}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function withEdge(envVars, run) {
  startEdge(envVars);
  await waitReady();
  try {
    await run();
  } finally {
    dockerRm(EDGE_NAME);
  }
}

// ── Seed: profiles para o gate de authorization (admin vs comum) ────────────────────
function seedProfiles() {
  const adminProfileId = randomUUID();
  const adminAuthUserId = randomUUID();
  const plainProfileId = randomUUID();
  const plainAuthUserId = randomUUID();
  psql(
    `insert into public.profiles (id, auth_user_id, role, full_name, email, status) values ` +
      `(${lit(adminProfileId)}, ${lit(adminAuthUserId)}, 'professional', 'Edge Admin ASAAS03', 'edge-admin-${adminProfileId}@t.test', 'active'), ` +
      `(${lit(plainProfileId)}, ${lit(plainAuthUserId)}, 'professional', 'Edge Plain ASAAS03', 'edge-plain-${plainProfileId}@t.test', 'active');`,
  );
  psql(
    `insert into private.platform_admins (profile_id, status) values (${lit(adminProfileId)}, 'active');`,
  );
  return { adminProfileId, adminAuthUserId, plainProfileId, plainAuthUserId };
}

function cleanupProfiles(s) {
  psql(`delete from private.platform_admins where profile_id = ${lit(s.adminProfileId)};`);
  psql(`delete from private.billing_accounts where owner_profile_id in (${lit(s.adminProfileId)}, ${lit(s.plainProfileId)});`);
  psql(`delete from public.profiles where id in (${lit(s.adminProfileId)}, ${lit(s.plainProfileId)});`);
}

let proxy;
let seed;
try {
  if (String(FUNCTIONS_DIR).includes("cdhjfyyuhmwrcuxqavib")) fail("path remoto inesperado");
  const secret = pgrstJwtSecret();
  const serviceRoleToken = mintToken(secret, { role: "service_role" });
  const anonToken = mintToken(secret, { role: "anon" });
  seed = seedProfiles();
  const adminToken = mintToken(secret, { sub: seed.adminAuthUserId, role: "authenticated" });
  const plainToken = mintToken(secret, { sub: seed.plainAuthUserId, role: "authenticated" });

  proxy = await startProxy(PROXY_PORT, 55533);

  const baseEnv = {
    SUPABASE_URL: `http://host.docker.internal:${PROXY_PORT}`,
    SUPABASE_ANON_KEY: anonToken,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleToken,
  };

  // A03-13/14 parte 1: ASAAS_OUTBOUND_ENVIRONMENT ausente -> 503, independente de auth/body.
  await withEdge({ ...baseEnv }, async () => {
    const r = await post({ Authorization: `Bearer ${adminToken}` }, { action: "ensure_customer" });
    if (r.status !== 503) fail(`ENV_MISSING status=${r.status}`);
    const body = await r.json();
    if (body.error !== "asaas_outbound_not_configured") fail(`ENV_MISSING body=${JSON.stringify(body)}`);
  });
  console.log("ASAAS03_EDGE_ENV_MISSING_PASS");

  // A03-17: environment ok, mas ASAAS_API_KEY_SANDBOX ausente -> 503, fail-closed.
  await withEdge({ ...baseEnv, ASAAS_OUTBOUND_ENVIRONMENT: "sandbox" }, async () => {
    const r = await post({ Authorization: `Bearer ${adminToken}` }, { action: "ensure_customer" });
    if (r.status !== 503) fail(`API_KEY_MISSING status=${r.status}`);
    const body = await r.json();
    if (body.error !== "asaas_not_configured") fail(`API_KEY_MISSING body=${JSON.stringify(body)}`);
  });
  console.log("ASAAS03_EDGE_API_KEY_MISSING_PASS");

  // A03-14: environment=production, sem ASAAS_API_KEY_PRODUCTION -> 503 (produção nunca
  // alcançável nesta WP mesmo se alguém setasse o environment errado).
  await withEdge({ ...baseEnv, ASAAS_OUTBOUND_ENVIRONMENT: "production", ASAAS_API_KEY_SANDBOX: FAKE_API_KEY }, async () => {
    const r = await post({ Authorization: `Bearer ${adminToken}` }, { action: "ensure_customer" });
    if (r.status !== 503) fail(`PRODUCTION_DENIED status=${r.status}`);
    const body = await r.json();
    if (body.error !== "asaas_not_configured") fail(`PRODUCTION_DENIED body=${JSON.stringify(body)}`);
  });
  console.log("ASAAS03_EDGE_PRODUCTION_DENIED_PASS");

  // Config válida (sandbox) para os testes de autorização/corpo abaixo.
  const validEnv = { ...baseEnv, ASAAS_OUTBOUND_ENVIRONMENT: "sandbox", ASAAS_API_KEY_SANDBOX: FAKE_API_KEY };

  await withEdge(validEnv, async () => {
    // invalid_action / invalid_json não dependem de auth — confirmam que chegam antes do gate.
    const rBadJson = await post({ Authorization: `Bearer ${adminToken}` }, "{not json");
    if (rBadJson.status !== 400) fail(`INVALID_JSON status=${rBadJson.status}`);

    const rNoAction = await post({ Authorization: `Bearer ${adminToken}` }, {});
    if (rNoAction.status !== 400) fail(`INVALID_ACTION status=${rNoAction.status}`);

    // A03-15: sem Authorization / com anon token -> não deveria conseguir se autenticar como
    // platform_admin (401 se o RPC nem aceitar a chamada; 403 se aceitar e is_platform_admin=false).
    const rNoAuth = await post({}, { action: "ensure_customer" });
    if (![401, 403].includes(rNoAuth.status)) fail(`ANON_NO_AUTH status=${rNoAuth.status}`);

    const rAnon = await post({ Authorization: `Bearer ${anonToken}` }, { action: "ensure_customer" });
    if (![401, 403].includes(rAnon.status)) fail(`ANON_TOKEN status=${rAnon.status}`);

    // A03-16: authenticated comum (sem platform_admins) -> 403 exato.
    const rPlain = await post({ Authorization: `Bearer ${plainToken}` }, { action: "ensure_customer" });
    const rPlainText = await rPlain.text();
    if (rPlain.status !== 403) fail(`PLAIN_AUTH status=${rPlain.status} body=${rPlainText}`);
    if (rPlainText.includes(FAKE_API_KEY)) fail("SECRET_LEAK plain");
  });
  console.log("ASAAS03_EDGE_AUTHORIZATION_GATE_PASS");

  // A03B-01: confirm_sandbox_payment nunca alcança a Asaas fora de sandbox — defesa em
  // profundidade dentro do próprio código (não só o gate de ASAAS_OUTBOUND_ENVIRONMENT no
  // topo do handler), mesmo no cenário hipotético de alguém configurar uma
  // ASAAS_API_KEY_PRODUCTION válida.
  await withEdge(
    { ...baseEnv, ASAAS_OUTBOUND_ENVIRONMENT: "production", ASAAS_API_KEY_PRODUCTION: FAKE_API_KEY },
    async () => {
      const r = await post({ Authorization: `Bearer ${adminToken}` }, { action: "confirm_sandbox_payment" });
      const respBody = await r.json();
      if (r.status !== 403) fail(`PRODUCTION_CONFIRM_GUARD status=${r.status} body=${JSON.stringify(respBody)}`);
      if (respBody.error !== "sandbox_only") fail(`PRODUCTION_CONFIRM_GUARD error=${JSON.stringify(respBody)}`);
    },
  );
  console.log("ASAAS03B_EDGE_PRODUCTION_CONFIRM_GUARD_PASS");

  // A03B-02: list_subscription_payments / confirm_sandbox_payment nunca chamam a Asaas
  // (asaasFetch) antes de ter uma subscription primary persistida — resolvida 100%
  // server-side (resolve_primary_asaas_subscription), nunca a partir do body do client.
  await withEdge(validEnv, async () => {
    const rList = await post({ Authorization: `Bearer ${adminToken}` }, { action: "list_subscription_payments" });
    const listBody = await rList.json();
    if (rList.status !== 409) fail(`SUBSCRIPTION_NOT_READY_LIST status=${rList.status} body=${JSON.stringify(listBody)}`);
    if (listBody.error !== "subscription_not_ready") fail(`SUBSCRIPTION_NOT_READY_LIST body=${JSON.stringify(listBody)}`);

    const rConfirm = await post({ Authorization: `Bearer ${adminToken}` }, { action: "confirm_sandbox_payment" });
    const confirmBody = await rConfirm.json();
    if (rConfirm.status !== 409) fail(`SUBSCRIPTION_NOT_READY_CONFIRM status=${rConfirm.status} body=${JSON.stringify(confirmBody)}`);
    if (confirmBody.error !== "subscription_not_ready") fail(`SUBSCRIPTION_NOT_READY_CONFIRM body=${JSON.stringify(confirmBody)}`);
  });
  console.log("ASAAS03B_EDGE_SUBSCRIPTION_NOT_READY_PASS");

  console.log("ASAAS03_EDGE_HTTP_ASSERTIONS_PASSED");
} finally {
  dockerRm(EDGE_NAME);
  if (seed) cleanupProfiles(seed);
  if (proxy) await new Promise((r) => proxy.close(r));
}
