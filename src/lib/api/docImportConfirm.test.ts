import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { WriteForbiddenError } from "@/lib/domain/disciplines";
import { initConference, markChecked, pickOption, setFieldValue, type DocKind, type DocReadResult } from "@/lib/domain/docImport";
import { readDemo } from "../../../supabase/functions/_shared/docread/demo";
import { ConferenceBlockedError, confirmImport, discardImport, freshProgress, ImportValidationError, type ConfirmArgs, type ConfirmDeps } from "./docImportConfirm";

const TODAY = "2026-11-16";
const fx = (n: string): string[] => JSON.parse(readFileSync(`${__dirname}/../../../supabase/functions/_shared/docread/fixtures/${n}.json`, "utf8"));
const read = (kind: DocKind, n: string): DocReadResult => readDemo({ kind, pages: fx(n), isImage: false, patientName: "Mariana Teste", today: TODAY });

const mkDeps = (): ConfirmDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    createAssessment: vi.fn(async () => { calls.push("assessment"); }),
    saveNutrition: vi.fn(async () => { calls.push("nutrition"); }),
    saveWorkout: vi.fn(async () => { calls.push("workout"); }),
    registerDocument: vi.fn(async () => { calls.push("document"); return { id: "doc-1" }; }),
    resolve: vi.fn(async () => { calls.push("resolve"); return { ok: true }; }),
    removeObject: vi.fn(async () => { calls.push("remove"); }),
  };
};
const base = (kind: DocKind, name: string, over: Partial<ConfirmArgs> = {}): ConfirmArgs => {
  const result = read(kind, name);
  return { kind, patientId: "pat-1", professionalId: "pro-1", canWrite: true, readId: "read-1", path: "pat-1/1.pdf", mime: "application/pdf", size: 1234, result, state: initConference(result), today: TODAY, ...over };
};
const settle = (a: ConfirmArgs): ConfirmArgs => {
  let st = a.state;
  for (const f of a.result.fields.filter((x) => x.uncertain)) st = f.options ? pickOption(a.kind, a.result, st, f.key, f.options[0], TODAY) : markChecked(a.kind, a.result, st, f.key, TODAY);
  return { ...a, state: st };
};

describe("confirmar importação", () => {
  it("BLOQUEADO com incerto sem conferir: nada é gravado (nem avaliação, nem documento, nem rastro)", async () => {
    const d = mkDeps();
    await expect(confirmImport(base("bioimpedancia", "bioimpedancia-mariana-incerta"), freshProgress(), d)).rejects.toBeInstanceOf(ConferenceBlockedError);
    expect(d.calls).toEqual([]);
  });
  it("bioimpedância conferida grava a avaliação, anexa o documento com origem e deixa o rastro", async () => {
    const d = mkDeps();
    const a = settle(base("bioimpedancia", "bioimpedancia-mariana-incerta"));
    const st = setFieldValue(a.result, a.state, "massa_magra", "51,5");
    const out = await confirmImport({ ...a, state: markChecked("bioimpedancia", a.result, st, "massa_magra", TODAY) }, freshProgress(), d);
    expect(d.calls).toEqual(["assessment", "document", "resolve"]);
    expect(d.createAssessment).toHaveBeenCalledWith(expect.objectContaining({
      patientId: "pat-1", professionalId: "pro-1", method: "bioimpedancia", assessed_at: "2026-11-10", weight: 70.3, body_fat_pct: 26.8,
    }));
    expect(d.registerDocument).toHaveBeenCalledWith(expect.objectContaining({
      patientId: "pat-1", path: "pat-1/1.pdf", kind: "exam", uploadedByProfessionalId: "pro-1", title: expect.stringMatching(/lido pela Vertexa IA \(demonstração\), conferido em 16\/11\/2026/),
    }));
    // rastro: só contagem e id do documento, nunca os valores
    const call = vi.mocked(d.resolve).mock.calls[0];
    expect(call[0]).toBe("read-1");
    expect(call[1]).toBe("confirmado");
    expect(call[2]).toEqual({ fieldsCorrected: 1, documentId: "doc-1" });
    expect(JSON.stringify(call)).not.toMatch(/70|26,8|51/);
    expect(out).toEqual({ documentId: "doc-1", traced: true });
  });
  it("dieta conferida grava pelo save do plano alimentar (não pelo de treino)", async () => {
    const d = mkDeps();
    await confirmImport(settle(base("dieta", "dieta-mariana-teste")), freshProgress(), d);
    expect(d.calls).toEqual(["nutrition", "document", "resolve"]);
    const input = vi.mocked(d.saveNutrition).mock.calls[0][0];
    expect(input.patientId).toBe("pat-1");
    expect(input.title).toBe("Plano alimentar importado");
    expect(input.meals).toHaveLength(3);
    expect(vi.mocked(d.registerDocument).mock.calls[0][0].kind).toBe("report");
  });
  it("treino conferido grava pelo save do plano de treino", async () => {
    const d = mkDeps();
    await confirmImport(settle(base("treino", "treino-mariana-teste")), freshProgress(), d);
    expect(d.calls).toEqual(["workout", "document", "resolve"]);
    const input = vi.mocked(d.saveWorkout).mock.calls[0][0];
    expect(input.workouts).toHaveLength(2);
    expect(input.workouts[0].exercises[1].reps).toBe(8); // primeira opção escolhida no teste
  });
  it("sem a disciplina do plano: recusa antes de tocar em qualquer coisa", async () => {
    const d = mkDeps();
    await expect(confirmImport(settle(base("dieta", "dieta-mariana-teste", { canWrite: false })), freshProgress(), d)).rejects.toBeInstanceOf(WriteForbiddenError);
    expect(d.calls).toEqual([]);
  });
  it("valor recusado pela validação da avaliação não grava nada", async () => {
    const d = mkDeps();
    const a = base("bioimpedancia", "bioimpedancia-mariana-teste");
    // 'peso' na faixa da importação, mas o formulário manual recusa 3 casas decimais
    const st = setFieldValue(a.result, a.state, "peso", "70,355");
    await expect(confirmImport({ ...a, state: st }, freshProgress(), d)).rejects.toThrow();
    expect(d.createAssessment).not.toHaveBeenCalled();
    expect(d.calls).toEqual([]);
    expect(ImportValidationError.name).toBe("ImportValidationError");
  });
  it("se o anexo falha depois de gravar, repetir NÃO grava o plano de novo", async () => {
    const d = mkDeps();
    vi.mocked(d.registerDocument).mockRejectedValueOnce(new Error("falhou"));
    const a = settle(base("dieta", "dieta-mariana-teste"));
    const progress = freshProgress();
    await expect(confirmImport(a, progress, d)).rejects.toThrow("falhou");
    expect(progress.wrote).toBe(true);
    await confirmImport(a, progress, d);
    expect(vi.mocked(d.saveNutrition)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.registerDocument)).toHaveBeenCalledTimes(2);
  });
  it("rastro que não chegou não desfaz o que foi salvo: avisa", async () => {
    const d = mkDeps();
    vi.mocked(d.resolve).mockRejectedValueOnce(new Error("x"));
    const out = await confirmImport(settle(base("treino", "treino-mariana-teste")), freshProgress(), d);
    expect(out.traced).toBe(false);
  });
});

describe("descartar importação", () => {
  it("não grava avaliação, plano nem documento: só o rastro e a remoção do arquivo", async () => {
    const d = mkDeps();
    await discardImport("read-1", "pat-1/1.pdf", d);
    expect(d.calls).toEqual(["resolve", "remove"]);
    expect(vi.mocked(d.resolve)).toHaveBeenCalledWith("read-1", "descartado");
    for (const fn of [d.createAssessment, d.saveNutrition, d.saveWorkout, d.registerDocument]) expect(fn).not.toHaveBeenCalled();
  });
  it("falha no rastro não impede descartar", async () => {
    const d = mkDeps();
    vi.mocked(d.resolve).mockRejectedValueOnce(new Error("x"));
    await expect(discardImport("read-1", "pat-1/1.pdf", d)).resolves.toBeUndefined();
    expect(d.removeObject).toHaveBeenCalled();
  });
});
