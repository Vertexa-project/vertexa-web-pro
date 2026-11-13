import { AlertTriangle, Loader2, Mic, MicOff, Pause, Play, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecordingApi } from "@/hooks/useEncounterRecording";
import type { EncounterStatus } from "@/lib/api/clinical";
import { formatClock } from "@/lib/clinical/chunking";

const MIC_TEXT: Record<string, string> = {
  denied: "O navegador bloqueou o microfone. Libere o acesso ao microfone nas permissões do site e tente de novo — ou preencha o prontuário à mão.",
  "no-device": "Nenhum microfone foi encontrado neste aparelho. Conecte um microfone ou preencha o prontuário à mão.",
  unsupported: "Este navegador não permite gravar áudio. Use o Chrome, Edge ou Safari atualizados — ou preencha o prontuário à mão.",
  other: "Não foi possível iniciar a gravação. Tente de novo ou preencha o prontuário à mão.",
};

export function RecorderPanel({ rec, status, previousMs }: { rec: RecordingApi; status: EncounterStatus; previousMs: number }) {
  const active = rec.phase === "recording";
  const paused = rec.phase === "paused";
  const finishing = rec.phase === "finishing";
  const sent = rec.pipeline.filter((p) => p.stage === "done").length;
  const sending = rec.pipeline.filter((p) => p.stage !== "done" && p.stage !== "failed").length;
  const interrupted = status === "gravando" && rec.phase === "idle";
  const time = rec.phase === "idle" ? previousMs : rec.elapsedMs;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {active ? <Mic className="h-4 w-4 text-destructive" aria-hidden /> : <MicOff className="h-4 w-4 text-muted-foreground" aria-hidden />}
          Gravação
          {active ? (
            <Badge tone="destructive" className="gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden /> Gravando
            </Badge>
          ) : paused ? (
            <Badge tone="warning">Pausada</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {active ? (
          <p role="status" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
            Esta consulta está sendo gravada.
          </p>
        ) : null}

        <div className="flex items-center gap-4">
          <span data-testid="rec-clock" className="font-mono text-2xl tabular-nums">
            {formatClock(time)}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label="Nível do áudio">
            <div className="h-full bg-primary transition-[width] duration-100" style={{ width: `${Math.round(rec.level * 100)}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {rec.phase === "idle" && !finishing ? (
            <Button onClick={() => void rec.start()} disabled={status === "processando"}>
              <Mic className="h-4 w-4" aria-hidden /> {interrupted || previousMs > 0 ? "Retomar gravação" : "Iniciar gravação"}
            </Button>
          ) : null}
          {active ? (
            <Button variant="outline" onClick={rec.pause}>
              <Pause className="h-4 w-4" aria-hidden /> Pausar
            </Button>
          ) : null}
          {paused ? (
            <Button variant="outline" onClick={rec.resume}>
              <Play className="h-4 w-4" aria-hidden /> Retomar
            </Button>
          ) : null}
          {active || paused ? (
            <Button variant="destructive" onClick={() => void rec.finish()}>
              <Square className="h-4 w-4" aria-hidden /> Encerrar
            </Button>
          ) : null}
          {interrupted && previousMs > 0 ? (
            <Button variant="secondary" onClick={() => void rec.finish()}>
              Encerrar e processar
            </Button>
          ) : null}
        </div>

        {rec.micError ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {MIC_TEXT[rec.micError]}
          </p>
        ) : null}
        {interrupted ? (
          <p className="text-sm text-muted-foreground">A gravação foi interrompida (a aba foi fechada ou recarregada). Os pedaços já enviados estão salvos.</p>
        ) : null}
        {rec.pipeline.length > 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="rec-progress">
            {sent} de {rec.pipeline.length} pedaços transcritos{sending > 0 ? ` · ${sending} em envio` : ""}
          </p>
        ) : null}
        {rec.failedChunks > 0 ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {rec.failedChunks} pedaço(s) não foram enviados (sem conexão?).
            <Button size="sm" variant="outline" onClick={rec.retryUploads}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {rec.working ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {rec.working}
          </p>
        ) : null}
        {status === "processando" && rec.phase === "idle" && !rec.working ? (
          <Button size="sm" variant="outline" onClick={() => void rec.reprocess()}>
            Concluir o processamento
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
