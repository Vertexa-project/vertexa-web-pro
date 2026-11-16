// Adaptador OpenAI da leitura de documentos (só roda com o secret OPENAI_API_KEY). Modelo: VERTEXA_DOC_MODEL (padrão gpt-4.1-mini).
import { buildSystemPrompt, buildUserPrompt, DOC_JSON_SCHEMA } from "./model.ts";
import type { DocKind } from "./types.ts";

export interface FilePayload { mime: string; base64: string; name: string }

export async function openaiRead(apiKey: string, kind: DocKind, file: FilePayload, text: string | null): Promise<unknown> {
  const model = Deno.env.get("VERTEXA_DOC_MODEL") ?? "gpt-4.1-mini";
  const filePart = file.mime === "application/pdf"
    ? { type: "file", file: { filename: "documento.pdf", file_data: `data:application/pdf;base64,${file.base64}` } }
    : { type: "image_url", image_url: { url: `data:${file.mime};base64,${file.base64}`, detail: "high" } };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: [{ type: "text", text: buildUserPrompt(kind, text) }, filePart] },
      ],
      response_format: { type: "json_schema", json_schema: { name: "vertexa_doc_read", strict: true, schema: DOC_JSON_SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`vertexa_provider_${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return JSON.parse(body.choices?.[0]?.message?.content ?? "null");
}
