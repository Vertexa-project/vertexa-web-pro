// Financeiro › Repasse › Regras: cadastro de regras por profissional, serviço e papel; fila «sem regra»; comissão sobre medicamento/manipulado.
// Admin/Gestor configuram; Financeiro consulta. Regra com repasse calculado só é encerrada (nunca apagada nem reescrita).
import { useState } from "react";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { Plus, Scale } from "lucide-react";

import { ActiveBadge, CheckField, ExportButtons, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext } from "@/hooks/useFin";
import { useMedCommissions, usePayoutContext, usePayoutRules, useSavePayoutRule, useSetPayoutRuleActive, useUnruled } from "@/hooks/useFinPayout";
import type { PayoutRuleRow, UnruledRow } from "@/lib/api/finPayout";
import { canManagePayoutRules, canSeePayoutRules } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { PAYOUT_ROLE_LABEL, PAYOUT_RULE_TYPE_LABEL, payoutErrorMessage } from "@/lib/domain/finPayout";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { ReasonDialog } from "@/pages/finance/appointments/ReasonDialog";
import { PayoutRuleDialog, type RulePrefill } from "@/pages/finance/payout/PayoutRuleDialog";
import { targetText, valueText } from "@/pages/finance/payout/payoutText";

const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
export function PayoutRulesTab() {
  const { clinicId, access } = useFinContext();
  const canRead = canSeePayoutRules(access);
  const canWrite = canManagePayoutRules(access);
  const [professionalId, setProfessionalId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<{ rule: PayoutRuleRow | null; prefill?: RulePrefill } | null>(null);
  const [ending, setEnding] = useState<PayoutRuleRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ctx = usePayoutContext(clinicId, canRead);
  const rulesQ = usePayoutRules(clinicId, professionalId || null, showInactive, canRead);
  const unruled = useUnruled(clinicId, canRead);
  const meds = useMedCommissions(clinicId, canRead);
  const setActive = useSetPayoutRuleActive();
  const endRule = useSavePayoutRule(clinicId ?? "");
  const [endTo, setEndTo] = useState("");
  const [endError, setEndError] = useState<string | null>(null);
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rules = rulesQ.data ?? [];
  const queue = unruled.data ?? [];
  const columns: ExportColumn<PayoutRuleRow>[] = [
    { header: "Profissional", value: (r) => r.professional_name }, { header: "Tipo", value: (r) => PAYOUT_RULE_TYPE_LABEL[r.rule_type] }, { header: "Papel", value: (r) => (r.role ? PAYOUT_ROLE_LABEL[r.role] : "") },
    { header: "Vale para", value: targetText }, { header: "Valor", value: valueText }, { header: "Início", value: (r) => br(r.valid_from) }, { header: "Fim", value: (r) => br(r.valid_to) }, { header: "Ativa", value: (r) => r.is_active },
  ];
  const onSaved = (r: { warnings: string[]; pctSum: number | null }) => {
    const parts = ["Regra salva."];
    if (r.warnings.includes("PCT_SUM_OVER_100")) parts.push(`Atenção: a soma dos percentuais de todos os participantes deste serviço passa de 100% (${String(r.pctSum ?? "").replace(".", ",")}%).`);
    if (r.warnings.includes("COMMISSION_MEDICATION_ART69")) parts.push("Aceite sobre comissão em medicamento/manipulado registrado no Histórico.");
    setNotice(parts.join(" "));
  };
  const submitEnd = (reason: string) => {
    if (!ending) return;
    if (!endTo || endTo < ending.valid_from) return setEndError("Informe uma data de fim a partir do início da regra.");
    setEndError(null);
    endRule.mutate({
      id: ending.id, professionalId: ending.professional_id, ruleType: ending.rule_type, role: ending.role, targetType: ending.target_type, serviceId: ending.service_id, category: ending.category, stockItemId: ending.stock_item_id,
      pct: ending.pct, amountCents: ending.amount_cents, tiers: ending.tiers, tierScope: ending.tier_scope, compensation: ending.compensation, usageFeeMode: ending.usage_fee_mode, commissionBase: ending.commission_base,
      deductionsOverride: ending.deductions_override, allUnits: ending.all_units, unitIds: ending.unit_ids, validFrom: ending.valid_from, validTo: endTo, notes: ending.notes, reason,
    }, { onSuccess: () => { setNotice("Vigência encerrada. Crie a nova regra a partir do dia seguinte."); setEnding(null); }, onError: (e) => setEndError(payoutErrorMessage(e)) });
  };

  return (
    <div className="min-w-0 space-y-4">
      {!canWrite ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">Você consulta as regras. Quem configura é o gestor da clínica.</p> : null}
      {notice ? <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{notice}</p> : null}

      {queue.length > 0 ? (
        <section className="min-w-0 space-y-2" aria-label="Atendimentos sem regra de repasse">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            <p className="font-medium">{queue.length} participante(s) sem regra de repasse</p>
            <p>O fechamento do mês só pode ser aprovado depois que você criar a regra ou marcar «sem repasse» para cada um.</p>
          </div>
          <FinTable<UnruledRow>
            label="Sem regra" rows={queue.slice(0, 50)} rowKey={(r) => `${r.appointment_id}-${r.professional_id}-${r.role}`}
            columns={[
              { header: "Profissional", role: "title", cell: (r) => r.professional_name },
              { header: "Papel", role: "badge", cell: (r) => <Badge tone="warning">{PAYOUT_ROLE_LABEL[r.role]}</Badge> },
              { header: "Data", nowrap: true, cell: (r) => br(r.performed_on) },
              { header: "Serviço", cell: (r) => r.service_name },
              { header: "Unidade", cell: (r) => r.unit_name },
              ...(canWrite ? [{ header: "Ações", role: "action" as const, cell: (r: UnruledRow) => <Button size="sm" variant="outline" onClick={() => setDialog({ rule: null, prefill: { professionalId: r.professional_id, role: r.role } })} aria-label={`Criar regra para ${r.professional_name}`}>Criar regra</Button> }] : []),
            ]}
          />
        </section>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Profissional" htmlFor="rules-pro">
            <NativeSelect id="rules-pro" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Todos</option>{(ctx.data?.professionals ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <div className="flex items-end"><CheckField id="rules-inactive" label="Mostrar regras desativadas" checked={showInactive} onChange={setShowInactive} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons columns={columns} rows={rules} filename="regras-de-repasse" sheetName="Regras" />
          {canWrite && ctx.data ? <Button onClick={() => setDialog({ rule: null })}><Plus aria-hidden /> Nova regra</Button> : null}
        </div>
      </div>

      {rulesQ.isLoading ? <LoadingState /> : rulesQ.isError ? <ErrorState onRetry={() => void rulesQ.refetch()} /> : rules.length === 0 ? (
        <EmptyState icon={Scale} title="Nenhuma regra de repasse" description="Cadastre o percentual, o fixo ou a comissão de cada profissional. Sem regra, o atendimento entra na fila «sem regra»."
          action={canWrite && ctx.data ? <Button onClick={() => setDialog({ rule: null })}>Nova regra</Button> : undefined} />
      ) : (
        <FinTable<PayoutRuleRow>
          label="Regras de repasse" rows={rules} rowKey={(r) => r.id}
          columns={[
            { header: "Profissional", role: "title", cell: (r) => r.professional_name },
            { header: "Situação", role: "badge", cell: (r) => (r.valid_to && r.valid_to < todayIsoBR() ? <Badge tone="muted">Encerrada</Badge> : <ActiveBadge active={r.is_active} />) },
            { header: "Tipo", cell: (r) => PAYOUT_RULE_TYPE_LABEL[r.rule_type] },
            { header: "Papel", cell: (r) => (r.role ? PAYOUT_ROLE_LABEL[r.role] : "—") },
            { header: "Vale para", cell: targetText },
            { header: "Valor", wide: true, cell: valueText },
            { header: "Vigência", nowrap: true, cell: (r) => `${br(r.valid_from)} a ${r.valid_to ? br(r.valid_to) : "sem fim"}` },
            { header: "Ações", role: "action", cell: (r) => (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog({ rule: r })} aria-label={`${canWrite ? "Editar" : "Ver"} regra de ${r.professional_name}`}>{canWrite ? "Editar" : "Ver"}</Button>
                {canWrite && r.is_active && !r.valid_to ? <Button size="sm" variant="outline" onClick={() => { setEnding(r); setEndTo(""); setEndError(null); }} aria-label={`Encerrar regra de ${r.professional_name}`}>Encerrar</Button> : null}
                {canWrite && r.is_active && !r.in_use ? <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Desativar a regra de ${r.professional_name}? Ela ainda não foi usada e fica em «Mostrar regras desativadas».`)) setActive.mutate({ ruleId: r.id, active: false, reason: "Regra desativada antes de ser usada" }); }} disabled={setActive.isPending} aria-label={`Desativar regra de ${r.professional_name}`}>Desativar</Button> : null}
              </div>
            ) },
          ]}
        />
      )}

      {(meds.data?.length ?? 0) > 0 ? (
        <section className="min-w-0 space-y-2" aria-label="Comissão sobre medicamento e manipulado">
          <p className="text-sm font-medium">Comissões sobre medicamento e manipulado</p>
          <FinTable
            label="Comissões sobre medicamento e manipulado" rows={meds.data ?? []} rowKey={(m) => m.line_id}
            columns={[
              { header: "Profissional", role: "title", cell: (m) => m.professional_name }, { header: "Item", cell: (m) => m.item_name },
              { header: "Extrato", cell: (m) => `${m.period.slice(5)}/${m.period.slice(0, 4)}` }, { header: "Valor", nowrap: true, className: "tabular-nums", cell: (m) => formatBRL(m.amount_cents) },
            ]}
          />
        </section>
      ) : null}

      {dialog && ctx.data ? <PayoutRuleDialog key={dialog.rule?.id ?? "new"} clinicId={clinicId} ctx={ctx.data} rule={dialog.rule} prefill={dialog.prefill} canWrite={canWrite} onClose={() => setDialog(null)} onSaved={onSaved} /> : null}
      {ending ? (
        <ReasonDialog title="Encerrar regra" description={`Regra de ${ending.professional_name}: o repasse já calculado não muda. A nova regra começa no dia seguinte.`} submitLabel="Encerrar vigência" pending={endRule.isPending} error={endError} onClose={() => setEnding(null)} onSubmit={submitEnd}>
          <Field label="Último dia da regra" htmlFor="rule-end-date"><Input id="rule-end-date" type="date" value={endTo} min={ending.valid_from} onChange={(e) => setEndTo(e.target.value)} /></Field>
        </ReasonDialog>
      ) : null}
    </div>
  );
}
