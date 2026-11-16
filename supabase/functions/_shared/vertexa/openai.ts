// Vertexa IA — adaptador OpenAI (só roda com o secret OPENAI_API_KEY; sem ele, modo demonstração).
// Modelo: VERTEXA_AI_MODEL (padrão gpt-4.1-mini).
import { REPLY_JSON_SCHEMA } from "./prompt.ts";

export async function openaiReply(apiKey: string, system: string, user: string): Promise<unknown> {
  const model = Deno.env.get("VERTEXA_AI_MODEL") ?? "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "vertexa_reply", strict: true, schema: REPLY_JSON_SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`vertexa_provider_${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return JSON.parse(body.choices?.[0]?.message?.content ?? "null");
}

/** Normaliza a saída crua do modelo para AiReply (campos fora do formato viram null → inválida). */
export function toAiReply(raw: unknown): import("./types.ts").AiReply | null {
  const r = raw as { text?: unknown; items?: unknown; draft?: unknown } | null;
  if (!r || typeof r.text !== "string" || !Array.isArray(r.items)) return null;
  const items = r.items
    .filter((i): i is { text: string; source: string; uncertain?: boolean } => typeof (i as any)?.text === "string" && typeof (i as any)?.source === "string")
    .map((i) => ({ text: i.text, source: i.source, uncertain: Boolean(i.uncertain) }));
  if (items.length !== r.items.length) return null;
  let draft = null;
  const d = r.draft as any;
  if (d) {
    if (!["mensagem", "resumo_retorno", "lista_ligacoes"].includes(d.kind) || typeof d.body !== "string" || typeof d.title !== "string" || !Array.isArray(d.fields)) return null;
    draft = {
      kind: d.kind, title: d.title, body: d.body, patientId: null, patientName: null,
      fields: d.fields.map((f: any) => ({ label: String(f.label), value: String(f.value), source: String(f.source), uncertain: Boolean(f.uncertain) })),
    };
  }
  return { text: r.text, items, draft, actions: [], blocked: null };
}
