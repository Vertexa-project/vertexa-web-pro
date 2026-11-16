// Bioimpedância — leitura DETERMINÍSTICA do texto do PDF (modo demonstração): rótulos comuns de InBody/Tanita/laudos BR.
// Nunca calcula nem completa: o que não achar com segurança fica vazio e incerto.
import { fmtNumberBR, foldKeepLength, isoToBR, parseDateBR, parseNumberBR } from "./numbers.ts";
import { crossCheckBio, applyRules } from "./validate.ts";
import type { ReadField } from "./types.ts";

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const GAP = String.raw`(?:[\s:=|\-–.]|\([a-z%]{1,6}\)){0,14}`;
const UNIT = String.raw`(?:\s*(%|kg|kcal|cm|litros?|l)(?![a-z]))?`;

interface Def {
  key: string;
  label: string;
  unit: string | null;
  required: boolean;
  integer?: boolean;
  re: string;
  forbidUnit?: RegExp;
  prefixForbid?: RegExp;
}

const NOT_REL = /(relacao|razao|rcq)[^\n]{0,24}$/;

export const BIO_DEFS: Def[] = [
  { key: "data", label: "Data do exame", unit: null, required: true, re: "" },
  { key: "peso", label: "Peso", unit: "kg", required: true, re: String.raw`peso(?: corporal| atual| total)?(?! ideal| meta| alvo| desejado)`, forbidUnit: /^(%|l)$/, prefixForbid: /(ideal|meta|alvo|controle de|perder|ganhar|desejad\w*)\s*$/ },
  { key: "gordura_pct", label: "% de gordura", unit: "%", required: true, re: String.raw`(?:percentual de gordura(?: corporal)?|% de gordura(?: corporal)?|\bpgc\b|gordura corporal|body fat percentage|percent body fat|\bpbf\b)`, forbidUnit: /^(kg|l|kcal|cm)$/, prefixForbid: /(massa|mass|peso)(?: de)?\s*$/ },
  { key: "massa_magra", label: "Massa magra", unit: "kg", required: false, re: String.raw`(?:massa magra(?: corporal)?|massa livre de gordura|\bmlg\b|lean body mass|\blbm\b)`, forbidUnit: /^%$/ },
  { key: "massa_muscular", label: "Massa muscular esquelética", unit: "kg", required: false, re: String.raw`(?:massa muscular(?: esqueletica)?|skeletal muscle mass|\bsmm\b)`, forbidUnit: /^%$/ },
  { key: "agua", label: "Água corporal", unit: "L", required: false, re: String.raw`(?:agua corporal(?: total)?|total body water|\btbw\b|agua total)`, forbidUnit: /^(%|kg)$/ },
  { key: "gordura_visceral", label: "Gordura visceral (nível)", unit: null, required: false, integer: true, re: String.raw`(?:nivel de gordura visceral|gordura visceral|visceral fat(?: level)?|\bvfl\b)` },
  { key: "tmb", label: "Taxa metabólica basal", unit: "kcal", required: false, integer: true, re: String.raw`(?:taxa metabolica basal|\btmb\b|\bbmr\b|basal metabolic rate)` },
  { key: "cintura", label: "Cintura", unit: "cm", required: false, re: String.raw`(?:circunferencia (?:da |de )?cintura|cintura)`, prefixForbid: NOT_REL },
  { key: "quadril", label: "Quadril", unit: "cm", required: false, re: String.raw`(?:circunferencia (?:do |de )?quadril|quadril)`, prefixForbid: /(cintura[- ]?|relacao[^\n]{0,24})$/ },
  { key: "abdomen", label: "Abdômen", unit: "cm", required: false, re: String.raw`(?:circunferencia (?:do )?abdomen|abdomen|abdominal)`, prefixForbid: NOT_REL },
];

interface Hit { value: number; text: string; page: number; snippet: string }

const clip = (s: string, n = 70) => s.replace(/\s+/g, " ").trim().slice(0, n);

function findAll(pages: string[], d: Def): Hit[] {
  const hits: Hit[] = [];
  const re = new RegExp(`(?:${d.re})${GAP}(${NUM})${UNIT}`, "g");
  pages.forEach((raw, p) => {
    const f = foldKeepLength(raw);
    re.lastIndex = 0;
    for (let m = re.exec(f); m; m = re.exec(f)) {
      const before = f.slice(Math.max(0, m.index - 24), m.index);
      if (d.prefixForbid?.test(before)) continue;
      const unit = m[2] ?? null;
      if (unit && d.forbidUnit?.test(unit)) continue;
      const n = parseNumberBR(m[1], { integer: d.integer });
      if (n == null) continue;
      hits.push({ value: n, text: m[1], page: p + 1, snippet: clip(raw.slice(m.index, m.index + m[0].length)) });
    }
  });
  return hits;
}

const DATE_RE = String.raw`(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})`;

function findDate(pages: string[]): { iso: string | null; hits: { iso: string; page: number; snippet: string; labeled: boolean }[] } {
  const labeled = new RegExp(String.raw`(?:data(?: do exame| da avaliacao| da medicao| do teste| de realizacao)?|exame realizado em|realizado em|test date|date of test)${GAP}${DATE_RE}`, "g");
  const any = new RegExp(DATE_RE, "g");
  const hits: { iso: string; page: number; snippet: string; labeled: boolean }[] = [];
  pages.forEach((raw, p) => {
    const f = foldKeepLength(raw);
    labeled.lastIndex = 0;
    for (let m = labeled.exec(f); m; m = labeled.exec(f)) {
      const iso = parseDateBR(m[1]);
      if (iso) hits.push({ iso, page: p + 1, snippet: clip(raw.slice(m.index, m.index + m[0].length)), labeled: true });
    }
  });
  if (hits.length === 0) {
    pages.forEach((raw, p) => {
      any.lastIndex = 0;
      for (let m = any.exec(raw); m; m = any.exec(raw)) {
        const iso = parseDateBR(m[1]);
        if (iso) hits.push({ iso, page: p + 1, snippet: clip(raw.slice(Math.max(0, m.index - 12), m.index + m[0].length).replace(m.index > 12 && raw[m.index - 13] !== " " ? /^\S*\s/ : /^$/, "")), labeled: false });
      }
    });
  }
  return { iso: hits[0]?.iso ?? null, hits };
}

const emptyField = (d: Def, reason: string | null): ReadField => ({
  key: d.key, group: null, label: d.label, value: null, unit: d.unit, required: d.required,
  uncertain: d.required, reason: d.required ? reason : null, options: null, source: null, page: null, confidence: 0,
});

/** Campos vazios (foto sem IA, PDF sem texto): obrigatórios nascem incertos. */
export function emptyBioFields(reason: string): ReadField[] {
  return BIO_DEFS.map((d) => emptyField(d, reason));
}

export function extractBio(pages: string[], today?: string): ReadField[] {
  const fields: ReadField[] = [];
  for (const d of BIO_DEFS) {
    if (d.key === "data") {
      const { hits } = findDate(pages);
      if (hits.length === 0) { fields.push(emptyField(d, "Não encontrei no documento.")); continue; }
      const distinct = [...new Set(hits.map((h) => h.iso))];
      const h = hits[0];
      const multi = distinct.length > 1;
      fields.push({
        key: "data", group: null, label: d.label, value: isoToBR(h.iso), unit: null, required: true,
        uncertain: multi || !h.labeled,
        reason: multi ? `Achei ${distinct.length} datas diferentes. Escolha a do exame.` : !h.labeled ? "A data veio de um trecho sem o rótulo \"Data\". Confira." : null,
        options: multi ? distinct.slice(0, 4).map(isoToBR) : null,
        source: h.snippet, page: h.page, confidence: h.labeled && !multi ? 0.95 : 0.6,
      });
      continue;
    }
    const hits = findAll(pages, d);
    if (hits.length === 0) { fields.push(emptyField(d, "Não encontrei no documento.")); continue; }
    const digits = d.integer ? 0 : 1;
    const fmt = (n: number) => (d.integer ? String(n) : fmtNumberBR(n, 2));
    const distinct = [...new Set(hits.map((h) => h.value))];
    const multi = distinct.length > 1;
    const h = hits[0];
    void digits;
    fields.push({
      key: d.key, group: null, label: d.label, value: fmt(h.value), unit: d.unit, required: d.required,
      uncertain: multi,
      reason: multi ? `Achei ${distinct.length} valores diferentes no documento. Escolha o certo.` : null,
      options: multi ? distinct.slice(0, 4).map(fmt) : null,
      source: h.snippet, page: h.page, confidence: multi ? 0.5 : 0.95,
    });
  }
  return crossCheckBio(applyRules("bioimpedancia", fields, today));
}
