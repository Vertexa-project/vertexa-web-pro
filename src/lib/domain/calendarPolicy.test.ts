import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_GOOGLE_WRITE_SCOPES,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_CALENDAR_LIST_FIELDS,
  GOOGLE_EVENT_LIST_FIELDS,
  PLAINTEXT_TOKEN_COLUMN_NAMES,
  calendarAuthHttpStatus,
  disconnectResultPayload,
  isOAuthStateExpired,
  oauthStateHasProfessional,
  parseOAuthCallbackSearch,
  payloadExposesRefreshToken,
  resolveSafeRedirectOrigin,
  scopesAreReadOnly,
  selectCallerMembership,
  selectOwnGoogleConnection,
  type CalendarConnectionRow,
  type CalendarMembership,
} from "./calendarPolicy";

const PROF_A = "11111111-1111-1111-1111-111111111111";
const PROF_B = "22222222-2222-2222-2222-222222222222";
const CLINIC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLINIC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function membership(over: Partial<CalendarMembership> = {}): CalendarMembership {
  return {
    professionalId: PROF_A,
    clinicId: CLINIC_A,
    professionalStatus: "active",
    clinicStatus: "active",
    ...over,
  };
}

function conn(over: Partial<CalendarConnectionRow> = {}): CalendarConnectionRow {
  return {
    id: "conn-a",
    clinic_id: CLINIC_A,
    professional_id: PROF_A,
    provider: "google",
    status: "connected",
    updated_at: "2026-09-10T12:00:00Z",
    ...over,
  };
}

describe("CAL02A — caller membership (JWT-derived, hints never authority)", () => {
  it("CAL02A-01: profissional autenticado resolve a própria membership", () => {
    const out = selectCallerMembership([membership()]);
    expect(out).toEqual({ ok: true, membership: membership() });
  });

  it("CAL02A-02: profissional A não inicia OAuth de B (hint professionalId)", () => {
    const out = selectCallerMembership([membership()], { professionalId: PROF_B });
    expect(out).toEqual({ ok: false, error: "tenant_mismatch" });
  });

  it("CAL02A-03: profissional da clínica A não passa clínica B", () => {
    const out = selectCallerMembership([membership()], { clinicId: CLINIC_B });
    expect(out).toEqual({ ok: false, error: "tenant_mismatch" });
  });

  it("CAL02A-04: Platform Admin / sem professional membership → 403 not_professional", () => {
    expect(selectCallerMembership([])).toEqual({ ok: false, error: "not_professional" });
    expect(calendarAuthHttpStatus("not_professional")).toBe(403);
  });

  it("CAL02A-05: profissional inativo ou clínica suspensa → fail closed", () => {
    expect(selectCallerMembership([membership({ professionalStatus: "inactive" })])).toEqual({
      ok: false,
      error: "professional_inactive",
    });
    expect(selectCallerMembership([membership({ clinicStatus: "suspended" })])).toEqual({
      ok: false,
      error: "clinic_suspended",
    });
    expect(calendarAuthHttpStatus("clinic_suspended")).toBe(403);
  });

  it("CAL02A-06: membership escolhida é a do caller (hint só confirma a própria)", () => {
    const own = membership();
    const out = selectCallerMembership([own], {
      clinicId: CLINIC_A,
      professionalId: PROF_A,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.membership.professionalId).toBe(PROF_A);
      expect(out.membership.clinicId).toBe(CLINIC_A);
    }
  });

  it("status nulo do profissional conta como ativo (espelho coalesce do banco)", () => {
    expect(selectCallerMembership([membership({ professionalStatus: null })]).ok).toBe(true);
  });

  it("duas memberships sem hint → ambiguous (não escolhe clínica alheia)", () => {
    const out = selectCallerMembership([
      membership(),
      membership({ professionalId: "p-other-own", clinicId: CLINIC_B }),
    ]);
    expect(out).toEqual({ ok: false, error: "ambiguous_membership" });
  });
});

describe("CAL02A — OAuth callback params / state TTL", () => {
  it("CAL02A-07: callback exige state e code; ignora clinic_id do query", () => {
    const ok = parseOAuthCallbackSearch(
      new URLSearchParams("code=abc&state=s1&clinic_id=evil"),
    );
    expect(ok).toEqual({ ok: true, code: "abc", state: "s1" });
    expect(parseOAuthCallbackSearch(new URLSearchParams("code=abc"))).toEqual({
      ok: false,
      reason: "missing_state",
    });
  });

  it("CAL02A-08: state expirado é detectado", () => {
    expect(isOAuthStateExpired("2026-09-10T10:00:00Z", Date.parse("2026-09-10T10:00:01Z"))).toBe(
      true,
    );
    expect(isOAuthStateExpired("2026-09-10T10:01:00Z", Date.parse("2026-09-10T10:00:00Z"))).toBe(
      false,
    );
  });

  it("erro OAuth do Google (access_denied) não vira success", () => {
    expect(parseOAuthCallbackSearch(new URLSearchParams("state=s1&error=access_denied"))).toEqual({
      ok: false,
      reason: "oauth_error",
    });
  });

  it("CAL02A-22a: state sem professional_id não é autoridade", () => {
    expect(oauthStateHasProfessional(null)).toBe(false);
    expect(oauthStateHasProfessional("")).toBe(false);
    expect(oauthStateHasProfessional(PROF_A)).toBe(true);
  });
});

describe("CAL02A — connection ownership", () => {
  it("CAL02A-09/20: sync/read escolhe só a conexão do próprio professional", () => {
    const rows = [
      conn({ id: "b", professional_id: PROF_B, updated_at: "2026-09-11T00:00:00Z" }),
      conn({ id: "a", professional_id: PROF_A, updated_at: "2026-09-09T00:00:00Z" }),
    ];
    expect(selectOwnGoogleConnection(rows, PROF_A, CLINIC_A)?.id).toBe("a");
  });

  it("CAL02A-10/12/21: admin/outro professional não seleciona a conexão de B", () => {
    const onlyB = [conn({ professional_id: PROF_B })];
    expect(selectOwnGoogleConnection(onlyB, PROF_A, CLINIC_A)).toBeNull();
  });

  it("prioriza status=connected sobre revoked mais recente", () => {
    const rows = [
      conn({ id: "revoked", status: "revoked", updated_at: "2026-09-12T00:00:00Z" }),
      conn({ id: "good", status: "connected", updated_at: "2026-09-01T00:00:00Z" }),
    ];
    expect(selectOwnGoogleConnection(rows, PROF_A, CLINIC_A)?.id).toBe("good");
  });
});

describe("CAL02A — disconnect payload / tokens", () => {
  it("CAL02A-11/13: revoke falho não inclui token no payload", () => {
    const payload = disconnectResultPayload(1, "failed");
    expect(payload).toEqual({ disconnected: true, removed: 1, provider_revocation: "failed" });
    expect(payloadExposesRefreshToken(payload)).toBe(false);
  });

  it("CAL02A-14: disconnect local reporta removed da própria conexão", () => {
    expect(disconnectResultPayload(1, "ok").removed).toBe(1);
    expect(disconnectResultPayload(0, "skipped").removed).toBe(0);
  });

  it("CAL02A-18: resposta de connect (só url) não vaza refresh_token", () => {
    expect(payloadExposesRefreshToken({ url: "https://accounts.google.com/o/oauth2/v2/auth" })).toBe(
      false,
    );
    expect(payloadExposesRefreshToken({ refresh_token: "x" })).toBe(true);
  });

  it("CAL02A-19: colunas plaintext de token estão na lista de regressão (não recriar)", () => {
    expect(PLAINTEXT_TOKEN_COLUMN_NAMES).toEqual(["refresh_token", "access_token"]);
  });
});

describe("CAL02A — redirect allowlist fail-closed", () => {
  it("CAL02A-15: allowlist ausente não aceita origem alguma", () => {
    expect(resolveSafeRedirectOrigin("http://localhost:5173", "")).toEqual({
      ok: false,
      error: "redirect_not_configured",
    });
    expect(resolveSafeRedirectOrigin("https://evil.example", null)).toEqual({
      ok: false,
      error: "redirect_not_configured",
    });
    expect(calendarAuthHttpStatus("redirect_not_configured")).toBe(503);
  });

  it("CAL02A-16: origem arbitrária é negada", () => {
    expect(
      resolveSafeRedirectOrigin("https://evil.example", "http://localhost:5173,https://app.vertexa.com"),
    ).toEqual({ ok: false, error: "redirect_origin_denied" });
    expect(resolveSafeRedirectOrigin("javascript:alert(1)", "http://localhost:5173")).toEqual({
      ok: false,
      error: "redirect_origin_denied",
    });
  });

  it("origem listada é aceita (só o origin, sem path)", () => {
    expect(
      resolveSafeRedirectOrigin("http://localhost:5173/configuracoes", "http://localhost:5173"),
    ).toEqual({ ok: true, origin: "http://localhost:5173" });
  });
});

describe("CAL02A — scopes read-only / Meet minimization", () => {
  it("CAL02A-17: scopes pedidos são exatamente events.readonly + calendarlist.readonly", () => {
    expect([...GOOGLE_CALENDAR_SCOPES]).toEqual([
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    expect(scopesAreReadOnly(GOOGLE_CALENDAR_SCOPES)).toBe(true);
    expect(scopesAreReadOnly([...GOOGLE_CALENDAR_SCOPES, FORBIDDEN_GOOGLE_WRITE_SCOPES[0]])).toBe(
      false,
    );
  });

  it("listagem Google pede só id/summary/status/start/end (sem attendees/Meet)", () => {
    expect(GOOGLE_EVENT_LIST_FIELDS).toBe("items(id,status,summary,start,end),nextPageToken");
    expect(GOOGLE_EVENT_LIST_FIELDS).not.toMatch(/attendee|description|hangout|conference|creator|organizer/i);
    expect(GOOGLE_CALENDAR_LIST_FIELDS).toBe("items(id,summary,primary)");
    expect(GOOGLE_CALENDAR_LIST_FIELDS).not.toMatch(/attendee|description|hangout|conference/i);
  });
});
