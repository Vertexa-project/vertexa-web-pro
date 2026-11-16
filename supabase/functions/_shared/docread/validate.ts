// Validação PURA dos campos lidos: faixas fisiológicas, formato, conta de conferência e verificação contra o texto.
// Usada na função (lado servidor) e na tela de Conferência (cada edição do profissional passa de novo por aqui).
import { CONFIDENCE_MIN, type DocKind, type ReadField } from "./types.ts";
import { parseDateBR, parseNumberBR, stripAccents } from "./numbers.ts";

export type Rule =
  | { type: "date" }
  | { type: "num"; lo: number; hi: number; unit: string; integer?: boolean }
  | { type: "time" }
  | { type: "text"; max: number };

const FAT_PCT: [number, number] = [2, 70];
export const BIO_RULES: Record<string, Rule> = {
  data: { type: "date" },
  peso: { type: "num", lo: 20, hi: 400, unit: "kg" },
  gordura_pct: { type: "num", lo: FAT_PCT[0], hi: FAT_PCT[1], unit: "%" },
  massa_magra: { type: "num", lo: 10, hi: 200, unit: "kg" },
  massa_muscular: { type: "num", lo: 5, hi: 120, unit: "kg" },
  agua: { type: "num", lo: 10, hi: 120, unit: "L" },
  gordura_visceral: { type: "num", lo: 1, hi: 30, unit: "", integer: true },
  tmb: { type: "num", lo: 500, hi: 5000, unit: "kcal", integer: true },
  cintura: { type: "num", lo: 30, hi: 250, unit: "cm" },
  quadril: { type: "num", lo: 30, hi: 250, unit: "cm" },
  abdomen: { type: "num", lo: 30, hi: 250, unit: "cm" },
};

/** Regra de um campo pela chave. Chaves desconhecidas → null (o campo é descartado). */
export function ruleFor(kind: DocKind, key: string): Rule | null {
  if (kind === "bioimpedancia") return BIO_RULES[key] ?? null;
  if (kind === "dieta") {
    if (/^m\d{1,2}\.time$/.test(key)) return { type: "time" };
    if (/^m\d{1,2}\.kcal$/.test(key)) return { type: "num", lo: 20, hi: 3000, unit: "kcal", integer: true };
    if (/^m\d{1,2}\.i\d{1,2}$/.test(key)) return { type: "text", max: 80 };
    return null;
  }
  if (/^d\d{1,2}\.e\d{1,2}\.sets$/.test(key)) return { type: "num", lo: 1, hi: 20, unit: "", integer: true };
  if (/^d\d{1,2}\.e\d{1,2}\.reps$/.test(key)) return { type: "num", lo: 1, hi: 100, unit: "", integer: true };
  if (/^d\d{1,2}\.e\d{1,2}\.load$/.test(key)) return { type: "num", lo: 0, hi: 500, unit: "kg" };
  return null;
}

const lim = (n: number) => String(n).replace(".", ",");

/** Erro em PT-BR ou null se o valor é aceitável. `today` = AAAA-MM-DD (data do exame não pode ser futura). */
export function validateValue(kind: DocKind, key: string, value: string | null | undefined, required: boolean, today?: string): string | null {
  const rule = ruleFor(kind, key);
  if (!rule) return "Campo desconhecido.";
  const v = (value ?? "").trim();
  if (v === "") return required ? "Preencha este campo." : null;
  switch (rule.type) {
    case "date": {
      const iso = parseDateBR(v);
      if (!iso) return "Data inválida. Use dia/mês/ano.";
      if (today && iso > today) return "A data do exame não pode ser futura.";
      return null;
    }
    case "time":
      return /^([01]?\d|2[0-3])[:h][0-5]\d$/.test(v) ? null : "Horário inválido. Use hh:mm.";
    case "text":
      return v.length <= rule.max ? null : `Texto longo demais (máx. ${rule.max}).`;
    case "num": {
      const n = parseNumberBR(v, { integer: rule.integer });
      if (n == null) return rule.integer ? "Use um número inteiro." : "Número inválido.";
      if (n < rule.lo || n > rule.hi) return `Fora da faixa esperada (${lim(rule.lo)} a ${lim(rule.hi)}${rule.unit ? " " + rule.unit : ""}).`;
      return null;
    }
  }
}

/** Aplica as regras a cada campo: fora da faixa, vazio obrigatório ou confiança baixa viram incertos. Não apaga valor. */
export function applyRules(kind: DocKind, fields: ReadField[], today?: string): ReadField[] {
  const out: ReadField[] = [];
  for (const f of fields) {
    if (!ruleFor(kind, f.key)) continue; // chave que o modelo inventou
    const err = validateValue(kind, f.key, f.value, false, today);
    let uncertain = f.uncertain;
    let reason = f.reason;
    if (f.value == null || f.value.trim() === "") {
      if (f.required) { uncertain = true; reason = reason ?? "Não encontrei no documento."; }
    } else if (err) {
      uncertain = true; reason = err;
    } else if (f.confidence < CONFIDENCE_MIN) {
      uncertain = true; reason = reason ?? "Leitura com pouca certeza.";
    } else if (!f.source) {
      uncertain = true; reason = reason ?? "Sem trecho de origem no documento.";
    }
    out.push({ ...f, uncertain, reason: uncertain ? reason : null });
  }
  return out;
}

/** Massa magra + massa de gordura deve bater com o peso (tolerância de 5% do peso). Senão marca para conferir. */
export function crossCheckBio(fields: ReadField[]): ReadField[] {
  const get = (k: string) => parseNumberBR(fields.find((f) => f.key === k)?.value ?? null);
  const peso = get("peso"), fat = get("gordura_pct"), magra = get("massa_magra");
  if (peso == null || fat == null || magra == null) return fields;
  const esperado = peso * (1 - fat / 100);
  if (Math.abs(esperado - magra) <= peso * 0.05) return fields;
  return fields.map((f) =>
    f.key === "massa_magra" || f.key === "gordura_pct"
      ? { ...f, uncertain: true, reason: "Massa magra, % de gordura e peso não batem entre si. Confira os três no documento." }
      : f,
  );
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * "O número vem do documento": quando há texto do arquivo, os dígitos do valor lido pela IA precisam aparecer nele.
 * Valor que a IA "calculou" ou inventou vira incerto.
 */
export function verifyAgainstText(fields: ReadField[], pages: string[]): ReadField[] {
  const hay = stripAccents(pages.join("\n"));
  const compact = hay.replace(/[\s.,]/g, "");
  return fields.map((f) => {
    if (f.value == null || f.value.trim() === "") return f;
    const v = f.value.trim();
    const d = digits(v);
    if (d === "") return f; // texto (nome de item) — sem número para conferir
    const present = hay.includes(stripAccents(v)) || compact.includes(d);
    return present ? f : { ...f, uncertain: true, reason: "Este número não aparece no texto do documento. Confira." };
  });
}

/** Nome do paciente no documento difere do paciente aberto? Compara o primeiro nome. */
export function checkPatientName(pages: string[], patientName: string | null | undefined): string | null {
  if (!patientName) return null;
  const text = pages.join("\n");
  const m = /(?:^|\n)\s*(?:nome(?: do paciente)?|paciente|cliente|name)\s*[:-]\s*([^\n\d]{3,60})/i.exec(text);
  if (!m) return null;
  const doc = stripAccents(m[1]).trim().split(/\s+/)[0];
  const mine = stripAccents(patientName).trim().split(/\s+/)[0];
  if (!doc || !mine || doc === mine) return null;
  return `O nome no documento (${m[1].trim()}) é diferente do paciente desta ficha. Confira se é o arquivo certo.`;
}
