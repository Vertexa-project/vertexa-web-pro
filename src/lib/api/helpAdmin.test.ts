import { describe, expect, it } from "vitest";

import { formatWhatsapp, helpMediaError, mapAdminHelp, nextArticlePosition, whatsappLink } from "./helpAdmin";

describe("WhatsApp do suporte", () => {
  it("link com DDI do Brasil quando falta", () => {
    expect(whatsappLink("98999990000")).toBe("https://wa.me/5598999990000");
    expect(whatsappLink("5598999990000")).toBe("https://wa.me/5598999990000");
    expect(whatsappLink("")).toBeNull();
  });
  it("mostra o número formatado", () => {
    expect(formatWhatsapp("98999990000")).toBe("(98) 99999-0000");
    expect(formatWhatsapp("5598999990000")).toBe("(98) 99999-0000");
    expect(formatWhatsapp("9833330000")).toBe("(98) 3333-0000");
  });
});

describe("helpMediaError", () => {
  it("confere tipo e tamanho por tipo de mídia", () => {
    expect(helpMediaError({ type: "video/mp4", size: 10 }, "video")).toBeNull();
    expect(helpMediaError({ type: "image/png", size: 10 }, "video")).toMatch(/MP4/);
    expect(helpMediaError({ type: "video/mp4", size: 51 * 1024 * 1024 }, "video")).toMatch(/50 MB/);
    expect(helpMediaError({ type: "image/webp", size: 10 }, "image")).toBeNull();
    expect(helpMediaError({ type: "image/png", size: 6 * 1024 * 1024 }, "image")).toMatch(/5 MB/);
  });
});

describe("mapAdminHelp", () => {
  it("lê assuntos e tutoriais, inclusive ocultos", () => {
    const d = mapAdminHelp({
      categories: [{ id: "agenda", title: "Agenda", description: "", position: 3 }],
      articles: [{ id: "1", slug: "x", category_id: "agenda", title: "X", summary: "", body: "", video_path: null, position: 1, is_published: false }],
    });
    expect(d.categories[0].position).toBe(3);
    expect(d.articles[0].isPublished).toBe(false);
  });
});

describe("nextArticlePosition", () => {
  it("tutorial novo entra no fim do assunto", () => {
    const arts = [
      { categoryId: "agenda", position: 1 },
      { categoryId: "agenda", position: 3 },
      { categoryId: "pacientes", position: 9 },
    ];
    expect(nextArticlePosition(arts, "agenda")).toBe(4);
    expect(nextArticlePosition(arts, "novo")).toBe(1);
  });
});
