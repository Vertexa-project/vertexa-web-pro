import { useState } from "react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { FilterField } from "@/components/platform-billing/FilterField";
import { LedgerList } from "@/components/platform-billing/LedgerList";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformBillingClinics } from "@/hooks/usePlatformBilling";
import { platformBillingErrorMessage } from "@/lib/domain/platformBilling";
import { clinicColumns, clinicHref, clinicMobile } from "./clinicColumns";

export function PlatformBillingClinicsPage({
  title = "Contratos",
  description = "Plano, preço, ciclo, Pix e saúde financeira de cada clínica.",
  preset,
}: {
  title?: string;
  description?: string;
  preset?: { financialStatus?: string; needsAttention?: boolean; pixStatus?: string };
}) {
  const access = useAmIPlatformAdmin(true);
  const [clinicQuery, setClinicQuery] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [contractStatus, setContractStatus] = useState("");
  const [pixStatus, setPixStatus] = useState(preset?.pixStatus ?? "");
  const [financialStatus, setFinancialStatus] = useState(preset?.financialStatus ?? "");
  const [attention, setAttention] = useState(
    preset?.needsAttention === true ? "yes" : "",
  );

  const query = usePlatformBillingClinics(access.isPlatformAdmin === true, {
    clinicQuery: clinicQuery.trim() || undefined,
    planCode: planCode || undefined,
    contractStatus: contractStatus || undefined,
    pixStatus: pixStatus || undefined,
    financialStatus: financialStatus || undefined,
    needsAttention: attention === "yes" ? true : attention === "no" ? false : undefined,
    limit: 50,
    offset: 0,
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="bp05-clinic" className="text-xs text-muted-foreground">
            Clínica
          </Label>
          <Input
            id="bp05-clinic"
            value={clinicQuery}
            onChange={(event) => setClinicQuery(event.target.value)}
            placeholder="Nome ou identificador"
            className="mt-1"
          />
        </div>
        <FilterField id="bp05-plan" label="Plano" value={planCode} onChange={setPlanCode}>
          <option value="">Todos</option>
          <option value="pulse">Pulse</option>
          <option value="sync">Sync</option>
          <option value="apex">Apex</option>
        </FilterField>
        <FilterField
          id="bp05-contract"
          label="Contrato"
          value={contractStatus}
          onChange={setContractStatus}
        >
          <option value="">Todos</option>
          <option value="active">Ativo</option>
          <option value="pending">Pendente</option>
          <option value="ended">Encerrado</option>
          <option value="cancelled">Cancelado</option>
        </FilterField>
        <FilterField id="bp05-pix" label="Pix Automático" value={pixStatus} onChange={setPixStatus}>
          <option value="">Todos</option>
          <option value="absent">Ausente</option>
          <option value="INTENT">Aguardando autorização</option>
          <option value="CREATED">Criado</option>
          <option value="ACTIVE">Ativo</option>
          <option value="REFUSED">Recusado</option>
        </FilterField>
        <FilterField
          id="bp05-fin"
          label="Situação financeira"
          value={financialStatus}
          onChange={setFinancialStatus}
        >
          <option value="">Todas</option>
          <option value="no_plan">Sem contrato</option>
          <option value="no_charges">Sem cobrança</option>
          <option value="current">Em dia</option>
          <option value="pending">Em aberto</option>
          <option value="overdue">Vencido</option>
        </FilterField>
        <FilterField id="bp05-att" label="Atenção" value={attention} onChange={setAttention}>
          <option value="">Todas</option>
          <option value="yes">Precisa de atenção</option>
          <option value="no">Sem atenção</option>
        </FilterField>
      </div>

      {query.isLoading ? <Skeleton className="h-64 w-full" /> : null}
      {query.isError ? (
        <ErrorState
          title="Não foi possível carregar os contratos"
          description={platformBillingErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isLoading && !query.isError && (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhuma clínica neste recorte"
          description="Ajuste os filtros ou aguarde um contrato comercial."
        />
      ) : null}
      {(query.data?.items.length ?? 0) > 0 ? (
        <LedgerList
          columns={clinicColumns()}
          rows={query.data?.items ?? []}
          getRowId={(row) => row.clinicId}
          ariaLabel={title}
          onRowHref={clinicHref}
          mobile={clinicMobile}
          attention={(row) => row.attention}
        />
      ) : null}
    </div>
  );
}
