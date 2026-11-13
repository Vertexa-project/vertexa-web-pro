import { useState } from "react";
import { CreditCard, Plus, Trash2 } from "lucide-react";

import { ActiveBadge, CentsInput, CheckField, DecimalInput, ExportButtons, Field, FormDialog, NativeSelect, ReasonField, TableShell, Td, Th } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAcquirers, useFinContext, useSaveAcquirer, useUnits } from "@/hooks/useFin";
import { ACQUIRER_KIND_LABEL, FEE_MODALITY_LABEL, type Acquirer, type FeeModality, type FeeRow } from "@/lib/api/finCatalog";
import { finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { formatDecimalBR } from "@/lib/domain/money";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const serverMessage = (e: unknown): string => {
  const m = (e as { message?: string }).message ?? "";
  if (m.includes("duplicate")) return "Já existe um meio de pagamento com esse nome.";
  if (m.includes("INVALID_FEES")) return "Confira a tabela de taxas: bandeira, modalidade e taxa entre 0 e 100%.";
  if (m.includes("REASON_REQUIRED")) return "Informe o motivo da desativação.";
  if ((e as { code?: string }).code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível salvar agora. Tente novamente.";
};

interface FeeDraft extends Omit<FeeRow, "fee_pct" | "anticipation_fee_pct"> { fee_pct: number | null; anticipation_fee_pct: number | null }

function AcquirerDialog({ clinicId, acquirer, canWrite, onClose }: { clinicId: string; acquirer: Acquirer | "new" | null; canWrite: boolean; onClose: () => void }) {
  const editing = acquirer && acquirer !== "new" ? acquirer : null;
  const kind = editing?.kind ?? "machine";
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const save = useSaveAcquirer(clinicId);
  const [name, setName] = useState(editing?.name ?? "");
  const [unitId, setUnitId] = useState(editing?.unit_id ?? "");
  const [active, setActive] = useState(editing?.is_active ?? true);
  const [flatPct, setFlatPct] = useState<number | null>(editing?.flat_fee_pct ?? 0);
  const [flatCents, setFlatCents] = useState<number | null>(editing?.flat_fee_cents ?? 0);
  const [settle, setSettle] = useState<number | null>(editing?.settle_days ?? 0);
  const [fees, setFees] = useState<FeeDraft[]>(editing?.fees ?? []);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deactivating = Boolean(editing && editing.is_active && !active);
  const setFee = (i: number, patch: Partial<FeeDraft>) => setFees((cur) => cur.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  function submit() {
    if (!name.trim()) return setError("Informe o nome.");
    if (kind === "machine" && fees.some((f) => !f.brand.trim() || f.fee_pct === null || f.fee_pct < 0 || f.fee_pct > 100)) return setError("Confira a tabela de taxas: bandeira e taxa entre 0 e 100% em cada linha.");
    if (kind === "machine") {
      const keys = fees.map((f) => `${f.brand.trim().toLowerCase()}|${f.modality}`);
      if (new Set(keys).size !== keys.length) return setError("Há duas linhas com a mesma bandeira e modalidade.");
    }
    if (deactivating && reason.trim().length < 3) return setError("Informe o motivo da desativação.");
    setError(null);
    save.mutate({
      id: editing?.id ?? null, name: name.trim(), unitId: unitId || null, isActive: active, flatFeePct: flatPct ?? 0, flatFeeCents: flatCents ?? 0, settleDays: settle ?? 0,
      fees: fees.map((f) => ({ ...f, brand: f.brand.trim(), fee_pct: f.fee_pct ?? 0, anticipation_fee_pct: f.anticipation ? f.anticipation_fee_pct ?? 0 : 0 })), reason: reason.trim() || undefined,
    }, { onSuccess: onClose, onError: (e) => setError(serverMessage(e)) });
  }

  return (
    <FormDialog open={acquirer !== null} onOpenChange={(o) => (!o ? onClose() : undefined)} title={editing ? `Editar ${editing.name}` : "Nova maquininha"} onSubmit={submit} pending={save.isPending} error={error} wide={kind === "machine"}>
      <fieldset disabled={!canWrite} className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Nome" htmlFor="acq-name"><Input id="acq-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></Field>
          {kind === "machine" ? (
            <Field label="Unidade" htmlFor="acq-unit">
              <NativeSelect id="acq-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Todas as unidades</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </NativeSelect>
            </Field>
          ) : null}
        </div>
        {kind === "pix" || kind === "cash" || kind === "transfer" ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Taxa (%)" htmlFor="acq-flat"><DecimalInput id="acq-flat" value={flatPct} onChange={setFlatPct} maxDecimals={4} /></Field>
            <Field label="Prazo de liquidação (dias)" htmlFor="acq-settle" hint="0 = no mesmo dia (D+0)."><DecimalInput id="acq-settle" value={settle} onChange={(v) => setSettle(v === null ? null : Math.round(v))} maxDecimals={0} /></Field>
          </div>
        ) : null}
        {kind === "boleto" ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Taxa fixa por boleto (R$)" htmlFor="acq-bol"><CentsInput id="acq-bol" value={flatCents} onChange={setFlatCents} /></Field>
            <Field label="Prazo de liquidação (dias)" htmlFor="acq-settle"><DecimalInput id="acq-settle" value={settle} onChange={(v) => setSettle(v === null ? null : Math.round(v))} maxDecimals={0} /></Field>
          </div>
        ) : null}
        {kind === "machine" ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Tabela de taxas: bandeira × modalidade</p>
            <p className="text-xs text-muted-foreground">Taxa %, prazo de liquidação em dias e antecipação automática (sim/não e taxa).</p>
            {fees.map((f, i) => (
              <div key={i} className="grid min-w-0 grid-cols-2 items-end gap-2 rounded-md border p-2 md:grid-cols-[7rem_10rem_5.5rem_5.5rem_auto_6rem_auto]">
                <Field label="Bandeira" htmlFor={`fee-b-${i}`}><Input id={`fee-b-${i}`} value={f.brand} onChange={(e) => setFee(i, { brand: e.target.value })} maxLength={40} placeholder="Visa" /></Field>
                <Field label="Modalidade" htmlFor={`fee-m-${i}`}>
                  <NativeSelect id={`fee-m-${i}`} value={f.modality} onChange={(e) => setFee(i, { modality: e.target.value as FeeModality })}>
                    {Object.entries(FEE_MODALITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Taxa (%)" htmlFor={`fee-p-${i}`}><DecimalInput id={`fee-p-${i}`} value={f.fee_pct} maxDecimals={4} onChange={(v) => setFee(i, { fee_pct: v })} /></Field>
                <Field label="Prazo (dias)" htmlFor={`fee-d-${i}`}><DecimalInput id={`fee-d-${i}`} value={f.settle_days} maxDecimals={0} onChange={(v) => setFee(i, { settle_days: v === null ? 0 : Math.round(v) })} /></Field>
                <div className="pb-2"><CheckField id={`fee-a-${i}`} label="Antecipa" checked={f.anticipation} onChange={(v) => setFee(i, { anticipation: v })} /></div>
                {f.anticipation ? <Field label="Taxa antecip. (%)" htmlFor={`fee-ap-${i}`}><DecimalInput id={`fee-ap-${i}`} value={f.anticipation_fee_pct} maxDecimals={4} onChange={(v) => setFee(i, { anticipation_fee_pct: v })} /></Field> : <span />}
                <Button type="button" variant="ghost" size="icon" aria-label={`Remover linha ${i + 1} da tabela de taxas`} onClick={() => setFees((cur) => cur.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setFees((c) => [...c, { brand: "", modality: "credit_1", fee_pct: null, settle_days: 30, anticipation: false, anticipation_fee_pct: 0, anticipation_days: 1 }])}><Plus aria-hidden /> Adicionar linha</Button>
          </div>
        ) : null}
        {editing ? <CheckField id="acq-active" label="Ativo" checked={active} onChange={setActive} /> : null}
        {editing ? <ReasonField value={reason} onChange={setReason} required={deactivating} /> : null}
      </fieldset>
    </FormDialog>
  );
}

function summary(a: Acquirer): string {
  if (a.kind === "boleto") return `Taxa fixa ${formatBRL(a.flat_fee_cents)} por boleto · D+${a.settle_days}`;
  if (a.kind !== "machine") return `Taxa ${formatDecimalBR(a.flat_fee_pct, 2)}% · D+${a.settle_days}`;
  return a.fees.length === 0 ? "Sem taxas cadastradas" : `${a.fees.length} ${a.fees.length === 1 ? "linha" : "linhas"} de taxa`;
}

/** Cadastros › Meios de pagamento (maquininhas, Pix, dinheiro, transferência, boleto). */
export function PaymentMethodsTab() {
  const { clinicId, access } = useFinContext();
  const canRead = finCan(access, "payment");
  const canWrite = finCan(access, "payment", "write");
  const q = useAcquirers(clinicId, canRead);
  const units = useUnits(clinicId, canRead);
  const [editing, setEditing] = useState<Acquirer | "new" | null>(null);
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = q.data ?? [];
  const unitName = (id: string | null) => (id ? (units.data ?? []).find((u) => u.id === id)?.name ?? "Unidade" : "Todas");
  const columns: ExportColumn<Acquirer>[] = [
    { header: "Meio de pagamento", value: (a) => a.name },
    { header: "Tipo", value: (a) => ACQUIRER_KIND_LABEL[a.kind] },
    { header: "Unidade", value: (a) => unitName(a.unit_id) },
    { header: "Taxas e prazo", value: (a) => summary(a) },
    { header: "Ativo", value: (a) => a.is_active },
  ];
  const feeColumns: ExportColumn<{ a: Acquirer; f: FeeRow }>[] = [
    { header: "Maquininha", value: (r) => r.a.name },
    { header: "Bandeira", value: (r) => r.f.brand },
    { header: "Modalidade", value: (r) => FEE_MODALITY_LABEL[r.f.modality] },
    { header: "Taxa (%)", value: (r) => r.f.fee_pct, kind: "pct" },
    { header: "Prazo (dias)", value: (r) => r.f.settle_days, kind: "qty" },
    { header: "Antecipação", value: (r) => r.f.anticipation },
    { header: "Taxa de antecipação (%)", value: (r) => r.f.anticipation_fee_pct, kind: "pct" },
  ];
  const feeRows = rows.flatMap((a) => a.fees.map((f) => ({ a, f })));
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4">
          <ExportButtons columns={columns} rows={rows} filename="meios-de-pagamento" sheetName="Meios de pagamento" />
          {feeRows.length > 0 ? <ExportButtons columns={feeColumns} rows={feeRows} filename="taxas-por-bandeira" sheetName="Taxas" /> : null}
        </div>
        {canWrite ? <Button onClick={() => setEditing("new")}><Plus aria-hidden /> Nova maquininha</Button> : null}
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={CreditCard} title="Nenhum meio de pagamento" description="Cadastre as maquininhas e suas taxas por bandeira e modalidade." action={canWrite ? <Button onClick={() => setEditing("new")}>Nova maquininha</Button> : undefined} />
      ) : (
        <TableShell label="Meios de pagamento">
          <thead><tr><Th>Meio de pagamento</Th><Th>Tipo</Th><Th>Unidade</Th><Th>Taxas e prazo</Th><Th>Situação</Th><Th>Ações</Th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td>{ACQUIRER_KIND_LABEL[a.kind]}</Td>
                <Td>{a.kind === "machine" ? unitName(a.unit_id) : "—"}</Td>
                <Td>{summary(a)}</Td>
                <Td><ActiveBadge active={a.is_active} /></Td>
                <Td><Button size="sm" variant="outline" onClick={() => setEditing(a)} aria-label={`${canWrite ? "Editar" : "Ver"} ${a.name}`}>{canWrite ? "Editar" : "Ver"}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {editing ? <AcquirerDialog key={editing === "new" ? "new" : editing.id} clinicId={clinicId} acquirer={editing} canWrite={canWrite} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
