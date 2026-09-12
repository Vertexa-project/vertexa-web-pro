/**
 * Lê API/anon/service do stack isolado. Nunca imprime chaves.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { assertFactoryApiUrl, assertLocalDbUrl } from "./localTarget.mjs";

export function resolveIsolatedStack(root, extraCandidates = []) {
  const candidates = [
    process.env.VERTEXA_AUTHEMAIL_STACK,
    path.join(root, ".tmp-authemail01"),
    ...extraCandidates,
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

export function loadIsolatedEnv(isolated) {
  const forcedUrl = process.env.E2E_FORCE_API_URL;
  if (forcedUrl) assertFactoryApiUrl(forcedUrl, "api");
  if (!isolated || !existsSync(isolated)) {
    throw new Error("stack: tmpdir isolado ausente");
  }
  const result = spawnSync("npx", ["--yes", "supabase@2.117.0", "status", "-o", "env"], {
    cwd: isolated,
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error("stack: supabase status falhou");
  }
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const get = (key) => text.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");
  const apiUrl = assertFactoryApiUrl(forcedUrl || get("API_URL"), "api");
  const anonKey = get("ANON_KEY") || get("PUBLISHABLE_KEY");
  const serviceKey = get("SERVICE_ROLE_KEY") || get("SECRET_KEY");
  const dbUrl = get("DB_URL");
  if (!anonKey || !serviceKey) {
    throw new Error("stack: env local incompleto");
  }
  if (dbUrl) assertLocalDbUrl(dbUrl, "db");
  return { apiUrl, anonKey, serviceKey, dbUrl: dbUrl ?? null, isolated };
}
