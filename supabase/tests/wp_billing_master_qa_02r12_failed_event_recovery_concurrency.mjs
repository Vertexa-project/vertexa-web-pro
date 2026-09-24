// R12 local-only concurrency proof: two service-role recovery calls produce
// exactly one failed -> received transition and one append-only audit row.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DOCKER_DB = process.env.WP_BILLING_R12_DOCKER_DB || "supabase_db_cdhjfyyuhmwrcuxqavib";
const eventId = randomUUID();
const externalEventId = `evt_r12_concurrent_${eventId}`;
const paymentId = `pay_r12_concurrent_${eventId}`;

function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function runConnection(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.stdin.write(sql);
    child.stdin.end();
  });
}

psql(`insert into private.billing_provider_events (
  id, provider, environment, external_event_id, event_type, event_created_at,
  external_resource_type, external_resource_id, payload_hash, processing_status,
  last_error_category, attempts, claimed_at
) values (
  ${lit(eventId)}::uuid, 'asaas', 'sandbox', ${lit(externalEventId)},
  'PAYMENT_CONFIRMED', clock_timestamp(), 'payment', ${lit(paymentId)},
  repeat('e', 64), 'failed', 'checkout_account_mismatch', 1,
  clock_timestamp() - interval '1 minute'
);`);

const call = `select public.requeue_failed_billing_provider_event(
  ${lit(eventId)}::uuid, 'sandbox', 'hosted_card_customer_adoption_upgrade'
)->>'outcome';`;

try {
  const [a, b] = await Promise.all([runConnection(call), runConnection(call)]);
  if (a.code !== 0 || b.code !== 0) {
    throw new Error(`R12 concurrent RPC failed a=${a.err} b=${b.err}`);
  }
  const outcomes = [a.out, b.out].sort().join("|");
  if (outcomes !== "already_requeued|requeued") {
    throw new Error(`R12 concurrent outcomes=${outcomes}`);
  }
  const facts = psql(`select concat_ws('|',
    (select processing_status from private.billing_provider_events where id=${lit(eventId)}::uuid),
    (select attempts from private.billing_provider_events where id=${lit(eventId)}::uuid),
    (select count(*) from private.billing_provider_event_recovery_audit where event_id=${lit(eventId)}::uuid),
    (select previous_error_category from private.billing_provider_event_recovery_audit where event_id=${lit(eventId)}::uuid),
    (select queued_attempt_number from private.billing_provider_event_recovery_audit where event_id=${lit(eventId)}::uuid)
  );`);
  if (facts !== "received|1|1|checkout_account_mismatch|2") {
    throw new Error(`R12 concurrent facts=${facts}`);
  }
  console.log("FAILED_PROVIDER_EVENT_RECOVERY_CONCURRENCY_PASS transitions=1 audits=1");
} finally {
  psql(`delete from private.billing_provider_event_recovery_audit where event_id=${lit(eventId)}::uuid;
         delete from private.billing_provider_events where id=${lit(eventId)}::uuid;`);
}
