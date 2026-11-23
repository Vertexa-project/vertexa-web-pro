import { describe, expect, it } from "vitest";

import { helpPlainText, parseHelpMarkup } from "./markup";

describe("parseHelpMarkup", () => {
  it("separa subtítulo, passos numerados, lista e parágrafos", () => {
    const blocks = parseHelpMarkup(
      "Intro da tela.\nContinua.\n\n## Como fazer\n1. Abra **Pacientes**.\n2. Clique em \"Novo paciente\".\n\n- Dica um\n- Dica dois",
    );
    expect(blocks).toEqual([
      { kind: "paragraph", text: "Intro da tela. Continua." },
      { kind: "heading", text: "Como fazer" },
      { kind: "ordered", items: ["Abra **Pacientes**.", 'Clique em "Novo paciente".'] },
      { kind: "bullets", items: ["Dica um", "Dica dois"] },
    ]);
  });

  it("não interpreta HTML: o texto fica como veio", () => {
    const blocks = parseHelpMarkup("<script>alert(1)</script>");
    expect(blocks).toEqual([{ kind: "paragraph", text: "<script>alert(1)</script>" }]);
  });

  it("linha recuada continua o item anterior", () => {
    expect(parseHelpMarkup("1. Primeiro\n   com mais texto\n2. Segundo")).toEqual([
      { kind: "ordered", items: ["Primeiro com mais texto", "Segundo"] },
    ]);
  });
});

describe("helpPlainText", () => {
  it("tira marcações", () => {
    expect(helpPlainText("## Título\n1. Abra **Agenda**\n- item")).toBe("Título Abra Agenda item");
  });
});
