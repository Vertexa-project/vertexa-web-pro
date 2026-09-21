import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Eye, Search, UserPlus, Users } from "lucide-react";

import { ClinicCapacityNotice } from "@/components/billing/ClinicCapacityNotice";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { ProfileAvatarUrlScope } from "@/components/avatar/ProfileAvatarUrlScope";
import { ProfilePhoto } from "@/components/avatar/ProfilePhoto";
import { PatientCreateDialog } from "@/components/patient/PatientCreateDialog";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { StatusBadge } from "@/components/status/StatusBadge";
import { DataTable, type Column } from "@/components/data-table/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { useListPatients } from "@/hooks/usePatients";
import { usePatientsWithoutActiveProfessional } from "@/hooks/usePatientTeam";
import { formatPercent, formatRelative, professionalTypeLabel } from "@/lib/domain/format";
import { patientsWithoutProfessionalIds } from "@/lib/domain/patientTeam";
import { statusLabel } from "@/lib/domain/vri";
import type { PatientListItem, PatientStatus } from "@/types/db";

const STATUS_OPTIONS: PatientStatus[] = [
  "novo",
  "em_acompanhamento",
  "atencao",
  "em_risco",
  "inativo",
];

/**
 * Responsável da paciente. Desde o WP-2bi-UI, `patient.professionals` já vem SÓ com vínculos
 * ATIVOS (o filtro mora em lib/api/patients.ts) — um profissional desativado não figura aqui.
 *
 * O badge "Sem responsável ativo" NÃO é derivado desta lista: vem da RPC
 * `patients_without_active_professional`, que é a verdade do servidor para a clínica inteira e
 * usa o critério certo (nenhum vínculo INTERNO ativo — vínculo só externo não conta como
 * responsável). Derivar de `professionals.length === 0` daria falso positivo para quem só tem
 * externo e falso negativo para quem lê a lista sob outra RLS.
 */
function ResponsibleProfessional({
  patient,
  withoutProfessional,
}: {
  patient: PatientListItem;
  withoutProfessional: boolean;
}) {
  const first = patient.professionals[0];
  const extra = patient.professionals.length - 1;
  return (
    <div className="flex flex-col items-start gap-1">
      {first ? (
        <>
          <span className="text-foreground">{first.full_name ?? "—"}</span>
          <span className="text-xs text-muted-foreground">
            {professionalTypeLabel(first.type)}
            {extra > 0 ? ` +${extra}` : ""}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {withoutProfessional ? <Badge tone="warning">Sem responsável ativo</Badge> : null}
    </div>
  );
}

export function PatientsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useListPatients();

  // Badge "sem responsável ativo": UMA chamada por CLÍNICA (não uma por paciente). A RPC é
  // admin-only e responde 42501 aos demais, então só disparamos quando o sinal REAL de admin for
  // verdadeiro — para o não-admin o badge simplesmente não existe.
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const { isClinicAdmin } = useIsClinicAdmin(clinicId);
  const canCreatePatients = isClinicAdmin;
  const withoutProfessional = usePatientsWithoutActiveProfessional(clinicId, isClinicAdmin);
  const withoutProfessionalIds = useMemo(
    () => patientsWithoutProfessionalIds(withoutProfessional.data),
    [withoutProfessional.data],
  );

  const [tab, setTab] = useState<"todos" | "pendentes">("todos");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PatientStatus>("all");
  const [professionalFilter, setProfessionalFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const professionalOptions = useMemo(() => {
    const map = new Map<string, string>();
    (data ?? []).forEach((p) =>
      p.professionals.forEach((pr) => map.set(pr.id, pr.full_name ?? "Profissional")),
    );
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((p) => {
      if (tab === "pendentes" && p.snapshot?.status !== "atencao" && p.snapshot?.status !== "em_risco") {
        return false;
      }
      if (term && !(p.profile?.full_name ?? "").toLowerCase().includes(term)) return false;
      if (statusFilter !== "all" && p.snapshot?.status !== statusFilter) return false;
      if (professionalFilter !== "all" && !p.professionals.some((pr) => pr.id === professionalFilter)) {
        return false;
      }
      return true;
    });
  }, [data, tab, search, statusFilter, professionalFilter]);

  const columns: Column<PatientListItem>[] = [
    {
      key: "patient",
      header: "Paciente",
      render: (p) => {
        const name = p.profile?.full_name ?? "Sem nome";
        return (
          <div className="flex items-center gap-3">
            <ProfilePhoto
              name={name}
              avatarPath={p.profile?.avatar_path}
              legacyUrl={p.profile?.avatar_url}
              className="h-9 w-9"
            />
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{name}</span>
              {p.goal ? <span className="text-xs text-muted-foreground">{p.goal}</span> : null}
            </div>
          </div>
        );
      },
    },
    {
      key: "professional",
      header: "Profissional",
      render: (p) => (
        <ResponsibleProfessional patient={p} withoutProfessional={withoutProfessionalIds.has(p.id)} />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <StatusBadge status={p.snapshot?.status} score={p.snapshot?.score} />,
    },
    {
      key: "adherence",
      header: "Adesão",
      render: (p) => <span className="text-foreground">{formatPercent(p.snapshot?.weekly_completion_rate)}</span>,
    },
    {
      key: "lastActivity",
      header: "Última atividade",
      render: (p) => (
        <span className="text-muted-foreground">
          {p.lastActivityAt ? formatRelative(p.lastActivityAt) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      // Cabeçalho nomeado só para leitor de tela (coluna de ação, visualmente sem título).
      header: <span className="sr-only">Ações</span>,
      headerClassName: "text-right",
      className: "text-right",
      render: (p) => (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Ver paciente ${p.profile?.full_name ?? ""}`.trim()}
          onClick={(e) => {
            // O <tr> inteiro também navega; evita o duplo disparo do row click.
            e.stopPropagation();
            navigate(`/pacientes/${p.id}`);
          }}
        >
          <Eye className="h-4 w-4" />
          Ver paciente
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pacientes"
        description="Acompanhe status, adesão e atividade dos seus pacientes."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/relatorios/lote")}>
              <Download className="h-4 w-4" />
              Exportar em lote
            </Button>
            {canCreatePatients ? (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus className="h-4 w-4" />
                Cadastrar novo paciente
              </Button>
            ) : null}
          </>
        }
      />
      <ClinicCapacityNotice clinicId={clinicId} kind="patient" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="pendentes">Pendentes</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="Buscar por nome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 sm:w-56"
              aria-label="Buscar pacientes"
            />
          </div>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={professionalFilter} onValueChange={setProfessionalFilter}>
            <SelectTrigger className="sm:w-56" aria-label="Filtrar por profissional">
              <SelectValue placeholder="Profissional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os profissionais</SelectItem>
              {professionalOptions.map((pr) => (
                <SelectItem key={pr.id} value={pr.id}>
                  {pr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
            canCreatePatients ? (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus className="h-4 w-4" />
                Cadastrar novo paciente
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum resultado"
          description="Ajuste a busca ou os filtros para encontrar pacientes."
        />
      ) : (
        <ProfileAvatarUrlScope paths={(data ?? []).map((p) => p.profile?.avatar_path)}>
          <DataTable
            columns={columns}
            rows={filtered}
            getRowId={(p) => p.id}
            onRowClick={(p) => navigate(`/pacientes/${p.id}`)}
            ariaLabel="Lista de pacientes"
          />
        </ProfileAvatarUrlScope>
      )}

      {canCreatePatients ? (
        <PatientCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(patientId) => navigate(`/pacientes/${patientId}`)}
        />
      ) : null}
    </div>
  );
}
