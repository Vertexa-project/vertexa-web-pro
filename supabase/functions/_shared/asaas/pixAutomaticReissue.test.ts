import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { makeAdminClient } from "./testHelpers.ts";
import {
  FORBIDDEN_REISSUE_BODY_KEYS,
  REISSUE_PIX_AUTOMATIC_ACTION,
  REISSUE_PIX_AUTOMATIC_RPC,
  hasForbiddenReissueKeys,
  invokeReissuePixAutomaticAuthorization,
  mapReissueRpcError,
  parseReissuePixAutomaticRequest,
  sanitizeReissueResponse,
} from "./pixAutomaticReissue.ts";

const here = dirname(fileURLToPath(import.meta.url));
const clinicId = "11111111-1111-4111-8111-111111111111";
const commercialContractId = "22222222-2222-4222-8222-222222222222";
const authorizationId = "33333333-3333-4333-8333-333333333333";

function validBody(over: Record<string, unknown> = {}) {
  return {
    action: REISSUE_PIX_AUTOMATIC_ACTION,
    clinicId,
    commercialContractId,
    authorizationId,
    ...over,
  };
}

describe("parseReissuePixAutomaticRequest", () => {
  it("aceita o contrato mínimo sem environment", () => {
    expect(parseReissuePixAutomaticRequest(validBody())).toEqual({
      ok: true,
      clinicId,
      commercialContractId,
      authorizationId,
      reason: null,
    });
  });

  it("rejeita UUID malformado", () => {
    expect(parseReissuePixAutomaticRequest(validBody({ clinicId: "not-a-uuid" }))).toEqual({
      ok: false,
      error: "reissue_ids_required",
    });
  });

  it("rejeita chaves proibidas", () => {
    for (const key of FORBIDDEN_REISSUE_BODY_KEYS) {
      expect(hasForbiddenReissueKeys(validBody({ [key]: "x" }))).toBe(true);
      expect(parseReissuePixAutomaticRequest(validBody({ [key]: "x" }))).toEqual({
        ok: false,
        error: "provider_payload_forbidden",
      });
    }
  });
});

describe("sanitizeReissueResponse", () => {
  it("expõe só metadados de produto", () => {
    const body = sanitizeReissueResponse({
      outcome: "reissued",
      old_authorization_id: authorizationId,
      new_authorization_id: "44444444-4444-4444-8444-444444444444",
      old_generation: 1,
      new_generation: 2,
      new_status: "INTENT",
      operation_id: "55555555-5555-4555-8555-555555555555",
      payload: "should-drop",
    });
    expect(body).toMatchObject({
      outcome: "reissued",
      oldGeneration: 1,
      newGeneration: 2,
      newStatus: "INTENT",
    });
    expect(JSON.stringify(body)).not.toContain("payload");
    expect(JSON.stringify(body)).not.toContain("should-drop");
  });
});

describe("invokeReissuePixAutomaticAuthorization", () => {
  it("PA + REFUSED chama o wrapper uma vez via userClient", async () => {
    const { adminClient, calls } = makeAdminClient(async () => ({
      data: {
        outcome: "reissued",
        old_authorization_id: authorizationId,
        new_authorization_id: "44444444-4444-4444-8444-444444444444",
        old_generation: 1,
        new_generation: 2,
        new_status: "INTENT",
        operation_id: null,
      },
      error: null,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const parsed = parseReissuePixAutomaticRequest(validBody());
    if (!parsed.ok) throw new Error("expected parse ok");
    const result = await invokeReissuePixAutomaticAuthorization(adminClient as never, parsed);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        name: REISSUE_PIX_AUTOMATIC_RPC,
        params: {
          p_clinic_id: clinicId,
          p_commercial_contract_id: commercialContractId,
          p_authorization_id: authorizationId,
          p_reason: null,
        },
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("ACTIVE/hint not refused vira 409", () => {
    expect(mapReissueRpcError({ hint: "BILLING_REISSUE_NOT_REFUSED" })).toEqual({
      status: 409,
      error: "authorization_not_refused",
    });
  });
});

describe("asaas-outbound reissue source contracts", () => {
  it("PA gate vem antes do reissue e o action não lê credencial nem asaasFetch", () => {
    const src = readFileSync(resolve(here, "../../asaas-outbound/index.ts"), "utf8");
    const adminIdx = src.indexOf("am_i_platform_admin");
    const reissueIdx = src.indexOf("REISSUE_PIX_AUTOMATIC_ACTION");
    const invokeIdx = src.indexOf("invokeReissuePixAutomaticAuthorization(userClient");
    const credIdx = src.lastIndexOf("readAsaasCredentials(environment)");
    const fetchIdx = src.indexOf("asaasFetch");
    expect(adminIdx).toBeGreaterThan(0);
    expect(invokeIdx).toBeGreaterThan(adminIdx);
    expect(credIdx).toBeGreaterThan(invokeIdx);
    expect(src).toContain('if (gate === "PA_ONLY" && !isPlatformAdmin)');
    expect(src).toContain('return jsonResponse(401, { error: "unauthorized" })');
    expect(src).toContain('return jsonResponse(403, { error: "forbidden" })');
    expect(src).toContain('gate === "PA_ONLY"');
    expect(src).toContain("userClient");
    expect(src).not.toContain("invokeReissuePixAutomaticAuthorization(supabaseAdmin");
    expect(src).not.toContain("invokeReissuePixAutomaticAuthorization(adminClient");
    expect(fetchIdx).toBe(-1);
    expect(reissueIdx).toBeGreaterThan(0);
    expect(src).not.toMatch(/console\.(log|debug|info|error|warn)\(/);
  });

  it("migration 05G1 é wrapper DEFINER sem HTTP e sem grant da private", () => {
    const sql = readFileSync(
      resolve(
        here,
        "../../../migrations/20260919190000_wp_asaas_05g1_pa_gated_pix_automatic_reissue.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("create table private.billing_pix_automatic_reissue_events");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("private.is_platform_admin()");
    expect(sql).toContain("private.current_profile_id()");
    expect(sql).toContain("private.billing_reissue_pix_automatic_authorization(");
    expect(sql).toContain("grant execute on function public.reissue_pix_automatic_authorization");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("revoke all on function public.reissue_pix_automatic_authorization");
    expect(sql).toContain("from public, anon, service_role");
    expect(sql).toContain("revoke all on table private.billing_pix_automatic_reissue_events");
    expect(sql).not.toMatch(/grant execute on function private\.billing_reissue_pix_automatic_authorization/);
    expect(sql).not.toMatch(/pg_net|net\.http|http_post|http_get|asaasFetch/i);
    expect(sql).not.toContain("p_environment");
    expect(sql).toContain("select a.environment");
    expect(sql).toContain("outcome = 'already_reissued'");
    expect(sql).toContain("list_platform_clinic_pix_automatic_statuses");
  });
});
