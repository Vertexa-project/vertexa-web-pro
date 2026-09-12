import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type E2EFixtures = {
  run_id: string;
  emails: {
    owner: string;
    professional: string;
    patient: string;
    pending: string;
  };
  ids: {
    clinic_id: string;
    owner_profile_id: string;
    professional_profile_id: string;
  };
  password: string;
};

export function loadE2EFixtures(root = process.cwd()): E2EFixtures {
  const pubPath = path.join(root, ".tmp", "e2e-fixtures.json");
  const secPath = path.join(root, ".tmp", "e2e-secrets.json");
  if (!existsSync(pubPath) || !existsSync(secPath)) {
    throw new Error("artefatos E2E ausentes — rode npm run e2e:fixtures");
  }
  const pub = JSON.parse(readFileSync(pubPath, "utf8")) as Omit<E2EFixtures, "password">;
  const sec = JSON.parse(readFileSync(secPath, "utf8")) as { run_id?: string; password?: string };
  if (!pub.run_id || pub.run_id !== sec.run_id || !sec.password) {
    throw new Error("artefatos E2E inconsistentes");
  }
  return { ...pub, password: sec.password };
}
