import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { ConsentCard } from "@/components/clinical/ConsentCard";
import { FinalizedActions } from "@/components/clinical/FinalizedActions";
import { RecordEditor } from "@/components/clinical/RecordEditor";
import { RecorderPanel } from "@/components/clinical/RecorderPanel";
import { TranscriptPanel } from "@/components/clinical/TranscriptPanel";
import { ErrorState } from "@/components/feedback/ErrorState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clinicalKeys, useChunks, useEncounter, usePeople, useRecord, useSegments } from "@/hooks/useClinical";
import { useClinic } from "@/hooks/useClinic";
import { useEncounterRecording } from "@/hooks/useEncounterRecording";
import { usePatient } from "@/hooks/usePatients";
import {
  cancelEncounter,
  clinicalErrorMessage,
  type EncounterStatus,
  finalizeEncounter,
  recordConsent,
  saveField,
  unlockField,
} from "@/lib/api/clinical";
import { resolveChunkMs } from "@/lib/clinical/chunking";
import { formatDateTimeBr } from "@/lib/clinical/display";
import { DEMO_BANNER } from "../../supabase/functions/_shared/clinical/demoScript";

const STATUS_LABEL: Record<EncounterStatus, { label: string; tone: "muted" | "destructive" | "warning" | "success" | "info" }> = {
  rascunho: { label: "Rascunho", tone: "info" },
  gravando: { label: "Gravando", tone: "destructive" },
  processando: { label: "Processando", tone: "warning" },
  finalizado: { label: "Finalizado", tone: "success" },
  cancelado: { label: "Cancelado", tone: "muted" },
};

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export function EncounterPage() {
  const { id: patientId = "", encounterId = "" } = useParams();
  const [search] = useSearchParams();
  const chunkMs = resolveChunkMs(search.get("chunk"));
  const qc = useQueryClient();

  const encQ = useEncounter(encounterId, true);
  const enc = encQ.data ?? null;
  const live = enc ? enc.status === "gravando" || enc.status === "processando" : false;
  const recordQ = useRecord(encounterId, live);
  const segQ = useSegments(encounterId, live);
  const chunkQ = useChunks(encounterId, live);
  const patientQ = usePatient(patientId);
  const clinicQ = useClinic(enc?.clinic_id);
  const peopleQ = usePeople(encounterId, enc?.status);

  const [highlight, setHighlight] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const segments = useMemo(() => segQ.data ?? [], [segQ.data]);
  const ordIndex = useMemo(() => new Map(segments.map((s, i) => [s.ord, i + 1])), [segments]);
  const chunks = useMemo(() => chunkQ.data ?? [], [chunkQ.data]);

  // O hook precisa de um encontro; antes de carregar usa um placeholder inerte.
  const rec = useEncounterRecording(
    enc ?? ({ id: encounterId, clinic_id: "", status: "rascunho" } as NonNullable<typeof enc>),
    chunks,
    chunkMs,
  );

  if (encQ.isLoading) return <PageSkeleton />;
  if (encQ.isError || !enc) {
    return (
      <ErrorState
        title="Atendimento não encontrado"
        description="O atendimento não existe ou você não tem acesso ao prontuário deste paciente."
        onRetry={() => void encQ.refetch()}
      />
    );
  }

  const editable = enc.status !== "finalizado" && enc.status !== "cancelado";
  const finalized = enc.status === "finalizado";
  const consent = enc.consent_given_at != null;
  const demo = enc.is_demo || segments.some((s) => s.is_demo);
  const fields = recordQ.data?.fields ?? {};
  const warning = recordQ.data?.ai_warning;
  const patientName = patientQ.data?.profile?.full_name ?? "Paciente";
  const previousMs = chunks.reduce((n, c) => n + (c.duration_ms ?? 0), 0);
  const st = STATUS_LABEL[enc.status];
  const refresh = () => qc.invalidateQueries({ queryKey: ["clinical"] });

  async function run(fn: () => Promise<void>) {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(clinicalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/pacientes/${patientId}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar à ficha
          </Link>
        </Button>
        <h1 className="min-w-0 break-words text-xl font-semibold">Atendimento · {patientName}</h1>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-sm text-muted-foreground">{formatDateTimeBr(enc.started_at)}</span>
      </div>

      {demo ? (
        <p role="status" data-testid="demo-banner" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm font-medium text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {DEMO_BANNER}
        </p>
      ) : null}
      {warning ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {warning}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="contents lg:col-start-1 lg:row-start-1 lg:block lg:space-y-4 lg:self-start">
          <div className="order-1 space-y-4 lg:order-none">
          {editable && !consent ? (
            <ConsentCard onConfirm={(v, t) => run(() => recordConsent(enc.id, v, t))} error={null} />
          ) : null}
          {editable && consent ? <RecorderPanel rec={rec} status={enc.status} previousMs={previousMs} /> : null}
          {finalized ? (
            <FinalizedActions encounter={enc} fields={fields} people={peopleQ.data} patientName={patientName} clinicName={clinicQ.data?.name ?? "Clínica"} />
          ) : null}
          {enc.status === "cancelado" ? <p className="text-sm text-muted-foreground">Atendimento cancelado.</p> : null}
          </div>
          <div className="order-3 lg:order-none">
            <TranscriptPanel segments={segments} loading={segQ.isLoading} highlightOrd={highlight} live={live || consent} />
          </div>
        </div>

        <div className="order-2 space-y-4 lg:order-none lg:col-start-2 lg:row-start-1">
          {recordQ.isLoading ? (
            <PageSkeleton />
          ) : recordQ.isError ? (
            <ErrorState title="Não foi possível carregar o prontuário" onRetry={() => void recordQ.refetch()} />
          ) : (
            <RecordEditor
              sections={enc.template_snapshot.sections}
              fields={fields}
              readOnly={!editable}
              ordIndex={ordIndex}
              people={peopleQ.data}
              startedAt={enc.started_at}
              onSave={async (k, v) => {
                await saveField(enc.id, k, v);
                await qc.invalidateQueries({ queryKey: clinicalKeys.record(enc.id) });
              }}
              onUnlock={async (k) => {
                await unlockField(enc.id, k);
                await qc.invalidateQueries({ queryKey: clinicalKeys.record(enc.id) });
              }}
              onSourceClick={setHighlight}
            />
          )}

          {editable ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
              <Button onClick={() => setConfirmFinalize(true)} disabled={busy || enc.status !== "rascunho"}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Finalizar atendimento
              </Button>
              <Button variant="outline" onClick={() => void rec.reprocess()} disabled={enc.status === "gravando" || !!rec.working}>
                Reprocessar com a IA
              </Button>
              <Button variant="ghost" onClick={() => setConfirmCancel(true)} disabled={busy || enc.status === "gravando"}>
                Cancelar atendimento
              </Button>
              {enc.status !== "rascunho" ? <span className="text-xs text-muted-foreground">Para finalizar, encerre a gravação e aguarde o processamento.</span> : null}
            </div>
          ) : null}
        </div>

      </div>

      <AlertDialog open={confirmFinalize} onOpenChange={setConfirmFinalize}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar o atendimento?</AlertDialogTitle>
            <AlertDialogDescription>
              Depois de finalizado, o prontuário não pode mais ser editado. Correções só por adendo, com autor e data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(() => finalizeEncounter(enc.id))}>Finalizar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar o atendimento?</AlertDialogTitle>
            <AlertDialogDescription>O atendimento fica registrado como cancelado e não poderá mais ser editado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(() => cancelEncounter(enc.id))}>Cancelar atendimento</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
