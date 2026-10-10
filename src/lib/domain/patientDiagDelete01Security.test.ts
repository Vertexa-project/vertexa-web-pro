import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION = "supabase/migrations/20261010120000_wp_patient_diag_delete_01_unused_patient_delete.sql";
const MIGRATION_B = "supabase/migrations/20261010120100_wp_patient_diag_delete_01b_close_direct_patient_delete.sql";
const UI_FILES = [
  "src/components/patient/PatientDeleteSection.tsx",
  "src/components/patient/PatientEditDialog.tsx",
  "src/hooks/usePatients.ts",
  "src/lib/api/patients.ts",
  "src/lib/domain/patientDeletion.ts",
];

/** Só o código executável: sem `-- comentários` nem `comment on ... is '...';`. */
function sqlCode(sql: string): string {
  return sql.replace(/comment on [\s\S]*?';\s*$/gm, "").replace(/--.*$/gm, "");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("WP-PATIENT-DIAG-DELETE-01 — contratos de fonte", () => {
  it("migration: DEFINER, search_path vazio, anon revogado, sem billing e sem escrita em auth", () => {
    const sql = sqlCode(readFileSync(resolve(root, MIGRATION), "utf8"));
    expect(sql).toContain("create or replace function public.delete_unused_patient_registration(p_patient_id uuid)");
    expect(sql).toContain("create or replace function public.get_patient_deletion_eligibility(p_patient_id uuid)");
    expect(sql.match(/security definer\s+set search_path = ''/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("revoke all on function public.delete_unused_patient_registration(uuid) from public, anon;");
    expect(sql).toContain("revoke all on function public.get_patient_deletion_eligibility(uuid) from public, anon;");
    expect(sql).toContain("private.is_clinic_admin(v_clinic)");
    expect(sql).toContain("private.identity_email_lock(");
    expect(sql).toMatch(/where pt\.id = p_patient_id for update/);
    expect(sql).not.toMatch(/billing_|asaas|entitlement/i);
    expect(sql).not.toMatch(/(delete\s+from|update|insert\s+into)\s+auth\./i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.patient_registration_events/i);
  });

  it("migration 01b fecha o DELETE direto em patients (policy + grants)", () => {
    const sql = sqlCode(readFileSync(resolve(root, MIGRATION_B), "utf8"));
    expect(sql).toContain("drop policy if exists patients_admin_delete on public.patients;");
    expect(sql).toContain("revoke delete, truncate on table public.patients from anon, authenticated;");
    expect(sql).not.toMatch(/create policy|grant\s+(delete|truncate|all)/i);
  });

  it("regra Gmail é só chave de RISCO destrutiva; semântica de identidade/login intocada", () => {
    const sql = sqlCode(readFileSync(resolve(root, MIGRATION), "utf8"));
    expect(sql).toContain("create or replace function private.destructive_identity_risk_key(p_email text)");
    expect(sql).toContain("= 'gmail.com'");
    expect(sql).not.toMatch(/googlemail|identity_email_canonical/i);
    for (const f of [MIGRATION, MIGRATION_B]) {
      const code = sqlCode(readFileSync(resolve(root, f), "utf8"));
      expect(code, f).not.toMatch(
        /function\s+(public|private)\.(handle_new_user|ensure_auth_profile|ensure_my_profile|create_patient|update_patient_registration|identity_email_lock)\s*\(/i,
      );
      expect(code, f).not.toMatch(/(create|drop)\s+trigger/i);
    }
  });

  it("UI/API da exclusão: só RPC; sem service_role; sem DELETE direto em tabela", () => {
    for (const f of UI_FILES) {
      const src = readFileSync(resolve(root, f), "utf8");
      expect(src, f).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_/);
    }
    const api = readFileSync(resolve(root, "src/lib/api/patients.ts"), "utf8");
    expect(api).toContain('supabase.rpc("delete_unused_patient_registration"');
    expect(api).toContain('supabase.rpc("get_patient_deletion_eligibility"');
  });

  it("nenhum código do web apaga patients/profiles direto pelo PostgREST", () => {
    const offenders = walk(resolve(root, "src")).filter((p) =>
      /from\(\s*["'](patients|profiles)["']\s*\)[\s\S]{0,80}\.delete\(/.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
