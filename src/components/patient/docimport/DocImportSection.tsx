import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { ConferencePanel } from "./ConferencePanel";
import { preloadPdfRenderer } from "./pdfRenderer";
import { GatedAction } from "../GatedAction";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { useFinAccess } from "@/hooks/useFin";
import { friendlyDocReadError, readDocument, warmDocReader } from "@/lib/api/docRead";
import { confirmImport, ConferenceBlockedError, discardImport, freshProgress, ImportValidationError, type ConfirmProgress } from "@/lib/api/docImportConfirm";
import { getDocumentSignedUrl, removeDocumentObject, uploadPatientDocumentObject } from "@/lib/api/documents";
import { assessmentErrorMessage } from "@/lib/api/assessments";
import { isDisciplineDenied, writeDeniedMessage } from "@/lib/domain/disciplines";
import {
  DOC_KIND_SURFACE, IMPORT_BUTTON_LABEL, importAccess, initConference,
  type ConferenceState, type DocKind, type DocReadResult,
} from "@/lib/domain/docImport";
import { IMPORT_ACCEPT, prepareImportFile } from "@/lib/domain/docImportFile";
import { qk } from "@/lib/queryKeys";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import type { PatientDetail } from "@/types/db";

interface Session {
  readId: string;
  path: string;
  fileName: string;
  mime: string | null;
  size: number | null;
  result: DocReadResult;
  state: ConferenceState;
  previewUrl: string | null;
  isImage: boolean;
  /** Bytes do PDF enviado, para desenhar a prévia sem depender do leitor de PDF do navegador. */
  pdfBytes: ArrayBuffer | null;
}

const CONFIRM_LABEL: Record<DocKind, string> = {
  bioimpedancia: "Confirmar avaliação",
  dieta: "Confirmar e salvar plano",
  treino: "Confirmar e salvar treino",
};

const DONE_MESSAGE: Record<DocKind, string> = {
  bioimpedancia: "Avaliação criada a partir do documento. O PDF original ficou guardado em Documentos.",
  dieta: "Plano alimentar salvo a partir do documento. O PDF original ficou guardado em Documentos.",
  treino: "Treino salvo a partir do documento. O PDF original ficou guardado em Documentos.",
};

function uploadErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (/Formato n|muito grande|vazio|HEIC/i.test(m)) return m;
  return "Não foi possível enviar o arquivo. Verifique sua permissão e tente de novo.";
}

/**
 * Botão de importação + tela de Conferência (inline, como no protótipo). Nada vai para a ficha antes de o profissional
 * conferir e confirmar; quem não tem papel clínico nem vê o botão, e sem a disciplina do plano ele fica travado com o motivo.
 */
export function DocImportSection({ patient, kind }: { patient: PatientDetail; kind: DocKind }) {
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading } = useCurrentProfessional();
  const { perms, isLoading: permLoading } = useDisciplinePermissions();
  const { access, isLoading: accLoading } = useFinAccess(me?.clinicId ?? null);
  const gate = importAccess(kind, perms, access.isAdmin, access.roles.map((r) => r.role), meLoading || permLoading || accLoading);

  const fileRef = useRef<HTMLInputElement>(null);
  const progress = useRef<ConfirmProgress>(freshProgress());
  const [session, setSession] = useState<Session | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const today = todayIsoBR();

  if (!gate.visible) return null;

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDone(null);
    setReading(file.name);
    let path: string | null = null;
    try {
      const ready = await prepareImportFile(file);
      path = await uploadPatientDocumentObject(patient.id, ready);
      const isImage = ready.type.startsWith("image/");
      // Leitura, link do documento e bytes da prévia correm juntos (cada um é independente).
      const [answer, previewUrl, pdfBytes] = await Promise.all([
        readDocument(patient.id, kind, path),
        getDocumentSignedUrl(path).catch(() => null),
        isImage || typeof ready.arrayBuffer !== "function" ? Promise.resolve(null) : ready.arrayBuffer().catch(() => null),
      ]);
      progress.current = freshProgress();
      setSession({
        readId: answer.read_id, path, fileName: ready.name, mime: ready.type || null, size: ready.size,
        result: answer.result, state: initConference(answer.result), previewUrl, isImage, pdfBytes,
      });
    } catch (e) {
      if (path) void removeDocumentObject(path);
      setError(path ? friendlyDocReadError(e instanceof Error ? e.message : "") : uploadErrorMessage(e));
    } finally {
      setReading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onConfirm() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const out = await confirmImport({
        kind, patientId: patient.id, professionalId: me?.id ?? null, canWrite: gate.canWrite,
        readId: session.readId, path: session.path, mime: session.mime, size: session.size,
        result: session.result, state: session.state, today,
      }, progress.current);
      // Recarregar as listas não segura a tela: a mensagem de pronto aparece já.
      void Promise.all([
        qc.invalidateQueries({ queryKey: qk.bodyAssessments(patient.id) }),
        qc.invalidateQueries({ queryKey: qk.weightSeries(patient.id) }),
        qc.invalidateQueries({ queryKey: qk.nutritionPlan(patient.id) }),
        qc.invalidateQueries({ queryKey: qk.workoutPlan(patient.id) }),
        qc.invalidateQueries({ queryKey: qk.allPlans }),
        qc.invalidateQueries({ queryKey: qk.patientExams(patient.id) }),
        qc.invalidateQueries({ queryKey: qk.patientTimeline(patient.id) }),
      ]);
      setDone(DONE_MESSAGE[kind]);
      setSession(null);
      void out.traced.then((ok) => { if (!ok) setDone(DONE_MESSAGE[kind] + " O registro de quem confirmou não chegou; avise o suporte."); });
    } catch (e) {
      if (e instanceof ConferenceBlockedError || e instanceof ImportValidationError) setError(e.message);
      else if (isDisciplineDenied(e)) setError(writeDeniedMessage(e, DOC_KIND_SURFACE[kind]));
      else if (progress.current.wrote) setError("Os dados foram salvos, mas o documento não foi anexado em Documentos. Toque em Confirmar de novo para tentar só o anexo.");
      else setError(kind === "bioimpedancia" ? assessmentErrorMessage(e) : "Não foi possível salvar. Nada foi alterado. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function onDiscard() {
    if (!session) return;
    // Fecha na hora: nada foi gravado na ficha; o rastro e a remoção do arquivo seguem em segundo plano.
    const { readId, path } = session;
    setSession(null);
    setDone("Importação descartada. Nada foi salvo.");
    void discardImport(readId, path);
  }

  const cachedPlan = kind === "dieta" ? qc.getQueryData(qk.nutritionPlan(patient.id)) : kind === "treino" ? qc.getQueryData(qk.workoutPlan(patient.id)) : null;
  const replaceWarning = kind !== "bioimpedancia" && cachedPlan
    ? `Este paciente já tem ${kind === "dieta" ? "um plano alimentar" : "um plano de treino"}. Ao confirmar, o plano atual é substituído por este.`
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-end gap-3">
        <GatedAction
          canEdit={gate.canWrite}
          disabled={Boolean(reading) || Boolean(session)}
          reason={gate.reason ?? ""}
          wrapperClassName="items-end"
          variant="outline"
          size="sm"
          onClick={() => { warmDocReader(); void preloadPdfRenderer().catch(() => undefined); fileRef.current?.click(); }}
        >
          {reading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
          {IMPORT_BUTTON_LABEL[kind]}
        </GatedAction>
        <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} className="sr-only" aria-label={IMPORT_BUTTON_LABEL[kind]} data-testid={`import-file-${kind}`} onChange={(e) => void onPick(e.target.files?.[0])} />
      </div>
      {reading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Lendo o arquivo {reading}… {kind === "dieta" ? "Montando refeições." : kind === "treino" ? "Montando os dias de treino." : "Extraindo medidas."}
        </p>
      ) : null}
      {done ? <p role="status" className="text-sm text-success">{done}</p> : null}
      {error && !session ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {session ? (
        <ConferencePanel
          kind={kind} result={session.result} state={session.state} onChange={(s) => setSession((cur) => (cur ? { ...cur, state: s } : cur))}
          today={today} fileName={session.fileName} previewUrl={session.previewUrl} isImage={session.isImage} pdfBytes={session.pdfBytes}
          busy={busy} error={error} replaceWarning={replaceWarning} confirmLabel={CONFIRM_LABEL[kind]}
          onConfirm={() => void onConfirm()} onDiscard={() => void onDiscard()}
        />
      ) : null}
    </div>
  );
}
