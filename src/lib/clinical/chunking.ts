// Gravação em pedaços — regras puras (testáveis sem navegador).
/** Cada pedaço de áudio dura ~2,5 min (consulta de 90 min = 36 pedaços). */
export const CHUNK_MS = 150_000;
export const MIN_CHUNK_MS = 4_000;
export const MAX_CHUNK_MS = 300_000;

export interface ChunkBoundary {
  seq: number;
  startMs: number;
  endMs: number;
}

/** Divide `totalMs` de gravação em pedaços de até `chunkMs`. */
export function planChunks(totalMs: number, chunkMs: number = CHUNK_MS): ChunkBoundary[] {
  if (totalMs <= 0 || chunkMs <= 0) return [];
  const out: ChunkBoundary[] = [];
  for (let start = 0, seq = 0; start < totalMs; start += chunkMs, seq++) {
    out.push({ seq, startMs: start, endMs: Math.min(start + chunkMs, totalMs) });
  }
  return out;
}

/** Duração de pedaço pedida por `?chunk=<segundos>` (só para teste); fora do intervalo → padrão. */
export function resolveChunkMs(param: string | null | undefined): number {
  const n = Number(param);
  if (!param || !Number.isFinite(n)) return CHUNK_MS;
  const ms = Math.round(n * 1000);
  return ms >= MIN_CHUNK_MS && ms <= MAX_CHUNK_MS ? ms : CHUNK_MS;
}

export interface AudioFormat {
  /** Valor para o MediaRecorder (pode ter codecs). */
  recorderMime: string;
  /** Content-Type base enviado ao bucket (sem codecs). */
  uploadMime: string;
  ext: string;
}

const FORMATS: AudioFormat[] = [
  { recorderMime: "audio/webm;codecs=opus", uploadMime: "audio/webm", ext: "webm" },
  { recorderMime: "audio/webm", uploadMime: "audio/webm", ext: "webm" },
  { recorderMime: "audio/mp4", uploadMime: "audio/mp4", ext: "mp4" }, // Safari/iOS
  { recorderMime: "audio/ogg;codecs=opus", uploadMime: "audio/ogg", ext: "ogg" },
];

/** Primeiro formato suportado: webm/opus; fallback mp4 (Safari/iOS). null = nenhum. */
export function pickAudioFormat(isSupported: (mime: string) => boolean): AudioFormat | null {
  return FORMATS.find((f) => isSupported(f.recorderMime)) ?? null;
}

/** Caminho do objeto: <clínica>/<atendimento>/<n>.<ext> (a policy do bucket valida este formato). */
export function chunkStoragePath(clinicId: string, encounterId: string, seq: number, ext: string): string {
  return `${clinicId}/${encounterId}/${seq}.${ext}`;
}

/** Espera antes da tentativa `attempt` (0 = primeira): 1 s, 2 s, 4 s ... até 30 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
