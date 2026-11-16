// Números pt-BR: "1.420" (milhar), "26,8" (decimal), "70.3" (decimal vindo de laudo em inglês). Puro.

/** Texto → número. `integer` = só inteiros (kcal, nível): "1.420" é 1420. Lixo → null. */
export function parseNumberBR(raw: string | null | undefined, opts: { integer?: boolean } = {}): number | null {
  if (raw == null) return null;
  let t = String(raw).trim().replace(/\s+/g, "");
  if (t === "" || !/^\d[\d.,]*$/.test(t)) return null;
  if (t.includes(",")) {
    // vírgula = decimal; pontos antes dela = milhar
    if (t.indexOf(",") !== t.lastIndexOf(",")) return null;
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (t.includes(".")) {
    const parts = t.split(".");
    const milhar = parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && parts[0].length >= 1 && parts[0].length <= 3;
    if (milhar && (opts.integer || parts.length > 2)) t = parts.join("");
    else if (parts.length > 2) return null;
    // senão: ponto decimal ("70.3")
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (opts.integer && !Number.isInteger(n)) return null;
  return n;
}

/** Número → texto pt-BR com vírgula. 1420 → "1420" (sem milhar, é campo editável). */
export function fmtNumberBR(n: number, digits = 1): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r).replace(".", ",");
}

/** "10/11/2026" | "10-11-26" | "2026-11-10" → "2026-11-10" (data válida) ou null. */
export function parseDateBR(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  let d: number, m: number, y: number;
  let x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (x) {
    d = Number(x[1]); m = Number(x[2]); y = Number(x[3]);
    if (x[3].length === 2) y += 2000;
  } else if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
    y = Number(x[1]); m = Number(x[2]); d = Number(x[3]);
  } else return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2026-11-10" → "10/11/2026". */
export function isoToBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Normaliza SEM mudar o tamanho (índices batem com o original, para citar o trecho). */
export function foldKeepLength(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = c.normalize("NFD")[0] ?? " ";
    out += n.toLowerCase().length === 1 ? n.toLowerCase() : c;
  }
  return out;
}

export const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
