// Treino — leitura DETERMINÍSTICA do texto do PDF (modo demonstração): dias/grupos, exercícios, séries, repetições, carga.
import { foldKeepLength, parseNumberBR } from "./numbers.ts";
import { applyRules } from "./validate.ts";
import type { ReadField, ReadGroup } from "./types.ts";

const DAY_RE = /^(?:treino|dia)\s+([a-f]|\d{1,2})\b\s*[\-–:|]?\s*(.*)$/;
const SETS_REPS = /(\d{1,2})\s*(?:x|×|series?\s+de)\s*(\d{1,3})(?:\s*(?:-|–|a|ate)\s*(\d{1,3}))?(?:\s*(?:rep|repeticoes))?/;
const LOAD = /(\d+(?:[.,]\d+)?)\s*kg\b/;
const IGNORE = /^(?:obs|descanso|aquec|alongam|cardio|intervalo|orienta|assinatura|educador|crefito|cref|paciente|nome|data|documento)/;

const clip = (s: string, n = 80) => s.replace(/\s+/g, " ").trim().slice(0, n);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function extractWorkout(pages: string[]): { groups: ReadGroup[]; fields: ReadField[]; unrecognized: string[] } {
  const groups: ReadGroup[] = [];
  const fields: ReadField[] = [];
  const unrecognized: string[] = [];
  let cur = -1;
  let ex = 0;
  pages.forEach((p, pi) => {
    for (const rawLine of p.split(/\r?\n/)) {
      const raw = rawLine.trim();
      if (!raw) continue;
      const f = foldKeepLength(raw);
      const dm = DAY_RE.exec(f);
      if (dm && !SETS_REPS.test(f)) {
        cur = groups.length;
        ex = 0;
        const id = `d${cur}`;
        const letter = /^[a-f]$/.test(dm[1]) ? dm[1].toUpperCase() : dm[1];
        const sub = raw.slice(raw.length - dm[2].length).trim().replace(/^[\-–:|\s]+/, "");
        groups.push({ id, title: `Treino ${letter}`, subtitle: sub || null });
        continue;
      }
      if (cur < 0) continue;
      const body = raw.replace(/^[\-–•*·▪]\s*/, "").replace(/^\d+[.)]\s+/, "");
      const fb = foldKeepLength(body);
      const sr = SETS_REPS.exec(fb);
      if (!sr) {
        if (IGNORE.test(fb) || fb.length < 4) continue;
        if (unrecognized.length < 10) unrecognized.push(clip(raw));
        continue;
      }
      const name = body.slice(0, sr.index).replace(/[\-–|:·,\s]+$/, "").trim();
      if (name.length < 2) { if (unrecognized.length < 10) unrecognized.push(clip(raw)); continue; }
      const gid = `d${cur}`, k = `${gid}.e${ex++}`;
      const common = { group: gid, unit: null as string | null, required: false, source: clip(raw), page: pi + 1 };
      fields.push({ ...common, key: `${k}.sets`, label: `${cap(name)} · séries`, value: sr[1], uncertain: false, reason: null, options: null, confidence: 0.95 });
      if (sr[3]) {
        const lo = Number(sr[2]), hi = Number(sr[3]);
        const mid = Math.round((lo + hi) / 2);
        const opts = [...new Set([lo, mid, hi])].filter((n) => n >= 1).map(String);
        fields.push({ ...common, key: `${k}.reps`, label: `${cap(name)} · repetições`, value: null, uncertain: true, reason: `O treino traz ${lo}–${hi} repetições: escolha o número.`, options: opts, confidence: 0.5 });
      } else {
        fields.push({ ...common, key: `${k}.reps`, label: `${cap(name)} · repetições`, value: sr[2], uncertain: false, reason: null, options: null, confidence: 0.95 });
      }
      const ld = LOAD.exec(fb.slice(sr.index + sr[0].length));
      const loadN = ld ? parseNumberBR(ld[1]) : null;
      fields.push({ ...common, key: `${k}.load`, label: `${cap(name)} · carga`, unit: "kg", value: loadN != null ? String(loadN).replace(".", ",") : null, uncertain: false, reason: null, options: null, confidence: ld ? 0.95 : 0 });
    }
  });
  const withEx = new Set(fields.map((f) => f.group));
  const keep = groups.filter((g) => withEx.has(g.id));
  return { groups: keep, fields: applyRules("treino", fields.filter((f) => f.group && withEx.has(f.group))), unrecognized };
}
