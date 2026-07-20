import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, ShieldAlert } from "lucide-react";

import { AsyncSection } from "@/components/patient/AsyncSection";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { useListPatients } from "@/hooks/usePatients";
import { listClinicProfessionalProfiles, listReportExports, type ReportExportFilters } from "@/lib/api/report";
import { formatDate } from "@/lib/domain/format";
import { qk } from "@/lib/queryKeys";

const PAGE_SIZE = 20;
const ALL = "__all__";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Auditoria de exportações (WP-REPORT B · Parte 3) — SOMENTE LEITURA, para o admin da clínica (sinal
 * REAL am_i_clinic_admin, NUNCA profiles.role). Lista quem exportou, qual paciente, quando, período,
 * seções, nº de registros e se foi lote. Filtros: data, profissional, paciente. Sem conteúdo clínico.
 * DECISÃO: nesta fase a tela é admin-only; a visão pessoal do autor (a RLS já permite ler as próprias)
 * fica como evolução (registrada em PENDENCIAS).
 */
export function ReportAuditPage() {
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [prof, setProf] = useState(ALL);
  const [patient, setPatient] = useState(ALL);
  const [page, setPage] = useState(0);

  const filters: ReportExportFilters = {
    from: from || null,
    to: to || null,
    professionalProfileId: prof === ALL ? null : prof,
    patientId: patient === ALL ? null : patient,
  };

  const listQ = useQuery({
    queryKey: qk.reportExports(filters, page),
    queryFn: () => listReportExports(filters, page, PAGE_SIZE),
    enabled: isClinicAdmin,
  });
  const profsQ = useQuery({
    queryKey: qk.clinicProfessionalProfiles(clinicId ?? "none"),
    queryFn: () => listClinicProfessionalProfiles(clinicId as string),
    enabled: Boolean(clinicId) && isClinicAdmin,
  });
  const patientsQ = useListPatients();

  if (adminLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Auditoria de exportações" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Verificando suas permissões…</CardContent>
        </Card>
      </div>
    );
  }
  if (!isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Auditoria de exportações" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            Apenas o administrador da clínica pode ver a auditoria de exportações.
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria de exportações"
        description="Registro de quem exportou relatórios de pacientes — quando, período e volume. Sem conteúdo clínico."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            De
            <Input type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} className="h-9 w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Até
            <Input type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} className="h-9 w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Profissional
            <Select value={prof} onValueChange={resetPage(setProf)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {(profsQ.data ?? []).map((p) => (
                  <SelectItem key={p.profileId} value={p.profileId}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Paciente
            <Select value={patient} onValueChange={resetPage(setPatient)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {(patientsQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.profile?.full_name ?? "Sem nome"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </CardContent>
      </Card>

      <AsyncSection
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        isEmpty={rows.length === 0}
        onRetry={() => listQ.refetch()}
        emptyIcon={ClipboardList}
        emptyTitle="Nenhuma exportação"
        emptyDescription="Nenhuma exportação registrada para os filtros escolhidos."
      >
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-4 py-2.5 font-medium">Profissional</th>
                  <th className="px-4 py-2.5 font-medium">Paciente</th>
                  <th className="px-4 py-2.5 font-medium">Período</th>
                  <th className="px-4 py-2.5 font-medium">Seções</th>
                  <th className="px-4 py-2.5 text-right font-medium">Registros</th>
                  <th className="px-4 py-2.5 font-medium">Lote</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{fmtDateTime(r.exportedAt)}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.authorName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.patientName ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {formatDate(r.periodFrom)} – {formatDate(r.periodTo)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.sections.length}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{r.recordCount}</td>
                    <td className="px-4 py-2.5">
                      {r.batchId ? <Badge tone="primary">Lote</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} registro(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              Anterior
            </Button>
            <span>Página {page + 1} de {lastPage + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}>
              Próxima
            </Button>
          </div>
        </div>
      </AsyncSection>
    </div>
  );
}
