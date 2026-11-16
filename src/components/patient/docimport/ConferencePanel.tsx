import { ExternalLink, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  conferenceStatus, DEMO_BADGE, DOC_KIND_LABEL, fieldError, markChecked, pickOption, setFieldValue,
  type ConferenceState, type DocKind, type DocReadResult, type ReadField,
} from "@/lib/domain/docImport";
import { cn } from "@/lib/utils";
import { PdfPagesPreview } from "./PdfPagesPreview";

interface Props {
  kind: DocKind;
  result: DocReadResult;
  state: ConferenceState;
  onChange: (next: ConferenceState) => void;
  today: string;
  fileName: string;
  previewUrl: string | null;
  isImage: boolean;
  /** PDF enviado: a prévia é desenhada a partir destes bytes (o iframe de PDF falha no celular). */
  pdfBytes?: ArrayBuffer | null;
  busy: boolean;
  error: string | null;
  /** Aviso fixo acima do rodapé (ex.: "o plano atual será substituído"). */
  replaceWarning?: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  onDiscard: () => void;
}

const SUB_LABEL: Record<string, string> = { sets: "Séries", reps: "Repetições", load: "Carga (kg)" };

interface FieldBoxProps {
  kind: DocKind;
  result: DocReadResult;
  state: ConferenceState;
  field: ReadField;
  today: string;
  label: string;
  disabled: boolean;
  onChange: (n: ConferenceState) => void;
  compact?: boolean;
}

/** Detalhes de um campo: motivo, alternativas, "Conferido" e fonte (página/trecho). */
function FieldExtras({ kind, result, state, field, today, label, disabled, onChange, showSource = true }: Omit<FieldBoxProps, "compact"> & { showSource?: boolean }) {
  const pending = field.uncertain && !state.checked[field.key];
  const err = fieldError(kind, field, state, today);
  const value = state.values[field.key] ?? "";
  const id = `conf-${field.key}`;
  return (
    <div id={`${id}-info`} className="mt-1.5 space-y-1">
      {pending && field.reason ? <p className="text-xs text-primary-ink">{label ? `${label}: ` : ""}{field.reason}</p> : null}
      {err && value.trim() !== "" ? (
        <p className="text-xs text-destructive" role="alert">
          {err}
        </p>
      ) : null}
      {field.options && pending ? (
        <div className="flex flex-wrap gap-1.5" aria-label={`Valores lidos para ${label}`}>
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              disabled={disabled}
              onClick={() => onChange(pickOption(kind, result, state, field.key, o, today))}
              className="rounded-full border border-primary/50 px-2.5 py-0.5 text-xs font-medium text-primary-ink hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {o}
            </button>
          ))}
        </div>
      ) : null}
      {pending ? (
        <Button type="button" size="sm" variant="outline" aria-label={`Conferido, está certo: ${label}`} disabled={disabled || Boolean(err) || value.trim() === ""} onClick={() => onChange(markChecked(kind, result, state, field.key, today))}>
          Conferido, está certo
        </Button>
      ) : null}
      {showSource ? (
        field.source ? (
          <p className="break-words text-xs text-muted-foreground">
            Fonte: {field.page ? `página ${field.page} · ` : ""}«{field.source}»
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{field.value == null ? "Não encontrado no documento." : "Sem trecho de origem."}</p>
        )
      ) : null}
    </div>
  );
}

/** Um campo: valor editável, fonte (página/trecho) e, se incerto, laranja + "conferir" até o profissional confirmar. */
function FieldBox(props: FieldBoxProps) {
  const { kind, result, state, field, today, label, disabled, onChange, compact } = props;
  const pending = field.uncertain && !state.checked[field.key];
  const done = field.uncertain && state.checked[field.key];
  const err = fieldError(kind, field, state, today);
  const id = `conf-${field.key}`;
  const value = state.values[field.key] ?? "";
  return (
    <div
      data-testid={`field-${field.key}`}
      data-uncertain={pending ? "true" : "false"}
      className={cn("min-w-0 rounded-md border p-3", compact && "p-2", pending ? "border-primary bg-primary/5" : "border-border")}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label htmlFor={id} className={cn("text-sm font-medium", compact && "text-xs", pending ? "text-primary-ink" : "text-foreground")}>
          {label}
          {field.unit && !compact ? <span className="font-normal text-muted-foreground"> ({field.unit})</span> : null}
        </label>
        {pending ? <span className="text-xs font-semibold text-primary-ink">conferir</span> : null}
        {done ? <Badge tone="success">conferido</Badge> : null}
      </div>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        inputMode={field.options || /(time|data)$/.test(field.key) ? "text" : "decimal"}
        aria-invalid={err ? true : undefined}
        aria-describedby={`${id}-info`}
        className={cn("mt-1.5 h-9", compact && "px-2", pending && "border-primary")}
        onChange={(e) => onChange(setFieldValue(result, state, field.key, e.target.value))}
      />
      {compact ? null : <FieldExtras {...props} />}
    </div>
  );
}

export function ConferencePanel(p: Props) {
  const status = conferenceStatus(p.kind, p.result, p.state, p.today);
  const common = { kind: p.kind, result: p.result, state: p.state, today: p.today, disabled: p.busy, onChange: p.onChange };
  const groups = p.result.groups;

  function body() {
    if (p.kind === "bioimpedancia") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {p.result.fields.map((f) => (
            <FieldBox key={f.key} {...common} field={f} label={f.label} />
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {groups.map((g) => {
          const fields = p.result.fields.filter((f) => f.group === g.id);
          return (
            <section key={g.id} aria-label={g.title} className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">
                {g.title}
                {g.subtitle ? <span className="font-normal text-muted-foreground"> · {g.subtitle}</span> : null}
              </h4>
              {p.kind === "dieta" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map((f) => (
                    <FieldBox key={f.key} {...common} field={f} label={f.label} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {[...new Set(fields.map((f) => f.key.split(".").slice(0, 2).join(".")))].map((ek) => {
                    const subs = fields.filter((f) => f.key.startsWith(`${ek}.`));
                    const name = subs[0]?.label.split(" · ")[0] ?? ek;
                    return (
                      <div key={ek} className="rounded-md border p-2" role="group" aria-label={name}>
                        <p className="mb-2 break-words text-sm font-medium text-foreground">{name}</p>
                        <div className="grid grid-cols-3 gap-2">
                          {subs.map((f) => (
                            <FieldBox key={f.key} {...common} field={f} compact label={SUB_LABEL[f.key.split(".")[2]] ?? f.label} />
                          ))}
                        </div>
                        {subs.filter((f) => f.uncertain && !p.state.checked[f.key]).map((f) => (
                          <FieldExtras key={f.key} {...common} field={f} label={SUB_LABEL[f.key.split(".")[2]] ?? f.label} showSource={false} />
                        ))}
                        {subs[0]?.source ? (
                          <p className="mt-1.5 break-words text-xs text-muted-foreground">
                            Fonte: {subs[0].page ? `página ${subs[0].page} · ` : ""}«{subs[0].source}»
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <Card className="border-primary/40" data-testid="conferencia" role="region" aria-label="Conferência da leitura">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Conferência · lido pela Vertexa IA</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="warning">Nada foi salvo ainda</Badge>
            {p.result.mode === "demo" ? <Badge tone="muted">Modo demonstração</Badge> : null}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Leitura de {DOC_KIND_LABEL[p.kind].toLowerCase()} a partir do arquivo <span className="break-all font-medium text-foreground">{p.fileName}</span>. Confira cada valor com o
          {" "}documento ao lado antes de confirmar. A Vertexa IA não diagnostica nem prescreve.
        </p>
        {p.result.mode === "demo" ? <p className="text-xs text-muted-foreground">{DEMO_BADGE}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {p.result.notice ? (
          <p role="status" className="rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
            {p.result.notice}
          </p>
        ) : null}
        {p.result.warnings.map((w) => (
          <p key={w} role="alert" className="rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
            {w}
          </p>
        ))}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Documento enviado</h3>
            <div className="relative overflow-hidden rounded-md border bg-muted/30">
              {p.previewUrl && p.isImage ? (
                <img src={p.previewUrl} alt="Documento enviado" className="max-h-[480px] w-full object-contain" />
              ) : p.pdfBytes ? (
                <PdfPagesPreview bytes={p.pdfBytes} />
              ) : p.previewUrl ? (
                <iframe src={p.previewUrl} title="Documento enviado" className="h-72 w-full lg:h-[480px]" />
              ) : (
                <div className="flex h-40 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                  <FileText className="h-6 w-6" aria-hidden />
                  Não consegui mostrar o documento aqui.
                </div>
              )}
            </div>
            {p.previewUrl ? (
              <a href={p.previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary-ink underline-offset-4 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Abrir o documento em outra aba
              </a>
            ) : null}
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Campos lidos</h3>
            {p.result.fields.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum campo foi lido.</p> : body()}
            {p.result.unrecognized.length > 0 ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{p.result.unrecognized.length} {p.result.unrecognized.length === 1 ? "linha não entendida" : "linhas não entendidas"}</summary>
                <ul className="mt-1 list-inside list-disc break-words">
                  {p.result.unrecognized.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>

        {p.replaceWarning ? (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
            {p.replaceWarning}
          </p>
        ) : null}
        {p.error ? (
          <p role="alert" className="text-sm text-destructive">
            {p.error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <span className="mr-auto min-w-0 text-sm text-muted-foreground" aria-live="polite">
            {status.hint}
          </span>
          <Button type="button" variant="outline" disabled={p.busy} onClick={p.onDiscard}>
            Descartar
          </Button>
          <Button type="button" disabled={!status.canConfirm || p.busy} onClick={p.onConfirm}>
            {p.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {p.confirmLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
