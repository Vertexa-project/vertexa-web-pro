import { useMemo } from "react";
import { Building2, Briefcase, ClipboardList, SlidersHorizontal, Users } from "lucide-react";

import { StatCard } from "@/components/dashboard/StatCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformClinics } from "@/hooks/usePlatformClinics";
import { usePlatformOnboardingSettings } from "@/hooks/usePlatformOnboarding";
import { CLINIC_ONBOARDING_MODE_LABEL } from "@/lib/domain/clinicOnboarding";
import { aggregatePlatformClinicStats } from "@/lib/domain/platformAdmin";

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function PlatformDashboardPage() {
  const access = useAmIPlatformAdmin(true);
  const enabled = access.isPlatformAdmin === true;
  const clinics = usePlatformClinics(enabled);
  const settings = usePlatformOnboardingSettings(enabled);
  const stats = useMemo(() => aggregatePlatformClinicStats(clinics.data ?? []), [clinics.data]);

  const loading = clinics.isLoading || settings.isLoading;
  const failed = clinics.isError || settings.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard da plataforma"
        description="Visão global. Sem dados clínicos individuais."
      />

      {loading ? <DashboardSkeleton /> : null}

      {failed ? (
        <ErrorState
          title="Não foi possível carregar o dashboard"
          description="As métricas usam só o catálogo da plataforma e a política de entrada."
          onRetry={() => {
            void clinics.refetch();
            void settings.refetch();
          }}
        />
      ) : null}

      {!loading && !failed ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard icon={Building2} label="Total de clínicas" value={stats.clinicCount} />
          <StatCard icon={Briefcase} label="Total de profissionais" value={stats.professionalCount} />
          <StatCard icon={Users} label="Total de pacientes" value={stats.patientCount} />
          <StatCard
            icon={ClipboardList}
            label="Solicitações pendentes"
            value={settings.data?.pendingRequestCount ?? 0}
          />
          <StatCard
            icon={SlidersHorizontal}
            label="Entrada de clínicas"
            value={CLINIC_ONBOARDING_MODE_LABEL[settings.data?.mode ?? "closed"]}
          />
        </div>
      ) : null}
    </div>
  );
}
