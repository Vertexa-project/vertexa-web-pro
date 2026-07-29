import { describe, expect, it } from "vitest";

import {
  DISCIPLINE_NOT_INFORMED,
  disciplineLabel,
  mentionsProfile,
  namesByProfileId,
  professionalQualification,
} from "./chatTeam";
import type { ChannelProfessional } from "@/types/db";

const LABELS = new Map([
  ["nutricionista", "Nutricionista"],
  ["educador_fisico", "Educador Físico"],
]);

function prof(over: Partial<ChannelProfessional> = {}): ChannelProfessional {
  return {
    profileId: "p1",
    name: "Dra. Ana Prado",
    type: "nutritionist",
    specialty: null,
    disciplines: [],
    ...over,
  };
}

describe("disciplineLabel — rótulo vem do BANCO; code desconhecido não some da tela", () => {
  it("usa o rótulo do catálogo quando existe", () => {
    expect(disciplineLabel("nutricionista", LABELS)).toBe("Nutricionista");
  });

  // Catálogo ainda não carregado (ou code novo no banco) não pode virar linha em branco.
  it("code fora do catálogo vira texto legível a partir do próprio code", () => {
    expect(disciplineLabel("psicologo", LABELS)).toBe("Psicologo");
    expect(disciplineLabel("terapeuta_ocupacional", new Map())).toBe("Terapeuta ocupacional");
  });

  it("rótulo vazio no catálogo não vence o fallback", () => {
    expect(disciplineLabel("medico", new Map([["medico", "   "]]))).toBe("Medico");
  });
});

describe("professionalQualification — precedência disciplines > specialty > type", () => {
  it("disciplines vence specialty e type", () => {
    expect(
      professionalQualification(
        prof({ disciplines: ["nutricionista"], specialty: "Esportiva", type: "doctor" }),
        LABELS,
      ),
    ).toBe("Nutricionista");
  });

  it("várias disciplinas aparecem TODAS, separadas", () => {
    expect(
      professionalQualification(prof({ disciplines: ["nutricionista", "educador_fisico"] }), LABELS),
    ).toBe("Nutricionista · Educador Físico");
  });

  it("sem disciplines, usa specialty", () => {
    expect(professionalQualification(prof({ specialty: "Nutrição esportiva" }), LABELS)).toBe(
      "Nutrição esportiva",
    );
  });

  it("sem disciplines e sem specialty, usa o type", () => {
    expect(professionalQualification(prof({ type: "physiotherapist" }), LABELS)).toBe("Fisioterapeuta");
  });

  it("codes em branco não contam como disciplina", () => {
    expect(professionalQualification(prof({ disciplines: ["  "], specialty: "Clínica" }), LABELS)).toBe(
      "Clínica",
    );
  });

  // O ponto do WP: ausência tem de virar FATO VISÍVEL, e quem decide o texto é a tela.
  it("sem nenhuma das três devolve null (a tela mostra o texto de não informado)", () => {
    expect(professionalQualification(prof({ type: null, specialty: null, disciplines: [] }), LABELS)).toBeNull();
    expect(DISCIPLINE_NOT_INFORMED).toBe("Disciplina não informada");
  });
});

describe("namesByProfileId", () => {
  it("indexa nome por profile e ignora nome vazio", () => {
    const map = namesByProfileId([
      prof({ profileId: "a", name: "Dra. Ana" }),
      prof({ profileId: "b", name: "   " }),
    ]);
    expect(map.get("a")).toBe("Dra. Ana");
    expect(map.has("b")).toBe(false);
  });
});

describe("mentionsProfile — destaque de quem foi marcado", () => {
  it("true quando o perfil está na lista de marcados da mensagem", () => {
    expect(mentionsProfile({ mentioned_profile_ids: ["p1", "p2"] }, "p2")).toBe(true);
  });

  it("false quando não está", () => {
    expect(mentionsProfile({ mentioned_profile_ids: ["p1"] }, "p9")).toBe(false);
    expect(mentionsProfile({ mentioned_profile_ids: [] }, "p1")).toBe(false);
  });

  // Sem identidade resolvida NADA pode ser destacado — destacar tudo seria pior que não destacar.
  it("perfil nulo nunca casa", () => {
    expect(mentionsProfile({ mentioned_profile_ids: ["p1"] }, null)).toBe(false);
  });
});
