import { AgendaCard } from "@/components/dashboard/AgendaCard";
import { PageHeader } from "@/components/PageHeader";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";

/** Agenda em tela própria: o mesmo componente que continua na tela Hoje. */
export function AgendaPage() {
  const { data: professional } = useCurrentProfessional();
  return (
    <div className="space-y-6">
      <PageHeader title="Agenda" description="Compromissos da clínica e do seu Google Agenda." />
      <AgendaCard clinicId={professional?.clinicId ?? null} defaultProfessionalId={professional?.id ?? null} />
    </div>
  );
}
