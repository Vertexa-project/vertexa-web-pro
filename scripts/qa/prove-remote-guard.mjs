/**
 * AUTH-EMAIL-05 — prova que a factory recusa o Supabase remoto antes de mutar.
 * Não envia credencial de produção.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertFactoryApiUrl } from "./localTarget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const factory = path.join(root, "scripts", "qa", "create-e2e-fixtures.mjs");
const remote = "https://cdhjfyyuhmwrcuxqavib.supabase.co";

let refused = false;
try {
  assertFactoryApiUrl(remote, "api");
} catch (error) {
  refused = /REFUSED/i.test(error instanceof Error ? error.message : "");
}
if (!refused) {
  console.error("FAIL guard-unit — URL de produção não foi recusada");
  process.exit(1);
}
console.info("PASS guard-unit");

const result = spawnSync(process.execPath, [factory], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    E2E_FORCE_API_URL: remote,
    E2E_PASSWORD: undefined,
  },
});
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status === 0) {
  console.error("FAIL guard-factory — execução remota não foi recusada");
  process.exit(1);
}
if (!/REFUSED|recusou|produção|supabase\.co/i.test(output)) {
  console.error("FAIL guard-factory — recusa sem mensagem de alvo remoto");
  process.exit(1);
}
if (/created user|PASS owner-fixture|PASS factory/i.test(output)) {
  console.error("FAIL guard-factory — mutação após recusa");
  process.exit(1);
}
console.info("PASS guard-factory-refused-before-mutation");
