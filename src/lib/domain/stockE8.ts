// Regras puras do Estoque · Entrega 8 (inventário cego, transferências, alertas, relatórios). A AUTORIDADE é do servidor; aqui: rótulos, mensagens e conferências de formulário.
import type { InventoryLine, InventoryStatus, ReportKey, TransferLine, TransferStatus } from "@/lib/api/stockE8";
import { formatBRL } from "@/lib/domain/finance";

export const INVENTORY_STATUS_LABEL: Record<InventoryStatus, string> = { counting: "Em contagem", review: "Em revisão", approved: "Aprovado", canceled: "Cancelado" };
export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = { in_transit: "Em trânsito", received: "Recebida", canceled: "Cancelada" };
export const SCOPE_LABEL = { all: "Todo o estoque da unidade", category: "Uma categoria", type: "Um tipo de item" } as const;
export const ITEM_TYPE_LABEL: Record<string, string> = { medication: "Medicamento", compounded: "Manipulado", resale: "Revenda", consumable: "Consumível" };

export const REPORTS: { key: ReportKey; label: string; hint: string; period: boolean }[] = [
  { key: "position", label: "Posição e valor do estoque", hint: "Saldo e valor (custo médio) de cada item por unidade, hoje.", period: false },
  { key: "movements", label: "Movimentações no período", hint: "Entradas e saídas por item e unidade, com o valor.", period: true },
  { key: "consumption", label: "Consumo por atendimento", hint: "O que os atendimentos consumiram, por serviço, profissional ou item.", period: true },
  { key: "losses", label: "Perdas", hint: "Perda, quebra, vencimento e diferença de transferência, por motivo.", period: true },
  { key: "validity", label: "Validade", hint: "Lotes vencidos ou que vencem na janela escolhida.", period: false },
  { key: "idle", label: "Itens sem giro", hint: "Itens com saldo parados há muitos dias.", period: false },
  { key: "purchases", label: "Compras por fornecedor", hint: "Entradas de compra e de XML no período.", period: true },
];

const MESSAGES: Record<string, string> = {
  INVALID_UNITS: "Unidade inválida.", SAME_UNIT: "Origem e destino precisam ser unidades diferentes.", UNIT_INACTIVE: "Uma das unidades está inativa.",
  LINES_REQUIRED: "Informe pelo menos uma linha.", INVALID_ITEM: "Item inválido.", INVALID_QUANTITY: "Quantidade inválida (item inteiro; sem passar do enviado).", INVALID_LOT: "Lote inválido para esta unidade.",
  INSUFFICIENT_STOCK: "Saldo insuficiente na unidade de origem (considere só unidades inteiras e lotes não vencidos).", LOT_EXPIRED: "Lote vencido: não pode ser transferido.",
  NOT_FOUND: "Registro não encontrado.", NOT_IN_TRANSIT: "Esta transferência não está mais em trânsito.", ALL_LINES_REQUIRED: "Confira todas as linhas da transferência.", INVALID_LINE: "Linha inválida.",
  DIVERGENCE_REASON_REQUIRED: "Quantidade a menos ou lote diferente exige o motivo da divergência (mínimo 3 letras).", LOT_REQUIRED: "Informe o lote e a validade deste item.",
  LOT_EXPIRY_MISMATCH: "Este lote já existe no destino com outra validade.", REASON_REQUIRED: "Informe o motivo (mínimo 3 letras).",
  INVALID_SCOPE: "Escopo inválido.", SCOPE_VALUE_REQUIRED: "Escolha a categoria ou o tipo do escopo.", INVENTORY_ALREADY_OPEN: "Já existe um inventário aberto nesta unidade. Aprove ou cancele antes de abrir outro.",
  COUNT_CLOSED: "A contagem deste inventário já foi encerrada.", NOT_FRACTIONAL: "Este item só pode ser contado em unidades inteiras.", UNCOUNTED_LINES: "Ainda há itens sem contagem. Conte todos ou confirme que o que sobrou é zero.",
  NOT_IN_REVIEW: "Este inventário não está em revisão.", INVENTORY_CLOSED: "Este inventário já foi encerrado.", INVENTORY_LINE_STALE: "O saldo mudou desde a contagem e o ajuste ficaria negativo. Reabra a contagem e recontem o item.",
  INVENTORY_BELOW_OPEN_UNITS: "O ajuste deixaria o lote abaixo das unidades abertas. Recontem o item.", STOCK_MOVEMENT_FROM_TRANSFER: "Movimento de transferência/inventário não se estorna à mão: cancele a transferência ou reabra o inventário.",
  INVALID_EXPIRY_DAYS: "Janelas de vencimento: de 1 a 5 valores, de 1 a 365 dias.", INVALID_IDLE_DAYS: "Dias sem giro: de 7 a 730.", INVALID_TRANSFER_DAYS: "Dias para transferência parada: de 1 a 60.",
  INVALID_PERIOD: "Período inválido (início depois do fim, ou mais de 10 anos).", INVALID_REPORT: "Relatório inválido.",
};
export function e8ErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const m = err?.message ?? "";
  const hit = Object.keys(MESSAGES).find((k) => m.includes(k));
  if (hit) return MESSAGES[hit];
  if (err?.code === "42501" || m.includes("forbidden")) return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}

/** Reais sem «-R$ 0,00»: valor que arredonda para zero sai como R$ 0,00. */
export function moneyOrZero(cents: number | null | undefined): string {
  const c = Math.round(cents ?? 0);
  return formatBRL(c === 0 ? 0 : c);
}
/** Diferença assinada para exibir: «+2», «−3», «0». */
export function signedQty(q: number): string {
  const s = Math.abs(q).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return q > 0 ? `+${s}` : q < 0 ? `−${s}` : "0";
}
export function brDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
}
export function brDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
}

/** Rascunho de contagem: texto digitado por linha → quantidade (vírgula decimal). Vazio = ainda não contada. */
export function parseCountText(raw: string, fractional: boolean): { ok: true; qty: number | null } | { ok: false; error: string } {
  const t = raw.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return { ok: true, qty: null };
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { ok: false, error: "Use número com até 3 casas." };
  const q = Number(t);
  if (!fractional && q !== Math.trunc(q)) return { ok: false, error: "Este item só tem unidades inteiras." };
  if (q > 1_000_000) return { ok: false, error: "Quantidade muito alta." };
  return { ok: true, qty: q };
}

/** Linhas de contagem que mudaram em relação ao que está salvo (só estas vão ao servidor). */
export function changedCounts(lines: InventoryLine[], drafts: Record<string, string>): { lineId: string; countedQty: number | null }[] {
  const out: { lineId: string; countedQty: number | null }[] = [];
  for (const l of lines) {
    if (!(l.id in drafts)) continue;
    const p = parseCountText(drafts[l.id], l.fractional);
    if (!p.ok) continue;
    if (p.qty !== l.counted_qty) out.push({ lineId: l.id, countedQty: p.qty });
  }
  return out;
}

export function countProgress(lines: InventoryLine[], drafts: Record<string, string>): { counted: number; total: number } {
  let counted = 0;
  for (const l of lines) {
    const p = l.id in drafts ? parseCountText(drafts[l.id], l.fractional) : { ok: true as const, qty: l.counted_qty };
    if (p.ok && p.qty !== null) counted += 1;
  }
  return { counted, total: lines.length };
}

/** O inventário cego esconde o esperado: se alguma linha trouxe esperado, a tela está em revisão (ou a contagem não é cega). */
export function linesShowExpected(lines: InventoryLine[]): boolean {
  return lines.some((l) => l.expected_qty !== null);
}

export interface ReceiveDraft { qty: string; lotCode: string; expiry: string; reason: string }
export function receiveDraftFor(l: TransferLine): ReceiveDraft {
  return { qty: String(l.qty_sent).replace(".", ","), lotCode: l.lot_code, expiry: l.expiry_date ?? "", reason: "" };
}
/** Recebimento: quantidade ≤ enviada; divergência (a menos ou lote/validade diferente) exige motivo. */
export function validateReceive(l: TransferLine, d: ReceiveDraft): { error?: string; diverges: boolean; qty: number | null } {
  const t = d.qty.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { error: "Informe a quantidade recebida.", diverges: false, qty: null };
  const qty = Number(t);
  if (qty > l.qty_sent) return { error: `Não pode passar do enviado (${l.qty_sent}).`, diverges: false, qty };
  const diverges = qty < l.qty_sent || d.lotCode.trim() !== l.lot_code || (d.expiry || null) !== (l.expiry_date ?? null);
  if (diverges && d.reason.trim().length < 3) return { error: "Divergência: informe o motivo.", diverges, qty };
  return { diverges, qty };
}

/** Soma da lista = total mostrado (relatórios): confere o total do servidor contra as linhas que a tela tem. */
export function sumField(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}
