// Inventário aberto: contagem (cega: sem esperado), revisão (esperado × contado × valor) e aprovado. O servidor decide o que cada perfil recebe; a tela só não pede o que não veio.
import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Save } from "lucide-react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { CheckField, ExportButtons, Field, FinTable, FormDialog } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApproveInventory, useCancelInventory, useCountInventory, useFinishInventory, useInventoryLines, useReopenInventory } from "@/hooks/useStockE8";
import type { InventoryLine, InventoryRow } from "@/lib/api/stockE8";
import { canManageInventory } from "@/lib/domain/finAccess";
import type { FinAccess } from "@/lib/domain/finAccess";
import { brDate, brDateTime, changedCounts, countProgress, e8ErrorMessage, INVENTORY_STATUS_LABEL, linesShowExpected, moneyOrZero, parseCountText, signedQty } from "@/lib/domain/stockE8";
import { formatQty } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { ReasonDialog } from "@/pages/finance/appointments/ReasonDialog";
import { ExtraLineDialog } from "@/pages/stock/e8/InventoryDialogs";

const PAGE = 100;
const TONE = { counting: "info", review: "warning", approved: "success", canceled: "muted" } as const;

export function InventoryDetail({ inv, access, clinicId, onBack }: { inv: InventoryRow; access: FinAccess; clinicId: string; onBack: () => void }) {
  const q = useInventoryLines(inv.id, inv.status);
  const count = useCountInventory();
  const finish = useFinishInventory();
  const reopen = useReopenInventory();
  const cancel = useCancelInventory();
  const approve = useApproveInventory();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"finish" | "approve" | "reopen" | "cancel" | "extra" | null>(null);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const [zero, setZero] = useState(false);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState<string | null>(null);

  const lines = q.data ?? [];
  const counting = inv.status === "counting";
  const showExpected = linesShowExpected(lines);
  const manage = canManageInventory(access);
  const canCount = counting && inv.can_count;
  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return lines.filter((l) => (!t || l.item_name.toLowerCase().includes(t) || l.lot_code.toLowerCase().includes(t) || (l.ean ?? "").includes(t)) && (!onlyDiff || (l.diff_qty ?? 0) !== 0));
  }, [lines, search, onlyDiff]);
  const progress = countProgress(lines, drafts);
  const dirty = changedCounts(lines, drafts);
  const badDraft = lines.some((l) => l.id in drafts && !parseCountText(drafts[l.id], l.fractional).ok);
  const diffs = lines.filter((l) => (l.diff_qty ?? 0) !== 0);
  const up = diffs.filter((l) => (l.diff_qty ?? 0) > 0).reduce((s, l) => s + (l.diff_value_cents ?? 0), 0);
  const down = diffs.filter((l) => (l.diff_qty ?? 0) < 0).reduce((s, l) => s + (l.diff_value_cents ?? 0), 0);

  const saveDrafts = (then?: () => void) => {
    setError(null);
    if (badDraft) return setError("Corrija as quantidades marcadas antes de salvar.");
    if (dirty.length === 0) return then?.();
    const chunks: typeof dirty[] = [];
    for (let i = 0; i < dirty.length; i += 500) chunks.push(dirty.slice(i, i + 500));
    const run = (i: number) => {
      if (i >= chunks.length) { setDrafts({}); return then?.(); }
      count.mutate({ inventoryId: inv.id, lines: chunks[i] }, { onSuccess: () => run(i + 1), onError: (e) => setError(e8ErrorMessage(e)) });
    };
    run(0);
  };
  const close = () => { setDialog(null); setDlgError(null); setNote(""); setNoteErr(null); setZero(false); };
  const err = (e: unknown) => setDlgError(e8ErrorMessage(e));

  const exportCols: ExportColumn<InventoryLine>[] = [
    { header: "Item", value: (l) => l.item_name }, { header: "Lote", value: (l) => l.lot_code }, { header: "Validade", value: (l) => (l.expiry_date ? brDate(l.expiry_date) : "") },
    ...(showExpected ? [{ header: "Esperado", value: (l: InventoryLine) => l.expected_qty, kind: "qty" as const }, { header: "Movimentado na contagem", value: (l: InventoryLine) => l.moved_qty, kind: "qty" as const }] : []),
    { header: "Contado", value: (l) => l.counted_qty, kind: "qty" },
    ...(showExpected ? [{ header: "Diferença", value: (l: InventoryLine) => l.diff_qty, kind: "qty" as const }, { header: "Custo médio (R$)", value: (l: InventoryLine) => l.avg_cost_cents, kind: "money" as const }, { header: "Valor da diferença (R$)", value: (l: InventoryLine) => l.diff_value_cents, kind: "money" as const }] : []),
  ];

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft aria-hidden /> Voltar aos inventários</Button>
      </div>
      <div className="min-w-0 space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">Inventário nº {inv.number}{inv.name ? ` · ${inv.name}` : ""} <Badge tone={TONE[inv.status]}>{INVENTORY_STATUS_LABEL[inv.status]}</Badge>{inv.blind ? <Badge tone="outline">Contagem cega</Badge> : null}</h2>
        <p className="text-sm text-muted-foreground">{inv.unit_name} · saldo congelado em {brDateTime(inv.frozen_at)}{inv.created_by_name ? ` por ${inv.created_by_name}` : ""}{inv.notes ? ` · ${inv.notes}` : ""}</p>
        {inv.status === "approved" ? <p className="text-sm text-muted-foreground">Aprovado em {brDateTime(inv.approved_at)}{inv.approved_by_name ? ` por ${inv.approved_by_name}` : ""}{inv.approve_note ? ` — ${inv.approve_note}` : ""}</p> : null}
        {inv.status === "canceled" ? <p className="text-sm text-muted-foreground">Cancelado em {brDateTime(inv.canceled_at)} — {inv.cancel_reason}</p> : null}
      </div>

      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <>
          {counting ? (
            <p className="rounded-md border bg-card px-3 py-2 text-sm" role="status">
              {inv.blind ? "Contagem cega: o saldo esperado não aparece. " : ""}Contados: <strong>{progress.counted}</strong> de <strong>{progress.total}</strong>. Digite a quantidade de cada item (deixe em branco o que ainda não contou) e salve.
            </p>
          ) : inv.status === "review" && !showExpected ? (
            <p className="rounded-md border bg-card px-3 py-2 text-sm" role="status">Contagem encerrada. A revisão das diferenças é do gestor.</p>
          ) : null}
          {showExpected && diffs.length >= 0 && (inv.status === "review" || inv.status === "approved") ? (
            <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-4" aria-label="Resumo das diferenças">
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Linhas com diferença</dt><dd className="font-semibold tabular-nums">{diffs.length} de {lines.length}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Sobra</dt><dd className="font-semibold tabular-nums">{moneyOrZero(up)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Falta</dt><dd className="font-semibold tabular-nums">{moneyOrZero(down)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Efeito no estoque</dt><dd className="font-semibold tabular-nums">{moneyOrZero(up + down)}</dd></div>
            </dl>
          ) : null}

          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <Field label="Buscar item, lote ou código" htmlFor="iv-search" className="min-w-[12rem] flex-1"><Input id="iv-search" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} /></Field>
            {showExpected && inv.status !== "counting" ? <CheckField id="iv-diff" label="Só com diferença" checked={onlyDiff} onChange={(v) => { setOnlyDiff(v); setLimit(PAGE); }} /> : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canCount ? (
              <>
                <Button onClick={() => saveDrafts()} disabled={count.isPending || dirty.length === 0}><Save aria-hidden /> Salvar contagem{dirty.length ? ` (${dirty.length})` : ""}</Button>
                <Button variant="outline" onClick={() => setDialog("extra")}><Plus aria-hidden /> Contar item fora da lista</Button>
                <Button variant="outline" onClick={() => saveDrafts(() => { setNoteErr(null); setDialog("finish"); })} disabled={count.isPending}>Encerrar contagem</Button>
              </>
            ) : null}
            {inv.status === "review" && manage ? (
              <>
                <Button onClick={() => setDialog("approve")}>Aprovar e ajustar estoque</Button>
                <Button variant="outline" onClick={() => setDialog("reopen")}>Reabrir para recontar</Button>
              </>
            ) : null}
            {manage && (inv.status === "counting" || inv.status === "review") ? <Button variant="ghost" onClick={() => setDialog("cancel")}>Cancelar inventário</Button> : null}
            {showExpected ? <ExportButtons columns={exportCols} rows={lines} filename={`inventario-${inv.number}`} sheetName={`Inventário ${inv.number}`} /> : null}
          </div>
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}

          {visible.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum item neste filtro.</p> : (
            <>
              <FinTable<InventoryLine>
                label="Itens do inventário" rows={visible.slice(0, limit)} rowKey={(l) => l.id}
                columns={[
                  { header: "Item", role: "title", cell: (l) => <>{l.item_name}{l.is_extra ? <Badge tone="info" className="ml-2">fora da lista</Badge> : null}</> },
                  { header: "Lote / validade", cell: (l) => `${l.lot_code}${l.expiry_date ? ` · ${brDate(l.expiry_date)}` : ""}` },
                  ...(showExpected ? [
                    { header: "Esperado", nowrap: true, className: "tabular-nums", cell: (l: InventoryLine) => formatQty(l.expected_qty ?? 0) },
                    ...(inv.status !== "counting" ? [{ header: "Movido na contagem", nowrap: true, className: "tabular-nums", cell: (l: InventoryLine) => ((l.moved_qty ?? 0) === 0 ? "—" : signedQty(l.moved_qty ?? 0)) }] : []),
                  ] : []),
                  { header: "Contado", nowrap: true, className: "tabular-nums", cell: (l) => (canCount ? (
                    <Input aria-label={`Quantidade contada de ${l.item_name} lote ${l.lot_code}`} inputMode="decimal" className="w-28" placeholder={l.stock_unit}
                      value={l.id in drafts ? drafts[l.id] : l.counted_qty === null ? "" : String(l.counted_qty).replace(".", ",")}
                      aria-invalid={l.id in drafts && !parseCountText(drafts[l.id], l.fractional).ok ? true : undefined}
                      onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))} />
                  ) : l.counted_qty === null ? "—" : `${formatQty(l.counted_qty)} ${l.stock_unit}`) },
                  ...(showExpected && inv.status !== "counting" ? [
                    { header: "Diferença", nowrap: true, className: "tabular-nums", cell: (l: InventoryLine) => <span className={(l.diff_qty ?? 0) < 0 ? "text-destructive" : (l.diff_qty ?? 0) > 0 ? "text-success" : undefined}>{signedQty(l.diff_qty ?? 0)} {l.stock_unit}</span> },
                    { header: "Valor", nowrap: true, className: "tabular-nums", cell: (l: InventoryLine) => ((l.diff_qty ?? 0) === 0 ? "—" : moneyOrZero(l.diff_value_cents)) },
                  ] : []),
                ]}
              />
              {visible.length > limit ? <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>Mostrar mais ({visible.length - limit} restantes)</Button> : null}
            </>
          )}
        </>
      )}

      {dialog === "extra" ? <ExtraLineDialog clinicId={clinicId} inventoryId={inv.id} onClose={close} /> : null}
      {dialog === "finish" ? (
        <FormDialog open onOpenChange={(o) => (!o ? close() : undefined)} title="Encerrar contagem" submitLabel="Encerrar e enviar para revisão" pending={finish.isPending} error={dlgError}
          description="Depois de encerrada, a contagem vai para a revisão do gestor, que vê esperado × contado × valor."
          onSubmit={() => { setDlgError(null); finish.mutate({ inventoryId: inv.id, zeroUncounted: zero }, { onSuccess: close, onError: err }); }}>
          {progress.counted < progress.total ? (
            <CheckField id="iv-zero" checked={zero} onChange={setZero} label={`Os ${progress.total - progress.counted} itens sem contagem estão com zero na prateleira`} hint="Sem marcar, o servidor recusa o encerramento enquanto houver item sem contagem." />
          ) : <p className="text-sm">Todos os itens foram contados.</p>}
        </FormDialog>
      ) : null}
      {dialog === "approve" ? (
        <FormDialog open onOpenChange={(o) => (!o ? close() : undefined)} title="Aprovar inventário" submitLabel="Aprovar e lançar ajustes" pending={approve.isPending} error={dlgError}
          description={`${diffs.length} ${diffs.length === 1 ? "ajuste será lançado" : "ajustes serão lançados"} no estoque (efeito de ${moneyOrZero(up + down)}), ao custo médio vigente. Os movimentos de ajuste não se apagam.`}
          onSubmit={() => { if (diffs.length > 0 && note.trim().length < 3) return setNoteErr("Informe o motivo dos ajustes (mínimo 3 letras)."); setNoteErr(null); setDlgError(null); approve.mutate({ inventoryId: inv.id, note }, { onSuccess: close, onError: err }); }}>
          <Field label={diffs.length > 0 ? "Motivo dos ajustes" : "Observação (opcional)"} htmlFor="iv-note" error={noteErr} hint="Fica registrado no Histórico e em cada movimento de ajuste."><Input id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoFocus /></Field>
        </FormDialog>
      ) : null}
      {dialog === "reopen" ? <ReasonDialog title="Reabrir contagem" submitLabel="Reabrir" pending={reopen.isPending} error={dlgError} description="A contagem volta para quem conta; as quantidades já digitadas ficam." onClose={close} onSubmit={(reason) => { setDlgError(null); reopen.mutate({ inventoryId: inv.id, reason }, { onSuccess: close, onError: err }); }} /> : null}
      {dialog === "cancel" ? <ReasonDialog title="Cancelar inventário" submitLabel="Cancelar inventário" pending={cancel.isPending} error={dlgError} description="Nenhum ajuste é lançado. O saldo do estoque continua como está." onClose={close} onSubmit={(reason) => { setDlgError(null); cancel.mutate({ inventoryId: inv.id, reason }, { onSuccess: () => { close(); onBack(); }, onError: err }); }} /> : null}
    </div>
  );
}
