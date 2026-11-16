// Vertexa IA — adaptador OpenAI (só roda com o secret OPENAI_API_KEY; sem ele, modo demonstração).
// Modelo: VERTEXA_AI_MODEL (padrão gpt-4.1-mini).
import { REPLY_JSON_SCHEMA } from "./prompt.ts";
import type { AiReply } from "./types.ts";

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

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** Normaliza a saída crua do modelo para AiReply (campos fora do formato viram null → inválida). */
export function toAiReply(raw: unknown): AiReply | null {
  if (!isObj(raw) || typeof raw.text !== "string" || !Array.isArray(raw.items)) return null;
  const items: AiReply["items"] = [];
  for (const i of raw.items) {
    if (!isObj(i) || typeof i.text !== "string" || typeof i.source !== "string") return null;
    items.push({ text: i.text, source: i.source, uncertain: Boolean(i.uncertain) });
  }
  let draft: AiReply["draft"] = null;
  const d = raw.draft;
  if (d) {
    if (!isObj(d) || !["mensagem", "resumo_retorno", "lista_ligacoes"].includes(String(d.kind)) || typeof d.body !== "string" || typeof d.title !== "string" || !Array.isArray(d.fields)) return null;
    const fields: NonNullable<AiReply["draft"]>["fields"] = [];
    for (const f of d.fields) {
      if (!isObj(f)) return null;
      fields.push({ label: String(f.label), value: String(f.value), source: String(f.source), uncertain: Boolean(f.uncertain) });
    }
    draft = { kind: d.kind as NonNullable<AiReply["draft"]>["kind"], title: d.title, body: d.body, patientId: null, patientName: null, fields };
  }
  return { text: raw.text, items, draft, actions: [], blocked: null };
}
