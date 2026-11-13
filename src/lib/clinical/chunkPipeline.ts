// Fila de envio dos pedaços: upload → registro → transcrição, com reenvio automático (backoff) se a
// rede cair. Cada pedaço retoma do estágio em que parou. Dependências injetadas (testável).
import { retryDelayMs } from "./chunking";

export interface PipelineChunk {
  seq: number;
  blob: Blob;
  durationMs: number;
  uploadMime: string;
  ext: string;
}

export interface PipelineDeps {
  upload: (c: PipelineChunk) => Promise<void>;
  register: (c: PipelineChunk) => Promise<string>;
  transcribe: (chunkId: string) => Promise<void>;
}

export type ChunkStage = "upload" | "register" | "transcribe" | "done" | "failed";

export interface ChunkState {
  seq: number;
  stage: ChunkStage;
  attempts: number;
  lastStage: Exclude<ChunkStage, "done" | "failed">;
}

export interface PipelineOptions {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onChange?: (states: ChunkState[]) => void;
  /** Disparado quando um pedaço termina de transcrever (a tela pede nova estruturação). */
  onTranscribed?: (seq: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ChunkPipeline {
  private states = new Map<number, ChunkState>();
  private chunks = new Map<number, PipelineChunk>();
  private chunkIds = new Map<number, string>();
  private running = new Set<Promise<void>>();
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly deps: PipelineDeps,
    private readonly opts: PipelineOptions = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? 8;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  enqueue(chunk: PipelineChunk): void {
    this.chunks.set(chunk.seq, chunk);
    this.states.set(chunk.seq, { seq: chunk.seq, stage: "upload", attempts: 0, lastStage: "upload" });
    this.start(chunk.seq);
  }

  /** Reenvia os pedaços que esgotaram as tentativas (botão "Tentar de novo"). */
  retryFailed(): void {
    for (const s of this.states.values()) {
      if (s.stage === "failed") {
        s.stage = s.lastStage;
        s.attempts = 0;
        this.start(s.seq);
      }
    }
  }

  snapshot(): ChunkState[] {
    return [...this.states.values()].sort((a, b) => a.seq - b.seq).map((s) => ({ ...s }));
  }

  pending(): number {
    return this.snapshot().filter((s) => s.stage !== "done" && s.stage !== "failed").length;
  }

  failed(): number {
    return this.snapshot().filter((s) => s.stage === "failed").length;
  }

  /** Resolve quando nada mais está em andamento (concluído ou falho). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  private start(seq: number): void {
    const p = this.run(seq).finally(() => this.running.delete(p));
    this.running.add(p);
  }

  private emit(): void {
    this.opts.onChange?.(this.snapshot());
  }

  private async run(seq: number): Promise<void> {
    const state = this.states.get(seq);
    const chunk = this.chunks.get(seq);
    if (!state || !chunk) return;
    this.emit();
    while (state.stage !== "done" && state.stage !== "failed") {
      const stage = state.stage;
      try {
        if (stage === "upload") {
          await this.deps.upload(chunk);
          state.stage = "register";
        } else if (stage === "register") {
          this.chunkIds.set(seq, await this.deps.register(chunk));
          state.stage = "transcribe";
        } else {
          await this.deps.transcribe(this.chunkIds.get(seq) as string);
          state.stage = "done";
          this.emit();
          this.opts.onTranscribed?.(seq);
          return;
        }
        state.lastStage = state.stage as ChunkState["lastStage"];
        state.attempts = 0;
        this.emit();
      } catch {
        state.attempts += 1;
        if (state.attempts >= this.maxAttempts) {
          state.lastStage = stage;
          state.stage = "failed";
          this.emit();
          return;
        }
        this.emit();
        await this.sleep(retryDelayMs(state.attempts - 1));
      }
    }
  }
}
