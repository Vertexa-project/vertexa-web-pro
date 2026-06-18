import { useNavigate } from "react-router-dom";
import { ClipboardList, Dumbbell, Utensils } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/DataTable";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { useAllPlans } from "@/hooks/usePlans";
import { formatRelative } from "@/lib/domain/format";
import type { PlanListItem } from "@/types/db";

export function PlansPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useAllPlans();

  const columns: Column<PlanListItem>[] = [
    {
      key: "type",
      header: "Tipo",
      render: (p) => (
        <Badge tone="muted" className="gap-1.5">
          {p.type === "treino" ? (
            <Dumbbell className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Utensils className="h-3.5 w-3.5" aria-hidden />
          )}
          {p.type === "treino" ? "Treino" : "Alimentar"}
        </Badge>
      ),
    },
    {
      key: "title",
      header: "Plano",
      render: (p) => <span className="font-medium text-foreground">{p.title}</span>,
    },
    { key: "patient", header: "Paciente", render: (p) => p.patientName ?? "—" },
    {
      key: "created",
      header: "Criado",
      render: (p) => <span className="text-muted-foreground">{formatRelative(p.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planos"
        description="Treinos e planos alimentares que os pacientes veem no app."
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nenhum plano criado"
          description="Crie planos no prontuário de cada paciente (abas Treino e Plano alimentar)."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={data}
          getRowId={(p) => `${p.type}-${p.id}`}
          onRowClick={(p) => p.patientId && navigate(`/pacientes/${p.patientId}`)}
          ariaLabel="Lista de planos"
        />
      )}
    </div>
  );
}
