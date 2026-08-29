import { useMemo } from "react";
import { Building2, Briefcase, Users } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/DataTable";
import { StatCard } from "@/components/dashboard/StatCard";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformClinics } from "@/hooks/usePlatformClinics";
import type { PlatformClinic } from "@/lib/api/platformAdmin";
import {
  aggregatePlatformClinicStats,
  PLATFORM_CLINIC_VISIBLE_COLUMNS,
} from "@/lib/domain/platformAdmin";
import { formatDate } from "@/lib/domain/format";

function CatalogSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const columns: Column<PlatformClinic>[] = [
  {
    key: PLATFORM_CLINIC_VISIBLE_COLUMNS[0],
    header: "Clínica",
    render: (row) => <span className="font-medium text-foreground">{row.clinicName}</span>,
  },
  {
    key: PLATFORM_CLINIC_VISIBLE_COLUMNS[1],
    header: "Criada em",
    render: (row) => formatDate(row.createdAt),
    className: "text-muted-foreground",
  },
  {
    key: PLATFORM_CLINIC_VISIBLE_COLUMNS[2],
    header: "Profissionais",
    render: (row) => <span className="tnum">{row.professionalCount}</span>,
  },
  {
    key: PLATFORM_CLINIC_VISIBLE_COLUMNS[3],
    header: "Pacientes",
    render: (row) => <span className="tnum">{row.patientCount}</span>,
  },
];

export function PlatformClinicsPage() {
  const access = useAmIPlatformAdmin(true);
  const { data, isLoading, isError, refetch } = usePlatformClinics(access.isPlatformAdmin === true);

  const stats = useMemo(() => aggregatePlatformClinicStats(data ?? []), [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard da plataforma"
        description="Visão global read-only das clínicas. Sem dados clínicos individuais."
      />

      {isLoading ? <CatalogSkeleton /> : null}

      {isError ? (
        <ErrorState
          title="Não foi possível carregar as clínicas"
          description="A listagem usa somente o catálogo da plataforma. Tente novamente."
          onRetry={() => void refetch()}
        />
      ) : null}

      {!isLoading && !isError && (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma clínica cadastrada"
          description="Quando houver clínicas na plataforma, elas aparecem aqui."
        />
      ) : null}

      {!isLoading && !isError && (data?.length ?? 0) > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={Building2} label="Total de clínicas" value={stats.clinicCount} />
            <StatCard icon={Briefcase} label="Total de profissionais" value={stats.professionalCount} />
            <StatCard icon={Users} label="Total de pacientes" value={stats.patientCount} />
          </div>
          <DataTable
            columns={columns}
            rows={data ?? []}
            getRowId={(row) => row.clinicId}
            ariaLabel="Clínicas da plataforma"
          />
        </>
      ) : null}
    </div>
  );
}
