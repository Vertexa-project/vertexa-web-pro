// Regras de movimentação de estoque (escopo-v1 §8.2–8.4, §12.2). ESPELHAM as funções do servidor (private.stock_apply / stock_exit /
// fin_stock_entry): a tela usa estas funções para sugerir lote, valorar e avisar cedo, mas QUEM DECIDE É O SERVIDOR (que recusa o mesmo).
// Custo em CENTAVOS; custo médio com 4 casas (meio-para-cima); quantidades em milésimos inteiros para não herdar erro de ponto flutuante.
import { distribute } from "./finSales";
import { roundHalfUp, toMilli } from "./money";

export type EntryType = "initial_balance" | "purchase" | "xml_purchase" | "bonus";
export type ExitType = "sector" | "loss" | "appointment";
export type LossKind = "loss" | "breakage" | "expiry";
export type MovementType =
  | EntryType | ExitType | "sale" | "reversal" | "patient_return" | "package_delivery" | "supplier_return" | "transfer_out" | "transfer_in" | "inventory";

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  initial_balance: "Saldo inicial", purchase: "Compra", xml_purchase: "Compra por XML da NF-e", bonus: "Bonificação / doação",
};
export const EXIT_TYPE_LABEL: Record<ExitType, string> = { sector: "Consumo interno", loss: "Perda, quebra ou vencimento", appointment: "Uso por paciente" };
export const LOSS_KIND_LABEL: Record<LossKind, string> = { loss: "Perda", breakage: "Quebra / avaria", expiry: "Vencimento" };
export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  ...ENTRY_TYPE_LABEL, sector: "Consumo interno", loss: "Perda / quebra / vencimento", appointment: "Uso por paciente", sale: "Venda ao paciente", reversal: "Estorno",
  patient_return: "Devolução de paciente", package_delivery: "Entrega de item de pacote", supplier_return: "Devolução ao fornecedor", transfer_out: "Transferência (saída)",
  transfer_in: "Transferência (entrada)", inventory: "Ajuste de inventário",
};

/** true se é número finito com no máximo 3 casas decimais (escopo-v1 §3). */
export function hasValidDecimals(qty: number): boolean {
  return Number.isFinite(qty) && Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6;
}

// ---------- custo ----------
/** Custo médio novo (centavos, 4 casas): (saldo × CM atual + valor que entra) ÷ (saldo + qtde). Exemplo do documento: 10@40,00 + 20@46,00 → 44,00. */
export function weightedAverageCost(balanceQty: number, avgCostCents: number, entryQty: number, entryTotalCents: number): number {
  const newQty = toMilli(balanceQty) + toMilli(entryQty);
  if (newQty <= 0) return avgCostCents;
  return roundHalfUp(((toMilli(balanceQty) / 1000) * avgCostCents + entryTotalCents) / (newQty / 1000), 4);
}

/** Valor de uma saída: quantidade × custo médio do momento, em centavos inteiros (meio-para-cima). Saída não muda o custo médio. */
export function exitValueCents(qty: number, avgCostCents: number): number {
  return roundHalfUp((toMilli(qty) / 1000) * avgCostCents, 0);
}

/** Frete rateado pelo valor das linhas (meio-para-cima por linha, diferença na última). Devolve o total de cada linha já com o frete. */
export function allocateFreight(lineTotalsCents: number[], freightCents: number): number[] {
  if (freightCents <= 0) return lineTotalsCents.slice();
  if (lineTotalsCents.reduce((a, v) => a + v, 0) <= 0) throw new Error("INVALID_FREIGHT");
  const shares = distribute(freightCents, lineTotalsCents);
  return lineTotalsCents.map((v, i) => v + shares[i]);
}

/** Total da linha de entrada: o total informado, ou quantidade × custo unitário (centavos, meio-para-cima). */
export function entryLineTotalCents(qty: number, unitCostCents: number | null, lineTotalCents?: number | null): number | null {
  if (lineTotalCents !== undefined && lineTotalCents !== null) return Math.round(lineTotalCents);
  if (unitCostCents === null || !Number.isFinite(unitCostCents)) return null;
  return roundHalfUp((toMilli(qty) / 1000) * unitCostCents, 0);
}

// ---------- lote e validade ----------
export interface LotView { lotId: string; lotCode: string; expiryDate: string | null; qty: number; available: number }

export type ExpiryStatus = "none" | "expired" | "d30" | "d60" | "d90" | "ok";
/** Alertas de vencimento padrão (90, 60 e 30 dias — §8.3). `today` e `expiry` em AAAA-MM-DD. */
export function expiryStatus(expiry: string | null, today: string): ExpiryStatus {
  if (!expiry) return "none";
  if (expiry < today) return "expired";
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "ok";
}
export const EXPIRY_STATUS_LABEL: Record<ExpiryStatus, string> = {
  none: "Sem validade", expired: "Vencido", d30: "Vence em até 30 dias", d60: "Vence em até 60 dias", d90: "Vence em até 90 dias", ok: "Dentro da validade",
};

export interface Allocation { lotId: string; lotCode: string; qty: number }
export type StockRuleError =
  | "INVALID_QUANTITY" | "INSUFFICIENT_STOCK" | "LOT_EXPIRED" | "LOT_NOT_EXPIRED" | "EXPIRED_LOT_CONFIRM_REQUIRED" | "NOT_FRACTIONAL" | "FRACTION_EXCEEDS_UNIT"
  | "OPEN_UNIT_OTHER_PATIENT" | "OPEN_UNIT_EXPIRED" | "INSUFFICIENT_OPEN_UNIT" | "PATIENT_REQUIRED";

export class StockRuleException extends Error {
  constructor(public readonly code: StockRuleError) { super(code); }
}

/**
 * Sugere de quais lotes sai a quantidade: FEFO (vence primeiro, sai primeiro; sem validade por último).
 * Lote vencido nunca sai para consumo ou venda; só como perda por vencimento (`expiryLoss`), que usa SOMENTE lotes vencidos.
 * `chosenLotId` fixa um lote (o usuário pode trocar). Devolve as parcelas por lote ou lança StockRuleException.
 */
export function pickLotsFefo(lots: LotView[], qty: number, today: string, opts: { expiryLoss?: boolean; chosenLotId?: string | null } = {}): Allocation[] {
  const need = toMilli(qty);
  if (!hasValidDecimals(qty) || !(need > 0)) throw new StockRuleException("INVALID_QUANTITY");
  const sorted = lots.filter((l) => !opts.chosenLotId || l.lotId === opts.chosenLotId)
    .sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") || a.lotCode.localeCompare(b.lotCode));
  let left = need;
  const out: Allocation[] = [];
  for (const l of sorted) {
    if (left <= 0) break;
    const expired = l.expiryDate !== null && l.expiryDate < today;
    if (expired && !opts.expiryLoss) { if (opts.chosenLotId) throw new StockRuleException("LOT_EXPIRED"); continue; }
    if (!expired && opts.expiryLoss) { if (opts.chosenLotId) throw new StockRuleException("LOT_NOT_EXPIRED"); continue; }
    const take = Math.min(toMilli(l.available), left);
    if (take <= 0) continue;
    out.push({ lotId: l.lotId, lotCode: l.lotCode, qty: take / 1000 });
    left -= take;
  }
  if (left > 0) {
    const expiredAvailable = sorted.filter((l) => l.expiryDate !== null && l.expiryDate < today).reduce((a, l) => a + toMilli(l.available), 0);
    if (!opts.expiryLoss && left <= expiredAvailable) throw new StockRuleException("LOT_EXPIRED"); // E4: o que falta só existe em lote vencido
    if (opts.expiryLoss && lots.some((l) => (l.expiryDate === null || l.expiryDate >= today) && l.qty > 0)) throw new StockRuleException("LOT_NOT_EXPIRED");
    throw new StockRuleException("INSUFFICIENT_STOCK");
  }
  return out;
}

// ---------- uso fracionado e individual ----------
/** Validade da unidade aberta = a MENOR entre a do lote e (abertura + validade após aberto). E5: aberta 01/11, 28 dias, lote 30/12 → 29/11. */
export function openedUnitExpiry(openedOn: string, openedValidityDays: number | null, lotExpiry: string | null): string | null {
  const byOpen = openedValidityDays ? addIsoDays(openedOn, openedValidityDays) : null;
  if (byOpen && lotExpiry) return byOpen < lotExpiry ? byOpen : lotExpiry;
  return byOpen ?? lotExpiry;
}
export function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface OpenUnitView { openUnitId: string; patientId: string | null; qtyRemaining: number; expiresOn: string | null }
/** Dose de uma unidade aberta. E12: caneta aberta para o paciente X não dá dose ao paciente Y (a tela oferece abrir uma nova). */
export function checkDose(unit: OpenUnitView, dose: number, patientId: string | null, today: string, opts: { individualUse: boolean; isLoss?: boolean; expiryLoss?: boolean }): void {
  const expired = unit.expiresOn !== null && unit.expiresOn < today;
  if (opts.individualUse && !opts.isLoss && unit.patientId !== patientId) throw new StockRuleException("OPEN_UNIT_OTHER_PATIENT");
  if (expired && !opts.expiryLoss) throw new StockRuleException("OPEN_UNIT_EXPIRED");
  if (!expired && opts.expiryLoss) throw new StockRuleException("LOT_NOT_EXPIRED");
  if (toMilli(dose) > toMilli(unit.qtyRemaining)) throw new StockRuleException("INSUFFICIENT_OPEN_UNIT");
}

/** Quantidade válida de saída: até 3 casas; item não fracionado só em unidades inteiras; fracionado acima de 1 só em unidades inteiras. */
export function checkExitQuantity(qty: number, fractional: boolean): void {
  if (!hasValidDecimals(qty) || qty <= 0) throw new StockRuleException("INVALID_QUANTITY");
  if (!fractional && !Number.isInteger(qty)) throw new StockRuleException("NOT_FRACTIONAL");
  if (fractional && qty > 1 && !Number.isInteger(qty)) throw new StockRuleException("FRACTION_EXCEEDS_UNIT");
}

// ---------- validação de formulários ----------
export interface ExitDraft { type: ExitType; qty: number | null; reason: string; purpose: string; lossKind: LossKind | ""; patientId: string; confirmExpired: boolean }
export interface ExitContext { fractional: boolean; individualUse: boolean; selectedLotExpired: boolean }
export type ExitErrors = Partial<Record<"qty" | "reason" | "purpose" | "lossKind" | "patient" | "confirm", string>>;

export function validateExit(d: ExitDraft, ctx: ExitContext): ExitErrors {
  const e: ExitErrors = {};
  if (d.qty === null || !(d.qty > 0)) e.qty = "Informe a quantidade.";
  else {
    try { checkExitQuantity(d.qty, ctx.fractional); } catch (x) {
      const code = (x as StockRuleException).code;
      e.qty = code === "NOT_FRACTIONAL" ? "Este item só sai em unidades inteiras." : code === "FRACTION_EXCEEDS_UNIT" ? "Acima de 1 unidade, informe um número inteiro." : "Use no máximo 3 casas decimais.";
    }
  }
  if (d.type === "sector") {
    if (d.purpose.trim().length < 2) e.purpose = "Informe o setor ou a finalidade.";
    if (d.reason.trim().length < 3) e.reason = "Informe o motivo.";
  }
  if (d.type === "loss") {
    if (!d.lossKind) e.lossKind = "Escolha perda, quebra ou vencimento.";
    if (d.reason.trim().length < 3) e.reason = "Informe o motivo.";
    if (d.lossKind === "expiry" && ctx.selectedLotExpired && !d.confirmExpired) e.confirm = "Confirme que o lote venceu.";
  }
  if (d.type === "appointment" && !d.patientId) e.patient = "Escolha o paciente.";
  return e;
}

// ---------- mensagens do servidor ----------
const MESSAGES: Record<string, string> = {
  INSUFFICIENT_STOCK: "Saldo insuficiente para essa quantidade.",
  LOT_EXPIRED: "Lote vencido não sai para consumo ou venda. Registre como perda por vencimento.",
  LOT_NOT_EXPIRED: "Esse lote ainda está na validade; perda por vencimento só vale para lote vencido.",
  EXPIRED_LOT_CONFIRM_REQUIRED: "Confirme que o lote está vencido para registrar a perda.",
  INVALID_QUANTITY: "Quantidade inválida (use até 3 casas decimais).",
  NOT_FRACTIONAL: "Este item só aceita unidades inteiras.",
  FRACTION_EXCEEDS_UNIT: "Acima de 1 unidade, informe um número inteiro.",
  OPEN_UNIT_OTHER_PATIENT: "Esta unidade aberta é de outro paciente. Abra uma nova unidade para este paciente.",
  OPEN_UNIT_EXPIRED: "A unidade aberta está vencida. Registre o descarte como perda por vencimento.",
  OPEN_UNIT_NOT_FOUND: "Unidade aberta não encontrada.",
  INSUFFICIENT_OPEN_UNIT: "A unidade aberta não tem essa quantidade.",
  PATIENT_REQUIRED: "Escolha o paciente.",
  PATIENT_NOT_FOUND: "Paciente não encontrado.",
  PURPOSE_AND_REASON_REQUIRED: "Informe o setor ou finalidade e o motivo.",
  REASON_REQUIRED: "Informe o motivo.",
  LOSS_KIND_REQUIRED: "Escolha perda, quebra ou vencimento.",
  INVALID_EXIT_TYPE: "Tipo de saída inválido.",
  INITIAL_BALANCE_EXISTS: "Esse item já tem saldo inicial nesta unidade. Para corrigir, estorne o lançamento antigo ou lance uma entrada.",
  LOT_REQUIRED: "Este item exige lote e validade em todas as linhas.",
  LOT_ALREADY_EXPIRED: "A validade informada já passou.",
  LOT_EXPIRY_MISMATCH: "Esse lote já existe com outra validade.",
  COST_REQUIRED: "Informe o custo de cada linha (zero só em bonificação).",
  INVOICE_NUMBER_REQUIRED: "Informe o número da nota.",
  INVOICE_KEY_REQUIRED: "A chave de acesso da NF-e (44 dígitos) é obrigatória.",
  INVOICE_ALREADY_IMPORTED: "Essa nota já foi lançada. Para lançar de novo, estorne a anterior.",
  SUPPLIER_REQUIRED: "Informe o fornecedor.",
  INVALID_TAX_ID: "CPF/CNPJ inválido.",
  ORIGIN_REQUIRED: "Informe a origem da bonificação ou doação.",
  INVALID_FREIGHT: "Frete inválido para esta entrada.",
  INVALID_DATE: "Data inválida.",
  INVALID_ITEM: "Item inválido ou inativo.",
  INVALID_UNITS: "Unidade inválida.",
  INVALID_FACTOR: "O fator de conversão deve ser maior que zero.",
  ENTRY_LINES_REQUIRED: "Inclua ao menos um item.",
  TOO_MANY_LINES: "Muitas linhas (máximo 500 por entrada).",
  ALREADY_REVERSED: "Este lançamento já foi estornado.",
  CANNOT_REVERSE_REVERSAL: "Um estorno não se estorna; faça um novo lançamento.",
  SALE_MOVEMENT_USE_CANCEL: "A baixa da venda volta quando a venda é cancelada.",
  REVERSAL_NO_STOCK: "Essa entrada já foi consumida em parte. Estorne antes as saídas dela.",
  STOCK_MOVEMENT_IMMUTABLE: "Movimentação não se edita nem se apaga; corrija por estorno.",
  NAME_REQUIRED: "Informe o nome.",
  APPOINTMENT_MOVEMENT_USE_CORRECT: "A baixa de um atendimento se corrige no próprio atendimento (Financeiro › Atendimentos › Corrigir kit).",
  DELIVERY_USE_RETURN: "A entrega de item de pacote se desfaz pela devolução de paciente.",
  RETURN_NOT_REVERSIBLE: "Devolução de paciente não se estorna.",
};

export function stockMoveErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const m = err?.message ?? "";
  const hit = Object.keys(MESSAGES).find((k) => m.includes(k));
  if (hit) return MESSAGES[hit];
  if (err?.code === "42501" || m.includes("forbidden")) return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}

/** Hoje (AAAA-MM-DD) no horário de Brasília, como o servidor (private.fin_today). */
export function todayIsoBR(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** Quantidade para exibir: até 3 casas, vírgula decimal, sem zeros sobrando (2,5 · 0,25 · 10). */
export function formatQty(qty: number): string {
  return qty.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/** Custo unitário em centavos (até 4 casas de centavo) → "R$ 44,00"; com fração de centavo, até 4 casas em reais: "R$ 6,0047". */
export function formatUnitCost(cents: number): string {
  const reais = cents / 100;
  const frac = Math.abs(reais * 100 - Math.round(reais * 100)) > 1e-9;
  return reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: frac ? 4 : 2 });
}
