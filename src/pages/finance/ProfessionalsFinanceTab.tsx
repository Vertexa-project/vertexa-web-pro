import { useRef, useState } from "react";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { Lock, Plus, Trash2, Users } from "lucide-react";

import { CentsInput, CheckField, DecimalInput, ExportButtons, Field, FinTable, NativeSelect, ReasonField } from "@/components/fin/FinUi";
import { useFocusFirstError } from "@/components/fin/useFinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinContext, useProFinanceDetail, useProFinanceList, useSaveProFinance, useUnits } from "@/hooks/useFin";
import { BOND_LABEL, WITHHOLDING_LABEL, type BondType, type ProFinanceListRow, type Withholding, type WithholdingType } from "@/lib/api/finProfessionals";
import { finCan } from "@/lib/domain/finAccess";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { formatTaxId, isValidTaxId, onlyDigits } from "@/lib/domain/taxId";
import { NoAccess } from "@/pages/finance/NoAccess";

const serverMessage = (e: unknown): string => {
  const m = (e as { message?: string }).message ?? "";
  if (m.includes("INVALID_TAX_ID")) return "CPF ou CNPJ inválido.";
  if (m.includes("INVALID_WITHHOLDING")) return "Confira as retenções: alíquota entre 0 e 100% e vigência válida.";
  if (m.includes("INVALID_UNITS")) return "Selecione ao menos uma unidade válida.";
  if ((e as { code?: string }).code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível salvar agora. Tente novamente.";
};

const today = () => todayIsoBR();

function ProDialog({ clinicId, row, canWrite, onClose }: { clinicId: string; row: ProFinanceListRow; canWrite: boolean; onClose: () => void }) {
  // A leitura do detalhe (CPF/CNPJ, Pix, banco) é sensível: o servidor registra cada leitura no Histórico.
  const detail = useProFinanceDetail(row.professional_id);
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  return (
    <FormShell row={row} onClose={onClose}>
      {detail.isLoading ? <LoadingState /> : detail.isError ? <ErrorState title="Não foi possível abrir os dados" description="Você pode não ter permissão para ver os dados financeiros deste profissional." onRetry={() => void detail.refetch()} /> : (
        <ProForm key={row.professional_id} row={row} units={units} canWrite={canWrite} initial={detail.data} onClose={onClose} />
      )}
    </FormShell>
  );
}

function FormShell({ row, onClose, children }: { row: ProFinanceListRow; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Dados financeiros — {row.full_name ?? "profissional"}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Dados pessoais protegidos (LGPD): só administrador, gestor, financeiro e o próprio profissional leem. Cada leitura fica registrada no Histórico.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function ProForm({ row, units, canWrite, initial, onClose }: { row: ProFinanceListRow; units: { id: string; name: string }[]; canWrite: boolean; initial?: { data: import("@/lib/api/finProfessionals").ProFinanceDetail["data"]; withholdings: Withholding[] }; onClose: () => void }) {
  const save = useSaveProFinance();
  const d = initial?.data ?? null;
  const [bond, setBond] = useState<BondType>(d?.bond_type ?? "pj");
  const [taxId, setTaxId] = useState(d?.tax_id ? formatTaxId(d.tax_id) : "");
  const [simples, setSimples] = useState(d?.simples_optant ?? false);
  const [pix, setPix] = useState(d?.pix_key ?? "");
  const [bank, setBank] = useState(d?.bank_name ?? "");
  const [agency, setAgency] = useState(d?.bank_agency ?? "");
  const [account, setAccount] = useState(d?.bank_account ?? "");
  const [invoice, setInvoice] = useState(d?.requires_invoice ?? false);
  const [allUnits, setAllUnits] = useState(d?.all_units ?? true);
  const [unitIds, setUnitIds] = useState<string[]>(d?.unit_ids ?? []);
  const [rules, setRules] = useState<Withholding[]>(initial?.withholdings.filter((w) => w.is_active) ?? []);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const bodyRef = useRef<HTMLFieldSetElement>(null);
  useFocusFirstError(bodyRef, tries > 0 ? `${tries}|${error ?? ""}` : null);
  const setRule = (i: number, patch: Partial<Withholding>) => setRules((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function submit() {
    setTries((n) => n + 1);
    const found: Record<string, string> = {};
    if (taxId.trim() && !isValidTaxId(taxId)) found.tax = "CPF ou CNPJ inválido. Confira os dígitos.";
    if (!allUnits && unitIds.length === 0) found.units = "Selecione ao menos uma unidade ou marque «Todas as unidades».";
    rules.forEach((r, i) => {
      if (!(r.rate_pct >= 0 && r.rate_pct <= 100)) found[`wr${i}`] = "Alíquota entre 0 e 100%.";
      else if (!r.valid_from) found[`wf${i}`] = "Informe o início da vigência.";
      else if (r.valid_to && r.valid_to < r.valid_from) found[`wt${i}`] = "O fim da vigência é antes do início.";
    });
    setFe(found);
    if (Object.keys(found).length > 0) return setError(null);
    setError(null);
    save.mutate({
      professionalId: row.professional_id, bondType: bond, taxId: onlyDigits(taxId), simplesOptant: simples, pixKey: pix.trim(), bankName: bank.trim(), bankAgency: agency.trim(),
      bankAccount: account.trim(), requiresInvoice: invoice, allUnits, unitIds, withholdings: rules, reason: reason.trim() || undefined,
    }, { onSuccess: onClose, onError: (e) => { const m = serverMessage(e); if (m.startsWith("CPF")) { setFe({ tax: m }); setError(null); } else setError(m); } });
  }

  return (
    <form className="contents" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <fieldset ref={bodyRef} disabled={!canWrite} className="min-w-0 space-y-5 overflow-y-auto px-6 py-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Field label="Vínculo" htmlFor="pf-bond">
            <NativeSelect id="pf-bond" value={bond} onChange={(e) => setBond(e.target.value as BondType)}>
              {Object.entries(BOND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="CPF ou CNPJ" htmlFor="pf-tax" error={fe.tax} className="sm:col-span-2"><Input id="pf-tax" inputMode="numeric" value={taxId} onChange={(e) => setTaxId(e.target.value)} maxLength={18} placeholder="000.000.000-00" /></Field>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <CheckField id="pf-simples" label="Optante pelo Simples" checked={simples} onChange={setSimples} />
          <CheckField id="pf-invoice" label="Exige nota fiscal no fechamento" checked={invoice} onChange={setInvoice} />
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Chave Pix" htmlFor="pf-pix"><Input id="pf-pix" value={pix} onChange={(e) => setPix(e.target.value)} maxLength={140} /></Field>
          <Field label="Banco" htmlFor="pf-bank"><Input id="pf-bank" value={bank} onChange={(e) => setBank(e.target.value)} maxLength={80} /></Field>
          <Field label="Agência" htmlFor="pf-agency"><Input id="pf-agency" value={agency} onChange={(e) => setAgency(e.target.value)} maxLength={20} /></Field>
          <Field label="Conta" htmlFor="pf-account"><Input id="pf-account" value={account} onChange={(e) => setAccount(e.target.value)} maxLength={30} /></Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Unidades em que atua</p>
          {fe.units ? <p className="text-xs font-medium text-destructive" role="alert" aria-invalid="true" tabIndex={-1}>{fe.units}</p> : null}
          <CheckField id="pf-all-units" label="Todas as unidades" checked={allUnits} onChange={setAllUnits} />
          {!allUnits ? (
            <div className="ml-6 flex flex-wrap gap-x-6 gap-y-2">
              {units.map((u) => <CheckField key={u.id} id={`pf-u-${u.id}`} label={u.name} checked={unitIds.includes(u.id)} onChange={(v) => setUnitIds((cur) => (v ? [...cur, u.id] : cur.filter((x) => x !== u.id)))} />)}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Retenções na fonte</p>
          <p className="text-xs text-muted-foreground">Aplicadas sobre o total bruto do mês. Nenhuma retenção até a clínica configurar com o contador. Uma retenção que sai da lista é desativada, não apagada.</p>
          {rules.map((r, i) => (
            <div key={r.id ?? `n${i}`} className="grid min-w-0 grid-cols-2 items-end gap-2 rounded-md border p-2 md:grid-cols-[9rem_6rem_8rem_8rem_8rem_auto]">
              <Field label="Tipo" htmlFor={`wh-t-${i}`}>
                <NativeSelect id={`wh-t-${i}`} value={r.rule_type} onChange={(e) => setRule(i, { rule_type: e.target.value as WithholdingType })}>
                  {Object.entries(WITHHOLDING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Alíquota (%)" htmlFor={`wh-r-${i}`} error={fe[`wr${i}`]}><DecimalInput id={`wh-r-${i}`} value={r.rate_pct} maxDecimals={4} onChange={(v) => setRule(i, { rate_pct: v ?? Number.NaN })} /></Field>
              <Field label="Retém a partir de (R$)" htmlFor={`wh-m-${i}`}><CentsInput id={`wh-m-${i}`} value={r.min_base_cents} onChange={(v) => setRule(i, { min_base_cents: v ?? 0 })} /></Field>
              <Field label="Vigência de" htmlFor={`wh-f-${i}`} error={fe[`wf${i}`]}><Input id={`wh-f-${i}`} type="date" value={r.valid_from} onChange={(e) => setRule(i, { valid_from: e.target.value })} /></Field>
              <Field label="Vigência até" htmlFor={`wh-to-${i}`} error={fe[`wt${i}`]}><Input id={`wh-to-${i}`} type="date" value={r.valid_to ?? ""} onChange={(e) => setRule(i, { valid_to: e.target.value || null })} /></Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover retenção ${i + 1}`} onClick={() => setRules((cur) => cur.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
              <div className="col-span-2 md:col-span-6"><CheckField id={`wh-w-${i}`} label="Dispensa automática se for optante pelo Simples" checked={r.waive_if_simples} onChange={(v) => setRule(i, { waive_if_simples: v })} /></div>
              {r.rule_type === "outra" ? <Field label="Nome da retenção" htmlFor={`wh-l-${i}`} className="col-span-2 md:col-span-6"><Input id={`wh-l-${i}`} value={r.label ?? ""} onChange={(e) => setRule(i, { label: e.target.value })} maxLength={60} /></Field> : null}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRules((cur) => [...cur, { rule_type: "irrf", label: null, rate_pct: 0, min_base_cents: 0, waive_if_simples: true, valid_from: today(), valid_to: null, is_active: true }])}><Plus aria-hidden /> Adicionar retenção</Button>
        </div>
        {canWrite ? <ReasonField value={reason} onChange={setReason} required={false} /> : null}
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{canWrite ? "Cancelar" : "Fechar"}</Button>
        {canWrite ? <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>Salvar</Button> : null}
      </DialogFooter>
    </form>
  );
}

/** Cadastros › Profissionais (dados financeiros e retenções — LGPD). */
export function ProfessionalsFinanceTab() {
  const { clinicId, access } = useFinContext();
  const canRead = finCan(access, "pro_finance");
  const canWrite = finCan(access, "pro_finance", "write");
  const q = useProFinanceList(clinicId, canRead);
  const [open, setOpen] = useState<ProFinanceListRow | null>(null);
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = q.data ?? [];
  const columns: ExportColumn<ProFinanceListRow>[] = [
    { header: "Profissional", value: (r) => r.full_name },
    { header: "Vínculo", value: (r) => (r.bond_type ? BOND_LABEL[r.bond_type] : "") },
    { header: "Optante pelo Simples", value: (r) => r.simples_optant },
    { header: "Exige NF", value: (r) => r.requires_invoice },
    { header: "CPF/CNPJ informado", value: (r) => r.has_tax_id },
    { header: "Dados de pagamento informados", value: (r) => r.has_payment_data },
    { header: "Retenções ativas", value: (r) => r.retentions_count, kind: "qty" },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <ExportButtons columns={columns} rows={rows} filename="profissionais-financeiro" sheetName="Profissionais" />
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum profissional ativo" description="Aprove pessoas na Equipe para cadastrar os dados financeiros." />
      ) : (
        <FinTable
          label="Dados financeiros dos profissionais" rows={rows} rowKey={(r) => r.professional_id}
          columns={[
            { header: "Profissional", role: "title", cell: (r) => r.full_name ?? "—" },
            { header: "Vínculo", role: "badge", cell: (r) => (r.bond_type ? BOND_LABEL[r.bond_type] : <Badge tone="warning">A preencher</Badge>) },
            { header: "Simples", cell: (r) => (r.bond_type ? (r.simples_optant ? "Sim" : "Não") : "—") },
            { header: "Exige NF", cell: (r) => (r.bond_type ? (r.requires_invoice ? "Sim" : "Não") : "—") },
            { header: "CPF/CNPJ", cell: (r) => (r.has_tax_id ? "Informado" : "—") },
            { header: "Pagamento", cell: (r) => (r.has_payment_data ? "Informado" : "—") },
            { header: "Retenções", cell: (r) => r.retentions_count },
            { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpen(r)} aria-label={`${canWrite ? "Editar" : "Ver"} dados financeiros de ${r.full_name ?? "profissional"}`}>{canWrite ? "Editar" : "Ver"}</Button> },
          ]}
        />
      )}
      {open ? <ProDialog key={open.professional_id} clinicId={clinicId} row={open} canWrite={canWrite} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
