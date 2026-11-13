// Gravador em pedaços (navegador): MediaRecorder reiniciado a cada `chunkMs` para que CADA arquivo seja
// independente (um webm cortado no meio não toca sozinho). Pausar fecha o pedaço atual; retomar abre outro.
import { pickAudioFormat, type AudioFormat } from "./chunking";

export interface RecordedChunk {
  seq: number;
  blob: Blob;
  durationMs: number;
  uploadMime: string;
  ext: string;
}

export interface RecorderEvents {
  onChunk: (chunk: RecordedChunk) => void;
  /** 0..1, ~10x por segundo, para o medidor de nível. */
  onLevel?: (level: number) => void;
}

export type MicErrorKind = "denied" | "no-device" | "unsupported" | "other";

export class MicError extends Error {
  constructor(public kind: MicErrorKind) {
    super(kind);
  }
}

export function classifyMicError(e: unknown): MicErrorKind {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
  return "other";
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export class ChunkedRecorder {
  private stream: MediaStream | null = null;
  private format: AudioFormat | null = null;
  private current: { rec: MediaRecorder; parts: Blob[]; startedAt: number } | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private seq: number;
  private doneMs = 0; // tempo já fechado em pedaços anteriores
  private paused = false;

  constructor(
    private readonly chunkMs: number,
    private readonly events: RecorderEvents,
    startSeq = 0,
  ) {
    this.seq = startSeq;
  }

  async start(): Promise<void> {
    if (!recordingSupported()) throw new MicError("unsupported");
    this.format = pickAudioFormat((m) => MediaRecorder.isTypeSupported(m));
    if (!this.format) throw new MicError("unsupported");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      throw new MicError(classifyMicError(e));
    }
    this.startMeter();
    this.openSegment();
  }

  elapsedMs(): number {
    return this.doneMs + (this.current ? performance.now() - this.current.startedAt : 0);
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    if (this.paused || !this.current) return;
    this.paused = true;
    this.closeSegment();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.openSegment();
  }

  /** Fecha o último pedaço, solta o microfone. */
  stop(): void {
    this.paused = false;
    this.closeSegment();
    this.stopMeter();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private openSegment(): void {
    if (!this.stream || !this.format) return;
    const rec = new MediaRecorder(this.stream, { mimeType: this.format.recorderMime });
    const seg = { rec, parts: [] as Blob[], startedAt: performance.now() };
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) seg.parts.push(ev.data);
    };
    const format = this.format;
    const seq = this.seq++;
    rec.onstop = () => {
      const durationMs = Math.round(performance.now() - seg.startedAt);
      this.doneMs += durationMs;
      if (seg.parts.length === 0) return;
      this.events.onChunk({
        seq,
        blob: new Blob(seg.parts, { type: format.uploadMime }),
        durationMs,
        uploadMime: format.uploadMime,
        ext: format.ext,
      });
    };
    rec.start();
    this.current = seg;
    this.rotateTimer = setTimeout(() => this.rotate(), this.chunkMs);
  }

  private closeSegment(): void {
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    this.rotateTimer = null;
    const seg = this.current;
    this.current = null;
    if (seg && seg.rec.state !== "inactive") seg.rec.stop();
  }

  /** Abre o próximo pedaço ANTES de fechar o atual: nenhum trecho de áudio fica sem gravar. */
  private rotate(): void {
    if (this.paused || !this.current) return;
    const prev = this.current;
    this.openSegment();
    if (prev.rec.state !== "inactive") prev.rec.stop();
  }

  private startMeter(): void {
    if (!this.stream || !this.events.onLevel) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      this.audioCtx.createMediaStreamSource(this.stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      this.levelTimer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        this.events.onLevel?.(this.paused ? 0 : Math.min(1, peak / 64));
      }, 100);
    } catch {
      // sem medidor: a gravação segue normalmente
    }
  }

  private stopMeter(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.events.onLevel?.(0);
  }
}
