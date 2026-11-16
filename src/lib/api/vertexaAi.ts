import { supabase } from "@/lib/supabase";
import type { AiAskResult, AiScreenContext } from "@/types/vertexaAi";

async function invokeFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vertexa-ai", { body });
  if (error) {
    let code = "function_error";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = (await ctx.json()) as { error?: string };
        if (p?.error) code = String(p.error);
      } catch {
        // corpo não-JSON
      }
    } else if (ctx && typeof ctx.status === "number" && ctx.status === 404) {
      code = "not_deployed";
    }
    throw new Error(code);
  }
  return data as T;
}

export const askVertexaAi = (message: string, screen: AiScreenContext) =>
  invokeFn<AiAskResult>({ action: "ask", message, screen });

/** Rastro de quem aprovou/descartou o rascunho (sem o texto). Falha em silêncio: nunca trava o profissional. */
export async function resolveVertexaDraft(requestId: string | null | undefined, decision: "usado" | "descartado"): Promise<void> {
  if (!requestId) return;
  try {
    await invokeFn<{ ok: boolean }>({ action: "resolve", request_id: requestId, decision });
  } catch {
    // o rastro é best-effort aqui; o pedido já foi registrado pela função
  }
}

const MESSAGES: Record<string, string> = {
  not_deployed: "A Vertexa IA ainda não está ativa neste ambiente.",
  unauthenticated: "Sua sessão expirou. Entre de novo para falar com a Vertexa IA.",
  forbidden: "Seu perfil não tem acesso a esta clínica.",
  invalid_message: "Escreva um pedido de até 600 caracteres.",
};
export const friendlyAiError = (code: string) => MESSAGES[code] ?? "Não consegui responder agora. Nada foi criado ou salvo. Tente de novo.";
