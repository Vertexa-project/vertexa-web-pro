import { describe, expect, it } from "vitest";

import {
  DISCIPLINE_NOT_INFORMED,
  disciplineLabel,
  mentionableProfessionals,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WP-FRONT-2bii-A item 2 — AS DUAS PERGUNTAS, E O TESTE QUE TRAVA OS DOIS SENTIDOS.
//
// Depois que alguém é desativado, a cascata do WP-TEAM-2b-ii o tira do ROSTER do canal, mas as
// mensagens que ele escreveu continuam lá. Então:
//   · seletor de @ (roster, p_include_message_authors=false) → ele NÃO pode aparecer
//   · nome do autor (roster ∪ autores, =true)                → ele TEM de aparecer
// Um teste só que provasse um lado deixaria o outro livre para regredir — e as duas regressões
// são silenciosas na tela (ou some o nome do histórico, ou o seletor oferece quem o banco recusa).
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("mentionableProfessionals × namesByProfileId — quem posso marcar ≠ quem escreveu", () => {
  const ativo = prof({ profileId: "ativo", name: "Bia Ativa" });
  const desativado = prof({ profileId: "saiu", name: "Alvo Que Saiu" });
  const euMesmo = prof({ profileId: "eu", name: "Eu Mesmo" });

  // O que cada chamada devolve DEPOIS da desativação: o roster perdeu quem saiu; a lista com
  // autores manteve, porque ele autorou mensagem no canal.
  const roster = [ativo, euMesmo];
  const comAutores = [ativo, euMesmo, desativado];

  it("o DESATIVADO não aparece no seletor de @ (a lista vem do roster)", () => {
    const ids = mentionableProfessionals(roster, "eu").map((p) => p.profileId);
    expect(ids).not.toContain("saiu");
    expect(ids).toEqual(["ativo"]);
  });

  it("o DESATIVADO aparece na resolução de nome (a lista vem com autores)", () => {
    const names = namesByProfileId(comAutores);
    expect(names.get("saiu")).toBe("Alvo Que Saiu");
  });

  // A regressão que este par existe para impedir: alimentar o seletor com a lista de autores.
  it("se o seletor fosse alimentado pela lista COM autores, ele ofereceria quem saiu", () => {
    const errado = mentionableProfessionals(comAutores, "eu").map((p) => p.profileId);
    expect(errado).toContain("saiu"); // é EXATAMENTE o que não pode chegar à tela
  });

  // E a regressão simétrica: alimentar o nome do autor com o roster.
  it("se o nome viesse do roster, a mensagem de quem saiu perderia a autoria", () => {
    expect(namesByProfileId(roster).get("saiu")).toBeUndefined();
  });

  it("o próprio profissional nunca é marcável (marcar a si mesmo só acende o próprio badge)", () => {
    expect(mentionableProfessionals(roster, "eu").map((p) => p.profileId)).not.toContain("eu");
  });

  it("lista ausente não quebra o seletor", () => {
    expect(mentionableProfessionals(null, "eu")).toEqual([]);
    expect(mentionableProfessionals(undefined, null)).toEqual([]);
  });
});
