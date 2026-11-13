import { describe, expect, it, vi } from "vitest";

import { ChunkPipeline, type PipelineChunk } from "./chunkPipeline";
import { CHUNK_MS, chunkStoragePath, formatClock, pickAudioFormat, planChunks, resolveChunkMs, retryDelayMs } from "./chunking";

const chunk = (seq: number): PipelineChunk => ({ seq, blob: new Blob(["x"]), durationMs: 1000, uploadMime: "audio/webm", ext: "webm" });

describe("divisão em pedaços", () => {
  it("consulta de 90 min = 36 pedaços de 2,5 min", () => {
    const p = planChunks(90 * 60_000);
    expect(p).toHaveLength(36);
    expect(p[0]).toEqual({ seq: 0, startMs: 0, endMs: CHUNK_MS });
    expect(p[35].endMs).toBe(90 * 60_000);
  });
  it("último pedaço é o resto; zero não gera pedaço", () => {
    expect(planChunks(CHUNK_MS + 1000).map((c) => c.endMs - c.startMs)).toEqual([CHUNK_MS, 1000]);
    expect(planChunks(0)).toEqual([]);
  });
  it("?chunk= só vale entre 4 e 300 s", () => {
    expect(resolveChunkMs("8")).toBe(8000);
    expect(resolveChunkMs("1")).toBe(CHUNK_MS);
    expect(resolveChunkMs("abc")).toBe(CHUNK_MS);
    expect(resolveChunkMs(null)).toBe(CHUNK_MS);
  });
  it("formato: webm/opus, fallback mp4 (Safari), nada = null", () => {
    expect(pickAudioFormat(() => true)?.ext).toBe("webm");
    expect(pickAudioFormat((m) => m === "audio/mp4")).toMatchObject({ ext: "mp4", uploadMime: "audio/mp4" });
    expect(pickAudioFormat(() => false)).toBeNull();
  });
  it("caminho, relógio e backoff", () => {
    expect(chunkStoragePath("c", "e", 3, "webm")).toBe("c/e/3.webm");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(65_000)).toBe("01:05");
    expect([0, 1, 2, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 30000]);
  });
});

describe("fila de envio com reenvio", () => {
  const sleep = () => Promise.resolve();
  it("upload falha 2x (rede caiu), depois conclui e transcreve", async () => {
    let fails = 2;
    const upload = vi.fn(async () => {
      if (fails-- > 0) throw new Error("rede");
    });
    const transcribe = vi.fn(async () => undefined);
    const onTranscribed = vi.fn();
    const q = new ChunkPipeline({ upload, register: async () => "id1", transcribe }, { sleep, onTranscribed });
    q.enqueue(chunk(0));
    await q.idle();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(transcribe).toHaveBeenCalledWith("id1");
    expect(onTranscribed).toHaveBeenCalledWith(0);
    expect(q.snapshot()[0].stage).toBe("done");
    expect(q.pending()).toBe(0);
  });
  it("retoma do estágio que falhou (não reenvia o áudio já enviado)", async () => {
    let fails = 1;
    const upload = vi.fn(async () => undefined);
    const transcribe = vi.fn(async () => {
      if (fails-- > 0) throw new Error("função fora");
    });
    const q = new ChunkPipeline({ upload, register: async () => "id", transcribe }, { sleep });
    q.enqueue(chunk(1));
    await q.idle();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(2);
  });
  it("esgota tentativas → failed; retryFailed reenvia e conclui", async () => {
    let offline = true;
    const upload = vi.fn(async () => {
      if (offline) throw new Error("offline");
    });
    const q = new ChunkPipeline({ upload, register: async () => "id", transcribe: async () => undefined }, { sleep, maxAttempts: 3 });
    q.enqueue(chunk(2));
    await q.idle();
    expect(q.failed()).toBe(1);
    expect(upload).toHaveBeenCalledTimes(3);
    offline = false;
    q.retryFailed();
    await q.idle();
    expect(q.failed()).toBe(0);
    expect(q.snapshot()[0].stage).toBe("done");
  });
  it("pedaços em paralelo não se atrapalham", async () => {
    const q = new ChunkPipeline({ upload: async () => undefined, register: async (c) => `id${c.seq}`, transcribe: async () => undefined }, { sleep });
    [0, 1, 2, 3].forEach((n) => q.enqueue(chunk(n)));
    await q.idle();
    expect(q.snapshot().every((s) => s.stage === "done")).toBe(true);
  });
});
