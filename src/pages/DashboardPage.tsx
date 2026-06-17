import { Construction } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { greeting } from "@/lib/domain/format";

export function DashboardPage() {
  const now = new Date();
  const hello = greeting(now.getHours());

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${hello}!`}
        description="Aqui você acompanha a retenção e a adesão dos seus pacientes."
      />
      <EmptyState
        icon={Construction}
        title="Dashboard em construção"
        description="Cards-resumo, foco do dia e tendência de adesão chegam na Fase 2."
      />
    </div>
  );
}
