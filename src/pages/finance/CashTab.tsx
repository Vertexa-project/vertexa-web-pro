// Financeiro › Caixa (Entrega 2, escopo-v1 §4.5): abertura com troco, sangria/suprimento com motivo, fechamento contado × esperado por forma,
// justificativa e aprovação do gestor quando há diferença, e relatório por dia, operador e unidade.
import { useMemo, useState } from "react";
import { AlertTriangle, Banknote } from "lucide-react";

import { CentsInput, ExportButtons, Field, FinTable, FormDialog, NativeSelect, TableShell, Td, Th } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useApproveCash, useCashMovement, useCashReport, useCloseCash, useMyOpenCash, useOpenCash } from "@/hooks/useFinSales";
import type { CashReportRow, CashSummary } from "@/lib/api/finSales";
import { canSeeCash, finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { financeSalesErrorMessage, previewCashClose } from "@/lib/domain/finSales";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const STATUS: Record<string, { label: string; tone: "info" | "warning" | "success" }> = {
  open: { label: "Aberto", tone: "info" }, pending_approval: { label: "Aguarda aprovação", tone: "warning" }, closed: { label: "Fechado", tone: "success" },
};

function OpenForm({ clinicId }: { clinicId: string }) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState("");
  const [opening, setOpening] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const open = useOpenCash(clinicId);
  const unit = unitId || units.find((u) => u.is_primary)?.id || units[0]?.id || "";
  return (
    <form className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" onSubmit={(e) => {
      e.preventDefault();
      if (opening === null) return setError("Informe o valor do troco (pode ser 0,00).");
      setError(null);
      open.mutate({ unitId: unit, openingCents: opening }, { onError: (err) => setError(financeSalesErrorMessage(err)) });
    }}>
      <Field label="Unidade" htmlFor="cash-unit"><NativeSelect id="cash-unit" value={unit} onChange={(e) => setUnitId(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
      <Field label="Troco inicial em espécie (R$)" htmlFor="cash-opening"><CentsInput id="cash-opening" value={opening} onChange={setOpening} /></Field>
      <Button type="submit" disabled={open.isPending || !unit}>Abrir caixa</Button>
      {error ? <p className="text-sm text-destructive sm:col-span-3" role="alert">{error}</p> : null}
    </form>
  );
}

function MovementDialog({ register, type, onClose }: { register: CashSummary; type: "sangria" | "suprimento"; onClose: () => void }) {
  const move = useCashMovement();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={type === "sangria" ? "Sangria (retirada de dinheiro)" : "Suprimento (reforço de troco)"} pending={move.isPending} error={error} submitLabel="Lançar"
      onSubmit={() => {
        if (!amount || amount <= 0) return setError("Informe o valor.");
        if (reason.trim().length < 3) return setError("Informe o motivo.");
        setError(null);
        move.mutate({ registerId: register.id, type, amountCents: amount, reason: reason.trim() }, { onSuccess: onClose, onError: (e) => setError(financeSalesErrorMessage(e)) });
      }}>
      <Field label="Valor (R$)" htmlFor="mov-amount"><CentsInput id="mov-amount" value={amount} onChange={setAmount} /></Field>
      <Field label="Motivo" htmlFor="mov-reason"><Input id="mov-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}

function CloseDialog({ register, onClose }: { register: CashSummary; onClose: () => void }) {
  const close = useCloseCash();
  const [counted, setCounted] = useState<Record<string, number | null>>({});
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string | null>(null);
  const expected = register.live_lines.map((l) => ({ key: l.key, label: l.label, expectedCents: l.expected_cents }));
  const preview = useMemo(() => previewCashClose(expected, counted, 0), [expected, counted]);
  const hasDiff = preview.totalAbsDifferenceCents > 0;
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} wide title="Fechar caixa" description="Informe o valor contado em espécie e confira as demais formas. O que não for contado vale o esperado."
      pending={close.isPending} error={error} submitLabel="Fechar caixa"
      onSubmit={() => {
        if (counted.cash == null) return setError("Informe o valor contado em espécie.");
        if (hasDiff && justification.trim().length < 3) return setError("Há diferença: informe a justificativa. O gestor precisa aprovar o fechamento.");
        setError(null);
        const payload: Record<string, number> = {};
        for (const [k, v] of Object.entries(counted)) if (v != null) payload[k] = v;
        close.mutate({ registerId: register.id, counted: payload, justification: justification.trim() }, { onSuccess: onClose, onError: (e) => setError(financeSalesErrorMessage(e)) });
      }}>
      <TableShell label="Conferência do caixa">
        <thead><tr><Th>Forma</Th><Th>Esperado</Th><Th>Contado</Th><Th>Diferença</Th></tr></thead>
        <tbody>{preview.lines.map((l) => (
          <tr key={l.key}>
            <Td className="font-medium">{l.label}</Td><Td className="tabular-nums">{formatBRL(l.expectedCents)}</Td>
            <Td className="min-w-32"><CentsInput aria-label={`Contado em ${l.label}`} value={counted[l.key] ?? null} placeholder={l.key === "cash" ? "0,00" : "igual ao esperado"} onChange={(v) => setCounted((c) => ({ ...c, [l.key]: v }))} /></Td>
            <Td className={`tabular-nums ${l.differenceCents !== 0 ? "font-semibold text-destructive" : ""}`}>{formatBRL(l.differenceCents)}</Td>
          </tr>
        ))}</tbody>
      </TableShell>
      {hasDiff ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Diferença de {formatBRL(preview.totalAbsDifferenceCents)}. Dentro do limite da clínica o caixa fecha direto; acima dele o fechamento aguarda a aprovação do gestor.</p>
          <Field label="Justificativa" htmlFor="close-just"><Input id="close-just" value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={300} /></Field>
        </div>
      ) : null}
    </FormDialog>
  );
}

/** Resumo do caixa aberto: troco, entradas (recebimentos + suprimentos), saídas (sangrias) e o esperado em espécie. */
function CashTotals({ r }: { r: CashSummary }) {
  const supr = r.movements.filter((m) => m.type === "suprimento").reduce((n, m) => n + m.amount_cents, 0);
  const sang = r.movements.filter((m) => m.type === "sangria").reduce((n, m) => n + m.amount_cents, 0);
  const cashLine = r.live_lines.find((l) => l.key === "cash")?.expected_cents ?? 0;
  const cashReceipts = cashLine - r.opening_cash_cents - supr + sang;
  const otherReceipts = r.live_lines.filter((l) => l.key !== "cash").reduce((n, l) => n + l.expected_cents, 0);
  const items: [string, number, string?][] = [
    ["Troco inicial", r.opening_cash_cents],
    ["Recebimentos em dinheiro", cashReceipts],
    ["Recebimentos em outras formas", otherReceipts],
    ["Entradas (recebimentos + suprimentos)", cashReceipts + otherReceipts + supr],
    ["Saídas (sangrias)", sang],
    ["Esperado em espécie na gaveta", cashLine, "font-semibold"],
  ];
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-2 rounded-lg border bg-card p-3 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Resumo do caixa">
      {items.map(([label, v, cls]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={`tabular-nums ${cls ?? ""}`}>{formatBRL(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function MyCash({ clinicId }: { clinicId: string }) {
  const q = useMyOpenCash(clinicId);
  const [dialog, setDialog] = useState<"sangria" | "suprimento" | "close" | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return <section className="space-y-2" aria-label="Meu caixa"><h2 className="text-base font-semibold">Meu caixa</h2><p className="text-sm text-muted-foreground">Você não tem caixa aberto. Abra o caixa para os recebimentos entrarem nele.</p><OpenForm clinicId={clinicId} /></section>;
  return (
    <section className="space-y-3" aria-label="Meu caixa">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Meu caixa — {r.unit_name} · {br(r.business_date)}</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog("sangria")}>Sangria</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("suprimento")}>Suprimento</Button>
          <Button size="sm" onClick={() => setDialog("close")}>Fechar caixa</Button>
        </div>
      </div>
      {r.business_date < new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) ? <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="alert"><AlertTriangle className="h-4 w-4" aria-hidden /> Este caixa é de um dia anterior e ainda não foi fechado.</p> : null}
      <CashTotals r={r} />
      <TableShell label="Esperado por forma de pagamento">
        <thead><tr><Th>Forma</Th><Th>Esperado</Th></tr></thead>
        <tbody>{r.live_lines.map((l) => <tr key={l.key}><Td className="font-medium">{l.label}</Td><Td className="tabular-nums">{formatBRL(l.expected_cents)}</Td></tr>)}</tbody>
      </TableShell>
      {r.movements.length > 0 ? (
        <TableShell label="Sangrias e suprimentos">
          <thead><tr><Th>Tipo</Th><Th>Valor</Th><Th>Motivo</Th></tr></thead>
          <tbody>{r.movements.map((m) => <tr key={m.id}><Td>{m.type === "sangria" ? "Sangria" : "Suprimento"}</Td><Td className="tabular-nums">{formatBRL(m.amount_cents)}</Td><Td>{m.reason}</Td></tr>)}</tbody>
        </TableShell>
      ) : null}
      {dialog === "close" ? <CloseDialog register={r} onClose={() => setDialog(null)} /> : dialog ? <MovementDialog register={r} type={dialog} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function Report({ clinicId, canApprove }: { clinicId: string; canApprove: boolean }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const units = useUnits(clinicId).data ?? [];
  const q = useCashReport(clinicId, { from, to, unitId });
  const approve = useApproveCash();
  const rows = q.data ?? [];
  const columns: ExportColumn<CashReportRow>[] = [
    { header: "Dia", value: (r) => br(r.business_date) }, { header: "Unidade", value: (r) => r.unit_name }, { header: "Operador", value: (r) => r.operator_name }, { header: "Situação", value: (r) => STATUS[r.status].label },
    { header: "Troco (R$)", value: (r) => r.opening_cash_cents, kind: "money" }, { header: "Espécie esperada (R$)", value: (r) => r.expected_cash_cents, kind: "money" }, { header: "Espécie contada (R$)", value: (r) => r.counted_cash_cents, kind: "money" },
    { header: "Diferença em espécie (R$)", value: (r) => r.cash_difference_cents, kind: "money" }, { header: "Diferença total (R$)", value: (r) => r.difference_cents, kind: "money" },
    { header: "Justificativa", value: (r) => r.justification }, { header: "Aprovado por", value: (r) => r.approved_by_name },
  ];
  return (
    <section className="space-y-3" aria-label="Relatório de caixas">
      <h2 className="text-base font-semibold">Caixas por dia, operador e unidade</h2>
      <FilterBar idPrefix="cash" from={from} to={to} onFrom={setFrom} onTo={setTo} units={units} unitId={unitId} onUnit={setUnitId} />
      <ExportButtons columns={columns} rows={rows} filename="caixas" sheetName="Caixas" />
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum caixa no período.</p> : (
        <FinTable<CashReportRow>
          label="Caixas"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Operador", role: "title", cell: (r) => r.operator_name ?? "—" },
            { header: "Situação", role: "badge", cell: (r) => <><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.stale ? <Badge tone="destructive" className="ml-1">Pendência</Badge> : null}</> },
            { header: "Dia", nowrap: true, cell: (r) => br(r.business_date) },
            { header: "Unidade", cell: (r) => r.unit_name },
            { header: "Esperado (espécie)", nowrap: true, className: "tabular-nums", cell: (r) => (r.expected_cash_cents == null ? "—" : formatBRL(r.expected_cash_cents)) },
            { header: "Contado", nowrap: true, className: "tabular-nums", cell: (r) => (r.counted_cash_cents == null ? "—" : formatBRL(r.counted_cash_cents)) },
            { header: "Diferença", nowrap: true, className: "tabular-nums", cell: (r) => <span className={(r.difference_cents ?? 0) > 0 ? "font-semibold text-destructive" : ""}>{r.difference_cents == null ? "—" : formatBRL(r.cash_difference_cents)}</span> },
            { header: "Justificativa", wide: true, className: "min-w-40", cell: (r) => <>{r.justification ?? "—"}{r.approved_by_name ? <span className="block text-xs text-muted-foreground">Aprovado por {r.approved_by_name}</span> : null}</> },
            { header: "Ações", role: "action", cell: (r) => (canApprove && r.status === "pending_approval" ? <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ registerId: r.id })} aria-label={`Aprovar fechamento de ${r.operator_name ?? "operador"} em ${br(r.business_date)}`}>Aprovar</Button> : null) },
          ]}
        />
      )}
    </section>
  );
}

/** Financeiro › Caixa. Operador abre/fecha o PRÓPRIO caixa; gestor/financeiro/admin enxergam todos e o gestor aprova diferenças. */
export function CashTab() {
  const { clinicId, access } = useFinContext();
  if (!clinicId) return <LoadingState />;
  if (!canSeeCash(access)) return <NoAccess />;
  const canOperate = finCan(access, "cash", "write");
  return (
    <div className="min-w-0 space-y-8">
      {canOperate ? <MyCash clinicId={clinicId} /> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Banknote className="h-4 w-4" aria-hidden /> Você consulta os caixas; quem opera abre e fecha o próprio.</p>}
      <Report clinicId={clinicId} canApprove={finCan(access, "cash_approve", "write")} />
    </div>
  );
}
