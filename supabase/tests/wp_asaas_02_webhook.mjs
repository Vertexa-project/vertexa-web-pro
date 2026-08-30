// WP-ASAAS-02 — testes locais do webhook stub. Sem HTTP Asaas. Sem print de secret.
import { execFileSync } from "node:child_process";
import {
  dispatchAsaasWebhook,
  extractResource,
  parseEnvelope,
  parseWebhookEnvironment,
  resolveWebhookSecretName,
  tokensEqual,
} from "../functions/_shared/asaasWebhook.js";

function requiredToken(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < 32) {
    throw new Error(`${name} ausente`);
  }
  return value;
}

const DOCKER_DB = process.env.WPASAAS02_DOCKER_DB || "supabase_db_vertexa-wp09b1";
const FAKE_SANDBOX = requiredToken("WPASAAS02_FAKE_SANDBOX");
const FAKE_PRODUCTION = requiredToken("WPASAAS02_FAKE_PRODUCTION");
const logs = [];
const origLog = console.log;
const origErr = console.error;
console.log = (...args) => {
  logs.push(args.map(String).join(" "));
};
console.error = (...args) => {
  logs.push(args.map(String).join(" "));
};

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

function ingestSql(row) {
  const created = row.eventCreatedAt ? `${lit(row.eventCreatedAt)}::timestamptz` : "null";
  const rtype = row.externalResourceType ? lit(row.externalResourceType) : "null";
  const rid = row.externalResourceId ? lit(row.externalResourceId) : "null";
  const json = psql(
    "select private.ingest_billing_provider_event(" +
      `${lit(row.provider)}, ${lit(row.environment)}, ${lit(row.externalEventId)}, ` +
      `${lit(row.eventType)}, ${created}, ${rtype}, ${rid}, ${lit(row.payloadHash)}` +
      ")::text;",
  );
  return JSON.parse(json);
}

async function call(headers, body, environmentRaw, tokens = {}) {
  if (arguments.length < 3) environmentRaw = "sandbox";
  const req = new Request("http://asaas-webhook.local/", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return dispatchAsaasWebhook(req, {
    environmentRaw,
    sandboxToken: Object.prototype.hasOwnProperty.call(tokens, "sandbox")
      ? tokens.sandbox
      : FAKE_SANDBOX,
    productionToken: Object.prototype.hasOwnProperty.call(tokens, "production")
      ? tokens.production
      : FAKE_PRODUCTION,
    ingest: async (row) => ingestSql(row),
  });
}

function eventCount(eventId, environment = "sandbox") {
  return Number(
    psql(
      "select count(*) from private.billing_provider_events " +
        `where external_event_id = ${lit(eventId)} and environment = ${lit(environment)};`,
    ),
  );
}

function fail(msg) {
  console.log = origLog;
  console.error = origErr;
  throw new Error(msg);
}

psql("delete from private.billing_provider_events where external_event_id like 'evt_asaas02_%';");

const e1 = await call({}, { id: "evt_asaas02_e1", event: "PAYMENT_CREATED" });
if (e1.status !== 401) fail(`E1 status=${e1.status}`);
if (eventCount("evt_asaas02_e1") !== 0) fail("E1 row criada");

const e2 = await call(
  { "asaas-access-token": "wrong-token-value-not-the-fake-secret" },
  { id: "evt_asaas02_e2", event: "PAYMENT_CREATED" },
);
if (e2.status !== 403) fail(`E2 status=${e2.status}`);
if (eventCount("evt_asaas02_e2") !== 0) fail("E2 row criada");

const e3 = await call({ "asaas-access-token": FAKE_SANDBOX }, { event: "PAYMENT_CREATED" });
if (e3.status !== 400) fail(`E3 status=${e3.status}`);
if (eventCount("evt_asaas02_e3") !== 0) fail("E3 row criada");

const paymentBody = {
  id: "evt_asaas02_e4",
  event: "PAYMENT_RECEIVED",
  dateCreated: "2024-06-12 16:45:03",
  payment: { object: "payment", id: "pay_080225913252" },
  extraUnknown: { foo: true },
};
const e4 = await call({ "asaas-access-token": FAKE_SANDBOX }, paymentBody);
if (e4.status !== 200) fail(`E4 status=${e4.status}`);
if ((await e4.json()).received !== true) fail("E4 body");
if (eventCount("evt_asaas02_e4") !== 1) fail("E4 rows");

const resource = psql(
  "select external_resource_type || ':' || external_resource_id " +
    "from private.billing_provider_events where external_event_id = 'evt_asaas02_e4';",
);
if (resource !== "payment:pay_080225913252") fail(`E8 resource=${resource}`);

const e5 = await call({ "asaas-access-token": FAKE_SANDBOX }, paymentBody);
if (e5.status !== 200) fail(`E5 status=${e5.status}`);
if (eventCount("evt_asaas02_e4") !== 1) fail("E5 duplicou");

const diverged = { ...paymentBody, payment: { object: "payment", id: "pay_OTHER" } };
const e6 = await call({ "asaas-access-token": FAKE_SANDBOX }, diverged);
if (e6.status !== 200) fail(`E6 status=${e6.status}`);
if (eventCount("evt_asaas02_e4") !== 1) fail("E6 duplicou");
const kept = psql(
  "select event_type || '|' || external_resource_id || '|' || last_error_category || '|' || processing_status " +
    "from private.billing_provider_events where external_event_id = 'evt_asaas02_e4';",
);
if (kept !== "PAYMENT_RECEIVED|pay_080225913252|payload_hash_mismatch|received") {
  fail(`E6 original/conflict=${kept}`);
}

const e6b = await call({ "asaas-access-token": FAKE_SANDBOX }, diverged);
if (e6b.status !== 200) fail(`E6b status=${e6b.status}`);
if (eventCount("evt_asaas02_e4") !== 1) fail("E6b cresceu");
const kept2 = psql(
  "select last_error_category from private.billing_provider_events where external_event_id = 'evt_asaas02_e4';",
);
if (kept2 !== "payload_hash_mismatch") fail("E6b category");

const e7 = await call(
  { "asaas-access-token": FAKE_SANDBOX },
  { id: "evt_asaas02_e7", event: "SOME_FUTURE_EVENT", brandNewField: 1 },
);
if (e7.status !== 200) fail(`E7 status=${e7.status}`);
if (eventCount("evt_asaas02_e7") !== 1) fail("E7 rows");

if (parseWebhookEnvironment(undefined).ok) fail("E9 parse absent");
if (parseWebhookEnvironment("").ok) fail("E9 parse empty");
const e9 = await call(
  { "asaas-access-token": FAKE_SANDBOX },
  { id: "evt_asaas02_e9", event: "PAYMENT_CREATED" },
  undefined,
);
if (e9.status !== 503) fail(`E9 status=${e9.status}`);
if (eventCount("evt_asaas02_e9") !== 0) fail("E9 row");

for (const bad of ["prod", "prodution", "SANDBOX", "PRODUCTION", "staging", "dev"]) {
  if (parseWebhookEnvironment(bad).ok) fail(`E10 parse ${bad}`);
  const badResp = await call(
    { "asaas-access-token": FAKE_SANDBOX },
    { id: "evt_asaas02_e10", event: "PAYMENT_CREATED" },
    bad,
  );
  if (badResp.status !== 503) fail(`E10 ${bad} status=${badResp.status}`);
}
if (eventCount("evt_asaas02_e10") !== 0) fail("E10 row");

const e11 = await call(
  { "asaas-access-token": FAKE_SANDBOX },
  { id: "evt_asaas02_e11", event: "PAYMENT_CREATED" },
  "sandbox",
);
if (e11.status !== 200) fail(`E11 status=${e11.status}`);
if (eventCount("evt_asaas02_e11", "sandbox") !== 1) fail("E11 rows");
const e11env = psql(
  "select environment from private.billing_provider_events where external_event_id = 'evt_asaas02_e11';",
);
if (e11env !== "sandbox") fail(`E11 env=${e11env}`);

const e12 = await call(
  { "asaas-access-token": FAKE_PRODUCTION },
  { id: "evt_asaas02_e12", event: "PAYMENT_CREATED" },
  "sandbox",
);
if (e12.status !== 403) fail(`E12 status=${e12.status}`);
if (eventCount("evt_asaas02_e12", "sandbox") !== 0) fail("E12 row");

const e13 = await call(
  { "asaas-access-token": FAKE_PRODUCTION },
  { id: "evt_asaas02_e13", event: "PAYMENT_CREATED" },
  "production",
);
if (e13.status !== 200) fail(`E13 status=${e13.status}`);
if (eventCount("evt_asaas02_e13", "production") !== 1) fail("E13 rows");
const e13env = psql(
  "select environment from private.billing_provider_events where external_event_id = 'evt_asaas02_e13';",
);
if (e13env !== "production") fail(`E13 env=${e13env}`);

const e14 = await call(
  { "asaas-access-token": FAKE_SANDBOX },
  { id: "evt_asaas02_e14", event: "PAYMENT_CREATED" },
  "production",
);
if (e14.status !== 403) fail(`E14 status=${e14.status}`);
if (eventCount("evt_asaas02_e14", "production") !== 0) fail("E14 row");

const eSecret = await call(
  { "asaas-access-token": FAKE_SANDBOX },
  { id: "evt_asaas02_esec", event: "PAYMENT_CREATED" },
  "sandbox",
  { sandbox: "", production: FAKE_PRODUCTION },
);
if (eSecret.status !== 503) fail(`secret-empty status=${eSecret.status}`);
if (eventCount("evt_asaas02_esec") !== 0) fail("secret-empty row");

if (resolveWebhookSecretName("sandbox") !== "ASAAS_WEBHOOK_AUTH_TOKEN_SANDBOX") fail("secret name sb");
if (resolveWebhookSecretName("production") !== "ASAAS_WEBHOOK_AUTH_TOKEN_PRODUCTION") fail("secret name pr");
if (resolveWebhookSecretName("SANDBOX") !== null) fail("secret name fallback");

if (!parseEnvelope({ id: "evt_x", event: "PAYMENT_CREATED", extra: 1 }).ok) fail("parse extra");
const extracted = extractResource("PAYMENT_RECEIVED", paymentBody);
if (extracted.type !== "payment" || extracted.id !== "pay_080225913252") fail("extract");
if (tokensEqual(FAKE_SANDBOX, FAKE_PRODUCTION)) fail("tokensEqual");

const leak = logs.join("\n");
if (leak.includes(FAKE_SANDBOX) || leak.includes(FAKE_PRODUCTION)) fail("SECRET_LEAK");

psql("delete from private.billing_provider_events where external_event_id like 'evt_asaas02_%';");

console.log = origLog;
console.error = origErr;
origLog("ASAAS02_EDGE_ASSERTIONS_PASSED");
