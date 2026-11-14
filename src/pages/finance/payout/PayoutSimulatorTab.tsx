// Financeiro › Repasse › Simulador: quanto cada participante receberia de um atendimento, com as regras vigentes e a mesma conta do servidor.
import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";

import { CentsInput, DecimalInput, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { ParticipantsFields } from "@/components/fin/ParticipantsFields";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFinContext } from "@/hooks/useFin";
import { usePayoutContext, usePayoutRules } from "@/hooks/useFinPayout";
import { canSeePayoutRules } from "@/lib/domain/finAccess";
import { EMPTY_PARTICIPANTS, toDrafts, type ParticipantsValue } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import { clinicMargin, matchRules, PAYOUT_ROLE_LABEL, simulateAppointment, taxOf, type PayoutLine } from "@/lib/domain/finPayout";
import { NoAccess } from "@/pages/finance/NoAccess";

export function PayoutSimulatorTab() {
  const { clinicId, access } = useFinContext();
  const canRead = canSeePayoutRules(access);
  const ctx = usePayoutContext(clinicId, canRead).data;
  const rulesQ = usePayoutRules(clinicId, null, false, canRead);
  const [serviceId, setServiceId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState<number | null>(null);
  const [fee, setFee] = useState<number | null>(null);
  const [material, setMaterial] = useState<number | null>(null);
  const [taxPct, setTaxPct] = useState<number | null>(null);
  const [cumulative, setCumulative] = useState<number | null>(null);
  const [parts, setParts] = useState<ParticipantsValue>(EMPTY_PARTICIPANTS);
  const service = ctx?.services.find((s) => s.id === serviceId);
  const drafts = useMemo(() => toDrafts(parts), [parts]);
  const names = new Map((ctx?.professionals ?? []).map((p) => [p.id, p.name]));
  const taxRate = taxPct ?? ctx?.tax_pct ?? 0;

  const result = useMemo(() => {
    if (!ctx || !service || gross === null || drafts.length === 0) return null;
    const clinic = { fee: ctx.settings.deduct_fee, tax: ctx.settings.deduct_tax, material: ctx.settings.deduct_material };
    const q = { serviceId: service.id, category: service.category, on, unitId: unitId || (ctx.units.length === 1 ? ctx.units[0].id : null) };
    const inp = { grossCents: gross, feeCents: fee ?? 0, taxPct: taxRate, materialCents: material ?? 0, cumulativeBaseCents: cumulative ?? 0 };
    const rules = rulesQ.data ?? [];
    const lines = simulateAppointment(rules, clinic, q, drafts.map((d) => ({ professionalId: d.professionalId, role: d.role })), inp);
    const noRule = drafts.filter((d) => matchRules(rules, { ...q, professionalId: d.professionalId, role: d.role }).length === 0);
    const total = lines.reduce((a, l) => a + l.amountCents, 0);
    return { lines, noRule, total, margin: clinicMargin(gross, fee ?? 0, taxOf(gross, taxRate), material ?? 0, [total]) };
  }, [ctx, service, gross, fee, material, taxRate, cumulative, drafts, rulesQ.data, on, unitId]);

  if (!clinicId || !ctx) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  return (
    <div className="min-w-0 space-y-4">
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">Simule um atendimento: nada é gravado. Usa as regras vigentes na data e as deduções que a clínica configurou.</p>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Serviço" htmlFor="sim-svc">
          <NativeSelect id="sim-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Selecione…</option>{ctx.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Data do atendimento" htmlFor="sim-date"><Input id="sim-date" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        {ctx.units.length > 1 ? (
          <Field label="Unidade" htmlFor="sim-unit">
            <NativeSelect id="sim-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Qualquer</option>{ctx.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>
          </Field>
        ) : null}
        <Field label="Valor liquidado (R$)" htmlFor="sim-gross" hint="O dinheiro que entrou (bruto, antes da taxa)."><CentsInput id="sim-gross" value={gross} onChange={setGross} /></Field>
        <Field label="Taxa do meio de pagamento (R$)" htmlFor="sim-fee"><CentsInput id="sim-fee" value={fee} onChange={setFee} /></Field>
        <Field label="Custo do material (R$)" htmlFor="sim-mat"><CentsInput id="sim-mat" value={material} onChange={setMaterial} /></Field>
        <Field label="Imposto (%)" htmlFor="sim-tax" hint={`Alíquota do mês: ${String(ctx.tax_pct).replace(".", ",")}%.`}><DecimalInput id="sim-tax" value={taxPct ?? ctx.tax_pct} onChange={setTaxPct} maxDecimals={4} /></Field>
        <Field label="Base já acumulada no mês (R$, para faixas)" htmlFor="sim-cum" hint="Opcional: só importa para regras com faixas por meta."><CentsInput id="sim-cum" value={cumulative} onChange={setCumulative} /></Field>
      </div>
      <ParticipantsFields idPrefix="sim" value={parts} onChange={setParts} professionals={ctx.professionals} allowedRoles={["responsavel", "executor", "auxiliar"]} />

      {!result ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Calculator className="h-4 w-4" aria-hidden /> Escolha o serviço, informe o valor e quem participou para ver o repasse.</p>
      ) : (
        <div className="min-w-0 space-y-3" aria-live="polite">
          {result.lines.length > 0 ? (
            <FinTable<PayoutLine>
              label="Resultado da simulação" rows={result.lines} rowKey={(l) => `${l.professionalId}-${l.role}-${l.ruleId}-${l.lineType}`}
              columns={[
                { header: "Profissional", role: "title", cell: (l) => names.get(l.professionalId) ?? "Profissional" },
                { header: "Papel", role: "badge", cell: (l) => <Badge tone="muted">{PAYOUT_ROLE_LABEL[l.role]}</Badge> },
                { header: "Base", nowrap: true, className: "tabular-nums", cell: (l) => (l.baseCents === null ? "—" : formatBRL(l.baseCents)) },
                { header: "%", nowrap: true, className: "tabular-nums", cell: (l) => (l.pct === null ? "fixo" : `${String(l.pct).replace(".", ",")}%`) },
                { header: "Repasse", nowrap: true, className: "tabular-nums font-medium", cell: (l) => formatBRL(l.amountCents) },
                { header: "Conta", wide: true, cell: (l) => l.formula },
              ]}
            />
          ) : null}
          {result.noRule.map((d) => (
            <p key={`${d.professionalId}-${d.role}`} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              Sem regra para {names.get(d.professionalId) ?? "o profissional"} ({PAYOUT_ROLE_LABEL[d.role].toLowerCase()}): este atendimento entraria na fila «sem regra».
            </p>
          ))}
          <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Total de repasses</dt><dd className="font-medium tabular-nums">{formatBRL(result.total)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Margem da clínica</dt><dd className="font-medium tabular-nums">{formatBRL(result.margin)}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}
