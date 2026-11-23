import { describe, expect, it } from "vitest";

import { mapTicketDetail, supportStatusLabel, validateSupportImage } from "./support";

describe("supportStatusLabel", () => {
  it("fala com cada lado do jeito dele", () => {
    expect(supportStatusLabel("aberto", "clinica")).toBe("Aguardando o suporte");
    expect(supportStatusLabel("aberto", "vertexa")).toBe("Aguardando resposta");
    expect(supportStatusLabel("respondido", "clinica")).toBe("Respondido");
    expect(supportStatusLabel("respondido", "vertexa")).toBe("Aguardando a clínica");
    expect(supportStatusLabel("resolvido", "vertexa")).toBe("Resolvido");
  });
});

describe("validateSupportImage", () => {
  it("aceita só imagem até 5 MB", () => {
    expect(validateSupportImage(null)).toBeNull();
    expect(validateSupportImage(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
    expect(validateSupportImage(new File(["x"], "a.pdf", { type: "application/pdf" }))).toMatch(/PNG, JPG ou WEBP/);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "b.jpg", { type: "image/jpeg" });
    expect(validateSupportImage(big)).toMatch(/5 MB/);
  });
});

describe("mapTicketDetail", () => {
  it("monta a conversa e o lado de quem vê", () => {
    const t = mapTicketDetail({
      id: "t1",
      number: "7",
      clinic_name: "Clínica",
      subject: "Agenda",
      category: "duvida",
      status: "respondido",
      created_at: "2026-11-23T12:00:00Z",
      opened_by_name: "Ana",
      viewer_side: "vertexa",
      messages: [{ id: "m1", author_side: "clinica", author_name: "Ana", body: "Oi", attachment_path: null, created_at: "x" }],
    });
    expect(t?.number).toBe(7);
    expect(t?.viewerSide).toBe("vertexa");
    expect(t?.messages[0].authorSide).toBe("clinica");
    expect(mapTicketDetail(null)).toBeNull();
  });
});
