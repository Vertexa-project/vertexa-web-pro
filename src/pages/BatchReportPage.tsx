import { useMemo, useState } from "react";
import { Download, Loader2, Users } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useListPatients } from "@/hooks/usePatients";
import { BATCH_REPORT_SECTIONS, MAX_BATCH_PATIENTS } from "@/lib/api/report";
import { captureException } from "@/lib/observability/sentry";

const PERIODS = [
  { value: "90", label: "Últimos 90 dias", days: 90 },
  { value: "180", label: "Últimos 6 meses", days: 180 },
  { value: "365", label: "Últimos 12 meses", days: 365 },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Exportação em LOTE (WP-REPORT B): seleciona VÁRIOS pacientes (dentre os que o profissional já vê) +
 * período e gera um PDF único (capa + 1 bloco por paciente). Cada paciente vira uma chamada da MESMA
 * RPC auditada (1 linha na trilha, mesmo batch_id). Falha parcial não aborta; o resultado informa quem
 * entrou e quem não. Teto de MAX_BATCH_PATIENTS pacientes.
 */
export function BatchReportPage() {
  const { data, isLoading, isError, refetch } = useListPatients();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periodValue, setPeriodValue] = useState("90");
  const [format, setFormat] = useState<"zip" | "single">("zip");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patients = useMemo(() => data ?? [], [data]);
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of patients) m[p.id] = p.profile?.full_name ?? "Paciente";
    return m;
  }, [patients]);

  const overLimit = selected.size > MAX_BATCH_PATIENTS;
  const allSelected = patients.length > 0 && selected.size === patients.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(patients.map((p) => p.id)));
  }

  async function handleExport() {
    setError(null);
    setResult(null);
    const ids = patients.map((p) => p.id).filter((id) => selected.has(id));
    if (ids.length === 0) {
      setError("Selecione ao menos um paciente.");
      return;
    }
    if (ids.length > MAX_BATCH_PATIENTS) {
      setError(`Selecione no máximo ${MAX_BATCH_PATIENTS} pacientes por lote.`);
      return;
    }
    const period = PERIODS.find((p) => p.value === periodValue) ?? PERIODS[0];
    const now = new Date();
    const from = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
    setGenerating(true);
    setProgress({ done: 0, total: ids.length });
    try {
      const { downloadBatchReport, downloadBatchZip } = await import("@/lib/pdf/generateBatchReport");
      const run = format === "zip" ? downloadBatchZip : downloadBatchReport;
      const outcome = await run(
        { patientIds: ids, from: ymd(from), to: ymd(now), sections: format === "zip" ? [] : BATCH_REPORT_SECTIONS, patientNames: nameById },
        (done, total) => setProgress({ done, total }),
        now,
      );
      setResult(
        outcome.failedIds.length === 0
          ? `Relatório gerado com ${outcome.includedCount} paciente(s).`
          : `Relatório gerado com ${outcome.includedCount} de ${outcome.total} paciente(s). ${outcome.failedIds.length} não incluído(s) (autorização negada ou erro).`,
      );
    } catch (err) {
      captureException(new Error("batch report failed"), { source: "report-export", scope: "batch" });
      setError("Não foi possível gerar o relatório em lote. Tente novamente.");
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exportar relatórios em lote"
        description={format === "zip" ? "Selecione pacientes e baixe um arquivo ZIP com um relatório PDF por paciente." : "Selecione pacientes e gere um PDF único com um bloco por paciente."}
        actions={
          <div className="flex items-center gap-2">
            <Select value={format} onValueChange={(v) => setFormat(v as "zip" | "single")} disabled={generating}>
              <SelectTrigger className="h-9 w-56" aria-label="Formato do relatório">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zip">Um PDF por paciente (ZIP)</SelectItem>
                <SelectItem value="single">PDF único (resumo)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={periodValue} onValueChange={setPeriodValue} disabled={generating}>
              <SelectTrigger className="h-9 w-40" aria-label="Período do relatório">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleExport} disabled={generating || selected.size === 0 || overLimit}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {generating && progress ? `Gerando ${progress.done} de ${progress.total}…` : "Exportar selecionados"}
            </Button>
          </div>
        }
      />

      {overLimit ? (
        <p className="text-sm text-destructive" role="alert">
          Selecione no máximo {MAX_BATCH_PATIENTS} pacientes por lote (selecionados: {selected.size}).
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {result ? <p className="text-sm text-foreground" role="status" aria-live="polite">{result}</p> : null}

      {isLoading ? (
        <TableSkeleton rows={5} cols={2} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : patients.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente" description="Você ainda não tem pacientes para exportar." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <label className="flex items-center gap-3 border-b px-4 py-3 text-sm font-medium">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={generating} aria-label="Selecionar todos" />
              Selecionar todos ({selected.size}/{patients.length})
            </label>
            <ul>
              {patients.map((p) => {
                const name = p.profile?.full_name ?? "Sem nome";
                return (
                  <li key={p.id} className="border-b last:border-b-0">
                    <label className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        disabled={generating}
                        aria-label={`Selecionar ${name}`}
                      />
                      <span className="text-foreground">{name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
