import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClinicCommercialUsage } from "@/hooks/useBillingCommercial";
import {
  capacityNotice,
  commercialMoney,
  founderBadgeLabel,
  pricingReasonLabel,
  type ClinicCommercialUsage,
} from "@/lib/domain/billingCommercial";

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-l border-border pl-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function BillingCommercialUsagePanel({ clinicId }: { clinicId: string }) {
  const usage = useClinicCommercialUsage(clinicId, true);
  if (usage.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Carregando o uso comercial…</CardContent>
      </Card>
    );
  }
  if (usage.isError || !usage.data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar o uso comercial da clínica.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <CommercialUsageBody usage={usage.data} />;
}

export function CommercialUsageBody({ usage }: { usage: ClinicCommercialUsage }) {
  const founder = founderBadgeLabel(usage.founder);
  const cap = usage.capacity;
  const price = usage.price;
  const professionalNotice = capacityNotice({
    remaining: cap.remainingProfessionals,
    allowed: cap.allowedProfessionals,
    kind: "professional",
    planCode: cap.planCode,
    canAddUnits: cap.planCode === "sync" || cap.planCode === "apex",
  });
  const patientNotice = capacityNotice({
    remaining: cap.remainingPatients,
    allowed: cap.allowedPatients,
    kind: "patient",
    planCode: cap.planCode,
    canAddUnits: cap.planCode === "sync" || cap.planCode === "apex",
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Uso e valor comercial</CardTitle>
          {founder ? <Badge tone="primary">{founder}</Badge> : null}
        </div>
        <CardDescription>
          Projeção comercial do servidor. Não é cobrança Asaas nem pagamento recebido.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Plano atual" value={price.planCode ? price.planCode.toUpperCase() : "Sem contrato"} />
          <Fact
            label="Valor mensal projetado"
            value={commercialMoney(price.finalProjectedCents)}
            hint={pricingReasonLabel(price.pricingReason)}
          />
          <Fact label="Tabela vigente" value={commercialMoney(price.tablePriceCents)} />
          <Fact
            label="Preço travado"
            value={price.lockedPriceCents != null ? commercialMoney(price.lockedPriceCents) : "—"}
            hint={price.lockUntil ? `Até ${price.lockUntil}` : "Travamento inicial encerrado ou inexistente"}
          />
          <Fact
            label="Benefício vitalício"
            value={usage.founder?.badge ? "30% sobre a tabela futura" : "Não aplicável"}
          />
          <Fact
            label="Profissionais"
            value={`${cap.billableProfessionals} / ${cap.allowedProfessionals || "—"}`}
            hint="O dono responsável não consome assento. Outro admin conta."
          />
          <Fact
            label="Pacientes ativos"
            value={`${cap.activePatients} / ${cap.allowedPatients || "—"}`}
            hint="Pacientes inativos ou históricos não consomem capacidade."
          />
          <Fact
            label="Unidades adicionais"
            value={`${cap.additionalProfessionalUnits} prof. · ${cap.additionalPatientUnits} pac.`}
            hint={
              cap.planCode === "pulse"
                ? "Pulse não tem unidade adicional nesta campanha."
                : "Somente o administrador da plataforma altera a capacidade paga."
            }
          />
        </dl>
        {usage.founder && !usage.founder.badge ? (
          <p className="text-sm text-muted-foreground">
            Há histórico Founder (slot {usage.founder.slotNumber}). O benefício atual está{" "}
            {usage.founder.benefitStatus === "returnable" ? "suspenso, com retorno possível enquanto a campanha estiver aberta" : "encerrado"}.
          </p>
        ) : null}
        {professionalNotice.tone !== "ok" ? (
          <p role="status" className="text-sm">
            <strong>{professionalNotice.title}.</strong> {professionalNotice.body}
          </p>
        ) : null}
        {patientNotice.tone !== "ok" ? (
          <p role="status" className="text-sm">
            <strong>{patientNotice.title}.</strong> {patientNotice.body}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
