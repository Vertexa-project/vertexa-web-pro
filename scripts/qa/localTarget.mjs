/**
 * AUTH-EMAIL-05 — guard de alvo local.
 * Recusa *.supabase.co sem exceção.
 * ALLOW_REMOTE_E2E=1 é dívida futura e NÃO autoriza produção neste WP.
 */

export const QA_EMAIL_DOMAIN = "example.test";
export const RUN_ID_RE = /^e2e-[0-9]{8}-[a-z0-9]{6,12}$/;
export const FIXTURE_ROLES = ["owner", "professional", "patient", "pending"];

export function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new Error("run_id inválido — cleanup/factory recusados");
  }
  return runId;
}

export function newRunId(now = new Date()) {
  const ymd = now.toISOString().slice(0, 10).replaceAll("-", "");
  const rand = Math.random().toString(36).slice(2, 10);
  return `e2e-${ymd}-${rand}`;
}

export function qaEmail(runId, role) {
  assertRunId(runId);
  if (!FIXTURE_ROLES.includes(role)) throw new Error(`role QA inválido: ${role}`);
  return `qa+${runId}-${role}@${QA_EMAIL_DOMAIN}`;
}

export function isRunOwnedEmail(email, runId) {
  if (typeof email !== "string") return false;
  const value = email.trim().toLowerCase();
  return FIXTURE_ROLES.some((role) => value === qaEmail(runId, role).toLowerCase());
}

function parseUrl(value, label) {
  if (!value || typeof value !== "string") throw new Error(`${label}: ausente`);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label}: URL inválida`);
  }
}

export function assertLocalHostname(hostname, label) {
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`${label}: recusou hostname não local`);
  }
}

export function assertLocalHttpUrl(value, label = "api") {
  if (/supabase\.co/i.test(value ?? "")) {
    throw new Error(`${label}: REFUSED remote supabase.co`);
  }
  const url = parseUrl(value, label);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: protocolo recusado`);
  }
  assertLocalHostname(url.hostname, label);
  return url.toString().replace(/\/$/, "");
}

export function assertLocalDbUrl(value, label = "db") {
  if (/supabase\.co/i.test(value ?? "")) {
    throw new Error(`${label}: REFUSED remote supabase.co`);
  }
  const url = parseUrl(value, label);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${label}: protocolo recusado`);
  }
  assertLocalHostname(url.hostname, label);
  return value;
}

/**
 * Alvo da factory. ALLOW_REMOTE_E2E nunca libera *.supabase.co.
 * Produção conhecida (cdhjfyyuhmwrcuxqavib) é sempre recusada.
 */
export function assertFactoryApiUrl(value, label = "api") {
  if (process.env.ALLOW_REMOTE_E2E === "1") {
    // Future design debt only. This WP still refuses production/remote hosts.
  }
  if (/cdhjfyyuhmwrcuxqavib/i.test(value ?? "")) {
    throw new Error(`${label}: REFUSED production supabase project`);
  }
  return assertLocalHttpUrl(value, label);
}

export function clinicNameForRun(runId) {
  assertRunId(runId);
  return `QA E2E ${runId}`;
}

export function isRunOwnedClinicName(name, runId) {
  return typeof name === "string" && name === clinicNameForRun(runId);
}
