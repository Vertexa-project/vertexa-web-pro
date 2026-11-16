import { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { CheckField, FinTable, NativeSelect, type FinColumn } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useImportDedupeKeys, useImportPatients } from "@/hooks/usePatientImportExport";
import { importExportErrorMessage } from "@/lib/api/patientImportExport";
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABEL,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  buildCandidates,
  buildImportPayload,
  buildPreview,
  canForceDuplicate,
  countPreview,
  detectDuplicates,
  duplicateLabel,
  importButtonLabel,
  importResultMessage,
  suggestMapping,
  type ImportField,
  type PreviewRow,
} from "@/lib/domain/patientImport";
import { ImportFileError, readImportFile, type ParsedImportFile } from "@/lib/domain/patientImportFile";
import { CSV_MIME, downloadBlob } from "@/lib/domain/tableExport";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicId: string | null;
  /** Chamado com a mensagem de resultado quando a importação termina (a tela de Pacientes mostra no aviso). */
  onDone?: (message: string) => void;
}

type Step = 1 | 2 | 3 | 4;

const TEMPLATE_HEADERS = IMPORT_FIELDS.map((f) => f.label);
const TEMPLATE_ROWS = [
  ["Ana Exemplo", "ana.exemplo@email.com", "(17) 99812-3344", "10/05/1990", "Feminino", "Emagrecimento", "70,5", "165"],
  ["Bruno Exemplo", "bruno.exemplo@email.com", "(17) 99701-2201", "02/01/1985", "Masculino", "Hipertrofia", "88", "178"],
];

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map((r) => r.join(";")).join("\r\n");
  downloadBlob(`\uFEFF${csv}\r\n`, "modelo_importar_pacientes.csv", CSV_MIME);
}

const REASON_BADGE: Record<PreviewRow["status"], { label: string; tone: "success" | "destructive" | "warning" }> = {
  pronto: { label: "Pronto", tone: "success" },
  erro: { label: "Com erro", tone: "destructive" },
  duplicado: { label: "Possível duplicado", tone: "warning" },
};

export function PatientImportDialog({ open, onOpenChange, clinicId, onDone }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [manual, setManual] = useState<Set<number>>(new Set());
  const [forced, setForced] = useState<Set<number>>(new Set());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState<{ line: number; text: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const keys = useImportDedupeKeys(clinicId, open && step >= 3);
  const importMut = useImportPatients(clinicId);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setFile(null);
    setMapping([]);
    setManual(new Set());
    setForced(new Set());
    setOnlyProblems(false);
    setFileError(null);
    setSubmitError(null);
    setResultMessage(null);
    setLeftOut([]);
    importMut.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleFile(f: File | undefined | null) {
    if (!f) return;
    setFileError(null);
    setReading(true);
    try {
      const parsed = await readImportFile(f);
      setFile(parsed);
      setMapping(suggestMapping(parsed.headers));
      setManual(new Set());
      setForced(new Set());
      setStep(2);
    } catch (e) {
      setFileError(e instanceof ImportFileError ? e.message : "Não consegui ler este arquivo. Confira se é um .csv ou .xlsx.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const recognized = mapping.filter((m) => m !== null).length;
  const nameMapped = mapping.includes("name");

  function setColumnField(index: number, value: ImportField | null) {
    setMapping((prev) => prev.map((m, i) => (i === index ? value : value !== null && m === value ? null : m)));
    setManual((prev) => new Set(prev).add(index));
  }

  const preview = useMemo<PreviewRow[]>(() => {
    if (!file || step < 3 || !keys.data) return [];
    const candidates = buildCandidates(file.rows, mapping);
    return buildPreview(candidates, detectDuplicates(candidates, keys.data));
  }, [file, mapping, step, keys.data]);

  const counts = useMemo(() => countPreview(preview, forced), [preview, forced]);
  const shown = useMemo(() => (onlyProblems ? preview.filter((p) => p.status !== "pronto") : preview), [preview, onlyProblems]);

  function toggleForced(line: number, on: boolean) {
    setForced((prev) => {
      const next = new Set(prev);
      if (on) next.add(line);
      else next.delete(line);
      return next;
    });
  }

  async function confirm() {
    if (!file || counts.toImport === 0) return;
    setSubmitError(null);
    try {
      const rows = buildImportPayload(preview, forced);
      const res = await importMut.mutateAsync({ filename: file.filename, rows });
      // Ficaram de fora: duplicados que a prévia segurou (e a pessoa não liberou) + os que o servidor ainda barrou.
      const msg = importResultMessage({
        imported: res.imported,
        duplicates: counts.duplicates - counts.forcedCount + res.duplicates,
        errors: counts.errors + res.errors,
      });
      const byLine = new Map(preview.map((p) => [p.candidate.line, p]));
      const out: { line: number; text: string }[] = [];
      for (const p of preview) {
        if (p.status === "erro") out.push({ line: p.candidate.line, text: `${p.candidate.values.name || "Sem nome"} — ${p.candidate.errors.join(", ")}` });
        else if (p.status === "duplicado" && !forced.has(p.candidate.line)) out.push({ line: p.candidate.line, text: `${p.candidate.values.name} — ${duplicateLabel(p.duplicate!)}` });
      }
      for (const r of res.results) {
        if (r.status === "importado") continue;
        const p = byLine.get(r.line);
        out.push({ line: r.line, text: `${p?.candidate.values.name ?? "Linha " + r.line} — ${r.status === "duplicado" ? "já cadastrado (conferido pelo servidor)" : "dado inválido"}` });
      }
      out.sort((a, b) => a.line - b.line);
      setLeftOut(out);
      setResultMessage(msg);
      setStep(4);
      onDone?.(msg);
    } catch (e) {
      setSubmitError(importExportErrorMessage(e, "Não foi possível importar. Nada foi gravado. Tente de novo."));
    }
  }

  const columns: FinColumn<PreviewRow>[] = [
    { header: "Linha", cell: (p) => p.candidate.line, nowrap: true },
    { header: "Nome", role: "title", cell: (p) => p.candidate.values.name || <span className="text-muted-foreground">Sem nome</span> },
    { header: "Contato", wide: true, cell: (p) => [p.candidate.values.email, p.candidate.values.phone].filter(Boolean).join(" · ") || "—" },
    {
      header: "Situação",
      role: "badge",
      cell: (p) => <Badge tone={REASON_BADGE[p.status].tone}>{REASON_BADGE[p.status].label}</Badge>,
    },
    {
      header: "Detalhe",
      wide: true,
      className: "min-w-[14rem]",
      cell: (p) => {
        if (p.status === "erro") return <span className="text-destructive">{p.candidate.errors.join(" · ")}</span>;
        if (p.status === "duplicado" && p.duplicate) {
          return (
            <div className="space-y-1.5">
              <p className="text-warning-foreground dark:text-warning">{duplicateLabel(p.duplicate)}</p>
              {canForceDuplicate(p.duplicate) ? (
                <CheckField
                  id={`force-${p.candidate.line}`}
                  label="Importar mesmo assim"
                  checked={forced.has(p.candidate.line)}
                  onChange={(v) => toggleForced(p.candidate.line, v)}
                />
              ) : (
                <p className="text-xs text-muted-foreground">E-mail repetido não entra.</p>
              )}
            </div>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  const title = "Importar pacientes";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {step === 4 ? "Importação concluída" : `Passo ${step} de 3`} · nada é gravado sem a sua confirmação
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="min-w-0 space-y-4">
          {step === 1 ? (
            <div className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void handleFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="font-medium text-foreground">Solte aqui o CSV ou a planilha</p>
                <p className="text-sm text-muted-foreground">Exportado do Dietbox, WebDiet ou de uma planilha sua.</p>
                <input
                  ref={inputRef}
                  id="import-file"
                  type="file"
                  accept=".csv,.xlsx,.txt,.tsv"
                  className="sr-only"
                  aria-label="Arquivo de pacientes (CSV ou XLSX)"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
                <Button type="button" disabled={reading} onClick={() => inputRef.current?.click()}>
                  {reading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                  Escolher arquivo
                </Button>
              </div>
              {fileError ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {fileError}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Até {IMPORT_MAX_ROWS} pacientes e {Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB por arquivo. Linhas em branco são ignoradas.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                Baixar modelo de planilha
              </Button>
            </div>
          ) : null}

          {step === 2 && file ? (
            <div className="space-y-3">
              <div className="min-w-0 rounded-lg border p-3 text-sm">
                <p className="break-words font-medium text-foreground">{file.filename}</p>
                <p className="text-muted-foreground">
                  {file.rows.length} {file.rows.length === 1 ? "linha" : "linhas"} · {file.headers.length} {file.headers.length === 1 ? "coluna" : "colunas"} ·{" "}
                  {recognized} {recognized === 1 ? "ligada" : "ligadas"}
                </p>
              </div>
              <ul aria-label="Colunas do arquivo" className="min-w-0 space-y-2">
                {file.headers.map((h, i) => {
                  const field = mapping[i] ?? null;
                  const example = file.rows.find((r) => (r.cells[i] ?? "").trim() !== "")?.cells[i]?.trim();
                  return (
                    <li key={`${h}-${i}`} className="grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-foreground">{h || `Coluna ${i + 1}`}</p>
                        {example ? <p className="truncate text-xs text-muted-foreground">ex.: {example}</p> : null}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <NativeSelect
                          aria-label={`Campo para a coluna ${h || i + 1}`}
                          value={field ?? ""}
                          className="min-w-0 flex-1"
                          onChange={(e) => setColumnField(i, (e.target.value || null) as ImportField | null)}
                        >
                          <option value="">Sem campo (ignorar)</option>
                          {IMPORT_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </NativeSelect>
                        {field ? (
                          <Badge tone={manual.has(i) ? "primary" : "success"}>{manual.has(i) ? "Ajustada" : "Ligada"}</Badge>
                        ) : (
                          <Badge tone="muted">Ignorada</Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {!nameMapped ? (
                <p role="alert" className="text-sm font-medium text-warning-foreground dark:text-warning">
                  Ligue uma coluna a “{IMPORT_FIELD_LABEL.name}” para continuar.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            keys.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Conferindo duplicados na sua clínica…
              </p>
            ) : keys.isError ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm font-medium text-destructive">
                  Não consegui conferir os pacientes já cadastrados, então não é seguro importar agora.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => void keys.refetch()}>
                  Tentar de novo
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2" aria-label="Resumo da prévia">
                  <Badge tone="success">{counts.ready} {counts.ready === 1 ? "pronto" : "prontos"}</Badge>
                  <Badge tone="destructive">{counts.errors} com erro</Badge>
                  <Badge tone="warning">{counts.duplicates} {counts.duplicates === 1 ? "possível duplicado" : "possíveis duplicados"}</Badge>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setOnlyProblems((v) => !v)} aria-pressed={onlyProblems}>
                    {onlyProblems ? "Mostrar todas as linhas" : "Mostrar só as com problema"}
                  </Button>
                </div>
                {shown.length > 0 ? (
                  <FinTable label="Prévia da importação" rows={shown} rowKey={(p) => String(p.candidate.line)} columns={columns} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma linha com problema.</p>
                )}
                <p className="text-sm text-muted-foreground">
                  O duplicado não entra, a não ser que você marque “Importar mesmo assim”. Nenhum paciente é juntado a outro. Linha com erro não entra.
                  Não enviamos convite nem e-mail: o convite do app continua sendo uma ação sua, paciente a paciente.
                </p>
                {submitError ? (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {submitError}
                  </p>
                ) : null}
              </div>
            )
          ) : null}

          {step === 4 ? (
            <div className="space-y-3">
              <p role="status" className="text-base font-medium text-foreground">
                {resultMessage}
              </p>
              <p className="text-sm text-muted-foreground">Cada paciente importado mostra “Importado de {file?.filename}” na Timeline da ficha.</p>
              {leftOut.length > 0 ? (
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">Ficaram de fora</p>
                  <ul aria-label="Linhas que ficaram de fora" className="min-w-0 space-y-1 text-sm text-muted-foreground">
                    {leftOut.map((l) => (
                      <li key={l.line} className="break-words">
                        Linha {l.line}: {l.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {step === 1 ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          ) : null}
          {step === 2 ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button type="button" disabled={!nameMapped} onClick={() => setStep(3)}>
                Conferir prévia
              </Button>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Button type="button" variant="outline" disabled={importMut.isPending} onClick={() => setStep(2)}>
                Voltar
              </Button>
              <Button type="button" disabled={counts.toImport === 0 || importMut.isPending || keys.isLoading || keys.isError} onClick={() => void confirm()}>
                {importMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {importButtonLabel(counts.toImport)}
              </Button>
            </>
          ) : null}
          {step === 4 ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
