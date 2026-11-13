// Financeiro · Entrega 4 — regras PURAS do atendimento (participantes), do kit (baixa e custo do material) e dos pacotes
// (escopo-v1 §4.4, §5.4, §8.2, §8.5, §12.2 E2/E3/E11/E17). ESPELHAM o servidor (migration 20261114090000_fin_e4_atendimento.sql) para
// pré-visualizar e avisar cedo; QUEM DECIDE É O SERVIDOR. Dinheiro em centavos inteiros; quantidades em milésimos; meio-para-cima.
import { distribute } from "./finSales";
import { roundHalfUp, toMilli } from "./money";
import { exitValueCents } from "./stockMoves";

export type ApptRole = "responsavel" | "executor" | "auxiliar";
export const APPT_ROLES: ApptRole[] = ["responsavel", "executor", "auxiliar"];
export const APPT_ROLE_LABEL: Record<ApptRole, string> = { responsavel: "Responsável", executor: "Executor", auxiliar: "Auxiliar" };

export type ApptStatus = "open" | "done" | "canceled";
export const APPT_STATUS_LABEL: Record<ApptStatus, string> = { open: "Aguardando", done: "Realizado", canceled: "Cancelado" };

// ---------- participantes (base do repasse) ----------
export interface ParticipantDraft { professionalId: string; role: ApptRole }

/** 1 responsável (obrigatório), até 1 executor, auxiliares à vontade; só papéis que o serviço prevê; sem repetir pessoa no mesmo papel. Devolve a mensagem ou null. */
export function validateParticipants(parts: ParticipantDraft[], allowedRoles: ApptRole[]): string | null {
  if (parts.length === 0) return "Informe quem é o responsável pelo atendimento.";
  if (parts.some((p) => !p.professionalId)) return "Escolha o profissional de cada papel.";
  if (parts.length > 10) return "No máximo 10 participantes por atendimento.";
  const seen = new Set<string>();
  for (const p of parts) {
    if (!allowedRoles.includes(p.role)) return `O serviço não prevê o papel ${APPT_ROLE_LABEL[p.role].toLowerCase()}.`;
    const key = `${p.professionalId}|${p.role}`;
    if (seen.has(key)) return "A mesma pessoa aparece duas vezes no mesmo papel.";
    seen.add(key);
  }
  if (parts.filter((p) => p.role === "responsavel").length !== 1) return "Precisa de exatamente um responsável.";
  if (parts.filter((p) => p.role === "executor").length > 1) return "Só pode haver um executor por atendimento.";
  return null;
}

// ---------- kit: unidade de CONSUMO → unidade de ESTOQUE ----------
/** O kit é cadastrado na unidade de consumo; o estoque se move na unidade de estoque (1 estoque = `factor` consumos), 3 casas. 5 ml de frasco de 30 ml → 0,167. */
export function kitStockQty(consumptionQty: number, factor: number): number {
  if (!(factor > 0)) throw new Error("INVALID_FACTOR");
  return roundHalfUp(consumptionQty / factor, 3);
}

/** Custo do material de uma linha: quantidade de estoque × custo médio do momento (centavos, meio-para-cima). 0,167 × R$ 300,00 = R$ 50,10. */
export function kitLineCostCents(consumptionQty: number, factor: number, avgCostCents: number): number {
  return exitValueCents(kitStockQty(consumptionQty, factor), avgCostCents);
}

export interface KitLineDraft { itemId: string; quantity: number | null; lotId: string }
export interface KitLineInfo { itemId: string; fractional: boolean; factor: number; balance: number; avgCostCents: number | null }
export type KitLineErrors = Record<number, string>;

/** Erros de preenchimento do kit confirmado (por linha). O servidor repete as mesmas regras. */
export function validateKit(lines: KitLineDraft[], info: (itemId: string) => KitLineInfo | undefined): KitLineErrors {
  const errors: KitLineErrors = {};
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (!l.itemId) { errors[i] = "Escolha o item."; return; }
    if (seen.has(l.itemId)) { errors[i] = "O mesmo item aparece duas vezes."; return; }
    seen.add(l.itemId);
    if (l.quantity === null || !(l.quantity > 0)) { errors[i] = "Informe uma quantidade maior que zero."; return; }
    if (Math.abs(l.quantity * 1000 - Math.round(l.quantity * 1000)) > 1e-6) { errors[i] = "Use no máximo 3 casas decimais."; return; }
    const it = info(l.itemId);
    if (!it) return;
    const stock = kitStockQty(l.quantity, it.factor);
    if (stock <= 0) errors[i] = "Quantidade pequena demais para a unidade de estoque.";
    else if (!it.fractional && stock !== Math.trunc(stock)) errors[i] = "Este item não é fracionado: a quantidade precisa dar unidades inteiras de estoque.";
  });
  return errors;
}

export interface KitLinePlan { stockQty: number; shortQty: number; enough: boolean; estimatedCostCents: number | null }
/** Pré-visualização: quanto sai do estoque, quanto faltaria («consumo sem saldo») e o custo estimado pelo custo médio atual. */
export function planKitLine(consumptionQty: number, info: KitLineInfo): KitLinePlan {
  const stockQty = kitStockQty(consumptionQty, info.factor);
  const short = Math.max(0, (toMilli(stockQty) - toMilli(info.balance)) / 1000);
  return { stockQty, shortQty: short, enough: short === 0, estimatedCostCents: info.avgCostCents === null ? null : exitValueCents(stockQty, info.avgCostCents) };
}

// ---------- pacotes ----------
/** Valor líquido de cada pacote vendido (quantidade > 1) e de cada linha dentro do pacote (§5.4, D23): meio-para-cima por linha, resto na última. */
export function packageNetShares(saleItemNetCents: number, packageCount: number, lineWeights: number[]): { packageCents: number; lines: number[] }[] {
  const perPackage = distribute(saleItemNetCents, Array.from({ length: packageCount }, () => 1));
  return perPackage.map((p) => ({ packageCents: p, lines: distribute(p, lineWeights) }));
}

/** Valor da próxima sessão/entrega de uma linha: proporcional ao total; a ÚLTIMA leva a sobra do arredondamento. */
export function packageUseValueCents(netTotalCents: number, qtyTotal: number, qtyUsed: number, priorValueCents: number, qty = 1): number {
  if (qtyUsed + qty >= qtyTotal) return netTotalCents - priorValueCents;
  return roundHalfUp((netTotalCents * qty) / qtyTotal, 0);
}

export interface PackageItemView { qtyTotal: number; qtyUsed: number }
export function packageRemaining(i: PackageItemView): number { return Math.max(0, (toMilli(i.qtyTotal) - toMilli(i.qtyUsed)) / 1000); }
export function packageExpired(expiresOn: string, today: string): boolean { return expiresOn < today; }

// ---------- mensagens ----------
const MESSAGES: Record<string, string> = {
  PARTICIPANTS_REQUIRED: "Informe quem participou do atendimento.",
  RESPONSIBLE_REQUIRED: "Precisa de exatamente um responsável.",
  ONE_EXECUTOR: "Só pode haver um executor por atendimento.",
  ROLE_NOT_ALLOWED: "O serviço não prevê esse papel no atendimento.",
  INVALID_PROFESSIONAL: "Um dos profissionais não está ativo nesta clínica.",
  DUPLICATE_PARTICIPANT: "A mesma pessoa aparece duas vezes no mesmo papel.",
  TOO_MANY_PARTICIPANTS: "No máximo 10 participantes por atendimento.",
  INVALID_SERVICE: "Serviço inválido ou inativo.",
  PATIENT_NOT_FOUND: "Paciente não encontrado nesta clínica.",
  INVALID_UNITS: "Unidade inválida.",
  INVALID_DATE: "Data inválida.",
  FUTURE_DATE: "Atendimento com data futura ainda não pode ser realizado. Ajuste a data ou espere o dia.",
  APPOINTMENT_NOT_OPEN: "Este atendimento já foi realizado ou cancelado.",
  APPOINTMENT_NOT_DONE: "Só atendimento realizado tem kit para corrigir.",
  ALREADY_CANCELED: "Este atendimento já está cancelado.",
  REASON_REQUIRED: "Informe o motivo.",
  LINK_CONFLICT: "Escolha a venda OU o pacote de origem, não os dois.",
  INVALID_SALE_LINK: "Essa venda não cobre este serviço para este paciente.",
  SALE_CANCELED: "A venda escolhida está cancelada.",
  SALE_ITEM_CONSUMED: "Todas as unidades dessa venda já têm atendimento.",
  INVALID_PACKAGE_LINK: "Esse pacote não cobre este serviço para este paciente.",
  PACKAGE_CANCELED: "O pacote está cancelado.",
  PACKAGE_EXPIRED: "O pacote está vencido; o saldo não usado vira receita da clínica.",
  NO_SESSIONS_LEFT: "O pacote não tem mais sessões para este serviço.",
  NO_ITEMS_LEFT: "Todas as unidades deste item do pacote já foram entregues.",
  NOT_A_PRODUCT_ITEM: "Este item do pacote é uma sessão, não um produto.",
  INVALID_ITEM: "Algum item do kit não existe mais ou está inativo.",
  DUPLICATE_ITEM: "O mesmo item aparece duas vezes no kit.",
  INVALID_QUANTITY: "Quantidade inválida (até 3 casas decimais, maior que zero; produto entregue é em unidades inteiras).",
  NOT_FRACTIONAL: "Este item não é fracionado: use unidades inteiras.",
  INVALID_LOT: "O lote escolhido não pertence a este item nesta unidade.",
  LOT_EXPIRED: "O lote escolhido está vencido; escolha outro (vencido só sai como perda por vencimento).",
  INSUFFICIENT_STOCK: "Saldo em estoque insuficiente. Lance a entrada antes.",
  INSUFFICIENT_OPEN_UNIT: "A unidade aberta não tem essa quantidade.",
  OPEN_UNIT_EXPIRED: "A unidade aberta venceu; descarte-a em Estoque › Saídas.",
  OPEN_UNIT_OTHER_PATIENT: "Esta unidade aberta é de outro paciente (uso individual).",
  APPOINTMENT_MOVEMENT_USE_CORRECT: "A baixa de um atendimento se corrige no próprio atendimento (Corrigir kit).",
  DELIVERY_USE_RETURN: "A entrega de item de pacote se desfaz pela devolução de paciente.",
  RETURN_NOT_REVERSIBLE: "Devolução de paciente não se estorna; faça uma nova saída.",
  RETURN_NOT_ALLOWED: "Só venda ou entrega de item de pacote pode ter devolução de paciente.",
  RETURN_NOT_ALLOWED_OPEN_UNIT: "Dose de unidade aberta nunca é entregue ao paciente; não há devolução.",
  RETURN_EXCEEDS_ORIGIN: "Não dá para devolver mais do que saiu (ou o que já foi devolvido).",
  ALREADY_RESOLVED: "Este consumo sem saldo já foi resolvido.",
  INVALID_MODE: "Escolha como resolver.",
  PACKAGE_QUANTITY_INTEGER: "Pacote se vende em unidades inteiras.",
  INVALID_LINES: "Kit inválido.",
  TOO_MANY_LINES: "Itens demais no kit (máximo 60).",
  RECORD_NOT_DELETABLE: "Registro financeiro não se apaga; use o cancelamento.",
};

export function apptErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const m = err?.message ?? "";
  const hit = Object.keys(MESSAGES).find((k) => m.includes(k));
  if (hit) return MESSAGES[hit];
  if (err?.code === "42501" || m.includes("forbidden")) return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}
