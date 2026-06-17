import { useNavigate } from "react-router-dom";
import { UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useListPatients } from "@/hooks/usePatients";
import { formatPercent, formatRelative, initials, professionalTypeLabel } from "@/lib/domain/format";
import type { PatientListItem } from "@/types/db";

function ResponsibleProfessional({ patient }: { patient: PatientListItem }) {
  const first = patient.professionals[0];
  if (!first) return <span className="text-muted-foreground">—</span>;
  const extra = patient.professionals.length - 1;
  return (
    <div className="flex flex-col">
      <span className="text-foreground">{first.full_name ?? "—"}</span>
      <span className="text-xs text-muted-foreground">
        {professionalTypeLabel(first.type)}
        {extra > 0 ? ` +${extra}` : ""}
      </span>
    </div>
  );
}

function PatientRow({ patient }: { patient: PatientListItem }) {
  const navigate = useNavigate();
  const name = patient.profile?.full_name ?? "Sem nome";
  return (
    <tr
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => navigate(`/pacientes/${patient.id}`)}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{name}</span>
            {patient.goal ? (
              <span className="text-xs text-muted-foreground">{patient.goal}</span>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        <ResponsibleProfessional patient={patient} />
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={patient.snapshot?.status} score={patient.snapshot?.score} />
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {formatPercent(patient.snapshot?.weekly_completion_rate)}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {patient.lastActivityAt ? formatRelative(patient.lastActivityAt) : "—"}
      </td>
    </tr>
  );
}

export function PatientsPage() {
  const { data, isLoading, isError, refetch } = useListPatients();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pacientes"
        description="Acompanhe status, adesão e atividade dos seus pacientes."
        actions={
          <Button>
            <UserPlus className="h-4 w-4" />
            Criar paciente
          </Button>
        }
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum paciente ainda"
          description="Cadastre seu primeiro paciente para começar o acompanhamento."
          action={
            <Button>
              <UserPlus className="h-4 w-4" />
              Criar paciente
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Profissional</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Adesão</th>
                  <th className="px-4 py-3">Última atividade</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((patient) => (
                  <PatientRow key={patient.id} patient={patient} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
