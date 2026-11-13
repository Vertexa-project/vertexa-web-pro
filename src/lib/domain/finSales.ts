// Financeiro · Entrega 2 — regras PURAS de venda, recebimento (títulos) e caixa diário (escopo-v1 §4.2, §4.3, §4.5, §5.2).
// Espelham o servidor (migration 20261113180000_fin_e2_vendas.sql) para pré-visualizar valores antes de salvar;
// a autoridade é sempre o servidor. Tudo em centavos inteiros; meio-para-cima POR LINHA; resto na ÚLTIMA linha.
import { percentOfCents, roundHalfUp, sumCents } from "./money";

// ---------- Rateio ----------
/** Distribui `total` (centavos) por `weights`: meio-para-cima por linha, diferença na última (igual a private.fin_distribute). */
export function distribute(total: number, weights: number[]): number[] {
  const sum = sumCents(weights);
  if (weights.length === 0) return [];
  if (sum <= 0) throw new Error("INVALID_WEIGHTS");
  let acc = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return total - acc;
    const v = roundHalfUp((total * w) / sum, 0);
    acc += v;
    return v;
  });
}

// ---------- Venda ----------
export interface SaleItemInput {
  unitPriceCents: number;
  quantity: number;
  /** Desconto do item em centavos OU em % (a % vence). */
  discountCents?: number | null;
  discountPct?: number | null;
}
export interface SaleLine { grossCents: number; discountItemCents: number; discountShareCents: number; netCents: number }
export interface SaleTotals { lines: SaleLine[]; grossCents: number; discountCents: number; netCents: number }

/** Totais da venda: desconto por item e/ou no total (rateado proporcionalmente ao líquido de cada item — §5.2/D23). */
export function computeSale(items: SaleItemInput[], totalDiscount: { cents?: number | null; pct?: number | null } = {}): SaleTotals {
  const base = items.map((it) => {
    const gross = roundHalfUp(it.unitPriceCents * it.quantity, 0);
    const disc = it.discountPct != null ? percentOfCents(gross, it.discountPct) : (it.discountCents ?? 0);
    if (disc < 0 || disc > gross) throw new Error("INVALID_DISCOUNT");
    return { gross, disc, net: gross - disc };
  });
  const sumNet = sumCents(base.map((b) => b.net));
  const totalDisc = totalDiscount.pct != null ? percentOfCents(sumNet, totalDiscount.pct) : (totalDiscount.cents ?? 0);
  if (totalDisc < 0 || totalDisc > sumNet) throw new Error("INVALID_DISCOUNT");
  const shares = sumNet > 0 ? distribute(totalDisc, base.map((b) => b.net)) : base.map(() => 0);
  const lines = base.map((b, i): SaleLine => ({ grossCents: b.gross, discountItemCents: b.disc, discountShareCents: shares[i], netCents: b.net - shares[i] }));
  const gross = sumCents(lines.map((l) => l.grossCents));
  const net = sumCents(lines.map((l) => l.netCents));
  return { lines, grossCents: gross, discountCents: gross - net, netCents: net };
}

// ---------- Recebimento → títulos (§4.3) ----------
export type PaymentKind = "machine" | "pix" | "cash" | "transfer" | "boleto";
export type CardModality = "debit" | "credit_1" | "credit_2_6" | "credit_7_12";

export const MODALITY_LABEL: Record<CardModality, string> = { debit: "Débito", credit_1: "Crédito à vista", credit_2_6: "Crédito 2–6×", credit_7_12: "Crédito 7–12×" };

/** Modalidade pela forma e nº de parcelas. */
export function modalityFor(type: "debit" | "credit", installments: number): CardModality {
  if (type === "debit") return "debit";
  if (installments <= 1) return "credit_1";
  return installments <= 6 ? "credit_2_6" : "credit_7_12";
}

export interface TitleRule {
  kind: PaymentKind;
  /** machine: da linha bandeira × modalidade; demais: taxa % do meio. */
  feePct: number;
  /** boleto: taxa fixa por boleto (cobrada na 1ª linha). */
  flatFeeCents?: number;
  settleDays: number;
  anticipation?: boolean;
  anticipationFeePct?: number;
  anticipationDays?: number;
}
export interface Title { installmentNo: number; grossCents: number; feeCents: number; netCents: number; expectedDate: string }

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Uma linha por parcela. Sem antecipação: parcela n liquida em data + prazo × n. Com antecipação: todas no prazo de
 * antecipação, com a taxa somada. Bruto = valor ÷ n (meio-para-cima, resto na última); taxa meio-para-cima por linha.
 */
export function buildTitles(amountCents: number, installments: number, paidOn: string, rule: TitleRule): Title[] {
  const n = Math.max(1, Math.trunc(installments));
  if (rule.kind !== "machine" && n !== 1) throw new Error("INSTALLMENTS_MODALITY_MISMATCH");
  const anticipated = rule.kind === "machine" && rule.anticipation === true;
  const pct = rule.feePct + (anticipated ? rule.anticipationFeePct ?? 0 : 0);
  const gross = distribute(amountCents, Array.from({ length: n }, () => 1));
  return gross.map((g, i) => {
    const fee = percentOfCents(g, pct) + (i === 0 ? rule.flatFeeCents ?? 0 : 0);
    if (fee > g) throw new Error("FEE_EXCEEDS_AMOUNT");
    const days = rule.kind !== "machine" ? rule.settleDays : anticipated ? rule.anticipationDays ?? 0 : rule.settleDays * (i + 1);
    return { installmentNo: i + 1, grossCents: g, feeCents: fee, netCents: g - fee, expectedDate: addDays(paidOn, days) };
  });
}

// ---------- Status ----------
export type SaleStatus = "open" | "partial" | "paid" | "canceled";
export const SALE_STATUS_LABEL: Record<SaleStatus, string> = { open: "Aberta", partial: "Paga parcialmente", paid: "Quitada", canceled: "Cancelada" };
export type ReceivableStatus = "expected" | "settled" | "reversed";
export const RECEIVABLE_STATUS_LABEL: Record<ReceivableStatus, string> = { expected: "Previsto", settled: "Liquidado", reversed: "Estornado" };

// ---------- Caixa diário (§4.5) ----------
export interface CashLine { key: string; label: string; expectedCents: number }
export interface CashCloseLine extends CashLine { countedCents: number; differenceCents: number }
export interface CashClosePreview {
  lines: CashCloseLine[];
  /** Soma das diferenças ABSOLUTAS (todas as formas). */
  totalAbsDifferenceCents: number;
  cashDifferenceCents: number;
  /** Acima do limite: justificativa obrigatória e fechamento aguarda aprovação do gestor (F19). */
  needsApproval: boolean;
}

/** Conferência do fechamento: forma não contada = esperado; só a espécie é obrigatória. */
export function previewCashClose(expected: CashLine[], counted: Record<string, number | null | undefined>, limitCents: number): CashClosePreview {
  const lines = expected.map((e): CashCloseLine => {
    const c = counted[e.key];
    const countedCents = c == null ? e.expectedCents : c;
    return { ...e, countedCents, differenceCents: countedCents - e.expectedCents };
  });
  const total = lines.reduce((s, l) => s + Math.abs(l.differenceCents), 0);
  return { lines, totalAbsDifferenceCents: total, cashDifferenceCents: lines.find((l) => l.key === "cash")?.differenceCents ?? 0, needsApproval: total > limitCents };
}

/** Esperado em espécie = troco + recebimentos em espécie + suprimentos − sangrias. */
export function expectedCash(openingCents: number, cashPaymentsCents: number, movements: { type: "sangria" | "suprimento"; amountCents: number }[]): number {
  return movements.reduce((s, m) => s + (m.type === "suprimento" ? m.amountCents : -m.amountCents), openingCents + cashPaymentsCents);
}

export interface OpenRegisterRef { operatorId: string; status: "open" | "pending_approval" | "closed" }
/** F20: um operador não abre segundo caixa com outro ainda aberto. */
export function canOpenCash(registers: OpenRegisterRef[], operatorId: string): boolean {
  return !registers.some((r) => r.operatorId === operatorId && r.status === "open");
}

/** Caixa aberto de dia anterior é pendência. */
export function isStaleRegister(r: { status: string; businessDate: string }, today: string): boolean {
  return r.status === "open" && r.businessDate < today;
}

/** Chave de conferência do caixa (igual ao servidor): pix | cash | transfer | boleto | machine:<id>:<bandeira>. */
export function cashKey(kind: PaymentKind, acquirerId: string, brand: string | null): string {
  return kind === "machine" ? `machine:${acquirerId}:${(brand ?? "").trim().toLowerCase()}` : kind;
}

// ---------- Mensagens do servidor ----------
const MESSAGES: Record<string, string> = {
  MEDICATION_NOT_SELLABLE: "Medicação aplicada na clínica não pode ser vendida.",
  ITEM_NOT_SELLABLE: "Este item não está liberado para venda.",
  COMPLIANCE_ACCEPTANCE_REQUIRED: "Manipulado em unidade sem licença sanitária: o Owner precisa dar o aceite desta unidade antes da venda.",
  PRICE_NOT_ALLOWED: "Seu papel não permite alterar o preço de tabela.",
  INVALID_DISCOUNT: "Desconto inválido: maior que o valor do item ou do total.",
  SALE_TOTAL_REQUIRED: "O total da venda precisa ser maior que zero.",
  OVERPAYMENT: "O valor recebido passa do saldo da venda.",
  CASH_REGISTER_REQUIRED: "Abra o seu caixa antes de lançar este recebimento.",
  FEE_NOT_CONFIGURED: "Esta maquininha não tem taxa cadastrada para a bandeira e modalidade escolhidas.",
  BRAND_REQUIRED: "Informe a bandeira do cartão.",
  CASH_ALREADY_OPEN: "Você já tem um caixa aberto. Feche-o antes de abrir outro.",
  CASH_INSUFFICIENT: "A sangria é maior que o dinheiro em caixa.",
  JUSTIFICATION_REQUIRED: "A diferença passa do limite: informe a justificativa.",
  REASON_REQUIRED: "Informe o motivo (mínimo 3 letras).",
  SALE_CANCELED: "A venda está cancelada.",
  ALREADY_CANCELED: "A venda já está cancelada.",
  SETTLE_DATE_FUTURE: "A data de liquidação não pode ser futura.",
  PAST_DATE_NOT_ALLOWED: "Só o gestor pode lançar recebimento com data passada.",
  SELF_APPROVAL_NOT_ALLOWED: "Outra pessoa precisa aprovar este fechamento.",
  PATIENT_NOT_FOUND: "Paciente não encontrado nesta clínica.",
  INVALID_ITEM: "Algum item da venda não está mais disponível.",
  INSUFFICIENT_STOCK: "Saldo em estoque insuficiente para um dos produtos da venda. Confira o saldo em Estoque ou lance a entrada antes.",
  LOT_EXPIRED: "O lote disponível deste produto está vencido. Confira em Estoque.",
};

export function financeSalesErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const m = err.message ?? "";
  const hit = Object.keys(MESSAGES).find((k) => m.includes(k));
  if (hit) return MESSAGES[hit];
  if (err.code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}
