import { describe, expect, it } from "vitest";

import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  isExpectedJoinError,
  joinErrorCode,
  joinRequestErrorMessage,
  normalizeJoinCode,
  rotateCodeErrorMessage,
  shareInviteText,
  validateJoinCode,
} from "./clinicJoin";

/** Erro no formato do PostgrestError (só o que a UI consome). */
const pgError = (code: string) => ({ code, message: "x", details: "", hint: "" });

describe("alfabeto do código", () => {
  it("tem 32 símbolos e nenhum ambíguo", () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(32);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[OI01]/);
  });

  it("espelha o comprimento do gerador do banco", () => {
    expect(JOIN_CODE_LENGTH).toBe(8);
  });
});

describe("normalizeJoinCode", () => {
  it("põe em maiúsculas", () => {
    expect(normalizeJoinCode("abcdefgh")).toBe("ABCDEFGH");
  });

  it("remove os separadores que as pessoas colam", () => {
    expect(normalizeJoinCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(normalizeJoinCode("ABCD EFGH")).toBe("ABCDEFGH");
    expect(normalizeJoinCode(" ABCD.EFGH ")).toBe("ABCDEFGH");
    expect(normalizeJoinCode("ABCD_EFGH")).toBe("ABCDEFGH");
  });

  it("NÃO descarta caracteres ambíguos — quem avisa é a validação", () => {
    // Descartar silenciosamente produziria um código diferente do que a pessoa digitou.
    expect(normalizeJoinCode("ABCDEFG0")).toBe("ABCDEFG0");
  });
});

describe("validateJoinCode", () => {
  it("aceita um código válido", () => {
    const r = validateJoinCode("abcd-efgh");
    expect(r).toEqual({ ok: true, value: "ABCDEFGH" });
  });

  it("exige o código", () => {
    expect(validateJoinCode("")).toMatchObject({ ok: false });
    expect(validateJoinCode("   ")).toMatchObject({ ok: false });
  });

  it("explica a confusão de O/0/I/1 em vez de só dizer inválido", () => {
    for (const bad of ["ABCDEFG0", "ABCDEFGO", "ABCDEFGI", "ABCDEFG1"]) {
      const r = validateJoinCode(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/O e I|0 e 1/);
    }
  });

  it("recusa comprimento errado", () => {
    expect(validateJoinCode("ABCDEFG")).toMatchObject({ ok: false });
    expect(validateJoinCode("ABCDEFGHJ")).toMatchObject({ ok: false });
  });

  it("recusa caractere fora do alfabeto", () => {
    const r = validateJoinCode("ABCDEFG#");
    expect(r.ok).toBe(false);
  });
});

describe("classificação de erro", () => {
  it("extrai o SQLSTATE", () => {
    expect(joinErrorCode(pgError("P0002"))).toBe("P0002");
    expect(joinErrorCode(new Error("boom"))).toBeNull();
    expect(joinErrorCode(null)).toBeNull();
  });

  it("trata P0002/22023/42501 como esperados (não vão ao Sentry)", () => {
    expect(isExpectedJoinError(pgError("P0002"))).toBe(true);
    expect(isExpectedJoinError(pgError("22023"))).toBe(true);
    expect(isExpectedJoinError(pgError("42501"))).toBe(true);
    expect(isExpectedJoinError(pgError("XX000"))).toBe(false);
    expect(isExpectedJoinError(new Error("boom"))).toBe(false);
  });
});

describe("joinRequestErrorMessage", () => {
  it("NÃO revela se a clínica existe quando o código é inválido", () => {
    const msg = joinRequestErrorMessage(pgError("P0002"));
    expect(msg).toMatch(/Código inválido/i);
    // o ponto do desenho: nada que confirme ou negue a existência de uma clínica
    expect(msg).not.toMatch(/não existe|inexistente|not found|nenhuma clínica/i);
  });

  it("explica que a conta já pertence a uma clínica", () => {
    expect(joinRequestErrorMessage(pgError("22023"))).toMatch(/já faz parte/i);
  });

  it("trata sessão expirada", () => {
    expect(joinRequestErrorMessage(pgError("42501"))).toMatch(/sessão expirou/i);
  });

  it("tem fallback genérico sem vazar o erro cru", () => {
    const msg = joinRequestErrorMessage(new Error("connection refused at 10.0.0.1"));
    expect(msg).not.toMatch(/10\.0\.0\.1|connection refused/);
    expect(msg).toMatch(/Tente novamente/i);
  });
});

describe("rotateCodeErrorMessage", () => {
  it("explica a falta de permissão", () => {
    expect(rotateCodeErrorMessage(pgError("42501"))).toMatch(/administrador/i);
  });

  it("tem fallback genérico", () => {
    expect(rotateCodeErrorMessage(new Error("x"))).toMatch(/Tente novamente/i);
  });
});

describe("shareInviteText", () => {
  it("monta a mensagem com clínica, código e link de login", () => {
    const t = shareInviteText("Clínica Vida Ativa", "ABCDEFGH", "https://app.vertexa.com");
    expect(t).toContain("Clínica Vida Ativa");
    expect(t).toContain("ABCDEFGH");
    expect(t).toContain("https://app.vertexa.com/login");
  });
});
