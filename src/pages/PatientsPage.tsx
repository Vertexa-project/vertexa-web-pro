import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Search, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { StatusBadge } from "@/components/status/StatusBadge";
import { DataTable, type Column } from "@/components/data-table/DataTable";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useListPatients } from "@/hooks/usePatients";
import { formatPercent, formatRelative, initials, professionalTypeLabel } from "@/lib/domain/format";
import { statusLabel } from "@/lib/domain/vri";
import type { PatientListItem, PatientStatus } from "@/types/db";

const STATUS_OPTIONS: PatientStatus[] = [
  "novo",
  "em_acompanhamento",
  "atencao",
  "em_risco",
  "inativo",
];

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

export function PatientsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useListPatients();

  const [tab, setTab] = useState<"todos" | "pendentes">("todos");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PatientStatus>("all");
  const [professionalFilter, setProfessionalFilter] = useState<string>("all");
  const [notice, setNotice] = useState<string | null>(null);

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
            <Avatar>
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{name}</span>
              {p.goal ? <span className="text-xs text-muted-foreground">{p.goal}</span> : null}
            </div>
          </div>
        );
      },
    },
    { key: "professional", header: "Profissional", render: (p) => <ResponsibleProfessional patient={p} /> },
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
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pacientes"
        description="Acompanhe status, adesão e atividade dos seus pacientes."
        actions={
          <>
            <Button variant="outline" onClick={() => setNotice("Exportação disponível em breve.")}>
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Button onClick={() => setNotice("Cadastro de paciente chega em breve (P2 da sprint).")}>
              <UserPlus className="h-4 w-4" />
              Criar paciente
            </Button>
          </>
        }
      />

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

      {notice ? (
        <p className="text-sm text-info" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum paciente ainda"
          description="Cadastre seu primeiro paciente para começar o acompanhamento."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum resultado"
          description="Ajuste a busca ou os filtros para encontrar pacientes."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(p) => p.id}
          onRowClick={(p) => navigate(`/pacientes/${p.id}`)}
          ariaLabel="Lista de pacientes"
        />
      )}
    </div>
  );
}
