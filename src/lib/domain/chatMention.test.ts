import { describe, expect, it } from "vitest";

import { classifyMentionFailure, mentionFailureMessage } from "./chatMention";

describe("classifyMentionFailure — 42501 é a policy, o resto não é palpite", () => {
  it("42501 (insufficient_privilege) é a recusa da RLS: o marcado saiu do canal", () => {
    expect(classifyMentionFailure({ code: "42501" })).toBe("not_participant");
  });

  // Qualquer outro código é IGNORÂNCIA declarada, não uma segunda teoria: se o INSERT caiu por
  // rede/timeout/5xx, não sabemos sequer se a marcação entrou.
  it("qualquer outro código vira 'unknown'", () => {
    expect(classifyMentionFailure({ code: "23505" })).toBe("unknown");
    expect(classifyMentionFailure({ code: "PGRST301" })).toBe("unknown");
    expect(classifyMentionFailure({ code: "" })).toBe("unknown");
  });

  it("erro sem código, null e undefined também são 'unknown' (nunca lança)", () => {
    expect(classifyMentionFailure({})).toBe("unknown");
    expect(classifyMentionFailure({ code: null })).toBe("unknown");
    expect(classifyMentionFailure(null)).toBe("unknown");
    expect(classifyMentionFailure(undefined)).toBe("unknown");
  });
});

describe("mentionFailureMessage — a mensagem FOI enviada, e o texto começa por aí", () => {
  // A regra que mais importa deste WP: a mensagem já está no banco quando a marcação falha.
  it("sempre começa afirmando que a mensagem foi enviada", () => {
    expect(mentionFailureMessage("Dra. Ana", "not_participant")).toMatch(/^Mensagem enviada\./);
    expect(mentionFailureMessage("Dra. Ana", "unknown")).toMatch(/^Mensagem enviada\./);
  });

  it("nunca manda tentar de novo nem reenviar (reenviar duplicaria)", () => {
    for (const reason of ["not_participant", "unknown"] as const) {
      const text = mentionFailureMessage("Dra. Ana", reason);
      expect(text.toLowerCase()).not.toMatch(/tente novamente|tentar de novo|reenvi/);
    }
  });

  it("not_participant diz o motivo REAL: a pessoa não está mais na conversa", () => {
    expect(mentionFailureMessage("Dra. Ana", "not_participant")).toBe(
      "Mensagem enviada. Não foi possível marcar Dra. Ana: essa pessoa não está mais nesta conversa.",
    );
  });

  // Não inventar causa é o ponto do 'unknown': o texto não afirma por que falhou.
  it("unknown NÃO afirma a causa", () => {
    const text = mentionFailureMessage("Dra. Ana", "unknown");
    expect(text).toContain("Não foi possível marcar Dra. Ana desta vez");
    expect(text).not.toContain("não está mais nesta conversa");
  });

  it("nome vazio ou só espaços cai para 'o profissional', não para um buraco na frase", () => {
    expect(mentionFailureMessage("   ", "not_participant")).toContain("marcar o profissional:");
    expect(mentionFailureMessage("", "unknown")).toContain("marcar o profissional desta vez");
  });
});
