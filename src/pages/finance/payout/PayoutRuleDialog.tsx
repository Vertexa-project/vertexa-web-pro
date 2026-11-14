// Cadastro de regra de repasse (escopo-v1 §5.1): profissional · papel · alvo · tipo · valor · deduções · vigência · unidades.
// Regra que já gerou repasse só tem o fim da vigência alterado: para mudar tipo ou valor, encerre e crie outra no dia seguinte.
import { useState } from "react";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { Plus, Trash2 } from "lucide-react";

import { CentsInput, CheckField, DecimalInput, Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSavePayoutRule } from "@/hooks/useFinPayout";
import type { PayoutContext, PayoutRuleRow, SavePayoutRuleInput } from "@/lib/api/finPayout";
import { SERVICE_CATEGORY_LABEL } from "@/lib/api/finCatalog";
import { PAYOUT_ROLE_LABEL, PAYOUT_RULE_TYPE_LABEL, payoutErrorMessage, validateTiers, type PayoutRole, type PayoutRuleType, type PayoutTargetType, type ServiceCategory, type Tier } from "@/lib/domain/finPayout";

export interface RulePrefill { professionalId?: string; role?: PayoutRole; serviceId?: string }
type Tri = "" | "yes" | "no";
const tri = (v: boolean | undefined): Tri => (v === undefined ? "" : v ? "yes" : "no");
const unTri = (t: Tri): boolean | undefined => (t === "" ? undefined : t === "yes");
const today = () => todayIsoBR();
const PARTICIPANT_TYPES: PayoutRuleType[] = ["pct", "fixed_per_exec", "none"];
const TYPE_HINT: Record<PayoutRuleType, string> = {
  pct: "Percentual sobre a base do atendimento; entra no mês em que o dinheiro liquida. Pode ter faixas por meta.",
  fixed_per_exec: "Valor por atendimento realizado; entra no mês da execução, mesmo que o paciente ainda deva.",
  fixed_monthly: "Valor por mês, proporcional aos dias de vigência quando a regra começa ou termina no meio do mês.",
  min_guarantee: "Piso mensal: se percentual + fixo por execução ficar abaixo, a clínica paga o complemento.",
  product_commission: "Comissão do vendedor/indicador por produto vendido ou entregue.",
  usage_fee: "Taxa de uso de sala/equipamento descontada no extrato (linha negativa). Só para quem negociou.",
  none: "Marca que este papel não é remunerado. Tira o atendimento da fila «sem regra».",
};

export function PayoutRuleDialog({ clinicId, ctx, rule, prefill, canWrite, onClose, onSaved }: {
  clinicId: string; ctx: PayoutContext; rule: PayoutRuleRow | null; prefill?: RulePrefill; canWrite: boolean; onClose: () => void; onSaved: (r: { warnings: string[]; pctSum: number | null }) => void;
}) {
  const save = useSavePayoutRule(clinicId);
  const used = Boolean(rule?.in_use);
  const [pro, setPro] = useState(rule?.professional_id ?? prefill?.professionalId ?? "");
  const [type, setType] = useState<PayoutRuleType>(rule?.rule_type ?? "pct");
  const [role, setRole] = useState<PayoutRole>((rule?.role === "vendedor" ? "responsavel" : rule?.role) ?? prefill?.role ?? "responsavel");
  const [target, setTarget] = useState<PayoutTargetType>(rule?.target_type ?? (prefill?.serviceId ? "service" : "default"));
  const [serviceId, setServiceId] = useState(rule?.service_id ?? prefill?.serviceId ?? "");
  const [category, setCategory] = useState<ServiceCategory>(rule?.category ?? "consulta");
  const [itemId, setItemId] = useState(rule?.stock_item_id ?? "");
  const [pct, setPct] = useState<number | null>(rule?.pct ?? null);
  const [amount, setAmount] = useState<number | null>(rule?.amount_cents ?? null);
  const [useTiers, setUseTiers] = useState(Boolean(rule?.tiers));
  const [tiers, setTiers] = useState<Tier[]>(rule?.tiers ?? [{ up_to_cents: null, pct: 50 }, { up_to_cents: null, pct: 60 }]);
  const [tierScope, setTierScope] = useState<"" | "organization" | "unit">(rule?.tier_scope ?? "");
  const [compensation, setCompensation] = useState(rule?.compensation ?? false);
  const [usageMode, setUsageMode] = useState<"fixed" | "pct">(rule?.usage_fee_mode ?? "fixed");
  const [commissionMode, setCommissionMode] = useState<"pct" | "amount">(rule && rule.rule_type === "product_commission" && rule.amount_cents !== null ? "amount" : "pct");
  const [commissionBase, setCommissionBase] = useState<"net_fee" | "margin">(rule?.commission_base ?? "net_fee");
  const [ded, setDed] = useState<{ fee: Tri; tax: Tri; material: Tri }>({ fee: tri(rule?.deductions_override?.fee), tax: tri(rule?.deductions_override?.tax), material: tri(rule?.deductions_override?.material) });
  const [allUnits, setAllUnits] = useState(rule?.all_units ?? true);
  const [unitIds, setUnitIds] = useState<string[]>(rule?.unit_ids ?? []);
  const [from, setFrom] = useState(rule?.valid_from ?? today());
  const [to, setTo] = useState(rule?.valid_to ?? "");
  const [notes, setNotes] = useState(rule?.notes ?? "");
  const [reason, setReason] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const readOnly = !canWrite;
  const lockedFields = used || readOnly;   // regra já usada: só o fim da vigência
  const item = ctx.items.find((i) => i.id === itemId);
  const medication = type === "product_commission" && target === "item" && item && ["medication", "compounded"].includes(item.item_type);
  const isParticipantType = PARTICIPANT_TYPES.includes(type);

  function submit() {
    const found: Record<string, string> = {};
    if (!pro) found.pro = "Escolha o profissional.";
    if (!from) found.from = "Informe o início da vigência.";
    if (to && from && to < from) found.to = "O fim não pode ser antes do início.";
    if (target === "service" && !serviceId) found.service = "Escolha o serviço.";
    if (target === "item" && !itemId) found.item = "Escolha o item.";
    const tiersOn = type === "pct" && useTiers;
    if (type === "pct" && !tiersOn && (pct === null || pct < 0 || pct > 100)) found.pct = "Informe um percentual entre 0 e 100.";
    if (tiersOn) { const m = validateTiers(tiers); if (m) found.tiers = m; }
    if (["fixed_per_exec", "fixed_monthly", "min_guarantee"].includes(type) && amount === null) found.amount = "Informe o valor.";
    if (type === "usage_fee" && (usageMode === "fixed" ? amount === null : pct === null)) found[usageMode === "fixed" ? "amount" : "pct"] = "Informe o valor da taxa de uso.";
    if (type === "product_commission" && (commissionMode === "pct" ? pct === null : amount === null)) found[commissionMode === "pct" ? "pct" : "amount"] = "Informe a comissão.";
    if (!allUnits && unitIds.length === 0) found.units = "Escolha ao menos uma unidade.";
    if (rule && reason.trim().length < 3) found.reason = "Informe o motivo da alteração.";
    if (medication && !accept) found.accept = "Marque o aceite para salvar a comissão sobre medicação ou manipulado.";
    setFe(found);
    if (Object.keys(found).length > 0) return setError(null);
    setError(null);
    const override = { ...(unTri(ded.fee) !== undefined ? { fee: unTri(ded.fee) } : {}), ...(unTri(ded.tax) !== undefined ? { tax: unTri(ded.tax) } : {}), ...(unTri(ded.material) !== undefined ? { material: unTri(ded.material) } : {}) };
    const input: SavePayoutRuleInput = {
      id: rule?.id ?? null, professionalId: pro, ruleType: type, role: isParticipantType ? role : type === "product_commission" ? "vendedor" : null,
      targetType: isParticipantType ? target : type === "product_commission" ? (target === "item" ? "item" : "default") : "default",
      serviceId: target === "service" && isParticipantType ? serviceId : null, category: target === "category" && isParticipantType ? category : null, stockItemId: type === "product_commission" && target === "item" ? itemId : null,
      pct: type === "pct" ? (tiersOn ? null : pct) : type === "usage_fee" ? (usageMode === "pct" ? pct : null) : type === "product_commission" ? (commissionMode === "pct" ? pct : null) : null,
      amountCents: type === "pct" || type === "none" ? null : type === "usage_fee" ? (usageMode === "fixed" ? amount : null) : type === "product_commission" ? (commissionMode === "amount" ? amount : null) : amount,
      tiers: tiersOn ? tiers : null, tierScope: tiersOn && tierScope ? tierScope : null, compensation: type === "min_guarantee" && compensation, usageFeeMode: type === "usage_fee" ? usageMode : null,
      commissionBase: type === "product_commission" ? commissionBase : "net_fee", deductionsOverride: type === "pct" && Object.keys(override).length > 0 ? override : null,
      allUnits, unitIds, validFrom: from, validTo: to || null, notes: notes.trim() || null, reason: reason.trim() || undefined, acceptMedication: Boolean(medication && accept),
    };
    save.mutate(input, { onSuccess: (r) => { onSaved({ warnings: r.warnings, pctSum: r.pct_sum }); onClose(); }, onError: (e) => setError(payoutErrorMessage(e)) });
  }

  const addTier = () => setTiers((cur) => { const last = cur[cur.length - 1]; return [...cur.slice(0, -1), { up_to_cents: null, pct: last.pct }, last]; });
  const setTier = (i: number, patch: Partial<Tier>) => setTiers((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const dedSelect = (key: "fee" | "tax" | "material", label: string) => (
    <Field label={label} htmlFor={`rule-ded-${key}`}>
      <NativeSelect id={`rule-ded-${key}`} value={ded[key]} onChange={(e) => setDed((cur) => ({ ...cur, [key]: e.target.value as Tri }))} disabled={lockedFields}>
        <option value="">Como a clínica configurou</option><option value="yes">Deduzir</option><option value="no">Não deduzir</option>
      </NativeSelect>
    </Field>
  );

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={rule ? (canWrite ? "Editar regra de repasse" : "Ver regra de repasse") : "Nova regra de repasse"} onSubmit={submit} pending={save.isPending} error={error} readOnly={readOnly} wide
      description={used ? "Esta regra já gerou repasse: só o fim da vigência pode mudar. Para mudar o valor, encerre-a e crie outra a partir do dia seguinte." : undefined}>
      <fieldset disabled={readOnly} className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Profissional" htmlFor="rule-pro" error={fe.pro}>
            <NativeSelect id="rule-pro" value={pro} onChange={(e) => setPro(e.target.value)} disabled={lockedFields}>
              <option value="">Selecione…</option>{ctx.professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Tipo de remuneração" htmlFor="rule-type" hint={TYPE_HINT[type]}>
            <NativeSelect id="rule-type" value={type} onChange={(e) => { const t = e.target.value as PayoutRuleType; setType(t); setTarget("default"); }} disabled={Boolean(rule)}>
              {(Object.keys(PAYOUT_RULE_TYPE_LABEL) as PayoutRuleType[]).map((t) => <option key={t} value={t}>{PAYOUT_RULE_TYPE_LABEL[t]}</option>)}
            </NativeSelect>
          </Field>
        </div>

        {isParticipantType ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <Field label="Papel no atendimento" htmlFor="rule-role">
              <NativeSelect id="rule-role" value={role} onChange={(e) => setRole(e.target.value as PayoutRole)} disabled={lockedFields}>
                {(["responsavel", "executor", "auxiliar"] as PayoutRole[]).map((r) => <option key={r} value={r}>{PAYOUT_ROLE_LABEL[r]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Vale para" htmlFor="rule-target">
              <NativeSelect id="rule-target" value={target} onChange={(e) => setTarget(e.target.value as PayoutTargetType)} disabled={lockedFields}>
                <option value="default">Todos os serviços (padrão)</option><option value="category">Uma categoria de serviço</option><option value="service">Um serviço específico</option>
              </NativeSelect>
            </Field>
            {target === "category" ? (
              <Field label="Categoria" htmlFor="rule-cat">
                <NativeSelect id="rule-cat" value={category} onChange={(e) => setCategory(e.target.value as ServiceCategory)} disabled={lockedFields}>
                  {Object.entries(SERVICE_CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </Field>
            ) : null}
            {target === "service" ? (
              <Field label="Serviço" htmlFor="rule-svc" error={fe.service}>
                <NativeSelect id="rule-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={lockedFields}>
                  <option value="">Selecione…</option>{ctx.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              </Field>
            ) : null}
          </div>
        ) : null}

        {type === "product_commission" ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Vale para" htmlFor="rule-target-item">
              <NativeSelect id="rule-target-item" value={target === "item" ? "item" : "default"} onChange={(e) => setTarget(e.target.value as PayoutTargetType)} disabled={lockedFields}>
                <option value="default">Todos os produtos</option><option value="item">Um item específico</option>
              </NativeSelect>
            </Field>
            {target === "item" ? (
              <Field label="Item" htmlFor="rule-item" error={fe.item}>
                <NativeSelect id="rule-item" value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={lockedFields}>
                  <option value="">Selecione…</option>{ctx.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Comissão em" htmlFor="rule-cm-mode">
              <NativeSelect id="rule-cm-mode" value={commissionMode} onChange={(e) => setCommissionMode(e.target.value as "pct" | "amount")} disabled={lockedFields}>
                <option value="pct">Percentual</option><option value="amount">R$ por unidade vendida</option>
              </NativeSelect>
            </Field>
            <Field label="Calculada sobre" htmlFor="rule-cm-base" hint="Padrão: valor liquidado menos a taxa do meio de pagamento.">
              <NativeSelect id="rule-cm-base" value={commissionBase} onChange={(e) => setCommissionBase(e.target.value as "net_fee" | "margin")} disabled={lockedFields || commissionMode === "amount"}>
                <option value="net_fee">Liquidado − taxa</option><option value="margin">Margem (liquidado − taxa − custo médio)</option>
              </NativeSelect>
            </Field>
          </div>
        ) : null}

        {type === "pct" ? (
          <div className="space-y-3">
            <CheckField id="rule-tiers" label="Usar faixas por meta (percentual progressivo no mês)" checked={useTiers} onChange={setUseTiers} disabled={lockedFields} />
            {!useTiers ? (
              <Field label="Percentual (%)" htmlFor="rule-pct" error={fe.pct}><DecimalInput id="rule-pct" value={pct} onChange={setPct} maxDecimals={4} disabled={lockedFields} /></Field>
            ) : (
              <div className="space-y-2" aria-label="Faixas por meta">
                {tiers.map((t, i) => (
                  <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
                    {i === tiers.length - 1 ? (
                      <Field label={`Faixa ${i + 1}`} htmlFor={`rule-tier-${i}`}><div id={`rule-tier-${i}`} className="flex min-h-10 min-w-0 items-center break-words rounded-md border border-input bg-muted/50 px-3 py-2 text-sm leading-snug text-muted-foreground">Acima da faixa anterior</div></Field>
                    ) : (
                      <Field label={`Faixa ${i + 1}: base do mês até (R$)`} htmlFor={`rule-tier-${i}`}><CentsInput id={`rule-tier-${i}`} value={t.up_to_cents} onChange={(v) => setTier(i, { up_to_cents: v })} disabled={lockedFields} /></Field>
                    )}
                    <Field label="%" htmlFor={`rule-tier-pct-${i}`}><DecimalInput id={`rule-tier-pct-${i}`} value={t.pct} onChange={(v) => setTier(i, { pct: v ?? 0 })} maxDecimals={4} disabled={lockedFields} /></Field>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remover faixa ${i + 1}`} disabled={lockedFields || tiers.length <= 2} onClick={() => setTiers((cur) => cur.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" disabled={lockedFields} onClick={addTier}><Plus aria-hidden /> Adicionar faixa</Button>
                {fe.tiers ? <p className="text-xs font-medium text-destructive" role="alert">{fe.tiers}</p> : null}
                <Field label="A base do mês soma" htmlFor="rule-tier-scope" hint="Padrão: todas as unidades da organização.">
                  <NativeSelect id="rule-tier-scope" value={tierScope} onChange={(e) => setTierScope(e.target.value as "" | "organization" | "unit")} disabled={lockedFields}>
                    <option value="">Como a clínica configurou ({ctx.settings.tier_base === "unit" ? "só a unidade" : "todas as unidades"})</option><option value="organization">Todas as unidades</option><option value="unit">Só a unidade do atendimento</option>
                  </NativeSelect>
                </Field>
              </div>
            )}
          </div>
        ) : null}

        {["fixed_per_exec", "fixed_monthly", "min_guarantee"].includes(type) || (type === "usage_fee" && usageMode === "fixed") || (type === "product_commission" && commissionMode === "amount") ? (
          <Field label={type === "fixed_per_exec" ? "Valor por atendimento realizado (R$)" : type === "fixed_monthly" ? "Valor por mês (R$)" : type === "min_guarantee" ? "Piso mensal (R$)" : type === "usage_fee" ? "Taxa de uso por mês (R$)" : "Comissão por unidade (R$)"} htmlFor="rule-amount" error={fe.amount}>
            <CentsInput id="rule-amount" value={amount} onChange={setAmount} disabled={lockedFields} />
          </Field>
        ) : null}
        {type === "usage_fee" ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Taxa de uso" htmlFor="rule-usage-mode">
              <NativeSelect id="rule-usage-mode" value={usageMode} onChange={(e) => setUsageMode(e.target.value as "fixed" | "pct")} disabled={lockedFields}>
                <option value="fixed">Valor fixo por mês</option><option value="pct">% do valor liquidado dos atendimentos</option>
              </NativeSelect>
            </Field>
            {usageMode === "pct" ? <Field label="Percentual (%)" htmlFor="rule-pct" error={fe.pct}><DecimalInput id="rule-pct" value={pct} onChange={setPct} maxDecimals={4} disabled={lockedFields} /></Field> : null}
          </div>
        ) : null}
        {type === "product_commission" && commissionMode === "pct" ? <Field label="Percentual (%)" htmlFor="rule-pct" error={fe.pct}><DecimalInput id="rule-pct" value={pct} onChange={setPct} maxDecimals={4} disabled={lockedFields} /></Field> : null}
        {type === "min_guarantee" ? <CheckField id="rule-comp" label="Com compensação: o complemento pago vira saldo e é abatido do excedente dos meses seguintes" checked={compensation} onChange={setCompensation} disabled={lockedFields} /> : null}

        {type === "pct" ? (
          <fieldset className="min-w-0 space-y-2 rounded-md border p-3" disabled={lockedFields}>
            <legend className="px-1 text-sm font-medium">Deduções da base (opcional)</legend>
            <p className="text-xs text-muted-foreground">Base = valor liquidado − taxa − imposto − material, só do que estiver ligado. Aqui a regra pode mudar o que a clínica configurou.</p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">{dedSelect("fee", "Taxa do meio de pagamento")}{dedSelect("tax", "Imposto")}{dedSelect("material", "Material do kit")}</div>
          </fieldset>
        ) : null}

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Início da vigência" htmlFor="rule-from" error={fe.from}><Input id="rule-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={lockedFields} /></Field>
          <Field label="Fim da vigência (opcional)" htmlFor="rule-to" error={fe.to} hint="Para trocar a regra: encerre esta e crie a nova a partir do dia seguinte."><Input id="rule-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={readOnly} /></Field>
        </div>
        {ctx.units.length > 1 ? (
          <div className="space-y-2">
            <CheckField id="rule-all-units" label="Vale para todas as unidades" checked={allUnits} onChange={setAllUnits} disabled={lockedFields} />
            {!allUnits ? (
              <div className="flex flex-wrap gap-x-6 gap-y-2" role="group" aria-label="Unidades da regra">
                {ctx.units.map((u) => <CheckField key={u.id} id={`rule-unit-${u.id}`} label={u.name} checked={unitIds.includes(u.id)} disabled={lockedFields} onChange={(v) => setUnitIds((cur) => (v ? [...cur, u.id] : cur.filter((x) => x !== u.id)))} />)}
              </div>
            ) : null}
            {fe.units ? <p className="text-xs font-medium text-destructive" role="alert">{fe.units}</p> : null}
          </div>
        ) : null}
        <Field label="Observação (opcional)" htmlFor="rule-notes"><Input id="rule-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>

        {medication ? (
          <div className="min-w-0 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p className="font-medium">Atenção: comissão sobre medicamento ou manipulado</p>
            <p>O Código de Ética Médica (art. 69) veda ao médico obter vantagem pela comercialização de medicamentos. A comissão é permitida, mas exige o aceite do responsável pela clínica, registrado no Histórico com nome e data.</p>
            <CheckField id="rule-accept" label="Estou ciente e aceito como responsável pela clínica" checked={accept} onChange={setAccept} disabled={!ctx.is_owner} />
            {!ctx.is_owner ? <p className="text-xs">Só o administrador da clínica pode dar este aceite.</p> : null}
            {fe.accept ? <p className="text-xs font-medium text-destructive" role="alert">{fe.accept}</p> : null}
          </div>
        ) : null}
        {rule && canWrite ? <Field label="Motivo da alteração" htmlFor="rule-reason" error={fe.reason} hint="Fica registrado no Histórico, com quem fez e quando."><Input id="rule-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field> : null}
      </fieldset>
    </FormDialog>
  );
}
