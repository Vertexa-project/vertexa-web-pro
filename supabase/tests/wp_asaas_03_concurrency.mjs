// WP-ASAAS-03 — concorrência: A03-03/A03-10 (reserve), retry concorrente de operação failed
// (risco anotado no plano seção U), e criação concorrente de billing_account (Correção 3).
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DOCKER_DB = process.env.WPASAAS03_DOCKER_DB || "supabase_db_vertexa-wp09b1";

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function runConn(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "-i", DOCKER_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.stdin.write(sql);
    child.stdin.end();
  });
}

function fail(msg) {
  throw new Error(msg);
}

function lit(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── Setup: profile + billing_account fresh para cada cenário ────────────────────────
function seedAccount() {
  const profileId = randomUUID();
  const authUserId = randomUUID();
  const accountId = randomUUID();
  psql(
    `insert into public.profiles (id, auth_user_id, role, full_name, email, status) values ` +
      `(${lit(profileId)}, ${lit(authUserId)}, 'professional', 'Conc ASAAS03', 'conc-asaas03-${accountId}@t.test', 'active');`,
  );
  psql(
    `insert into private.billing_accounts (id, owner_profile_id, provider, environment) values ` +
      `(${lit(accountId)}, ${lit(profileId)}, 'asaas', 'sandbox');`,
  );
  return { profileId, authUserId, accountId };
}

function cleanupAccount({ profileId, accountId }) {
  psql(`delete from private.billing_subscriptions where billing_account_id = ${lit(accountId)};`);
  psql(`delete from private.billing_outbound_operations where billing_account_id = ${lit(accountId)};`);
  psql(`delete from private.billing_accounts where id = ${lit(accountId)};`);
  psql(`delete from public.profiles where id = ${lit(profileId)};`);
}

// ── Cenário 1 (A03-03): duas reservas concorrentes da MESMA idempotency_key nova ────
async function scenarioFreshConcurrentReserve() {
  const acc = seedAccount();
  const key = `conc-fresh-${acc.accountId}`;
  const ref = `vtx:sandbox:${acc.accountId}:customer`;
  const call =
    `select private.reserve_billing_outbound_operation(` +
    `${lit(acc.accountId)},'asaas','sandbox','create_customer',${lit(key)},${lit(ref)})->>'outcome';`;

  const [a, b] = await Promise.all([runConn(call), runConn(call)]);
  if (a.code !== 0 || b.code !== 0) fail(`scenario1 psql fail a=${a.err} b=${b.err}`);

  const outcomes = [a.out, b.out].sort();
  const n = Number(
    psql(
      `select count(*) from private.billing_outbound_operations ` +
        `where billing_account_id = ${lit(acc.accountId)} and idempotency_key = ${lit(key)};`,
    ),
  );
  cleanupAccount(acc);

  if (n !== 1) fail(`scenario1 FAIL: rows=${n} (esperado 1)`);
  const ok = outcomes[0] === "in_flight_retry" && outcomes[1] === "reserved";
  if (!ok) fail(`scenario1 FAIL: outcomes=${outcomes.join(",")} (esperado reserved+in_flight_retry)`);
  console.log("ASAAS03_CONCURRENCY_FRESH_RESERVE_PASS rows=1 outcomes=" + outcomes.join(","));
}

// ── Cenário 2 (risco da seção U): duas reservas concorrentes de uma operação já FAILED ──
async function scenarioFailedConcurrentRetry() {
  const acc = seedAccount();
  const key = `conc-failed-${acc.accountId}`;
  const ref = `vtx:sandbox:${acc.accountId}:customer`;

  const first = psql(
    `select private.reserve_billing_outbound_operation(` +
      `${lit(acc.accountId)},'asaas','sandbox','create_customer',${lit(key)},${lit(ref)})->>'operation_id';`,
  );
  psql(
    `select private.fail_billing_outbound_operation(${lit(first)}::uuid, 'network_timeout');`,
  );

  const call =
    `select private.reserve_billing_outbound_operation(` +
    `${lit(acc.accountId)},'asaas','sandbox','create_customer',${lit(key)},${lit(ref)})->>'outcome';`;

  const [a, b] = await Promise.all([runConn(call), runConn(call)]);
  if (a.code !== 0 || b.code !== 0) fail(`scenario2 psql fail a=${a.err} b=${b.err}`);

  const outcomes = [a.out, b.out].sort();
  const attemptCount = Number(
    psql(`select attempt_count from private.billing_outbound_operations where id = ${lit(first)}::uuid;`),
  );
  const status = psql(`select status from private.billing_outbound_operations where id = ${lit(first)}::uuid;`);
  cleanupAccount(acc);

  // attempt_count: 1 (reserve original) + 1 (fail não muda attempt_count) + 1 (claimed_for_retry)
  // + 1 (in_flight_retry do perdedor) = 3. Exatamente UM claimed_for_retry, o outro in_flight_retry
  // — provando que o FOR UPDATE serializou a corrida em vez de os dois se considerarem donos.
  const ok = outcomes[0] === "claimed_for_retry" && outcomes[1] === "in_flight_retry";
  if (!ok) fail(`scenario2 FAIL: outcomes=${outcomes.join(",")} (esperado 1 claimed_for_retry + 1 in_flight_retry)`);
  if (attemptCount !== 3) fail(`scenario2 FAIL: attempt_count=${attemptCount} (esperado 3)`);
  if (status !== "pending") fail(`scenario2 FAIL: status=${status} (esperado pending, nunca 2x failed->pending divergente)`);
  console.log(`ASAAS03_CONCURRENCY_FAILED_RETRY_PASS attempt_count=${attemptCount} outcomes=${outcomes.join(",")}`);
}

// ── Cenário 3 (A03-10): mesmo teste do cenário 1, mas para create_subscription (após
// customer provisionado) — prova que a corrida de subscription também é segura ─────────
async function scenarioSubscriptionConcurrentReserve() {
  const acc = seedAccount();
  psql(`update private.billing_accounts set external_customer_id = 'cus_conc_test' where id = ${lit(acc.accountId)};`);
  const key = `${acc.accountId}:create_subscription:primary`;
  const ref = `vtx:sandbox:${acc.accountId}:subscription:primary`;
  const call =
    `select private.reserve_billing_outbound_operation(` +
    `${lit(acc.accountId)},'asaas','sandbox','create_subscription',${lit(key)},${lit(ref)})->>'outcome';`;

  const [a, b] = await Promise.all([runConn(call), runConn(call)]);
  if (a.code !== 0 || b.code !== 0) fail(`scenario3 psql fail a=${a.err} b=${b.err}`);

  const outcomes = [a.out, b.out].sort();
  const n = Number(
    psql(
      `select count(*) from private.billing_outbound_operations ` +
        `where billing_account_id = ${lit(acc.accountId)} and idempotency_key = ${lit(key)};`,
    ),
  );
  cleanupAccount(acc);

  if (n !== 1) fail(`scenario3 FAIL: rows=${n} (esperado 1)`);
  const ok = outcomes[0] === "in_flight_retry" && outcomes[1] === "reserved";
  if (!ok) fail(`scenario3 FAIL: outcomes=${outcomes.join(",")}`);
  console.log("ASAAS03_CONCURRENCY_SUBSCRIPTION_RESERVE_PASS rows=1 outcomes=" + outcomes.join(","));
}

// ── Cenário 4 (Correção 3 / GATE billing account race): duas get_or_create_billing_account
// concorrentes do MESMO owner (pré-onboarding) -> exatamente 1 billing_account ────────────
async function scenarioConcurrentBillingAccountCreation() {
  const profileId = randomUUID();
  const authUserId = randomUUID();
  psql(
    `insert into public.profiles (id, auth_user_id, role, full_name, email, status) values ` +
      `(${lit(profileId)}, ${lit(authUserId)}, 'professional', 'Conc Account ASAAS03', 'conc-account-${profileId}@t.test', 'active');`,
  );

  const call =
    `select set_config('request.jwt.claims', json_build_object('sub',${lit(authUserId)},'role','authenticated')::text, false); ` +
    `set role authenticated; ` +
    `select public.get_or_create_billing_account('asaas','sandbox',null)->>'billing_account_id'; ` +
    `reset role;`;

  const [a, b] = await Promise.all([runConn(call), runConn(call)]);
  if (a.code !== 0 || b.code !== 0) fail(`scenario4 psql fail a=${a.err} b=${b.err}`);

  const idA = a.out.trim().split("\n").filter(Boolean).pop();
  const idB = b.out.trim().split("\n").filter(Boolean).pop();
  const n = Number(psql(`select count(*) from private.billing_accounts where owner_profile_id = ${lit(profileId)};`));

  psql(`delete from private.billing_accounts where owner_profile_id = ${lit(profileId)};`);
  psql(`delete from public.profiles where id = ${lit(profileId)};`);

  if (n !== 1) fail(`scenario4 FAIL: billing_accounts rows=${n} (esperado 1 — corrida não serializada)`);
  if (idA !== idB) fail(`scenario4 FAIL: ids divergentes a=${idA} b=${idB}`);
  console.log(`ASAAS03_CONCURRENCY_BILLING_ACCOUNT_PASS rows=1 id=${idA}`);
}

await scenarioFreshConcurrentReserve();
await scenarioFailedConcurrentRetry();
await scenarioSubscriptionConcurrentReserve();
await scenarioConcurrentBillingAccountCreation();
console.log("ASAAS03_CONCURRENCY_ALL_PASS");
