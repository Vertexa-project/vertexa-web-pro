// Validação de saída (regras do guia): número só se vier do sistema; sem diagnóstico/prescrição;
// fonte em cada frase; resultado SEMPRE rascunho (sem campo de "salvo/enviado").
import type { AiReply, Fact } from "./types.ts";

const NUM_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;

/** Normaliza "1.748,5" / "12,5" / "12.5" → forma comparável. Pontos de milhar saem. */
export function normNumber(raw: string): string {
  let s = raw;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  return s.replace(",", ".").replace(/^0+(?=\d)/, "");
}

export function numbersIn(text: string): string[] {
  return (text.match(NUM_RE) ?? []).map(normNumber);
}

/** Números que a IA pode citar: tudo que aparece nos fatos (rótulo, valor, e o dia/hora deles). */
export function allowedNumbers(facts: Fact[], extra: string[] = []): Set<string> {
  const set = new Set<string>();
  for (const f of facts) {
    for (const part of [f.label, f.value == null ? "" : String(f.value), f.source]) numbersIn(part).forEach((n) => set.add(n));
  }
  for (const e of extra) numbersIn(e).forEach((n) => set.add(n));
  return set;
}

const FORBIDDEN: RegExp[] = [
  /\bdiagnostic(o|ar|amos|ou)\b/i,
  /\bo paciente (tem|esta com|sofre de)\b.*\b(diabetes|hipertens|obesidade|depress|anemia|cancer|doenca)/i,
  /\b(prescrev|prescrevo|prescrevemos|receito|recomendo (tomar|usar))\b/i,
  /\btome\b|\btomar \d|\b\d+\s?(mg|mcg|ui|ml)\b/i,
  /\bdose\b/i,
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export type ValidationResult = { ok: true } | { ok: false; reason: "numero_fora_do_sistema" | "diagnostico_ou_prescricao" | "sem_fonte"; detail: string };

function allText(r: AiReply): string[] {
  return [r.text, ...r.items.map((i) => i.text), ...(r.draft ? [r.draft.body, r.draft.title, ...r.draft.fields.map((f) => f.value)] : [])];
}

export function validateReply(reply: AiReply, facts: Fact[], extraAllowed: string[] = []): ValidationResult {
  const texts = allText(reply);
  for (const t of texts) {
    // Por frase: recusa explícita do sistema ("não diagnostico") não conta; o resto da mensagem continua valendo.
    for (const sentence of norm(t).split(/[.!?\n]+/)) {
      if (/(^|\s)(nao|sem) (posso |faco |vou )?(diagnostic|prescrev)/.test(sentence)) continue;
      for (const re of FORBIDDEN) if (re.test(sentence)) return { ok: false, reason: "diagnostico_ou_prescricao", detail: re.source };
    }
  }
  const allowed = allowedNumbers(facts, extraAllowed);
  for (const t of texts) {
    for (const n of numbersIn(t)) {
      if (!allowed.has(n)) return { ok: false, reason: "numero_fora_do_sistema", detail: n };
    }
  }
  for (const i of reply.items) if (!i.source.trim()) return { ok: false, reason: "sem_fonte", detail: i.text.slice(0, 40) };
  if (reply.draft) for (const f of reply.draft.fields) if (!f.source.trim()) return { ok: false, reason: "sem_fonte", detail: f.label };
  return { ok: true };
}

export const SAFE_FALLBACK: AiReply = {
  text: "Não consegui montar uma resposta segura com os dados carregados. Nada foi criado ou salvo. Tente de novo ou abra a tela pelo menu.",
  items: [],
  draft: null,
  actions: [],
  blocked: null,
};
