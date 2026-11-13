import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { CheckField, DecimalInput, ExportButtons, Field, FinTable, MonthYearPicker, NativeSelect, useFocusFirstError } from "@/components/fin/FinUi";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffectiveTaxRate, useFinContext, useFinSettings, useSaveFinSettings, useSetTaxRate, useTaxRates, useUnits } from "@/hooks/useFin";
import type { FinSettings } from "@/lib/api/finRegistry";
import { finCan } from "@/lib/domain/finAccess";
import { formatDecimalBR } from "@/lib/domain/money";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { currentPeriod, isPeriod, pctText, periodName, taxRateHeadline, taxRateNotice } from "@/lib/domain/taxRate";
import { formatBRL } from "@/lib/domain/finance";
import { CentsInput } from "@/components/fin/FinUi";
import { NoAccess } from "@/pages/finance/NoAccess";

const periodLabel = (p: string) => periodName(p);

function TaxRatesCard({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const rates = useTaxRates(clinicId);
  const units = useUnits(clinicId);
  const save = useSetTaxRate(clinicId);
  const [period, setPeriod] = useState(currentPeriod());
  const [rate, setRate] = useState<number | null>(null);
  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("");
  const [fe, setFe] = useState<{ rate?: string; period?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, tries > 0 ? `${tries}|${error ?? ""}` : null);
  // Servidor: fin_effective_tax_rate (mês do formulário e mês atual da clínica).
  const nowPeriod = currentPeriod();
  const effNow = useEffectiveTaxRate(clinicId, nowPeriod, null);
  const effForm = useEffectiveTaxRate(clinicId, period, unitId || null);

  if (rates.isLoading) return <LoadingState />;
  if (rates.isError) return <ErrorState onRetry={() => void rates.refetch()} />;
  const list = rates.data ?? [];
  const unitName = (id: string | null) => (id ? (units.data ?? []).find((u) => u.id === id)?.name ?? "Unidade" : "Toda a clínica");
  const eNow = effNow.data;
  const eForm = effForm.data;
  const noticeNow = eNow ? taxRateNotice(eNow, nowPeriod) : null;

  const columns: ExportColumn<(typeof list)[number]>[] = [
    { header: "Competência", value: (r) => periodLabel(r.period) },
    { header: "Alíquota (%)", value: (r) => r.rate_pct, kind: "pct" },
    { header: "Abrangência", value: (r) => unitName(r.unit_id) },
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(null);
    setTries((n) => n + 1);
    if (!isPeriod(period)) { setFe({ period: "Informe o mês e o ano." }); return setError("Informe a competência."); }
    if (rate === null || rate < 0 || rate > 100) { setFe({ rate: "Informe uma alíquota entre 0 e 100%." }); return setError(null); }
    setError(null);
    setFe({});
    save.mutate({ period, ratePct: rate, unitId: unitId || null, reason: reason.trim() || undefined }, {
      onSuccess: () => { setSaved(`Alíquota de ${periodLabel(period)} salva.`); setReason(""); },
      onError: () => setError("Não foi possível salvar agora. Tente novamente."),
    });
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">Alíquota de imposto por mês</CardTitle>
        <CardDescription>Usada quando a dedução de imposto está ligada e na margem. Mês sem alíquota repete a do mês anterior.</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {eNow ? <p className="text-lg font-semibold tabular-nums" data-testid="tax-headline">{taxRateHeadline(eNow, nowPeriod)}</p> : null}
        {noticeNow && canWrite ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium" role="status" data-testid="tax-notice">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />
            <span className="min-w-0 break-words">{noticeNow}</span>
          </div>
        ) : null}
        {canWrite ? (
          <form ref={formRef} noValidate className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={submit} aria-label="Informar alíquota do mês">
            <Field label="Competência" htmlFor="tax-period" error={fe.period}>
              <MonthYearPicker id="tax-period" value={period} onChange={(v) => { setPeriod(v); setFe({}); }} />
            </Field>
            <Field label="Alíquota (%)" htmlFor="tax-rate" error={fe.rate}><DecimalInput id="tax-rate" value={rate} onChange={setRate} maxDecimals={4} placeholder="6,5" /></Field>
            <div className="min-w-0 sm:col-span-2" data-testid="tax-form-effective">
              {eForm ? (
                eForm.found && !eForm.inherited
                  ? <p className="text-sm text-muted-foreground">{periodLabel(period)} já tem alíquota própria: <strong className="tabular-nums text-foreground">{pctText(eForm.ratePct)}</strong>. Salvar troca o valor.</p>
                  : <p className="break-words text-sm font-medium text-warning-foreground">{taxRateNotice(eForm, period)}</p>
              ) : null}
            </div>
            <Field label="Abrangência" htmlFor="tax-unit">
              <NativeSelect id="tax-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Toda a clínica</option>
                {(units.data ?? []).filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Motivo (opcional)" htmlFor="tax-reason"><Input id="tax-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
            <div className="sm:col-span-2"><Button type="submit" className="w-full sm:w-auto" disabled={save.isPending} aria-busy={save.isPending}>Salvar alíquota</Button></div>
          </form>
        ) : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {saved ? <p className="text-sm text-success" role="status">{saved}</p> : null}
        <ExportButtons columns={columns} rows={list} filename="aliquotas" sheetName="Alíquotas" />
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alíquota cadastrada ainda.</p>
        ) : (
          <FinTable
            label="Alíquotas por competência" rows={list} rowKey={(r) => r.id}
            columns={[
              { header: "Competência", role: "title", cell: (r) => periodLabel(r.period) },
              { header: "Alíquota", cell: (r) => `${formatDecimalBR(r.rate_pct, 2)}%` },
              { header: "Abrangência", cell: (r) => unitName(r.unit_id) },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SettingsCard({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const settings = useFinSettings(clinicId);
  const save = useSaveFinSettings(clinicId);
  const [draft, setDraft] = useState<FinSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data) return <ErrorState onRetry={() => void settings.refetch()} />;
  const s = draft ?? settings.data;
  const set = (patch: Partial<FinSettings>) => { setSaved(false); setDraft({ ...s, ...patch }); };
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(settings.data);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!(draft.accept_days >= 1 && draft.accept_days <= 60)) return setError("O prazo de aceite deve ficar entre 1 e 60 dias.");
    setError(null);
    const { clinic_id: _ignored, ...patch } = draft;
    void _ignored;
    save.mutate({ patch }, { onSuccess: () => { setSaved(true); setDraft(null); }, onError: () => setError("Não foi possível salvar agora. Tente novamente.") });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configurações financeiras da clínica</CardTitle>
        <CardDescription>{canWrite ? "Valem para toda a clínica." : "Somente leitura: quem altera é o gestor ou o administrador."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={submit} aria-label="Configurações financeiras">
          <fieldset className="space-y-3" disabled={!canWrite}>
            <legend className="mb-1 text-sm font-medium">Recebimentos</legend>
            <CheckField id="set-auto" label="Liquidar automaticamente na data prevista" checked={s.auto_settle} onChange={(v) => set({ auto_settle: v })} hint="Desligado: o gestor confirma cada liquidação manualmente." />
          </fieldset>
          <fieldset className="space-y-3" disabled={!canWrite}>
            <legend className="mb-1 text-sm font-medium">Deduções da base do repasse</legend>
            <CheckField id="set-fee" label="Taxa do meio de pagamento" checked={s.deduct_fee} onChange={(v) => set({ deduct_fee: v })} />
            <CheckField id="set-tax" label="Imposto" checked={s.deduct_tax} onChange={(v) => set({ deduct_tax: v })} />
            <CheckField id="set-mat" label="Material" checked={s.deduct_material} onChange={(v) => set({ deduct_material: v })} />
          </fieldset>
          <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2" disabled={!canWrite}>
            <legend className="mb-1 text-sm font-medium sm:col-span-2">Caixa, aceite e extrato</legend>
            <Field label="Limite de diferença do caixa (R$)" htmlFor="set-cash" hint="Acima disso, o fechamento exige justificativa.">
              <CentsInput id="set-cash" value={s.cash_diff_limit_cents} onChange={(v) => set({ cash_diff_limit_cents: v ?? 0 })} />
            </Field>
            <Field label="Prazo de aceite (dias)" htmlFor="set-accept">
              <DecimalInput id="set-accept" value={s.accept_days} onChange={(v) => set({ accept_days: v === null ? 0 : Math.round(v) })} maxDecimals={0} />
            </Field>
            <Field label="Paciente no extrato" htmlFor="set-patient">
              <NativeSelect id="set-patient" value={s.patient_display} onChange={(e) => set({ patient_display: e.target.value as FinSettings["patient_display"] })}>
                <option value="initials">Iniciais</option><option value="full">Nome completo</option><option value="hidden">Oculto</option>
              </NativeSelect>
            </Field>
            <Field label="Base das faixas de meta" htmlFor="set-tier">
              <NativeSelect id="set-tier" value={s.tier_base} onChange={(e) => set({ tier_base: e.target.value as FinSettings["tier_base"] })}>
                <option value="organization">Organização (todas as unidades)</option><option value="unit">Por unidade</option>
              </NativeSelect>
            </Field>
          </fieldset>
          <p className="text-xs text-muted-foreground">Limite atual: {formatBRL(s.cash_diff_limit_cents)}.</p>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          {saved ? <p className="text-sm text-success" role="status">Configurações salvas.</p> : null}
          {canWrite ? <Button type="submit" disabled={!dirty || save.isPending} aria-busy={save.isPending}>Salvar configurações</Button> : <Badge tone="muted">Somente leitura</Badge>}
        </form>
      </CardContent>
    </Card>
  );
}

/** Cadastros › Impostos e configurações. */
export function TaxSettingsTab() {
  const { clinicId, access } = useFinContext();
  if (!clinicId) return <LoadingState />;
  if (!finCan(access, "tax") && !finCan(access, "settings")) return <NoAccess />;
  return (
    <div className="grid min-w-0 gap-6 2xl:grid-cols-2">
      {finCan(access, "tax") ? <TaxRatesCard clinicId={clinicId} canWrite={finCan(access, "tax", "write")} /> : null}
      {finCan(access, "settings") ? <SettingsCard clinicId={clinicId} canWrite={finCan(access, "settings", "write")} /> : null}
    </div>
  );
}
