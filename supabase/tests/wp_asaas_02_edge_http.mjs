// WP-ASAAS-02A1 — smoke HTTP no Edge Runtime local. Sem Asaas. Sem print de secret.
import { createHmac } from "node:crypto";
import http from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const DOCKER_DB = process.env.WPASAAS02_DOCKER_DB || "supabase_db_vertexa-wp09b1";
const PGRST = process.env.WPASAAS02_PGRST || "pgrst-wp09b1";
const EDGE_NAME = "wp-asaas02-edge-runtime";
const EDGE_IMAGE = "public.ecr.aws/supabase/edge-runtime:v1.74.3";
const PROXY_PORT = Number(process.env.WPASAAS02_PROXY_PORT || 55534);
const EDGE_PORT = Number(process.env.WPASAAS02_EDGE_PORT || 55541);
function requiredToken(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < 32) {
    throw new Error(`${name} ausente`);
  }
  return value;
}

const FAKE_SANDBOX = requiredToken("WPASAAS02_FAKE_SANDBOX");
const FAKE_PRODUCTION = requiredToken("WPASAAS02_FAKE_PRODUCTION");
const FUNCTIONS_DIR = path.resolve(fileURLToPath(new URL("../functions", import.meta.url)));

const logs = [];
const origLog = console.log;
const origErr = console.error;
console.log = (...args) => {
  logs.push(args.map(String).join(" "));
};
console.error = (...args) => {
  logs.push(args.map(String).join(" "));
};

function fail(msg) {
  console.log = origLog;
  console.error = origErr;
  throw new Error(msg);
}

function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DOCKER_DB,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function eventCount(eventId) {
  return Number(
    psql(
      "select count(*) from private.billing_provider_events " +
        `where external_event_id = ${lit(eventId)} and environment = 'sandbox';`,
    ),
  );
}

function pgrstJwtSecret() {
  const env = execFileSync("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", PGRST], {
    encoding: "utf8",
  });
  const line = env.split(/\r?\n/).find((l) => l.startsWith("PGRST_JWT_SECRET="));
  if (!line) fail("pgrst jwt secret ausente");
  return line.slice("PGRST_JWT_SECRET=".length);
}

function mintServiceRole(secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "supabase-demo",
      role: "service_role",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function startProxy(listenPort, targetPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const path = (req.url || "/").replace(/^\/rest\/v1/, "") || "/";
      const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
      const p = http.request(
        { hostname: "127.0.0.1", port: targetPort, path, method: req.method, headers },
        (pr) => {
          res.writeHead(pr.statusCode || 500, pr.headers);
          pr.pipe(res);
        },
      );
      p.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "proxy_error" }));
      });
      req.pipe(p);
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

function startEdge(serviceRole) {
  dockerRm(EDGE_NAME);
  const args = [
    "run",
    "--rm",
    "-d",
    "--name",
    EDGE_NAME,
    "-p",
    `${EDGE_PORT}:9000`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    "ASAAS_WEBHOOK_ENVIRONMENT=sandbox",
    "-e",
    `ASAAS_WEBHOOK_AUTH_TOKEN_SANDBOX=${FAKE_SANDBOX}`,
    "-e",
    `ASAAS_WEBHOOK_AUTH_TOKEN_PRODUCTION=${FAKE_PRODUCTION}`,
    "-e",
    `SUPABASE_URL=http://host.docker.internal:${PROXY_PORT}`,
    "-e",
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`,
    "-v",
    `${FUNCTIONS_DIR}:/home/deno/functions:ro`,
    EDGE_IMAGE,
    "start",
    "--main-service",
    "/home/deno/functions/asaas-webhook",
    "--port",
    "9000",
  ];
  const id = execFileSync("docker", args, { encoding: "utf8" }).trim();
  if (!id) fail("edge-runtime não iniciou");
}

async function waitReady() {
  const url = `http://127.0.0.1:${EDGE_PORT}/`;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(url, { method: "POST", body: "{}" });
      if (res.status === 401 || res.status === 400 || res.status === 503 || res.status === 200) {
        return;
      }
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
  if (logs.includes(FAKE_SANDBOX) || logs.includes(FAKE_PRODUCTION)) {
    fail("EDGE_RUNTIME_BLOCKED: secret em log");
  }
  fail(`EDGE_RUNTIME_BLOCKED: sem HTTP pronto (${logs.split(/\r?\n/).slice(0, 8).join(" | ")})`);
}

async function postWebhook(headers, body) {
  return fetch(`http://127.0.0.1:${EDGE_PORT}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let proxy;
try {
  if (String(FUNCTIONS_DIR).includes("cdhjfyyuhmwrcuxqavib")) fail("path remoto inesperado");
  const serviceRole = mintServiceRole(pgrstJwtSecret());
  proxy = await startProxy(PROXY_PORT, 55533);
  startEdge(serviceRole);
  await waitReady();

  psql("delete from private.billing_provider_events where external_event_id like 'evt_asaas02_r%';");

  const r1 = await postWebhook({}, { id: "evt_asaas02_r1", event: "PAYMENT_CREATED" });
  if (r1.status !== 401) fail(`R1 status=${r1.status}`);
  if (eventCount("evt_asaas02_r1") !== 0) fail("R1 row");
  const r1body = await r1.text();
  if (r1body.includes(FAKE_SANDBOX) || r1body.includes(FAKE_PRODUCTION)) fail("R1 leak");

  const r2 = await postWebhook(
    { "asaas-access-token": "wrong-token-value-not-the-fake-secret" },
    { id: "evt_asaas02_r2", event: "PAYMENT_CREATED" },
  );
  if (r2.status !== 403) fail(`R2 status=${r2.status}`);
  if (eventCount("evt_asaas02_r2") !== 0) fail("R2 row");

  const valid = {
    id: "evt_asaas02_r3",
    event: "PAYMENT_RECEIVED",
    dateCreated: "2024-06-12 16:45:03",
    payment: { object: "payment", id: "pay_080225913252" },
  };
  const r3 = await postWebhook({ "asaas-access-token": FAKE_SANDBOX }, valid);
  if (r3.status !== 200) fail(`R3 status=${r3.status} body=${await r3.text()}`);
  if ((await r3.json()).received !== true) fail("R3 body");
  if (eventCount("evt_asaas02_r3") !== 1) fail("R3 rows");
  const r3env = psql(
    "select environment from private.billing_provider_events where external_event_id = 'evt_asaas02_r3';",
  );
  if (r3env !== "sandbox") fail(`R3 env=${r3env}`);

  const r4 = await postWebhook({ "asaas-access-token": FAKE_SANDBOX }, valid);
  if (r4.status !== 200) fail(`R4 status=${r4.status}`);
  if (eventCount("evt_asaas02_r3") !== 1) fail("R4 duplicou");

  const r5 = await postWebhook(
    { "asaas-access-token": FAKE_SANDBOX },
    { ...valid, payment: { object: "payment", id: "pay_OTHER" } },
  );
  if (r5.status !== 200) fail(`R5 status=${r5.status}`);
  if (eventCount("evt_asaas02_r3") !== 1) fail("R5 duplicou");
  const kept = psql(
    "select event_type || '|' || external_resource_id || '|' || last_error_category || '|' || processing_status " +
      "from private.billing_provider_events where external_event_id = 'evt_asaas02_r3';",
  );
  if (kept !== "PAYMENT_RECEIVED|pay_080225913252|payload_hash_mismatch|received") {
    fail(`R5 original=${kept}`);
  }

  const leak = logs.join("\n");
  if (leak.includes(FAKE_SANDBOX) || leak.includes(FAKE_PRODUCTION) || leak.includes(serviceRole)) {
    fail("SECRET_LEAK");
  }

  psql("delete from private.billing_provider_events where external_event_id like 'evt_asaas02_r%';");
  console.log = origLog;
  console.error = origErr;
  origLog("ASAAS02_EDGE_HTTP_ASSERTIONS_PASSED");
} finally {
  dockerRm(EDGE_NAME);
  if (proxy) await new Promise((r) => proxy.close(r));
}
