// Fechamento mensal do repasse (Entrega 6): tipos, rótulos, mensagens de erro, caminho dos arquivos e colunas de exportação.
// Quem decide é o servidor (RPC fin_closing_*); aqui só se descreve o que mostrar.
import { formatBRL } from "@/lib/domain/finance";
import { PAYOUT_LINE_LABEL, type PayoutLineType } from "@/lib/domain/finPayout";
import { periodName } from "@/lib/domain/taxRate";
import type { ExportColumn } from "@/lib/domain/tableExport";

export type ClosingStatus = "conferencia" | "aprovado" | "travado";
export type StatementStatus = "open" | "approved" | "paid";
export type Acceptance = "pending" | "accepted" | "contested" | "approved_without";
export type NfStatus = "not_required" | "pending" | "received";
export type PaymentStatus = "none" | "pending" | "paid";
export type PayMethod = "pix" | "transfer" | "cash" | "other";
export type AdjustKind = "bonus" | "discount" | "advance";

export const CLOSING_STATUS_LABEL: Record<ClosingStatus, string> = { conferencia: "Em conferência", aprovado: "Aprovado", travado: "Travado" };
export const ACCEPTANCE_LABEL: Record<Acceptance, string> = { pending: "Pendente", accepted: "Aceito", contested: "Contestado", approved_without: "Aprovado sem aceite" };
export const NF_LABEL: Record<NfStatus, string> = { not_required: "Não exigida", pending: "Pendente", received: "Recebida" };
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { pix: "Pix", transfer: "Transferência", cash: "Dinheiro", other: "Outra" };
export const ADJUST_KIND_LABEL: Record<AdjustKind, string> = { bonus: "Bônus (soma)", discount: "Desconto (subtrai)", advance: "Adiantamento (subtrai)" };
export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = { open: "Em conferência", approved: "Aprovado", paid: "Pago" };
export const BOND_LABEL: Record<string, string> = { pj: "PJ", autonomo: "Autônomo", clt: "CLT", socio: "Sócio" };

export type BadgeTone = "success" | "warning" | "destructive" | "info" | "primary" | "muted" | "outline";
export const acceptanceTone = (a: Acceptance): BadgeTone => (a === "accepted" ? "success" : a === "contested" ? "destructive" : a === "approved_without" ? "info" : "warning");
export const nfTone = (n: NfStatus): BadgeTone => (n === "received" ? "success" : n === "pending" ? "warning" : "muted");
export const closingTone = (s: ClosingStatus): BadgeTone => (s === "travado" ? "success" : s === "aprovado" ? "info" : "warning");

/** Linha da tabela do gestor (uma por profissional). */
export interface ClosingRow {
  id: string; professional_id: string; name: string; bond_type: string | null; appointments: number;
  pct_cents: number; fixed_exec_cents: number; fixed_monthly_cents: number; guarantee_cents: number; commission_cents: number; usage_fee_cents: number; adjustment_cents: number;
  gross_cents: number; withholding_cents: number; net_cents: number;
  withholdings: { rule_type: string; label: string | null; rate_pct: number; amount_cents: number; waived: "simples" | "min_base" | null }[];
  negative: boolean; status: StatementStatus; acceptance: Acceptance; accept_deadline: string; deadline_passed: boolean; notified_at: string | null; stmt_version: number;
  requires_invoice: boolean; nf_status: NfStatus; invoice_number: string | null; invoice_date: string | null; invoice_path: string | null;
  paid_on: string | null; pay_method: PayMethod | null; pay_note: string | null; proof_path: string | null; payment_status: PaymentStatus; open_disputes: number; answered_disputes: number;
}

export const WITHHOLDING_LABEL: Record<string, string> = { irrf: "IRRF", pis_cofins_csll: "PIS/COFINS/CSLL", iss: "ISS", outra: "Outra retenção" };
export const withholdingName = (w: { rule_type: string; label: string | null }): string => w.label || WITHHOLDING_LABEL[w.rule_type] || w.rule_type.toUpperCase();
const pctTxt = (v: number) => `${String(v).replace(".", ",")}%`;

// ---------- datas ----------
/** «2026-06» → «junho de 2026». */
export const periodLabel = (period: string): string => periodName(period);
/** Competência do mês anterior a «hoje» (o fechamento de outubro abre em novembro). Recebe a data de Brasília (AAAA-MM-DD). */
export function previousPeriod(todayIso: string): string {
  const y = Number(todayIso.slice(0, 4)); const m = Number(todayIso.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export const brDate = (iso: string | null | undefined): string => (!iso ? "—" : iso.split("T")[0].split("-").reverse().join("/"));
/** Data-hora (created_at) mostrada no horário de Brasília — nunca o dia do UTC. */
export const brDateTime = (iso: string | null | undefined): string =>
  !iso ? "—" : new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ---------- decisões de tela (o servidor confere de novo) ----------
/** Resumo do aceite para a coluna da tabela. */
export function acceptanceText(r: Pick<ClosingRow, "acceptance" | "deadline_passed" | "accept_deadline" | "status">): string {
  if (r.acceptance === "pending" && r.status === "open") return r.deadline_passed ? `Pendente · prazo venceu em ${brDate(r.accept_deadline)}` : `Pendente · até ${brDate(r.accept_deadline)}`;
  return ACCEPTANCE_LABEL[r.acceptance];
}
export function paymentText(r: Pick<ClosingRow, "payment_status" | "paid_on" | "status" | "net_cents">): string {
  if (r.payment_status === "paid") return `Pago em ${brDate(r.paid_on)}`;
  if (r.status === "open") return "Aguardando aprovação";
  if (r.net_cents <= 0) return "Nada a pagar";
  return "Pendente";
}
/** Pode ser incluído na aprovação em lote? (o servidor repete a conferência e devolve os motivos) */
export function canSelectForApproval(r: Pick<ClosingRow, "status" | "acceptance" | "deadline_passed">): boolean {
  if (r.status !== "open") return false;
  if (r.acceptance === "accepted") return true;
  return r.acceptance === "pending" && r.deadline_passed;
}
export const SKIP_REASON_TEXT: Record<string, string> = {
  CONTESTED: "tem contestação em aberto: responda e atualize o extrato",
  ACCEPTANCE_PENDING: "ainda no prazo de aceite do profissional",
  STATEMENT_CHANGED: "o extrato mudou depois da conferência: use «Atualizar extratos»",
};

// ---------- erros ----------
export function closingErrorMessage(e: unknown): string {
  const m = (e as { message?: string }).message ?? "";
  const code = (e as { code?: string }).code;
  const map: [string, string][] = [
    ["PERIOD_NOT_ENDED", "O fechamento começa no dia 1 do mês seguinte."],
    ["PERIOD_LOCKED", "Este mês está travado. Só o responsável pela clínica pode destravar, com motivo."],
    ["UNRULED_PENDING", "Há atendimento sem regra de repasse. Crie a regra ou marque «sem repasse» antes de aprovar."],
    ["NOT_ALL_APPROVED", "Aprove todos os extratos antes de travar o mês."],
    ["ALREADY_LOCKED", "Este mês já está travado."],
    ["NOT_LOCKED", "Este mês não está travado."],
    ["NOT_APPROVED", "Aprove o extrato antes de pagar."],
    ["NOTHING_TO_PAY", "Este extrato não tem valor líquido a pagar."],
    ["ALREADY_PAID", "Este extrato já foi pago."],
    ["INVOICE_REQUIRED", "Este profissional precisa enviar a NF antes do pagamento."],
    ["INVOICE_NOT_REQUIRED", "Este profissional não precisa emitir NF."],
    ["INVOICE_NUMBER_REQUIRED", "Informe o número da NF."],
    ["INVALID_INVOICE_DATE", "A data da NF não pode ser futura."],
    ["INVOICE_FILE_REQUIRED", "Anexe o arquivo da NF."],
    ["PROOF_REQUIRED", "Anexe o comprovante do pagamento."],
    ["INVALID_PAID_ON", "Informe a data do pagamento (não pode ser futura)."],
    ["INVALID_METHOD", "Escolha a forma de pagamento."],
    ["COMMENT_REQUIRED", "Escreva o motivo da contestação (mínimo de 3 letras)."],
    ["RESPONSE_REQUIRED", "Escreva a resposta (mínimo de 3 letras)."],
    ["ALREADY_ANSWERED", "Esta contestação já foi respondida."],
    ["INVALID_LINE", "Essa linha não pertence ao seu extrato do mês."],
    ["NOT_PENDING", "O extrato não está aguardando aceite."],
    ["STATEMENT_NOT_OPEN", "O extrato já foi aprovado e não muda mais."],
    ["INVALID_AMOUNT", "Informe um valor maior que zero."],
    ["REASON_REQUIRED", "Informe o motivo (mínimo de 3 letras)."],
    ["INVALID_KIND", "Escolha o tipo de ajuste."],
    ["NOTE_TOO_LONG", "A observação passou de 200 letras."],
  ];
  for (const [k, v] of map) if (m.includes(k)) return v;
  if (code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}

// ---------- arquivos (NF e comprovante) ----------
export const MAX_CLOSING_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_CLOSING_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export function closingFileError(file: { size: number; type: string }): string | null {
  if (!(ALLOWED_CLOSING_MIME as readonly string[]).includes(file.type)) return "Envie um PDF ou uma imagem (JPG, PNG ou WebP).";
  if (file.size > MAX_CLOSING_FILE_BYTES) return "O arquivo passa de 10 MB.";
  if (file.size === 0) return "O arquivo está vazio.";
  return null;
}
/** Caminho no bucket privado: <clínica>/<extrato>/<arquivo>. O nome é limpo (sem acento, espaço ou barra) e ganha prefixo único. */
export function closingFilePath(clinicId: string, statementId: string, kind: "nf" | "comprovante", fileName: string, stamp: number = Date.now()): string {
  const clean = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "arquivo";
  return `${clinicId}/${statementId}/${kind}-${stamp}-${clean}`;
}

// ---------- exportação (CSV/XLSX) ----------
const tableMoney = (f: (r: ClosingRow) => number): Pick<ExportColumn<ClosingRow>, "value" | "kind"> => ({ value: f, kind: "money" });
/** Valor de retenção mostrado como desconto, sem «-0,00» quando é zero. */
export const negCents = (c: number): number => (c ? -c : 0);
/** Data e hora do aviso ao profissional, ou que ainda não foi enviado. */
export const notifiedText = (iso: string | null): string => (iso ? `Enviado ao profissional em ${new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Ainda não enviado ao profissional");

export function closingTableColumns(period: string): ExportColumn<ClosingRow>[] {
  return [
    { header: "Competência", value: () => periodLabel(period) },
    { header: "Profissional", value: (r) => r.name },
    { header: "Vínculo", value: (r) => (r.bond_type ? BOND_LABEL[r.bond_type] ?? r.bond_type : "") },
    { header: "Atendimentos", value: (r) => r.appointments, kind: "qty" },
    { header: "Percentual (R$)", ...tableMoney((r) => r.pct_cents) },
    { header: "Fixo por execução (R$)", ...tableMoney((r) => r.fixed_exec_cents) },
    { header: "Fixo mensal (R$)", ...tableMoney((r) => r.fixed_monthly_cents) },
    { header: "Garantia (R$)", ...tableMoney((r) => r.guarantee_cents) },
    { header: "Comissões (R$)", ...tableMoney((r) => r.commission_cents) },
    { header: "Taxa de uso (R$)", ...tableMoney((r) => r.usage_fee_cents) },
    { header: "Ajustes (R$)", ...tableMoney((r) => r.adjustment_cents) },
    { header: "Total bruto (R$)", ...tableMoney((r) => r.gross_cents) },
    { header: "Retenções (R$)", ...tableMoney((r) => negCents(r.withholding_cents)) },
    { header: "Líquido a pagar (R$)", ...tableMoney((r) => r.net_cents) },
    { header: "Aceite", value: (r) => ACCEPTANCE_LABEL[r.acceptance] },
    { header: "NF", value: (r) => NF_LABEL[r.nf_status] },
    { header: "Pagamento", value: (r) => paymentText(r) },
  ];
}
/** Retenções por tipo e profissional (para o contador emitir as guias: §5.8). Uma linha por retenção. */
export interface WithholdingExportRow { name: string; tax: string; rate: string; base: number; amount: number; waived: string }
export function withholdingRows(rows: ClosingRow[]): WithholdingExportRow[] {
  return rows.flatMap((r) => r.withholdings.map((w) => ({
    name: r.name, tax: withholdingName(w), rate: pctTxt(w.rate_pct), base: r.gross_cents, amount: w.amount_cents,
    waived: w.waived === "simples" ? "Dispensada (Simples)" : w.waived === "min_base" ? "Abaixo do valor mínimo" : "",
  })));
}
export const withholdingColumns = (period: string): ExportColumn<WithholdingExportRow>[] => [
  { header: "Competência", value: () => periodLabel(period) }, { header: "Profissional", value: (r) => r.name }, { header: "Retenção", value: (r) => r.tax },
  { header: "Alíquota", value: (r) => r.rate }, { header: "Base (R$)", value: (r) => r.base, kind: "money" }, { header: "Valor retido (R$)", value: (r) => r.amount, kind: "money" }, { header: "Observação", value: (r) => r.waived },
];

/** Arquivo de pagamento (F14): nome, documento, chave Pix/banco e líquido. */
export interface PaymentFileRow { closing_pro_id: string; name: string; tax_id: string | null; pix_key: string | null; bank_name: string | null; bank_agency: string | null; bank_account: string | null; net_cents: number }
export function formatTaxId(d: string | null): string {
  if (!d) return "";
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}
export const paymentFileColumns: ExportColumn<PaymentFileRow>[] = [
  { header: "Nome", value: (r) => r.name }, { header: "CPF/CNPJ", value: (r) => formatTaxId(r.tax_id) }, { header: "Chave Pix", value: (r) => r.pix_key ?? "" },
  { header: "Banco", value: (r) => r.bank_name ?? "" }, { header: "Agência", value: (r) => r.bank_agency ?? "" }, { header: "Conta", value: (r) => r.bank_account ?? "" },
  { header: "Valor líquido (R$)", value: (r) => r.net_cents, kind: "money" },
];

/** Linhas do extrato do profissional (lançamentos + linhas mensais) para CSV/XLSX. */
export interface StatementItem { kind: "line" | "monthly" | "withholding"; date: string | null; patient: string | null; service: string; type: string; role: string; gross: number | null; base: number | null; pct: number | null; amount: number }
export const statementColumns: ExportColumn<StatementItem>[] = [
  { header: "Data", value: (i) => brDate(i.date) }, { header: "Paciente", value: (i) => i.patient ?? "" }, { header: "Serviço / papel", value: (i) => [i.service, i.role].filter(Boolean).join(" · ") },
  { header: "Tipo", value: (i) => i.type }, { header: "Valor liquidado (R$)", value: (i) => i.gross, kind: "money" }, { header: "Base (R$)", value: (i) => i.base, kind: "money" },
  { header: "Regra (%)", value: (i) => i.pct, kind: "pct" }, { header: "Repasse (R$)", value: (i) => i.amount, kind: "money" },
];
export interface StatementLineLike { source_date: string | null; patient: string | null; service_name: string | null; role: string | null; kind: string; line_type: PayoutLineType; gross_cents: number | null; base_cents: number | null; pct: number | null; amount_cents: number }
export function statementItems(
  lines: StatementLineLike[], derived: { line_type: PayoutLineType; amount_cents: number; memory?: Record<string, unknown> }[],
  withholdings: { rule_type: string; label: string | null; rate_pct: number; amount_cents: number; waived: string | null }[], roleLabel: (r: string) => string,
): StatementItem[] {
  const out: StatementItem[] = lines.map((l) => ({
    kind: "line", date: l.source_date, patient: l.patient, service: l.service_name ?? "", type: l.kind === "correction" ? (l.line_type === "adjustment" ? "Estorno / ajuste" : "Correção") : PAYOUT_LINE_LABEL[l.line_type],
    role: l.role ? roleLabel(l.role) : "", gross: l.gross_cents, base: l.base_cents, pct: l.pct, amount: l.amount_cents,
  }));
  for (const d of derived) out.push({ kind: "monthly", date: null, patient: null, service: d.memory?.carried_negative ? "Saldo negativo do mês anterior" : "", type: d.memory?.carried_negative ? "Saldo trazido" : PAYOUT_LINE_LABEL[d.line_type], role: "", gross: null, base: null, pct: null, amount: d.amount_cents });
  for (const w of withholdings) if (!w.waived && w.amount_cents !== 0) out.push({ kind: "withholding", date: null, patient: null, service: `${withholdingName(w)} (${pctTxt(w.rate_pct)})`, type: "Retenção", role: "", gross: null, base: null, pct: w.rate_pct, amount: -w.amount_cents });
  return out;
}

export const totalsText = (cents: number) => formatBRL(cents);

/** Linha do histórico do fechamento a partir do registro de auditoria. */
export interface ClosingHistoryRow { id: string; text: string; when: string; who: string | null }
interface AuditLike { id: string; entity: string; entity_id: string | null; action: string; after: Record<string, unknown> | null; before?: Record<string, unknown> | null; reason: string | null; user_name: string | null; at: string }
export function closingHistoryRows(entries: AuditLike[], closingId: string, period: string): ClosingHistoryRow[] {
  return entries
    .filter((e) => e.entity.startsWith("closing") && (e.entity_id === closingId || e.after?.period === period || e.before?.period === period))
    .map((e) => {
      const unlocked = e.entity === "closing" && e.action === "update" && e.after?.status === "conferencia" && "ledger_reversed" in (e.after ?? {});
      const text = unlocked ? `Mês destravado. Motivo: ${e.reason ?? "—"}` : e.reason ?? "Alteração";
      const when = new Date(e.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      return { id: e.id, text, when, who: e.user_name };
    });
}
