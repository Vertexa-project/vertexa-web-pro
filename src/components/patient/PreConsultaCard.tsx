// Pré-consulta (A1) no Resumo da ficha: status, respostas, exames anexados e "Resumo para a consulta" (modo demonstração).
import { useState } from "react";
import { ClipboardList, FileText, Send, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCancelPreConsulta, useOpenPreConsultaFile, usePreConsultaFiles, usePreConsultas, useSendPreConsulta,
} from "@/hooks/usePreConsulta";
import { answeredPairs, buildSummary, currentOf, dayMonthBR, statusText, type PreConsultaRow } from "@/lib/domain/preConsulta";

const TONE: Record<PreConsultaRow["status"], "success" | "primary" | "muted" | "warning"> = {
  respondida: "success", enviada: "primary", rascunho: "warning", cancelada: "muted",
};

function Details({ row }: { row: PreConsultaRow }) {
  const files = usePreConsultaFiles(row.id);
  const open = useOpenPreConsultaFile();
  const [error, setError] = useState<string | null>(null);
  const pairs = answeredPairs(row);
  const fileList = files.data ?? [];
  const summary = row.status === "respondida" ? buildSummary(row, fileList.length) : [];

  const openFile = (path: string) => {
    setError(null);
    open.mutateAsync(path).then((url) => window.open(url, "_blank", "noopener,noreferrer")).catch(() => setError("Não foi possível abrir o arquivo."));
  };

  return (
    <div className="space-y-4">
      {summary.length > 0 ? (
        <section aria-label="Resumo para a consulta" className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary-ink" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Resumo para a consulta</h3>
            <Badge tone="muted">Modo demonstração</Badge>
          </div>
          <ul className="space-y-1 text-sm text-foreground">
            {summary.map((l) => <li key={l} className="break-words">{l}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Só o que o paciente respondeu, resumido sem inventar nada.</p>
        </section>
      ) : null}

      {pairs.length > 0 ? (
        <dl className="space-y-3">
          {pairs.map(({ q, a }) => (
            <div key={q.id}>
              <dt className="text-xs font-medium text-muted-foreground">{q.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      ) : row.status === "respondida" ? <p className="text-sm text-muted-foreground">O paciente enviou só exames, sem respostas escritas.</p>
        : <p className="text-sm text-muted-foreground">Ainda sem respostas. Quando o paciente enviar, elas aparecem aqui.</p>}

      {fileList.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Exames enviados (também em Documentos)</p>
          <ul className="space-y-1">
            {fileList.map((f) => (
              <li key={f.document_id}>
                <button type="button" onClick={() => openFile(f.file_path)} className="flex min-w-0 items-center gap-2 text-left text-sm text-primary-ink underline-offset-2 hover:underline">
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="break-all">{f.title ?? "Exame"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function PreConsultaCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = usePreConsultas(patientId);
  const send = useSendPreConsulta(patientId);
  const cancel = useCancelPreConsulta(patientId);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = currentOf(data ?? []);
  const pending = row && (row.status === "enviada" || row.status === "rascunho");

  const onSend = () => {
    setError(null);
    setNotice(null);
    send.mutateAsync()
      .then((r) => setNotice(r.created ? "Pré-consulta enviada ao app do paciente." : "Já existe uma pré-consulta para esta consulta."))
      .catch(() => setError("Não foi possível enviar. Tente novamente."));
  };
  const onCancel = () => {
    if (!row) return;
    setError(null);
    setNotice(null);
    cancel.mutateAsync(row.id).then(() => setNotice("Pedido cancelado.")).catch(() => setError("Não foi possível cancelar. Tente novamente."));
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          Pré-consulta
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={cancel.isPending}>
              <X className="h-4 w-4" aria-hidden />
              Cancelar pedido
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onSend} disabled={send.isPending}>
              <Send className="h-4 w-4" aria-hidden />
              Enviar pré-consulta
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar.{" "}
            <button type="button" className="underline" onClick={() => refetch()}>Tentar de novo</button>
          </p>
        ) : !row ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma pré-consulta enviada. O paciente recebe no app uma ficha curta e o pedido de exames antes da consulta.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[row.status]}>{statusText(row)}</Badge>
              {row.appointment_starts_at ? <span className="text-sm text-muted-foreground">Consulta de {dayMonthBR(row.appointment_starts_at)}</span> : null}
              <span className="text-xs text-muted-foreground">{row.source === "auto" ? "Enviada automaticamente" : "Enviada pela equipe"}</span>
            </div>
            <Details row={row} />
          </>
        )}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
