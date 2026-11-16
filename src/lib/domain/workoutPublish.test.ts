import { describe, expect, it } from "vitest";

import { derivePermissions } from "./disciplines";
import { canPublishWorkout, listLetters, publicationOf, publishErrorMessage, summarizePublish, visibleToPatient } from "./workoutPublish";

describe("treino: publicado × rascunho", () => {
  it("plano que já existia (sem a marca) conta como publicado; só is_draft esconde", () => {
    expect(publicationOf({})).toBe("publicado");
    expect(publicationOf({ is_draft: false })).toBe("publicado");
    expect(publicationOf({ is_draft: null })).toBe("publicado");
    expect(publicationOf({ is_draft: true })).toBe("rascunho");
    expect(visibleToPatient({ is_draft: false })).toBe(true);
    expect(visibleToPatient({ is_draft: true })).toBe(false);
    expect(visibleToPatient(null)).toBe(false);
  });
  it("resumo antes de publicar: dias liberados, animação e instrução", () => {
    const anim = (n: string, gif?: string | null) => Boolean(gif) || n === "Supino";
    const s = summarizePublish(
      [
        { letter: "A", name: "Peito", workout_exercises: [{ name: "Supino", notes: "Desça devagar" }, { name: "Crucifixo", gif_url: "x.gif" }] },
        { letter: null, name: "Costas", workout_exercises: [{ name: "Remada livre", notes: "  " }] },
        { letter: "C", name: "Vazio", workout_exercises: [] },
      ],
      anim,
    );
    expect(s).toEqual({ days: 2, dayLetters: ["A", "2"], exercises: 3, withAnimation: 2, withInstruction: 1, canPublish: true });
    expect(summarizePublish([{ letter: "A", name: "A", workout_exercises: [] }], anim).canPublish).toBe(false);
    expect(listLetters(["A", "B", "C"])).toBe("A, B e C");
    expect(listLetters(["A", "B"])).toBe("A e B");
    expect(listLetters(["A"])).toBe("A");
  });
  it("permissão: só quem edita treino (educador físico ou fisioterapeuta) publica", () => {
    expect(canPublishWorkout(derivePermissions(["educador_fisico"]))).toBe(true);
    expect(canPublishWorkout(derivePermissions(["fisioterapeuta"]))).toBe(true);
    expect(canPublishWorkout(derivePermissions(["nutricionista", "medico"]))).toBe(false);
    expect(canPublishWorkout(derivePermissions([]))).toBe(false);
  });
  it("erros em PT", () => {
    expect(publishErrorMessage({ message: "workout_plan_empty" })).toBe("Adicione ao menos um exercício antes de publicar.");
    expect(publishErrorMessage({ code: "42501", message: "forbidden: requires educador_fisico" })).toBe("Requer a disciplina Educador Físico ou Fisioterapeuta.");
    expect(publishErrorMessage(new Error("rede"))).toBe("Não foi possível publicar agora. Tente novamente.");
  });
});
