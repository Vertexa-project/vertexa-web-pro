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
      { kind: "ordered", items: ["Abra **Pacientes**.", 'Clique em "Novo paciente".'], start: 1 },
      { kind: "bullets", items: ["Dica um", "Dica dois"] },
    ]);
  });

  it("não interpreta HTML: o texto fica como veio", () => {
    const blocks = parseHelpMarkup("<script>alert(1)</script>");
    expect(blocks).toEqual([{ kind: "paragraph", text: "<script>alert(1)</script>" }]);
  });

  it("linha recuada continua o item anterior", () => {
    expect(parseHelpMarkup("1. Primeiro\n   com mais texto\n2. Segundo")).toEqual([
      { kind: "ordered", items: ["Primeiro com mais texto", "Segundo"], start: 1 },
    ]);
  });
});

describe("imagem no meio dos passos", () => {
  it("vira bloco de imagem e a numeração continua", () => {
    expect(parseHelpMarkup("1. Um\n[[imagem:images/a-1.png]]\n2. Dois")).toEqual([
      { kind: "ordered", items: ["Um"], start: 1 },
      { kind: "image", path: "images/a-1.png" },
      { kind: "ordered", items: ["Dois"], start: 2 },
    ]);
  });

  it("caminho fora da pasta de imagens fica como texto", () => {
    expect(parseHelpMarkup("[[imagem:../x.png]]")[0].kind).toBe("paragraph");
  });
});

describe("helpPlainText", () => {
  it("tira marcações", () => {
    expect(helpPlainText("## Título\n1. Abra **Agenda**\n- item")).toBe("Título Abra Agenda item");
  });
});
