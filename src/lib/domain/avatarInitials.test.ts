import { describe, expect, it } from "vitest";

import { avatarInitials } from "./avatarInitials";

describe("avatarInitials", () => {
  it("usa primeira e última palavra significativa: Neemias Santos → NS", () => {
    expect(avatarInitials("Neemias Santos")).toBe("NS");
  });

  it("ignora partículas: Luana dos Santos Costa → LC", () => {
    expect(avatarInitials("Luana dos Santos Costa")).toBe("LC");
  });

  it("Maria da Silva → MS", () => {
    expect(avatarInitials("Maria da Silva")).toBe("MS");
  });

  it("ignora título Dr./Dra.", () => {
    expect(avatarInitials("Dr. Neemias Santos")).toBe("NS");
    expect(avatarInitials("Dra. Ana Prado")).toBe("AP");
  });

  it("nome único usa as duas primeiras letras", () => {
    expect(avatarInitials("Ana")).toBe("AN");
  });

  it("vazio ou nulo cai em fallback estável", () => {
    expect(avatarInitials(null)).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });
});
