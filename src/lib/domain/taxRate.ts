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

/** Texto do aviso ao gestor; null quando não há o que avisar. */
export function taxRateNotice(eff: EffectiveTaxRate, period: string): string | null {
  const [y, m] = period.split("-");
  const label = `${m}/${y}`;
  if (!eff.found) return `Nenhuma alíquota cadastrada até ${label}. Informe a alíquota do mês.`;
  if (eff.inherited && eff.sourcePeriod) {
    const [sy, sm] = eff.sourcePeriod.split("-");
    return `${label} ainda não tem alíquota: está valendo a de ${sm}/${sy} (${String(eff.ratePct).replace(".", ",")}%). Atualize quando sair a do mês.`;
  }
  return null;
}
