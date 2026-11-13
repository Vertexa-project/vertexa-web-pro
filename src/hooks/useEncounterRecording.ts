import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { clinicalKeys } from "@/hooks/useClinical";
import {
  type ChunkRow,
  type Encounter,
  registerChunk,
  setEncounterStatus,
  structureEncounter,
  transcribeChunk,
  uploadAudioChunk,
} from "@/lib/api/clinical";
import { ChunkedRecorder, MicError, type MicErrorKind } from "@/lib/clinical/audioRecorder";
import { ChunkPipeline, type ChunkState, type PipelineChunk } from "@/lib/clinical/chunkPipeline";
import { chunkStoragePath } from "@/lib/clinical/chunking";

export type RecorderPhase = "idle" | "recording" | "paused" | "finishing";

export interface RecordingApi {
  phase: RecorderPhase;
  level: number;
  elapsedMs: number;
  micError: MicErrorKind | null;
  pipeline: ChunkState[];
  failedChunks: number;
  structuring: boolean;
  working: string | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  finish: () => Promise<void>;
  retryUploads: () => void;
  /** Termina de transcrever pedaços pendentes e reorganiza o prontuário (também depois de recarregar a aba). */
  reprocess: () => Promise<void>;
}

/** Orquestra gravador + fila de envio + estruturação do prontuário para UM atendimento. */
export function useEncounterRecording(encounter: Encounter, chunks: ChunkRow[], chunkMs: number): RecordingApi {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [micError, setMicError] = useState<MicErrorKind | null>(null);
  const [pipeline, setPipeline] = useState<ChunkState[]>([]);
  const [structuring, setStructuring] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const pipelineRef = useRef<ChunkPipeline | null>(null);
  const structRef = useRef<{ running: boolean; dirty: boolean; promise: Promise<void> | null }>({ running: false, dirty: false, promise: null });
  const baseMsRef = useRef(0);
  const encId = encounter.id;
  const clinicId = encounter.clinic_id;

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: clinicalKeys.all(encId) });
    for (const k of ["encounter", "record", "segments", "chunks"] as const) {
      void qc.invalidateQueries({ queryKey: clinicalKeys[k](encId) });
    }
  }, [qc, encId]);

  const runStructure = useCallback((): Promise<void> => {
    const st = structRef.current;
    // Já organizando: marca para rodar de novo e devolve a MESMA espera, para quem chama
    // (ex.: encerrar) só seguir quando o prontuário estiver de fato preenchido.
    if (st.running) {
      st.dirty = true;
      return st.promise ?? Promise.resolve();
    }
    st.running = true;
    setStructuring(true);
    st.promise = (async () => {
      try {
        do {
          st.dirty = false;
          try {
            await structureEncounter(encId);
          } catch {
            // o aviso aparece na tela pelo ai_warning / próximo ciclo
          }
          refresh();
        } while (st.dirty);
      } finally {
        st.running = false;
        st.promise = null;
        setStructuring(false);
      }
    })();
    return st.promise;
  }, [encId, refresh]);

  const getPipeline = useCallback((): ChunkPipeline => {
    if (!pipelineRef.current) {
      pipelineRef.current = new ChunkPipeline(
        {
          upload: (c) => uploadAudioChunk(chunkStoragePath(clinicId, encId, c.seq, c.ext), c.blob, c.uploadMime),
          register: (c) =>
            registerChunk(encId, c.seq, chunkStoragePath(clinicId, encId, c.seq, c.ext), c.uploadMime, c.blob.size, c.durationMs),
          transcribe: async (id) => {
            await transcribeChunk(id);
          },
        },
        {
          onChange: setPipeline,
          onTranscribed: () => {
            refresh();
            void runStructure();
          },
        },
      );
    }
    return pipelineRef.current;
  }, [clinicId, encId, refresh, runStructure]);

  // tempo corrido (já gravado antes + gravador atual)
  useEffect(() => {
    baseMsRef.current = chunks.reduce((n, c) => n + (c.duration_ms ?? 0), 0);
  }, [chunks]);
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const t = setInterval(() => setElapsedMs(baseMsRef.current + (recorderRef.current?.elapsedMs() ?? 0)), 500);
    return () => clearInterval(t);
  }, [phase]);

  // não perder pedaços ainda não enviados ao fechar a aba
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (phase === "recording" || phase === "paused" || (pipelineRef.current?.pending() ?? 0) > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
    },
    [],
  );

  const start = useCallback(async () => {
    setMicError(null);
    const nextSeq = chunks.reduce((m, c) => Math.max(m, c.seq + 1), 0);
    const pipe = getPipeline();
    const rec = new ChunkedRecorder(chunkMs, { onChunk: (c) => pipe.enqueue(c as PipelineChunk), onLevel: setLevel }, nextSeq);
    try {
      await rec.start();
    } catch (e) {
      setMicError(e instanceof MicError ? e.kind : "other");
      return;
    }
    recorderRef.current = rec;
    setPhase("recording");
    try {
      await setEncounterStatus(encId, "gravando");
    } catch {
      // segue gravando; o status é reconciliado ao encerrar
    }
    refresh();
  }, [chunks, chunkMs, getPipeline, encId, refresh]);

  const pause = useCallback(() => {
    recorderRef.current?.pause();
    setPhase("paused");
  }, []);
  const resume = useCallback(() => {
    recorderRef.current?.resume();
    setPhase("recording");
  }, []);

  const settle = useCallback(async () => {
    const pipe = getPipeline();
    setWorking("Enviando e transcrevendo o áudio…");
    await pipe.idle();
    if (pipe.failed() > 0) {
      setWorking(null);
      return false;
    }
    setWorking("Organizando o prontuário…");
    await runStructure();
    await setEncounterStatus(encId, "rascunho");
    setWorking(null);
    refresh();
    return true;
  }, [getPipeline, runStructure, encId, refresh]);

  const finish = useCallback(async () => {
    setPhase("finishing");
    recorderRef.current?.stop();
    recorderRef.current = null;
    setLevel(0);
    try {
      await setEncounterStatus(encId, "processando");
    } catch {
      // já estava em processamento
    }
    refresh();
    await settle();
    setPhase("idle");
  }, [encId, refresh, settle]);

  const retryUploads = useCallback(() => {
    pipelineRef.current?.retryFailed();
    void settle();
  }, [settle]);

  const reprocess = useCallback(async () => {
    setWorking("Transcrevendo o que faltou…");
    for (const c of chunks.filter((x) => x.status !== "done")) {
      try {
        await transcribeChunk(c.id);
      } catch {
        // pedaço segue pendente; aparece na lista
      }
    }
    setWorking("Organizando o prontuário…");
    await runStructure();
    if (encounter.status === "processando") await setEncounterStatus(encId, "rascunho");
    setWorking(null);
    refresh();
  }, [chunks, runStructure, encounter.status, encId, refresh]);

  return {
    phase,
    level,
    elapsedMs,
    micError,
    pipeline,
    failedChunks: pipeline.filter((p) => p.stage === "failed").length,
    structuring,
    working,
    start,
    pause,
    resume,
    finish,
    retryUploads,
    reprocess,
  };
}
