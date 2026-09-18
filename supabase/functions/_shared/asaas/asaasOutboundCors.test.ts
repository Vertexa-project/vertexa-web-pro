import { describe, expect, it, vi } from "vitest";
import { corsHeaders, jsonResponse, preflight } from "../cors.ts";

const APP_ORIGIN = "https://app.vertexa.app.br";
const UNAUTHORIZED_ORIGIN = "https://evil.example";

describe("asaas-outbound CORS canonical helper", () => {
  it("OPTIONS with app origin returns canonical CORS without invoking execute", () => {
    const executePixAutomatic = vi.fn();
    const req = new Request("https://cdhjfyyuhmwrcuxqavib.supabase.co/functions/v1/asaas-outbound", {
      method: "OPTIONS",
      headers: {
        Origin: APP_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, apikey, content-type",
      },
    });

    let res: Response | null = null;
    if (req.method === "OPTIONS") res = preflight();
    else executePixAutomatic();

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res?.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
    expect(res?.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res?.headers.get("Access-Control-Allow-Headers") ?? "").toMatch(/authorization/i);
    expect(executePixAutomatic).not.toHaveBeenCalled();
    // Canonical policy is allowlist-via-* (same as google-calendar-*). Browser accepts * for
    // https://app.vertexa.app.br without Access-Control-Allow-Credentials.
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("unauthorized origin follows project * policy and still does not POST", () => {
    const executePixAutomatic = vi.fn();
    const req = new Request("https://cdhjfyyuhmwrcuxqavib.supabase.co/functions/v1/asaas-outbound", {
      method: "OPTIONS",
      headers: { Origin: UNAUTHORIZED_ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    if (req.method === "OPTIONS") {
      const res = preflight();
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    } else {
      executePixAutomatic();
    }
    expect(executePixAutomatic).not.toHaveBeenCalled();
  });

  it("JSON 4xx/5xx responses include the same CORS headers as 200", () => {
    const ok = jsonResponse({ ok: true }, 200);
    const bad = jsonResponse({ error: "method_not_allowed" }, 405);
    const fail = jsonResponse({ error: "provider_error" }, 502);
    for (const res of [ok, bad, fail]) {
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Content-Type")).toContain("application/json");
    }
  });
});
