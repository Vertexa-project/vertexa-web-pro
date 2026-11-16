import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { CheckField, Field, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useExportPatients } from "@/hooks/usePatientImportExport";
import { importExportErrorMessage } from "@/lib/api/patientImportExport";
import {
  EXPORT_GROUPS,
  EXPORT_NOTE,
  EXPORT_REASONS,
  EXPORT_REASON_MAX,
  buildExportCsv,
  exportDoneMessage,
  exportFilename,
  validateExportRequest,
  type ExportGroup,
  type ExportReasonKind,
} from "@/lib/domain/patientExport";
import { CSV_MIME, downloadBlob } from "@/lib/domain/tableExport";
import { todayIsoBR } from "@/lib/domain/stockMoves";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicId: string | null;
  /** Quantidade de pacientes ativos mostrada no cabeçalho (a RPC devolve a contagem real). */
  patientCount: number;
}

const ALL: ExportGroup[] = EXPORT_GROUPS.map((g) => g.key);

export function PatientExportDialog({ open, onOpenChange, clinicId, patientCount }: Props) {
  const [groups, setGroups] = useState<ExportGroup[]>(ALL);
  const [kind, setKind] = useState<ExportReasonKind | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; csv: string; filename: string } | null>(null);
  const exportMut = useExportPatients(clinicId);

  useEffect(() => {
    if (!open) return;
    setGroups(ALL);
    setKind("");
    setReason("");
    setError(null);
    setDone(null);
    exportMut.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(g: ExportGroup, on: boolean) {
    setGroups((prev) => (on ? [...prev, g] : prev.filter((x) => x !== g)));
  }

  async function submit() {
    const invalid = validateExportRequest({ groups, kind, reason });
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    try {
      // O servidor grava a auditoria e devolve as linhas na mesma transação; sem registro não há arquivo.
      const res = await exportMut.mutateAsync({ groups, kind: kind as ExportReasonKind, reason });
      const csv = buildExportCsv(groups, res.rows);
      const filename = exportFilename(todayIsoBR());
      downloadBlob(csv, filename, CSV_MIME);
      setDone({ message: exportDoneMessage(res.row_count), csv, filename });
    } catch (e) {
      setError(importExportErrorMessage(e, "Não foi possível exportar. Nada foi registrado nem baixado. Tente de novo."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Exportar base de pacientes</DialogTitle>
          <DialogDescription>
            {done ? "Arquivo gerado" : `${patientCount} ${patientCount === 1 ? "paciente" : "pacientes"} · padrão brasileiro, com vírgula decimal`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="min-w-0 space-y-4">
          {done ? (
            <div className="space-y-3">
              <p role="status" className="text-sm font-medium text-foreground">
                {done.message}
              </p>
              <p className="text-sm text-muted-foreground">
                Registrado em Configurações › Auditoria de exportações: quem, quando, motivo e quantidade — sem os dados.
              </p>
            </div>
          ) : (
            <>
              <fieldset className="min-w-0 space-y-2">
                <legend className="text-sm font-medium text-foreground">Quais dados</legend>
                {EXPORT_GROUPS.map((g) => (
                  <CheckField
                    key={g.key}
                    id={`exp-${g.key}`}
                    label={g.label}
                    hint={g.hint}
                    checked={groups.includes(g.key)}
                    onChange={(v) => toggle(g.key, v)}
                  />
                ))}
              </fieldset>
              <p className="text-sm text-muted-foreground">Só o papel Gestor exporta. {EXPORT_NOTE}</p>
              <Field label="Motivo da exportação" htmlFor="exp-kind">
                <NativeSelect id="exp-kind" value={kind} onChange={(e) => setKind(e.target.value as ExportReasonKind | "")} aria-invalid={error !== null && !kind ? true : undefined}>
                  <option value="">Escolha o motivo</option>
                  {EXPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Explique em poucas palavras" htmlFor="exp-reason" hint="Obrigatório. Fica registrado junto com o seu nome e a data.">
                <Input
                  id="exp-reason"
                  value={reason}
                  maxLength={EXPORT_REASON_MAX}
                  placeholder="Ex.: backup mensal da clínica"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <p className="text-sm text-warning-foreground dark:text-warning">O arquivo contém dados pessoais. Guarde em local seguro.</p>
              {error ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {done ? (
            <>
              <Button type="button" variant="outline" onClick={() => downloadBlob(done.csv, done.filename, CSV_MIME)}>
                <Download className="h-4 w-4" aria-hidden />
                Baixar de novo
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={exportMut.isPending} onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={exportMut.isPending} onClick={() => void submit()}>
                {exportMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                Exportar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
