// R10 local-only concurrency proof: PAYMENT_CREATED and PAYMENT_CONFIRMED for
// the same hosted checkout converge on one customer/subscription/payment.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DOCKER_DB = process.env.WP_BILLING_R10_DOCKER_DB || "supabase_db_cdhjfyyuhmwrcuxqavib";

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

const profileId = randomUUID();
const clinicId = randomUUID();
const accountId = randomUUID();
const contractId = randomUUID();
const attemptId = randomUUID();
const createdEventId = randomUUID();
const confirmedEventId = randomUUID();
const checkoutId = `checkout_r10_concurrent_${attemptId}`;
const customerId = `cus_r10_concurrent_${accountId}`;
const subscriptionId = `sub_r10_concurrent_${contractId}`;
const paymentId = `pay_r10_concurrent_${attemptId}`;
const reference = `vtx:local:r10:concurrent:${attemptId}`;
const taxId = "52998224725";

psql(`
  set session_replication_role = replica;
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (${lit(profileId)}, ${lit(randomUUID())}, 'professional', 'Local R10 concurrency',
          ${lit(`r10-${profileId}@local.invalid`)}, 'active');
  insert into public.clinics (id, name, owner_profile_id)
  values (${lit(clinicId)}, 'Local R10 concurrency clinic', ${lit(profileId)});
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
  values (${lit(clinicId)}, 'Local R10 concurrency identity', ${lit(taxId)}, 'r10@billing.invalid');
  insert into private.billing_accounts (id, owner_profile_id, clinic_id, provider, environment)
  values (${lit(accountId)}, ${lit(profileId)}, ${lit(clinicId)}, 'asaas', 'sandbox');
  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (${lit(contractId)}, ${lit(clinicId)}, ${lit(randomUUID())}, 39000, 'BRL', 'monthly', 'active', clock_timestamp());
  insert into private.billing_hosted_card_checkout_attempts (
    id, billing_account_id, commercial_contract_id, environment, status, attempt_number,
    external_reference, provider_checkout_id, expires_at
  ) values (${lit(attemptId)}, ${lit(accountId)}, ${lit(contractId)}, 'sandbox', 'active', 1,
            ${lit(reference)}, ${lit(checkoutId)}, clock_timestamp() + interval '60 minutes');
  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, payload_hash, processing_status, event_created_at
  ) values
    (${lit(createdEventId)}, 'asaas', 'sandbox', 'evt_r10_concurrent_created', 'PAYMENT_CREATED', repeat('c', 64), 'processing', clock_timestamp()),
    (${lit(confirmedEventId)}, 'asaas', 'sandbox', 'evt_r10_concurrent_confirmed', 'PAYMENT_CONFIRMED', repeat('d', 64), 'processing', clock_timestamp());
`);

function adoptionCall(eventId, externalEventId, status, financialState, eventType) {
  return `select public.apply_hosted_card_payment_with_customer_adoption(
    ${lit(eventId)}::uuid, ${lit(externalEventId)}, 'sandbox', ${lit(checkoutId)}, ${lit(paymentId)},
    ${lit(subscriptionId)}, ${lit(customerId)}, ${lit(taxId)}, ${lit(status)}, ${lit(financialState)}, 'CREDIT_CARD',
    39000, 39000, null, current_date,
    ${eventType === "PAYMENT_CONFIRMED" ? "current_date" : "null"},
    ${eventType === "PAYMENT_CONFIRMED" ? "current_date" : "null"},
    ${lit(eventType)}, clock_timestamp()
  )->>'outcome';`;
}

try {
  const [created, confirmed] = await Promise.all([
    runConnection(adoptionCall(createdEventId, "evt_r10_concurrent_created", "PENDING", "pending", "PAYMENT_CREATED")),
    runConnection(adoptionCall(confirmedEventId, "evt_r10_concurrent_confirmed", "CONFIRMED", "confirmed", "PAYMENT_CONFIRMED")),
  ]);
  if (created.code !== 0 || confirmed.code !== 0) {
    throw new Error(`R10 concurrency RPC failed created=${created.err} confirmed=${confirmed.err}`);
  }
  if (created.out !== "applied" || confirmed.out !== "applied") {
    throw new Error(`R10 concurrency outcomes=${created.out},${confirmed.out}`);
  }

  const facts = psql(`select concat_ws('|',
    (select count(*) from private.billing_accounts where id = ${lit(accountId)} and external_customer_id = ${lit(customerId)}),
    (select count(*) from private.billing_subscriptions where external_subscription_id = ${lit(subscriptionId)}),
    (select count(*) from private.billing_payments where external_payment_id = ${lit(paymentId)}),
    (select count(*) from private.billing_provider_events where id in (${lit(createdEventId)}::uuid, ${lit(confirmedEventId)}::uuid) and processing_status = 'processed')
  );`);
  if (facts !== "1|1|1|2") throw new Error(`R10 concurrency canonical facts=${facts}`);
  console.log("HOSTED_CARD_CUSTOMER_ADOPTION_CONCURRENCY_PASS customer=1 subscription=1 payment=1 events=2");
} finally {
  psql(`
    set session_replication_role = replica;
    delete from private.billing_payments where external_payment_id = ${lit(paymentId)};
    delete from private.billing_subscriptions where external_subscription_id = ${lit(subscriptionId)};
    delete from private.billing_provider_events where id in (${lit(createdEventId)}::uuid, ${lit(confirmedEventId)}::uuid);
    delete from private.billing_hosted_card_checkout_attempts where id = ${lit(attemptId)};
    delete from private.billing_accounts where id = ${lit(accountId)};
    delete from private.billing_customer_identities where clinic_id = ${lit(clinicId)};
    delete from private.billing_commercial_contracts where id = ${lit(contractId)};
    delete from public.clinics where id = ${lit(clinicId)};
    delete from public.profiles where id = ${lit(profileId)};
  `);
}
