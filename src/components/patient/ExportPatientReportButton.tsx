import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_REPORT_SECTIONS, isReportAuthzError } from "@/lib/api/report";
import { validateCustomPeriod } from "@/lib/domain/reportPeriod";
import { captureException } from "@/lib/observability/sentry";

// Janela ≤ 366 dias (limite da RPC). Sem "todo o período".
const CUSTOM = "custom";
const PERIODS: Array<{ value: string; label: string; days: number }> = [
  { value: "30", label: "Últimos 30 dias", days: 30 },
  { value: "90", label: "Últimos 90 dias", days: 90 },
  { value: "180", label: "Últimos 6 meses", days: 180 },
  { value: "365", label: "Últimos 12 meses", days: 365 },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Botão "Relatório completo (PDF)". O ÚNICO caminho para o pacote é a RPC export_patient_report
 * (autoriza + audita + retorna); a partir do JSON monta o PDF no client. Autorização negada (42501)
 * → mensagem clara + Sentry source:"authz" (SEM PII). Período default: 90 dias.
 */
export function ExportPatientReportButton({ patientId }: { patientId: string }) {
  const [periodValue, setPeriodValue] = useState<string>("90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setGenerating(true);
    try {
      const now = new Date();
      let fromYmd: string;
      let toYmd: string;
      if (periodValue === CUSTOM) {
        const invalid = validateCustomPeriod(customFrom, customTo, ymd(now));
        if (invalid) {
          setError(invalid);
          setGenerating(false);
          return;
        }
        fromYmd = customFrom;
        toYmd = customTo;
      } else {
        const period = PERIODS.find((p) => p.value === periodValue) ?? PERIODS[1];
        fromYmd = ymd(new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000));
        toYmd = ymd(now);
      }
      // Lazy: @react-pdf só entra no bundle ao exportar de fato.
      const { downloadPatientReport } = await import("@/lib/pdf/generatePatientReport");
      await downloadPatientReport(
        { patientId, from: fromYmd, to: toYmd, sections: DEFAULT_REPORT_SECTIONS, surface: "web" },
        now,
      );
    } catch (err) {
      if (isReportAuthzError(err)) {
        // A1: negação reportada como authz, SEM PII (sem nome/id de paciente em texto livre).
        captureException(new Error("patient report export denied"), { source: "authz", scope: "report-export" });
        setError("Você não tem permissão para exportar este paciente.");
      } else {
        captureException(new Error("patient report export failed"), { source: "report-export" });
        setError("Não foi possível gerar o relatório. Tente novamente.");
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
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
            <SelectItem value={CUSTOM}>Personalizado…</SelectItem>
          </SelectContent>
        </Select>
        {periodValue === CUSTOM ? (
          <>
            <input
              type="date"
              aria-label="Data inicial do relatório"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={customFrom}
              max={customTo || undefined}
              disabled={generating}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              aria-label="Data final do relatório"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={customTo}
              min={customFrom || undefined}
              disabled={generating}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        ) : null}
        <Button variant="outline" size="sm" onClick={handleExport} disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {generating ? "Gerando…" : "Relatório completo (PDF)"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
