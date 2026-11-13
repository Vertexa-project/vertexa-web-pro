// Alíquota mensal de imposto (escopo-v1 §4.1, critério F21): mês sem alíquota usa a do mês anterior e a tela
// avisa o gestor. Espelha public.fin_effective_tax_rate (SQL). Período no formato AAAA-MM.

export interface TaxRateRow {
  period: string;
  rate_pct: number;
  unit_id: string | null;
}

export interface EffectiveTaxRate {
  found: boolean;
  ratePct: number | null;
  /** true quando a alíquota vem de um mês anterior (o mês pedido não tem a sua). */
  inherited: boolean;
  sourcePeriod: string | null;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isPeriod = (p: string): boolean => PERIOD.test(p);

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function effectiveTaxRate(rates: TaxRateRow[], period: string, unitId: string | null = null): EffectiveTaxRate {
  const candidates = rates
    .filter((r) => r.period <= period && (r.unit_id === null || r.unit_id === unitId))
    // mais recente primeiro; no mesmo mês, a da unidade vence a da organização
    .sort((a, b) => (a.period === b.period ? Number(a.unit_id === null) - Number(b.unit_id === null) : a.period < b.period ? 1 : -1));
  const hit = candidates[0];
  if (!hit) return { found: false, ratePct: null, inherited: false, sourcePeriod: null };
  return { found: true, ratePct: Number(hit.rate_pct), inherited: hit.period !== period, sourcePeriod: hit.period };
}

export const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "novembro de 2026" (ou só "novembro" quando `sameYearAs` é do mesmo ano). */
export function periodName(period: string, sameYearAs?: string): string {
  const [y, m] = period.split("-");
  const name = MONTH_NAMES[Number(m) - 1] ?? period;
  return sameYearAs && sameYearAs.slice(0, 4) === y ? name : `${name} de ${y}`;
}

export function pctText(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

/** Destaque: "Alíquota de dezembro de 2026: 7,00%" (ou que não há alíquota até o mês). */
export function taxRateHeadline(eff: EffectiveTaxRate, period: string): string {
  return eff.found ? `Alíquota de ${periodName(period)}: ${pctText(eff.ratePct)}` : `Alíquota de ${periodName(period)}: não cadastrada`;
}

/** Aviso ao gestor/admin; null quando o mês tem a sua alíquota. */
export function taxRateNotice(eff: EffectiveTaxRate, period: string): string | null {
  if (!eff.found) return `Nenhuma alíquota cadastrada até ${periodName(period)} — cadastre a deste mês.`;
  if (eff.inherited && eff.sourcePeriod) return `${periodName(period)} não tem alíquota própria: usando a de ${periodName(eff.sourcePeriod, period)} (${pctText(eff.ratePct)}) — cadastre a deste mês.`;
  return null;
}
