import { describe, expect, it, vi } from "vitest";

import { handlePrescriptionWebhook, hmacHex, parseCanonical, safeEqual, type CanonicalSigned } from "./webhook";

const SESSION = "0b8f2c1e-5a43-4d36-9c0e-2f7a1b6d8e90";
const body = (o: Record<string, unknown> = {}) => JSON.stringify({ session_id: SESSION, external_id: "EXT-1", title: "Receita", content: "x", items: [{ name: "Med", dose: "1", posology: "2x", quantity: "3" }], signed_at: "2026-11-18T12:00:00Z", sncr_number: "N-1", ...o });
const req = async (b: string, secret: string | null, method = "POST") =>
  new Request("https://x.test/prescription-webhook?provider=memed", { method, body: method === "POST" ? b : undefined, headers: secret ? { "x-vertexa-signature": await hmacHex(secret, b) } : {} });

describe("webhook do provedor de prescrição", () => {
  it("sem segredo configurado: 503 e nada é gravado", async () => {
    const ingest = vi.fn();
    const res = await handlePrescriptionWebhook(await req(body(), "s"), { provider: "memed", secret: undefined, ingest });
    expect(res.status).toBe(503); expect(ingest).not.toHaveBeenCalled();
  });
  it("assinatura errada ou ausente: 401", async () => {
    const ingest = vi.fn();
    expect((await handlePrescriptionWebhook(await req(body(), "outro"), { provider: "memed", secret: "s", ingest })).status).toBe(401);
    expect((await handlePrescriptionWebhook(await req(body(), null), { provider: "memed", secret: "s", ingest })).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("método diferente de POST: 405", async () => {
    expect((await handlePrescriptionWebhook(await req("", "s", "GET"), { provider: "memed", secret: "s", ingest: vi.fn() })).status).toBe(405);
  });
  it("payload válido assinado: chama a ingestão e devolve o id; repetição devolve duplicate", async () => {
    const ingest = vi.fn<(p: CanonicalSigned & { provider: string }) => Promise<{ ok: true; documentId: string; duplicate: boolean }>>()
      .mockResolvedValueOnce({ ok: true, documentId: "d1", duplicate: false }).mockResolvedValueOnce({ ok: true, documentId: "d1", duplicate: true });
    const deps = { provider: "memed" as const, secret: "s", ingest };
    const r1 = await handlePrescriptionWebhook(await req(body(), "s"), deps);
    const r2 = await handlePrescriptionWebhook(await req(body(), "s"), deps);
    expect(await r1.json()).toEqual({ document_id: "d1", duplicate: false });
    expect(await r2.json()).toEqual({ document_id: "d1", duplicate: true });
    expect(ingest.mock.calls[0][0]).toMatchObject({ provider: "memed", sessionId: SESSION, externalId: "EXT-1", sncrNumber: "N-1", signedAt: "2026-11-18T12:00:00.000Z" });
  });
  it("payload inválido (sem sessão, sem id externo, item sem nome): 400", async () => {
    const deps = { provider: "memed" as const, secret: "s", ingest: vi.fn() };
    for (const bad of [{ session_id: "nao-uuid" }, { external_id: " " }, { items: [{ dose: "1" }] }]) {
      expect((await handlePrescriptionWebhook(await req(body(bad), "s"), deps)).status).toBe(400);
    }
    expect(deps.ingest).not.toHaveBeenCalled();
  });
  it("falha na ingestão (sessão desconhecida): 422", async () => {
    const res = await handlePrescriptionWebhook(await req(body(), "s"), { provider: "memed", secret: "s", ingest: async () => ({ ok: false }) });
    expect(res.status).toBe(422);
  });
  it("utilitários: comparação em tempo constante e parse canônico", () => {
    expect(safeEqual("abc", "abc")).toBe(true); expect(safeEqual("abc", "abd")).toBe(false); expect(safeEqual("abc", "ab")).toBe(false);
    expect(parseCanonical(null)).toBeNull();
    expect(parseCanonical(JSON.parse(body({ items: Array.from({ length: 51 }, () => ({ name: "x" })) })))).toBeNull();
  });
});
