// ASAAS-03C — helpers de teste compartilhados (Vitest). NÃO é código de produção: não é
// importado por nenhum arquivo de supabase/functions fora de *.test.ts.
import { vi } from "vitest";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function emptyResponse(status: number): Response {
  return new Response("", { status });
}

export function malformedResponse(status: number): Response {
  return new Response("{not-valid-json", { status, headers: { "content-type": "application/json" } });
}

export type RpcCall = { name: string; params: Record<string, unknown> };

/** Fake mínimo de SupabaseClient: só .rpc(name, params). Casts `as any` no call site (estes
 * arquivos de teste não passam por `tsc --noEmit`, só pelo transform do Vitest). */
export function makeAdminClient(
  handler: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (name: string, params: Record<string, unknown> = {}) => {
    calls.push({ name, params });
    return handler(name, params);
  });
  return { adminClient: { rpc } as unknown, calls };
}

/** Lê o body JSON enviado numa chamada de fetch mockada (para ecoar externalReference etc). */
export function readSentBody(init: RequestInit | undefined): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") return {};
  return JSON.parse(init.body) as Record<string, unknown>;
}
