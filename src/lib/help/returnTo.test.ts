import { beforeEach, describe, expect, it } from "vitest";

import { clearHelpReturn, isHelpPath, peekHelpReturn, rememberHelpReturn } from "./returnTo";

describe("volta para a Central depois do login", () => {
  beforeEach(() => sessionStorage.clear());

  it("lembra só caminhos da Central", () => {
    rememberHelpReturn("/pacientes");
    expect(peekHelpReturn()).toBeNull();
    rememberHelpReturn("/ajuda/tutoriais/agenda");
    expect(peekHelpReturn()).toBe("/ajuda/tutoriais/agenda");
    clearHelpReturn();
    expect(peekHelpReturn()).toBeNull();
  });

  it("não aceita endereço parecido", () => {
    expect(isHelpPath("/ajudante")).toBe(false);
    expect(isHelpPath("/ajuda")).toBe(true);
  });
});
