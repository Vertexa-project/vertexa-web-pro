// Financeiro · Entrega 5 — regras PURAS do motor de repasse (escopo-v1 §5, §12.1). ESPELHAM o servidor
// (migration 20261114180000_fin_e5_repasse.sql) para o simulador e para os testes dos exemplos A a H; QUEM DECIDE É O SERVIDOR.
// Dinheiro em centavos inteiros; arredondamento meio-para-cima em cada linha (simétrico nos estornos); totais somam as linhas já arredondadas.
import { distribute } from "./finSales";
import { roundHalfUp } from "./money";

export type PayoutRole = "responsavel" | "executor" | "auxiliar";
export const PAYOUT_ROLES: PayoutRole[] = ["responsavel", "executor", "auxiliar"];
export const PAYOUT_ROLE_LABEL: Record<PayoutRole | "vendedor", string> = { responsavel: "Responsável", executor: "Executor", auxiliar: "Auxiliar", vendedor: "Vendedor" };

export type PayoutRuleType = "pct" | "fixed_per_exec" | "fixed_monthly" | "min_guarantee" | "product_commission" | "usage_fee" | "none";
export const PAYOUT_RULE_TYPE_LABEL: Record<PayoutRuleType, string> = {
  pct: "Percentual sobre a base", fixed_per_exec: "Fixo por execução", fixed_monthly: "Fixo mensal", min_guarantee: "Garantia mínima",
  product_commission: "Comissão de produto", usage_fee: "Taxa de uso (aluguel)", none: "Sem repasse",
};
export type PayoutTargetType = "service" | "category" | "item" | "default";
export type ServiceCategory = "consulta" | "procedimento" | "aplicacao" | "avaliacao" | "sessao" | "outro";
export type PayoutLineType = "pct" | "tier_adjust" | "fixed_exec" | "fixed_monthly" | "guarantee" | "commission" | "usage_fee" | "adjustment" | "withholding";
export const PAYOUT_LINE_LABEL: Record<PayoutLineType, string> = {
  pct: "Percentual", tier_adjust: "Ajuste de faixa", fixed_exec: "Fixo por execução", fixed_monthly: "Fixo mensal", guarantee: "Garantia mínima",
  commission: "Comissão de produto", usage_fee: "Taxa de uso", adjustment: "Ajuste / estorno", withholding: "Retenção",
};

export interface Tier { up_to_cents: number | null; pct: number }
export interface Deductions { fee: boolean; tax: boolean; material: boolean }

/** Regra como o servidor devolve (campos usados pelo cálculo). */
export interface PayoutRule {
  id: string; professional_id: string; role: PayoutRole | "vendedor" | null; target_type: PayoutTargetType; service_id: string | null; category: ServiceCategory | null;
  stock_item_id: string | null; rule_type: PayoutRuleType; pct: number | null; amount_cents: number | null; tiers: Tier[] | null; tier_scope: "organization" | "unit" | null;
  compensation: boolean; usage_fee_mode: "fixed" | "pct" | null; deductions_override: Partial<Deductions> | null; all_units: boolean; unit_ids: string[];
  valid_from: string; valid_to: string | null; is_active: boolean;
}

// ---------- base de cálculo (§5.2) ----------
/** Cada dedução só entra se estiver ligada na clínica; a regra sobrescreve (chave ausente = herda). */
export function resolveDeductions(clinic: Deductions, override?: Partial<Deductions> | null): Deductions {
  return { fee: override?.fee ?? clinic.fee, tax: override?.tax ?? clinic.tax, material: override?.material ?? clinic.material };
}
/** Imposto = alíquota × valor liquidado BRUTO. */
export const taxOf = (grossCents: number, ratePct: number): number => roundHalfUp((grossCents * ratePct) / 100, 0);
/** Base = valor liquidado − taxa − imposto − material (só o que estiver ligado); nunca negativa. */
export function payoutBase(i: { grossCents: number; feeCents: number; taxCents: number; materialCents: number }, ded: Deductions): number {
  return Math.max(0, i.grossCents - (ded.fee ? i.feeCents : 0) - (ded.tax ? i.taxCents : 0) - (ded.material ? i.materialCents : 0));
}
/** Repasse = base × % (meio-para-cima por linha). */
export const pctAmount = (baseCents: number, pct: number): number => roundHalfUp((baseCents * pct) / 100, 0);
/** Material em pagamento parcelado: deduzido proporcionalmente a cada parcela liquidada (§5.2). */
export function materialShare(materialCents: number, appointmentValueCents: number, grossPieceCents: number): number {
  if (appointmentValueCents <= 0) return materialCents;
  return Math.min(roundHalfUp((materialCents * grossPieceCents) / appointmentValueCents, 0), materialCents);
}
/** Mês do extrato (D6, regime de caixa): o da liquidação do dinheiro, ou o da execução se esta vier depois do dinheiro. */
export function releasePeriod(settledOn: string, performedOn: string): string {
  return (settledOn > performedOn ? settledOn : performedOn).slice(0, 7);
}

// ---------- faixas por meta (D26) ----------
/** Prévia durante o mês: percentual da faixa atingida pela base acumulada. */
export function tierPct(tiers: Tier[], cumulativeBaseCents: number): number {
  for (const t of tiers) if (t.up_to_cents === null || cumulativeBaseCents <= t.up_to_cents) return t.pct;
  return tiers[tiers.length - 1]?.pct ?? 0;
}
/** No fechamento: cálculo progressivo — cada faixa só incide sobre a parte da base que cai nela. */
export function tierProgressive(tiers: Tier[], baseCents: number): number {
  let prev = 0; let sum = 0;
  for (const t of tiers) {
    const upper = t.up_to_cents ?? baseCents;
    sum += (Math.max(Math.min(baseCents, upper) - prev, 0) * t.pct) / 100;
    if (t.up_to_cents === null || baseCents <= t.up_to_cents) break;
    prev = t.up_to_cents;
  }
  return roundHalfUp(sum, 0);
}
/** Linha «ajuste de faixa» = total progressivo − o que as linhas já somam. */
export const tierAdjust = (tiers: Tier[], baseCents: number, linesCents: number): number => tierProgressive(tiers, baseCents) - linesCents;

/** Valida as faixas da regra: ao menos 2, tetos crescentes, última sem teto, % de 0 a 100. Devolve a mensagem ou null. */
export function validateTiers(tiers: Tier[]): string | null {
  if (tiers.length < 2) return "Informe ao menos duas faixas.";
  let prev = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (!(t.pct >= 0 && t.pct <= 100)) return "O percentual da faixa precisa estar entre 0 e 100.";
    if (i < tiers.length - 1) {
      if (t.up_to_cents === null || t.up_to_cents <= prev) return "Os tetos das faixas precisam crescer.";
      prev = t.up_to_cents;
    } else if (t.up_to_cents !== null) return "A última faixa é «acima de» e não tem teto.";
  }
  return null;
}

// ---------- qual regra vale (§5.1) ----------
export interface RuleQuery { professionalId: string; role: PayoutRole; serviceId: string; category: ServiceCategory; on: string; unitId: string | null }
const ruleLevel = (r: PayoutRule, q: RuleQuery): number | null =>
  r.target_type === "service" && r.service_id === q.serviceId ? 1 : r.target_type === "category" && r.category === q.category ? 2 : r.target_type === "default" ? 3 : null;
const ruleInForce = (r: PayoutRule, on: string, unitId: string | null) =>
  r.is_active && r.valid_from <= on && (r.valid_to === null || r.valid_to >= on) && (r.all_units || (unitId !== null && r.unit_ids.includes(unitId)));

/** Regras vigentes do participante, só do nível mais específico que existir: serviço > categoria > padrão. Vazio = «sem regra» (fila do gestor). */
export function matchRules(rules: PayoutRule[], q: RuleQuery): PayoutRule[] {
  const cand = rules.filter((r) => r.professional_id === q.professionalId && r.role === q.role && ["pct", "fixed_per_exec", "none"].includes(r.rule_type) && ruleInForce(r, q.on, q.unitId) && ruleLevel(r, q) !== null);
  if (cand.length === 0) return [];
  const best = Math.min(...cand.map((r) => ruleLevel(r, q) as number));
  return cand.filter((r) => ruleLevel(r, q) === best);
}
/** Soma dos percentuais de todos os participantes de um mesmo serviço (F11): passou de 100 = aviso na configuração. */
export function pctSum(rules: Pick<PayoutRule, "rule_type" | "pct" | "tiers" | "is_active">[]): number {
  return rules.filter((r) => r.is_active && r.rule_type === "pct").reduce((a, r) => a + (r.pct ?? Math.max(0, ...(r.tiers ?? []).map((t) => t.pct))), 0);
}
export const pctSumWarning = (sum: number): boolean => sum > 100;

// ---------- atendimento avulso: uma linha de repasse por participante ----------
export interface PayoutInput { grossCents: number; feeCents: number; taxPct: number; materialCents: number; cumulativeBaseCents?: number }
export interface PayoutLine { professionalId: string; role: PayoutRole; ruleId: string; lineType: "pct" | "fixed_exec"; baseCents: number | null; pct: number | null; amountCents: number; formula: string }

/** Linhas de um atendimento para os participantes dados (simulador; mesmas fórmulas do servidor). */
export function simulateAppointment(rules: PayoutRule[], clinic: Deductions, q: Omit<RuleQuery, "professionalId" | "role">, participants: { professionalId: string; role: PayoutRole }[], inp: PayoutInput): PayoutLine[] {
  const out: PayoutLine[] = [];
  const tax = taxOf(inp.grossCents, inp.taxPct);
  for (const p of participants) {
    const matched = matchRules(rules, { ...q, professionalId: p.professionalId, role: p.role });
    if (matched.some((r) => r.rule_type === "none")) continue;
    for (const r of matched) {
      if (r.rule_type === "fixed_per_exec") {
        out.push({ professionalId: p.professionalId, role: p.role, ruleId: r.id, lineType: "fixed_exec", baseCents: null, pct: null, amountCents: r.amount_cents ?? 0, formula: `fixo por execução R$ ${(r.amount_cents ?? 0) / 100}` });
      } else if (r.rule_type === "pct") {
        const ded = resolveDeductions(clinic, r.deductions_override);
        const base = payoutBase({ grossCents: inp.grossCents, feeCents: inp.feeCents, taxCents: tax, materialCents: inp.materialCents }, ded);
        const pct = r.tiers ? tierPct(r.tiers, (inp.cumulativeBaseCents ?? 0) + base) : (r.pct ?? 0);
        out.push({ professionalId: p.professionalId, role: p.role, ruleId: r.id, lineType: "pct", baseCents: base, pct, amountCents: pctAmount(base, pct),
          formula: `base = ${inp.grossCents} − taxa ${ded.fee ? inp.feeCents : 0} − imposto ${ded.tax ? tax : 0} − material ${ded.material ? inp.materialCents : 0} = ${base}; repasse = base × ${pct}%` });
      }
    }
  }
  return out;
}
/** Margem da clínica (Exemplo B): recebido − taxa − imposto − material − repasses. */
export const clinicMargin = (grossCents: number, feeCents: number, taxCents: number, materialCents: number, payoutsCents: number[]): number =>
  grossCents - feeCents - taxCents - materialCents - payoutsCents.reduce((a, v) => a + v, 0);

// ---------- pacote multiprofissional (§5.4, Exemplo D) ----------
/** Valor rateado de cada sessão: referência × (valor do pacote ÷ soma das referências); diferença de arredondamento na última. */
export function packageSessionValues(packageCents: number, refs: { refCents: number; qty: number }[]): number[] {
  const weights = refs.map((r) => r.refCents * r.qty);
  const lineTotals = distribute(packageCents, weights);
  return refs.map((r, i) => Math.round(lineTotals[i] / r.qty));
}
export interface PackageUnit { id: string; valueCents: number; occurredOn: string }
export interface Settlement { date: string; grossCents: number }
export interface PackageRelease { id: string; releaseDate: string | null; coveredCents: number }
/**
 * Uma sessão só gera repasse percentual quando o liquidado acumulado do pacote cobre o valor rateado dela; as sessões são cobertas
 * por ordem de data, sempre inteiras. `releaseDate` nulo = «aguardando recebimento»; senão, a data em que liberou (a mais tardia entre a
 * liquidação que cobriu e a execução).
 */
export function releasePackageUnits(units: PackageUnit[], settlements: Settlement[]): PackageRelease[] {
  const sortedSettlements = [...settlements].sort((a, b) => a.date.localeCompare(b.date));
  const cums: number[] = []; let acc = 0;
  for (const s of sortedSettlements) { acc += s.grossCents; cums.push(acc); }
  const ordered = [...units].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  let cumValue = 0;
  return ordered.map((u) => {
    cumValue += u.valueCents;
    if (cumValue <= 0) return { id: u.id, releaseDate: u.occurredOn, coveredCents: cumValue };
    const k = cums.findIndex((c) => c >= cumValue);
    if (k < 0) return { id: u.id, releaseDate: null, coveredCents: cumValue };
    const d = sortedSettlements[k].date;
    return { id: u.id, releaseDate: d > u.occurredOn ? d : u.occurredOn, coveredCents: cumValue };
  });
}
/** Taxa efetiva do pacote = taxa total ÷ valor total; aplicada à sessão. */
export const packageFee = (valueCents: number, feeTotalCents: number, grossTotalCents: number): number =>
  grossTotalCents > 0 ? roundHalfUp((valueCents * feeTotalCents) / grossTotalCents, 0) : 0;

// ---------- fixos, garantia, taxa de uso (§5.3, D25, D27) ----------
const daysIn = (period: string): number => { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const isoDay = (iso: string): number => Number(iso.slice(8, 10));
/** Fixo mensal proporcional aos dias de vigência no mês (Exemplo E). `period` = AAAA-MM. */
export function fixedMonthlyAmount(amountCents: number, validFrom: string, validTo: string | null, period: string): number {
  const dim = daysIn(period);
  const first = `${period}-01`; const last = `${period}-${String(dim).padStart(2, "0")}`;
  if (validFrom > last || (validTo !== null && validTo < first)) return 0;
  const from = validFrom > first ? isoDay(validFrom) : 1;
  const to = validTo !== null && validTo < last ? isoDay(validTo) : dim;
  return roundHalfUp((amountCents * (to - from + 1)) / dim, 0);
}
export interface GuaranteeMonth { variableCents: number; complementCents: number; abatedCents: number; balanceCents: number; adjustmentCents: number; receivesCents: number }
/**
 * Garantia mínima mês a mês (Exemplo F). O piso compara apenas percentual (com faixa) + fixo por execução. Sem compensação: complemento até o piso.
 * Com compensação: o complemento vira saldo a compensar e, nos meses acima do piso, o excedente abate o saldo.
 */
export function guaranteeSeries(floorCents: number, compensation: boolean, variables: number[]): GuaranteeMonth[] {
  let balance = 0;
  return variables.map((v) => {
    const complement = Math.max(floorCents - v, 0);
    let abated = 0;
    if (complement > 0) { if (compensation) balance += complement; }
    else if (compensation && balance > 0) { abated = Math.min(balance, v - floorCents); balance -= abated; }
    return { variableCents: v, complementCents: complement, abatedCents: abated, balanceCents: balance, adjustmentCents: complement - abated, receivesCents: v + complement - abated };
  });
}
/** Taxa de uso: fixa por mês ou % do valor liquidado dos atendimentos do profissional; linha negativa (Exemplo H). */
export const usageFeeAmount = (mode: "fixed" | "pct", amountCents: number | null, pct: number | null, liquidatedCents: number): number =>
  -(mode === "fixed" ? (amountCents ?? 0) : roundHalfUp((liquidatedCents * (pct ?? 0)) / 100, 0));

// ---------- total do mês e retenções (§5.8, §5.9) ----------
export interface MonthParts { pct: number; tierAdjust: number; fixedExec: number; fixedMonthly: number; guarantee: number; commission: number; usageFee: number; adjustments: number; carryIn: number }
/** Ordem do §5.9: percentual (com ajuste de faixa) → fixo por execução → fixo mensal → garantia → comissões → taxa de uso (−) → ajustes (±) = total bruto. */
export const monthGross = (p: MonthParts): number => p.pct + p.tierAdjust + p.fixedExec + p.fixedMonthly + p.guarantee + p.commission + p.usageFee + p.adjustments + p.carryIn;
export interface WithholdingRule { type: string; ratePct: number; minBaseCents: number; waiveIfSimples: boolean }
export interface WithholdingLine { type: string; ratePct: number; amountCents: number; waived: "simples" | "min_base" | null }
/** Retenções sobre o total bruto POSITIVO; dispensa por tipo para optante pelo Simples; total negativo não sofre retenção e vai ao mês seguinte. */
export function withholdings(grossCents: number, rules: WithholdingRule[], simplesOptant: boolean): { lines: WithholdingLine[]; totalCents: number; netCents: number; carryCents: number } {
  if (grossCents <= 0) return { lines: [], totalCents: 0, netCents: 0, carryCents: grossCents < 0 ? grossCents : 0 };
  const lines: WithholdingLine[] = rules.map((r) => {
    if (simplesOptant && r.waiveIfSimples) return { type: r.type, ratePct: r.ratePct, amountCents: 0, waived: "simples" as const };
    if (grossCents < r.minBaseCents) return { type: r.type, ratePct: r.ratePct, amountCents: 0, waived: "min_base" as const };
    return { type: r.type, ratePct: r.ratePct, amountCents: roundHalfUp((grossCents * r.ratePct) / 100, 0), waived: null };
  });
  const total = lines.reduce((a, l) => a + l.amountCents, 0);
  return { lines, totalCents: total, netCents: grossCents - total, carryCents: 0 };
}

// ---------- mensagens ----------
export function payoutErrorMessage(e: unknown): string {
  const m = (e as { message?: string }).message ?? "";
  const code = (e as { code?: string }).code;
  const map: [string, string][] = [
    ["RULE_OVERLAP", "Já existe regra para esta pessoa, papel e serviço nesse período. Encerre a anterior e comece esta no dia seguinte."],
    ["RULE_IN_USE", "Esta regra já gerou repasse: só o fim da vigência pode mudar. Encerre-a e crie a nova a partir do dia seguinte."],
    ["RULE_END_BEFORE_USE", "O fim da vigência não pode ser antes do último atendimento que usou a regra."],
    ["RULE_TYPE_LOCKED", "O tipo da regra não muda: encerre esta e crie outra."],
    ["MEDICATION_COMMISSION_ACCEPT_REQUIRED", "Comissão sobre medicação ou manipulado exige o aceite do responsável pela clínica."],
    ["INVALID_TIERS", "Confira as faixas: ao menos duas, tetos crescentes e a última sem teto."],
    ["INVALID_PCT", "O percentual precisa estar entre 0 e 100."],
    ["INVALID_AMOUNT", "Informe um valor válido."],
    ["INVALID_PROFESSIONAL", "Escolha um profissional da clínica."],
    ["INVALID_VALID_FROM", "Informe o início da vigência."],
    ["INVALID_VALID_TO", "O fim da vigência não pode ser antes do início."],
    ["REASON_REQUIRED", "Informe o motivo (mínimo de 3 letras)."],
  ];
  for (const [k, v] of map) if (m.includes(k)) return v;
  if (code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}

// ---------- memória de cálculo (auditoria da linha) ----------
const brl = (cents: unknown): string => (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (iso: unknown): string => (typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const periodBr = (p: unknown): string => (typeof p === "string" && /^\d{4}-\d{2}$/.test(p) ? `${p.slice(5)}/${p.slice(0, 4)}` : "—");
/** A conta gravada vem em centavos («base = 30000 − taxa 0 …»): mostra em reais («base = R$ 300,00 − taxa R$ 0,00 …»), sem mexer no percentual. */
export function formulaInReais(formula: string): string {
  return formula
    .replace(/(base|taxa|imposto|material|=)\s+(-?\d+)(?=\s*(?:−|-|;|=|$))/g, (_m, label: string, cents: string) => `${label} ${(Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`)
    .replace(/fixo por execução R\$ (\d+(?:\.\d+)?)/, (_m, v: string) => `fixo por execução ${Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
}
export interface MemoryView { formula: string | null; rows: [string, string][]; correction: string | null }
/** Traduz a memória gravada na linha (regra aplicada, base, percentual, deduções) para o diálogo «Como foi calculado». */
export function describeMemory(memory: Record<string, unknown>, lineType: PayoutLineType): MemoryView {
  const m = memory ?? {};
  const rows: [string, string][] = [];
  const rule = (m.rule ?? null) as { type?: PayoutRuleType; pct?: number | null; tiers?: Tier[] | null; amount_cents?: number | null; valid_from?: string } | null;
  if (m.origin) rows.push(["Origem", m.origin === "pacote" ? `Pacote ${String(m.package ?? "")}`.trim() : m.origin === "produto" ? "Venda de produto" : m.origin === "execucao" ? "Execução do atendimento" : "Venda do serviço (fora de pacote)"]);
  if (m.service) rows.push(["Serviço", String(m.service)]);
  if (m.item) rows.push(["Item", String(m.item)]);
  if (m.performed_on) rows.push(["Atendimento em", dateBr(m.performed_on)]);
  if (m.settled_date) rows.push(["Dinheiro liquidado em", dateBr(m.settled_date)]);
  if (m.released_on) rows.push(["Liberado em", dateBr(m.released_on)]);
  if (m.gross_cents !== undefined) rows.push(["Valor liquidado (bruto)", brl(m.gross_cents)]);
  const ded = (m.deductions ?? null) as Deductions | null;
  if (m.fee_cents !== undefined) rows.push([`Taxa do meio de pagamento${ded && !ded.fee ? " (não deduzida)" : ""}`, brl(m.fee_cents)]);
  if (m.tax_cents !== undefined) rows.push([`Imposto${m.tax_pct !== undefined ? ` (${String(m.tax_pct).replace(".", ",")}%)` : ""}${ded && !ded.tax ? " (não deduzido)" : ""}`, brl(m.tax_cents)]);
  if (m.material_cents !== undefined) rows.push([`Material${ded && !ded.material ? " (não deduzido)" : ""}`, brl(m.material_cents)]);
  if (rule) {
    const what = rule.type ? PAYOUT_RULE_TYPE_LABEL[rule.type] : "Regra";
    const val = rule.tiers ? `faixas ${rule.tiers.map((t) => `${t.pct}%${t.up_to_cents === null ? " acima" : ` até ${brl(t.up_to_cents)}`}`).join(" · ")}` : rule.pct !== null && rule.pct !== undefined ? `${rule.pct}%` : rule.amount_cents !== null && rule.amount_cents !== undefined ? brl(rule.amount_cents) : "";
    rows.push(["Regra aplicada", `${what}${val ? ` — ${val}` : ""}${rule.valid_from ? ` (desde ${dateBr(rule.valid_from)})` : ""}`]);
  }
  const c = (m.correction ?? null) as { reason?: string; previous_amount?: number; new_amount?: number; origin_period?: string } | null;
  const correction = c ? `${lineType === "adjustment" ? "Estorno/ajuste" : "Correção"} de lançamento de ${periodBr(c.origin_period)}: de ${brl(c.previous_amount)} para ${brl(c.new_amount)}${c.reason ? ` — ${c.reason}` : ""}.` : null;
  return { formula: typeof m.formula === "string" ? formulaInReais(m.formula) : null, rows, correction };
}
