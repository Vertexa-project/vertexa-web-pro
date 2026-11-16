import { History } from "lucide-react";

import { FinTable, type FinColumn } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePatientExports } from "@/hooks/usePatientImportExport";
import type { PatientExportRecord } from "@/lib/api/patientImportExport";
import { dateTimeBR } from "@/lib/domain/clinicalDocs";
import { exportGroupLabel, exportReasonLabel } from "@/lib/domain/patientExport";

const COLUMNS: FinColumn<PatientExportRecord>[] = [
  { header: "Data", role: "title", nowrap: true, cell: (r) => dateTimeBR(r.created_at) },
  { header: "Quem", cell: (r) => r.actor_name ?? "—" },
  {
    header: "Motivo",
    wide: true,
    cell: (r) => (
      <span className="break-words">
        {exportReasonLabel(r.reason_kind)} — {r.reason_text}
      </span>
    ),
  },
  { header: "Dados", wide: true, cell: (r) => r.fields.map(exportGroupLabel).join(", ") },
  { header: "Pacientes", nowrap: true, cell: (r) => r.row_count },
];

/** Auditoria de exportações da base: só o admin da clínica (a RLS da tabela também só devolve linhas a ele). */
export function PatientExportsAudit({ clinicId }: { clinicId: string | null }) {
  const q = usePatientExports(clinicId, true);
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-ink" aria-hidden>
          <History className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">Exportações da base de pacientes</CardTitle>
          <CardDescription>Cada exportação da base fica registrada: quem, quando e por quê. Os dados exportados não ficam guardados aqui.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {q.isLoading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <EmptyState icon={History} title="Nenhuma exportação ainda" description="Quando alguém exportar a base de pacientes, aparece aqui." />
        ) : (
          <FinTable label="Exportações" rows={q.data} rowKey={(r) => r.id} columns={COLUMNS} />
        )}
      </CardContent>
    </Card>
  );
}
