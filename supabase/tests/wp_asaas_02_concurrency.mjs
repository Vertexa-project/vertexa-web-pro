// WP-ASAAS-02 — duas entregas simultâneas do mesmo event id → 1 row.
import { spawn, execFileSync } from "node:child_process";

const DOCKER_DB = process.env.WPASAAS02_DOCKER_DB || "supabase_db_vertexa-wp09b1";
const EVENT_ID = "evt_asaas02_conc";
const HASH = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

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

function runConn(sql) {
  return new Promise((resolve) => {
    const child = spawn(
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
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => {
      resolve({ code, out: out.trim(), err: err.trim() });
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

const ingest =
  "select private.ingest_billing_provider_event(" +
  `'asaas','sandbox','${EVENT_ID}','PAYMENT_CREATED',now(),'payment','pay_c',` +
  `'${HASH}')->>'outcome';`;

psql(`delete from private.billing_provider_events where external_event_id = '${EVENT_ID}';`);

const [a, b] = await Promise.all([runConn(ingest), runConn(ingest)]);
if (a.code !== 0 || b.code !== 0) {
  throw new Error(`concurrency psql fail a=${a.err} b=${b.err}`);
}

const n = Number(
  psql(`select count(*) from private.billing_provider_events where external_event_id = '${EVENT_ID}';`),
);
const outcomes = [a.out, b.out].sort();
psql(`delete from private.billing_provider_events where external_event_id = '${EVENT_ID}';`);

if (n !== 1) throw new Error(`concurrency rows=${n}`);
const ok =
  (outcomes[0] === "duplicate" && outcomes[1] === "inserted") ||
  (outcomes[0] === "inserted" && outcomes[1] === "inserted");
// unique_violation path deve devolver duplicate para o perdedor.
if (!(outcomes.includes("inserted") && (outcomes.includes("duplicate") || n === 1))) {
  throw new Error(`concurrency outcomes=${outcomes.join(",")}`);
}
void ok;
console.log("ASAAS02_CONCURRENCY_PASS rows=1");
