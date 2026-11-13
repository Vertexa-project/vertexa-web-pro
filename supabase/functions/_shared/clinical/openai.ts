// Consulta assistida — adaptador OpenAI (só roda com o secret OPENAI_API_KEY; sem ele, modo demonstração).
// Secrets: OPENAI_API_KEY (obrigatório p/ ligar), CLINICAL_TRANSCRIBE_MODEL (padrão gpt-4o-transcribe;
// aceita whisper-1), CLINICAL_STRUCTURE_MODEL (padrão gpt-4.1-mini).
import { DEMO_ORD_STRIDE } from "./demoScript.ts";

export interface TranscribedSegment {
  ord: number;
  start_ms: number;
  speaker: string | null;
  text: string;
}

/** Divide um texto corrido em trechos de até `max` caracteres, cortando em fim de frase. */
export function splitIntoSegments(text: string, max = 420): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function segmentsFromText(seq: number, text: string, durationMs: number | null): TranscribedSegment[] {
  const parts = splitIntoSegments(text);
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  let acc = 0;
  return parts.map((p, i) => {
    const start = durationMs ? Math.round((acc / total) * durationMs) : i * 15_000;
    acc += p.length;
    return { ord: seq * DEMO_ORD_STRIDE + i, start_ms: start, speaker: null, text: p };
  });
}

export async function openaiTranscribe(
  apiKey: string,
  audio: Blob,
  filename: string,
  seq: number,
  durationMs: number | null,
): Promise<TranscribedSegment[]> {
  const model = Deno.env.get("CLINICAL_TRANSCRIBE_MODEL") ?? "gpt-4o-transcribe";
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  form.append("language", "pt");
  form.append("response_format", model === "whisper-1" ? "verbose_json" : "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcribe_provider_${res.status}`);
  const body = (await res.json()) as { text?: string; segments?: Array<{ start: number; text: string }> };
  if (model === "whisper-1" && Array.isArray(body.segments) && body.segments.length > 0) {
    return body.segments
      .filter((s) => s.text.trim())
      .map((s, i) => ({ ord: seq * DEMO_ORD_STRIDE + i, start_ms: Math.round(s.start * 1000), speaker: null, text: s.text.trim() }));
  }
  return segmentsFromText(seq, body.text ?? "", durationMs);
}

export async function openaiStructure(
  apiKey: string,
  system: string,
  user: string,
  jsonSchema: Record<string, unknown>,
): Promise<unknown> {
  const model = Deno.env.get("CLINICAL_STRUCTURE_MODEL") ?? "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "prontuario", strict: true, schema: jsonSchema } },
    }),
  });
  if (!res.ok) throw new Error(`structure_provider_${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content ?? "";
  return JSON.parse(content);
}
