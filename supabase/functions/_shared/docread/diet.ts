// Dieta — leitura DETERMINÍSTICA do texto do PDF (modo demonstração): refeições com horário, itens e quantidades.
import { foldKeepLength, parseNumberBR } from "./numbers.ts";
import { applyRules } from "./validate.ts";
import type { ReadField, ReadGroup } from "./types.ts";

const MEAL_RE = /^(?:\d+[.)]\s*)?(cafe da manha|desjejum|lanche da manha|colacao|almoco|lanche da tarde|lanche|pre[- ]?treino|pos[- ]?treino|jantar|ceia|refeicao\s*\d+)\b(.*)$/;
const STOP_RE = /^(?:substitu|orienta|observa|obs\b|total|recomenda|hidrata|suplement|assinatura|nutricionista|crn)/;
const HOUSEHOLD = /\b(colher(?:es)?|colher de sopa|xicaras?|copos?|conchas?|porcoes?|porcao|escumadeiras?)\b/;
const FREE = /\b(a vontade|livre|a gosto)\b/;
const TIME = /(\d{1,2})[:h](\d{2})/;
const KCAL = /(\d{2,4})\s*kcal/;
const UNIT_WORDS = "(?:g|gramas?|kg|ml|l|un|unid(?:ades?)?|fatias?|colher(?:es)?(?: de (?:sopa|cha|sobremesa))?|xicaras?|copos?|conchas?|porcoes?|scoops?|ovos?)";
const LEAD_QTY = new RegExp(String.raw`^(\d+(?:[.,]\d+)?)\s*(${UNIT_WORDS})\b\s*(?:de\s+)?(.+)$`);

const clip = (s: string, n = 80) => s.replace(/\s+/g, " ").trim().slice(0, n);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

interface Line { raw: string; fold: string; page: number }

function toLines(pages: string[]): Line[] {
  const out: Line[] = [];
  pages.forEach((p, i) => {
    for (const raw of p.split(/\r?\n/)) {
      const t = raw.trim();
      if (t) out.push({ raw: t, fold: foldKeepLength(t), page: i + 1 });
    }
  });
  return out;
}

function splitItems(s: string): string[] {
  return s.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
}

interface ParsedItem { name: string; qty: string | null; uncertain: boolean; reason: string | null }

function parseItem(rawIn: string): ParsedItem | null {
  let raw = rawIn.replace(/^[-–•*·▪]\s*/, "").replace(/^\d+[.)]\s+/, "").trim();
  if (raw.length < 2) return null;
  let f = foldKeepLength(raw);
  let paren = "";
  const pm = /\(([^)]*\d[^)]*)\)\s*$/.exec(raw);
  if (pm) { paren = pm[1].trim(); raw = raw.slice(0, pm.index).trim(); f = foldKeepLength(raw); }
  let name: string, qty: string | null = null;
  const lead = LEAD_QTY.exec(f);
  if (lead) {
    const n = parseNumberBR(lead[1]);
    const unit = raw.slice(f.indexOf(lead[2], lead[1].length), f.indexOf(lead[2], lead[1].length) + lead[2].length);
    const restStart = raw.length - lead[3].length;
    name = raw.slice(restStart).trim();
    let u = unit;
    if (/^ovos?$/i.test(unit)) { u = "un"; name = `${unit} ${name}`.trim(); }
    // "4 colheres de sopa de arroz": a unidade pode vir com "de sopa"
    qty = `${n != null ? String(n).replace(".", ",") : lead[1]} ${u}`.trim();
  } else {
    const tail = new RegExp(String.raw`^(.+?)\s*[-–:]\s*(\d+(?:[.,]\d+)?\s*${UNIT_WORDS})\s*$`).exec(f);
    if (tail) { name = raw.slice(0, tail[1].length).trim(); qty = raw.slice(raw.length - tail[2].length).trim(); }
    else if (FREE.test(f)) { name = raw.replace(/\s*(à|a)\s+vontade|\s*livre|\s*a gosto/i, "").trim() || raw; qty = "à vontade"; }
    else { name = raw; qty = null; }
  }
  if (!name || name.length < 2) return null;
  let uncertain = false, reason: string | null = null;
  if (qty == null) { uncertain = true; reason = "O PDF não traz a quantidade."; }
  else if (paren) qty = `${qty} (${paren})`;
  else if (HOUSEHOLD.test(foldKeepLength(qty)) && !/\d\s*(g|ml|kg)\b/.test(qty)) { uncertain = true; reason = "Medida caseira sem peso: confirme a conversão."; }
  return { name: name.replace(/^de\s+/i, ""), qty, uncertain, reason };
}

export function extractDiet(pages: string[]): { groups: ReadGroup[]; fields: ReadField[]; unrecognized: string[] } {
  const lines = toLines(pages);
  const groups: ReadGroup[] = [];
  const fields: ReadField[] = [];
  let cur = -1;
  let items = 0;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const mm = MEAL_RE.exec(L.fold);
    if (mm) {
      cur = groups.length;
      items = 0;
      const at = L.fold.indexOf(mm[1]);
      const title = cap(L.raw.slice(at, at + mm[1].length).trim().toLowerCase());
      const rest = L.raw.slice(L.fold.indexOf(mm[1]) + mm[1].length);
      let time = TIME.exec(rest), kcal = KCAL.exec(rest);
      // horário/kcal podem vir na linha seguinte ("07:30 · 420 kcal")
      const nxt = lines[i + 1];
      if (nxt && /^[\d:h\s·\-–|.kcal]+$/i.test(nxt.raw) && (TIME.test(nxt.raw) || KCAL.test(nxt.raw))) {
        time = time ?? TIME.exec(nxt.raw); kcal = kcal ?? KCAL.exec(nxt.raw);
        i++;
      }
      const gid = `m${cur}`;
      groups.push({ id: gid, title });
      fields.push({ key: `${gid}.time`, group: gid, label: "Horário", value: time ? `${time[1].padStart(2, "0")}:${time[2]}` : null, unit: null, required: false, uncertain: false, reason: null, options: null, source: time ? clip(L.raw) : null, page: time ? L.page : null, confidence: time ? 0.95 : 0 });
      if (kcal) fields.push({ key: `${gid}.kcal`, group: gid, label: "Calorias", value: kcal[1], unit: "kcal", required: false, uncertain: false, reason: null, options: null, source: clip(L.raw), page: L.page, confidence: 0.95 });
      continue;
    }
    if (cur < 0) continue;
    if (STOP_RE.test(L.fold)) { cur = -1; continue; }
    if (/^[\d:h\s·\-–|.kcal]+$/i.test(L.raw)) continue;
    for (const part of splitItems(L.raw)) {
      const it = parseItem(part);
      if (!it) continue;
      fields.push({ key: `m${cur}.i${items++}`, group: `m${cur}`, label: cap(it.name), value: it.qty, unit: null, required: false, uncertain: it.uncertain, reason: it.reason, options: null, source: clip(L.raw), page: L.page, confidence: it.uncertain ? 0.5 : 0.95 });
    }
  }
  // refeição sem item = refeição inútil
  const withItems = new Set(fields.filter((f) => /\.i\d+$/.test(f.key)).map((f) => f.group));
  const keepGroups = groups.filter((g) => withItems.has(g.id));
  const keepIds = new Set(keepGroups.map((g) => g.id));
  return { groups: keepGroups, fields: applyRules("dieta", fields.filter((f) => f.group && keepIds.has(f.group))), unrecognized: [] };
}
