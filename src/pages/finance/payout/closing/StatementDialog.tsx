// Extrato do profissional no fechamento (Entrega 6): cabeçalho, linhas mensais, lançamentos com memória, retenções, líquido, contestações, NF e pagamento.
// Usado pelo gestor (Fechamento › Ver extrato) e pelo profissional (Meu extrato). Quem decide o que cada um pode é o servidor; aqui só se mostra o que o papel alcança.
import { useMemo, useState } from "react";
import { Check, FileText, MessageSquareWarning, RefreshCw } from "lucide-react";

import { CentsInput, ExportButtons, Field, FinTable, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFinContext } from "@/hooks/useFin";
import { useAcceptStatement, useAdjustStatement, useAnswerDispute, useApproveClosing, useContestStatement, usePayStatement, useRefreshClosing, useSaveInvoice, useStatement } from "@/hooks/useFinClosing";
import { closingFileUrl, type DisputeRow, type StatementView } from "@/lib/api/finClosing";
import type { PayoutLineRow } from "@/lib/api/finPayout";
import {
  ADJUST_KIND_LABEL, NF_LABEL, PAY_METHOD_LABEL, STATEMENT_STATUS_LABEL, SKIP_REASON_TEXT, acceptanceText, acceptanceTone, brDate, brDateTime, closingErrorMessage,
  nfTone, paymentText, periodLabel, statementColumns, statementItems, withholdingName, type AdjustKind, type PayMethod,
} from "@/lib/domain/finClosing";
import { formatBRL } from "@/lib/domain/finance";
import { PAYOUT_LINE_LABEL, PAYOUT_ROLE_LABEL } from "@/lib/domain/finPayout";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { PayoutMemoryDialog } from "@/pages/finance/payout/PayoutMemoryDialog";

const pctTxt = (v: number) => `${String(v).replace(".", ",")}%`;
type StatementLine = StatementView["lines"][number];

/** Abre o arquivo (NF ou comprovante) por URL assinada de curta duração. */
function FileLink({ path, label }: { path: string | null; label: string }) {
  const [err, setErr] = useState<string | null>(null);
  if (!path) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => { setErr(null); closingFileUrl(path).then((u) => window.open(u, "_blank", "noopener,noreferrer")).catch(() => setErr("Não foi possível abrir o arquivo.")); }}>
        <FileText aria-hidden /> {label}
      </Button>
      {err ? <span className="text-xs text-destructive" role="alert">{err}</span> : null}
    </span>
  );
}

export function StatementDialog({ statementId, onClose }: { statementId: string; onClose: () => void }) {
  const { clinicId } = useFinContext();
  const q = useStatement(statementId);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-4xl">
        {q.isLoading ? <><DialogHeader><DialogTitle>Extrato</DialogTitle></DialogHeader><DialogBody><LoadingState /></DialogBody></>
          : q.isError || !q.data ? <><DialogHeader><DialogTitle>Extrato</DialogTitle></DialogHeader><DialogBody><ErrorState onRetry={() => void q.refetch()} /></DialogBody></>
          : <StatementBody v={q.data} clinicId={clinicId ?? ""} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function StatementBody({ v, clinicId, onClose }: { v: StatementView; clinicId: string; onClose: () => void }) {
  const r = v.row;
  const locked = v.closing.locked;
  const open = r.status === "open" && !locked;
  const [memory, setMemory] = useState<PayoutLineRow | null>(null);
  const [dlg, setDlg] = useState<null | { kind: "contest"; line: StatementLine | null } | { kind: "answer"; dispute: DisputeRow } | { kind: "adjust" } | { kind: "invoice" } | { kind: "pay" }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const accept = useAcceptStatement(); const approve = useApproveClosing(); const refresh = useRefreshClosing();
  const items = useMemo(() => statementItems(v.lines, v.derived, v.withholdings, (x) => PAYOUT_ROLE_LABEL[x as keyof typeof PAYOUT_ROLE_LABEL] ?? x), [v]);
  const canContest = v.is_self && open && (r.acceptance === "pending" || r.acceptance === "accepted");
  const canNf = r.requires_invoice && !locked && (v.is_self || v.can.pay);
  const canPay = v.can.pay && r.status === "approved" && r.net_cents > 0 && !locked;
  const lineRow = (l: StatementLine): PayoutLineRow => ({ ...l, professional_id: v.professional.id, professional_name: v.professional.name });

  const run = <T,>(p: Promise<T>, ok: (x: T) => string) => { setNotice(null); setErr(null); p.then((x) => setNotice(ok(x))).catch((e) => setErr(closingErrorMessage(e))); };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Extrato de {v.professional.name} · {periodLabel(v.closing.period)}</DialogTitle>
        <DialogDescription>
          {STATEMENT_STATUS_LABEL[r.status]}{locked ? " · mês travado" : ""} · versão {r.stmt_version}{v.professional.bond_type ? ` · ${v.professional.bond_type.toUpperCase()}` : ""}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={acceptanceTone(r.acceptance)}>{acceptanceText(r)}</Badge>
          {r.requires_invoice ? <Badge tone={nfTone(r.nf_status)}>NF {NF_LABEL[r.nf_status].toLowerCase()}</Badge> : null}
          <Badge tone={r.payment_status === "paid" ? "success" : "muted"}>{paymentText(r)}</Badge>
          {r.negative ? <Badge tone="warning">Saldo negativo levado ao mês seguinte</Badge> : null}
        </div>
        {notice ? <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{notice}</p> : null}
        {err ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{err}</p> : null}
        {!v.check.matches ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">Os lançamentos do mês mudaram depois da última conferência. {v.can.prepare ? "Use «Atualizar extrato»." : "Peça ao financeiro para atualizar o extrato."}</p> : null}

        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Percentual</dt><dd className="tabular-nums">{formatBRL(r.pct_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Fixo por execução</dt><dd className="tabular-nums">{formatBRL(r.fixed_exec_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Fixo mensal</dt><dd className="tabular-nums">{formatBRL(r.fixed_monthly_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Garantia</dt><dd className="tabular-nums">{formatBRL(r.guarantee_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Comissões</dt><dd className="tabular-nums">{formatBRL(r.commission_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Taxa de uso</dt><dd className="tabular-nums">{formatBRL(r.usage_fee_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Ajustes e estornos</dt><dd className="tabular-nums">{formatBRL(r.adjustment_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Total bruto</dt><dd className="font-semibold tabular-nums">{formatBRL(r.gross_cents)}</dd></div>
          {v.withholdings.map((w) => (
            <div key={`${w.rule_type}-${w.label ?? ""}`} className="min-w-0">
              <dt className="text-xs text-muted-foreground">Retenção {withholdingName(w)} ({pctTxt(w.rate_pct)})</dt>
              <dd className="tabular-nums">{w.waived ? (w.waived === "simples" ? "dispensada (Simples)" : "abaixo do mínimo") : `−${formatBRL(w.amount_cents)}`}</dd>
            </div>
          ))}
          <div><dt className="text-xs text-muted-foreground">Líquido a pagar</dt><dd className="font-semibold tabular-nums">{formatBRL(r.net_cents)}</dd></div>
        </dl>

        {v.derived.length > 0 ? (
          <div className="min-w-0 space-y-1 rounded-md border bg-muted/30 p-3 text-sm" aria-label="Linhas do mês">
            <p className="font-medium">Linhas do mês</p>
            <ul className="space-y-1">
              {v.derived.map((d, i) => (
                <li key={`${d.line_type}-${i}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words">{d.memory?.carried_negative ? "Saldo negativo trazido" : PAYOUT_LINE_LABEL[d.line_type]}</span>
                  <span className="tabular-nums font-medium">{formatBRL(d.amount_cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {r.requires_invoice || r.invoice_number || r.paid_on ? (
          <div className="min-w-0 space-y-1 rounded-md border p-3 text-sm" aria-label="NF e pagamento">
            {r.requires_invoice ? (
              <p className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium">NF:</span>
                <span>{r.invoice_number ? `nº ${r.invoice_number} · emitida em ${brDate(r.invoice_date)}` : "ainda não enviada"}</span>
                <FileLink path={r.invoice_path} label="Abrir NF" />
              </p>
            ) : null}
            {r.paid_on ? (
              <p className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium">Pagamento:</span>
                <span>{brDate(r.paid_on)} · {r.pay_method ? PAY_METHOD_LABEL[r.pay_method] : ""}{r.pay_note ? ` · ${r.pay_note}` : ""}</span>
                <FileLink path={r.proof_path} label="Abrir comprovante" />
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {v.is_self && open && r.acceptance === "pending" ? (
            <Button size="sm" disabled={accept.isPending} onClick={() => run(accept.mutateAsync(r.id), () => "Extrato aceito.")}><Check aria-hidden /> Aceitar extrato</Button>
          ) : null}
          {canContest ? <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "contest", line: null })}><MessageSquareWarning aria-hidden /> Contestar</Button> : null}
          {v.can.prepare && open ? (
            <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => run(refresh.mutateAsync({ closingId: v.closing.id, professionalId: v.professional.id }), (x) => (x.changed > 0 ? "Extrato atualizado." : "O extrato já estava em dia."))}><RefreshCw aria-hidden /> Atualizar extrato</Button>
          ) : null}
          {v.can.decide && open ? <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "adjust" })}>Lançar ajuste manual</Button> : null}
          {v.can.decide && open ? (
            <Button size="sm" disabled={approve.isPending} onClick={() => run(approve.mutateAsync({ closingId: v.closing.id, professionalIds: [v.professional.id] }), (x) => (x.approved > 0 ? "Extrato aprovado." : `Não foi aprovado: ${x.skipped.map((s) => SKIP_REASON_TEXT[s.reason] ?? s.reason).join("; ")}.`))}>Aprovar extrato</Button>
          ) : null}
          {canNf ? <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "invoice" })}>{r.nf_status === "received" ? "Substituir NF" : "Enviar NF"}</Button> : null}
          {canPay ? <Button size="sm" onClick={() => setDlg({ kind: "pay" })}>Registrar pagamento</Button> : null}
          <Button size="sm" variant="outline" onClick={() => void import("@/lib/pdf/generateClosingPdf").then((m) => m.downloadStatementPdf(v)).catch(() => setErr("Não foi possível gerar o PDF agora."))}><FileText aria-hidden /> Baixar PDF</Button>
        </div>
        {v.is_self && open && r.acceptance === "contested" ? <p className="text-sm text-muted-foreground" role="note">Contestação enviada. O gestor responde e o extrato volta para o seu aceite.</p> : null}
        {v.is_self && open && r.acceptance === "pending" ? <p className="text-xs text-muted-foreground">Prazo para aceitar: {brDate(r.accept_deadline)}. Depois do prazo o gestor pode aprovar sem o seu aceite.</p> : null}

        {v.disputes.length > 0 ? (
          <div className="min-w-0 space-y-2" aria-label="Contestações">
            <p className="text-sm font-medium">Contestações</p>
            <ul className="space-y-2">
              {v.disputes.map((d) => (
                <li key={d.id} className="min-w-0 space-y-1 rounded-md border p-3 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-xs text-muted-foreground">{d.line_label ?? "Extrato inteiro"} · {brDateTime(d.created_at)}</span>
                    <Badge tone={d.status === "open" ? "warning" : "success"}>{d.status === "open" ? "Aguardando resposta" : "Respondida"}</Badge>
                  </div>
                  <p className="break-words">{d.comment}</p>
                  {d.response ? <p className="break-words rounded bg-muted/50 px-2 py-1"><span className="font-medium">Resposta: </span>{d.response}</p> : null}
                  {d.status === "open" && v.can.decide && !locked ? <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "answer", dispute: d })}>Responder</Button> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Lançamentos do mês</p>
            <ExportButtons columns={statementColumns} rows={items} filename={`extrato-${v.professional.name.replace(/\s+/g, "-").toLowerCase()}-${v.closing.period}`} sheetName="Extrato" />
          </div>
          {v.lines.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum lançamento neste mês: o valor vem das linhas mensais acima.</p> : (
            <FinTable<StatementLine>
              label="Lançamentos do extrato" rows={v.lines} rowKey={(l) => l.id}
              columns={[
                { header: "Serviço", role: "title", cell: (l) => l.service_name ?? PAYOUT_LINE_LABEL[l.line_type] },
                { header: "Tipo", role: "badge", cell: (l) => <Badge tone={l.amount_cents < 0 ? "warning" : l.kind === "correction" ? "info" : "muted"}>{l.kind === "correction" ? (l.line_type === "adjustment" ? "Estorno / ajuste" : "Correção") : PAYOUT_LINE_LABEL[l.line_type]}</Badge> },
                { header: "Data", nowrap: true, cell: (l) => brDate(l.source_date) },
                { header: "Paciente", cell: (l) => l.patient ?? "—" },
                { header: "Valor liquidado", nowrap: true, className: "tabular-nums", cell: (l) => (l.gross_cents === null ? "—" : formatBRL(l.gross_cents)) },
                { header: "Base", nowrap: true, className: "tabular-nums", cell: (l) => (l.base_cents === null ? "—" : formatBRL(l.base_cents)) },
                { header: "Regra", nowrap: true, className: "tabular-nums", cell: (l) => (l.pct === null ? "—" : pctTxt(l.pct)) },
                { header: "Repasse", nowrap: true, className: "tabular-nums font-medium", cell: (l) => formatBRL(l.amount_cents) },
                {
                  header: "Ações", role: "action",
                  cell: (l) => (
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setMemory(lineRow(l))} aria-label={`Ver como foi calculado: ${l.service_name ?? "lançamento"}`}>Como foi calculado</Button>
                      {canContest ? <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "contest", line: l })} aria-label={`Contestar a linha ${l.service_name ?? "lançamento"}`}>Contestar</Button> : null}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </DialogBody>
      <DialogFooter><Button onClick={onClose}>Fechar</Button></DialogFooter>

      {memory ? <PayoutMemoryDialog line={memory} onClose={() => setMemory(null)} /> : null}
      {dlg?.kind === "contest" ? <ContestDialog v={v} line={dlg.line} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); setNotice(m); }} /> : null}
      {dlg?.kind === "answer" ? <AnswerDialog dispute={dlg.dispute} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); setNotice(m); }} /> : null}
      {dlg?.kind === "adjust" ? <AdjustDialog statementId={r.id} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); setNotice(m); }} /> : null}
      {dlg?.kind === "invoice" ? <InvoiceDialog statementId={r.id} clinicId={clinicId} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); setNotice(m); }} /> : null}
      {dlg?.kind === "pay" ? <PayDialog statementId={r.id} clinicId={clinicId} net={r.net_cents} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); setNotice(m); }} /> : null}
    </>
  );
}

const lineLabel = (l: StatementLine) => `${brDate(l.source_date)} · ${l.service_name ?? PAYOUT_LINE_LABEL[l.line_type]} · ${formatBRL(l.amount_cents)}`;

function ContestDialog({ v, line, onClose, onDone }: { v: StatementView; line: StatementLine | null; onClose: () => void; onDone: (m: string) => void }) {
  const [comment, setComment] = useState(""); const [lineId, setLineId] = useState(line?.id ?? ""); const [error, setError] = useState<string | null>(null);
  const m = useContestStatement();
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Contestar o extrato" description="Diga o que está errado. O gestor responde e o extrato volta para o seu aceite." submitLabel="Enviar contestação" pending={m.isPending} error={error}
      onSubmit={() => {
        if (comment.trim().length < 3) { setError(closingErrorMessage({ message: "COMMENT_REQUIRED" })); return; }
        setError(null);
        const picked = v.lines.find((l) => l.id === lineId) ?? null;
        m.mutate({ statementId: v.row.id, comment: comment.trim(), lineId: picked?.id ?? null, lineLabel: picked ? lineLabel(picked) : null }, { onSuccess: () => onDone("Contestação enviada ao gestor."), onError: (e) => setError(closingErrorMessage(e)) });
      }}>
      <Field label="Linha contestada (opcional)" htmlFor="ct-line">
        <NativeSelect id="ct-line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
          <option value="">Extrato inteiro</option>
          {v.lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
        </NativeSelect>
      </Field>
      <Field label="O que está errado" htmlFor="ct-comment"><Textarea id="ct-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={4} /></Field>
    </FormDialog>
  );
}

function AnswerDialog({ dispute, onClose, onDone }: { dispute: DisputeRow; onClose: () => void; onDone: (m: string) => void }) {
  const [text, setText] = useState(""); const [error, setError] = useState<string | null>(null);
  const m = useAnswerDispute();
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Responder contestação" description={dispute.comment} submitLabel="Enviar resposta" pending={m.isPending} error={error}
      onSubmit={() => {
        if (text.trim().length < 3) { setError(closingErrorMessage({ message: "RESPONSE_REQUIRED" })); return; }
        setError(null);
        m.mutate({ disputeId: dispute.id, response: text.trim() }, { onSuccess: () => onDone("Resposta enviada. Corrija a origem, se for o caso, e use «Atualizar extrato»."), onError: (e) => setError(closingErrorMessage(e)) });
      }}>
      <Field label="Resposta" htmlFor="an-text"><Textarea id="an-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={4} /></Field>
    </FormDialog>
  );
}

function AdjustDialog({ statementId, onClose, onDone }: { statementId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [kind, setKind] = useState<AdjustKind>("bonus"); const [cents, setCents] = useState<number | null>(null); const [reason, setReason] = useState(""); const [error, setError] = useState<string | null>(null);
  const m = useAdjustStatement();
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Ajuste manual" description="Bônus, desconto ou adiantamento. Fica no extrato e no histórico, com o motivo." submitLabel="Lançar ajuste" pending={m.isPending} error={error}
      onSubmit={() => {
        if (!cents || cents <= 0) { setError(closingErrorMessage({ message: "INVALID_AMOUNT" })); return; }
        if (reason.trim().length < 3) { setError(closingErrorMessage({ message: "REASON_REQUIRED" })); return; }
        setError(null);
        m.mutate({ statementId, kind, amountCents: cents, reason: reason.trim() }, { onSuccess: () => onDone("Ajuste lançado; o extrato voltou para o aceite do profissional."), onError: (e) => setError(closingErrorMessage(e)) });
      }}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="aj-kind"><NativeSelect id="aj-kind" value={kind} onChange={(e) => setKind(e.target.value as AdjustKind)}>{(Object.keys(ADJUST_KIND_LABEL) as AdjustKind[]).map((k) => <option key={k} value={k}>{ADJUST_KIND_LABEL[k]}</option>)}</NativeSelect></Field>
        <Field label="Valor (R$)" htmlFor="aj-val"><CentsInput id="aj-val" value={cents} onChange={setCents} /></Field>
      </div>
      <Field label="Motivo" htmlFor="aj-reason"><Input id="aj-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
    </FormDialog>
  );
}

function InvoiceDialog({ statementId, clinicId, onClose, onDone }: { statementId: string; clinicId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [number, setNumber] = useState(""); const [date, setDate] = useState(todayIsoBR()); const [file, setFile] = useState<File | null>(null); const [error, setError] = useState<string | null>(null);
  const m = useSaveInvoice(clinicId);
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="NF do profissional" description="Número, data e arquivo da nota fiscal (PDF ou imagem de até 10 MB)." submitLabel="Salvar NF" pending={m.isPending} error={error}
      onSubmit={() => {
        if (!number.trim()) { setError(closingErrorMessage({ message: "INVOICE_NUMBER_REQUIRED" })); return; }
        if (!file) { setError(closingErrorMessage({ message: "INVOICE_FILE_REQUIRED" })); return; }
        setError(null);
        m.mutate({ statementId, number: number.trim(), date, file }, { onSuccess: () => onDone("NF registrada."), onError: (e) => setError(e instanceof Error && !("code" in e) ? e.message : closingErrorMessage(e)) });
      }}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Número da NF" htmlFor="nf-num"><Input id="nf-num" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} /></Field>
        <Field label="Data de emissão" htmlFor="nf-date"><Input id="nf-date" type="date" value={date} max={todayIsoBR()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Arquivo da NF" htmlFor="nf-file"><Input id="nf-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
    </FormDialog>
  );
}

function PayDialog({ statementId, clinicId, net, onClose, onDone }: { statementId: string; clinicId: string; net: number; onClose: () => void; onDone: (m: string) => void }) {
  const [paidOn, setPaidOn] = useState(todayIsoBR()); const [method, setMethod] = useState<PayMethod>("pix"); const [file, setFile] = useState<File | null>(null); const [note, setNote] = useState(""); const [error, setError] = useState<string | null>(null);
  const m = usePayStatement(clinicId);
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Registrar pagamento" description={`Líquido a pagar: ${formatBRL(net)}. Anexe o comprovante (PDF ou imagem de até 10 MB).`} submitLabel="Registrar pagamento" pending={m.isPending} error={error}
      onSubmit={() => {
        if (!file) { setError(closingErrorMessage({ message: "PROOF_REQUIRED" })); return; }
        setError(null);
        m.mutate({ statementId, paidOn, method, file, note }, { onSuccess: (r) => onDone(r.locked ? "Pagamento registrado. Todos os extratos foram pagos e o mês foi travado." : "Pagamento registrado."), onError: (e) => setError(e instanceof Error && !("code" in e) ? e.message : closingErrorMessage(e)) });
      }}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Data do pagamento" htmlFor="pg-date"><Input id="pg-date" type="date" value={paidOn} max={todayIsoBR()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Forma" htmlFor="pg-method"><NativeSelect id="pg-method" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{(Object.keys(PAY_METHOD_LABEL) as PayMethod[]).map((k) => <option key={k} value={k}>{PAY_METHOD_LABEL[k]}</option>)}</NativeSelect></Field>
      </div>
      <Field label="Comprovante" htmlFor="pg-file"><Input id="pg-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      <Field label="Observação (opcional)" htmlFor="pg-note"><Input id="pg-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}

