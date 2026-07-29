import { describe, expect, it } from "vitest";

import { indexById, QUOTE_UNAVAILABLE, quotedPreview, resolveQuote } from "./chatReply";
import type { ChatMessageView } from "@/types/db";

function msg(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: "m1",
    channel_id: "c1",
    sender_profile_id: "p1",
    sender_role: "professional",
    body: "Olá",
    created_at: "2026-07-29T12:00:00Z",
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    reply_to_message_id: null,
    sender_name: "Dra. Ana",
    mentioned_profile_ids: [],
    ...over,
  };
}

const authorOf = (m: ChatMessageView) => m.sender_name ?? "Profissional";

describe("quotedPreview — body é ANULÁVEL (mensagem só-anexo)", () => {
  it("usa o corpo quando existe", () => {
    expect(quotedPreview(msg({ body: "Bom dia" }))).toBe("Bom dia");
  });

  it("trunca com reticências e sem espaço solto no fim", () => {
    const preview = quotedPreview(msg({ body: "a".repeat(50) + " " + "b".repeat(50) }), 60);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(61);
    expect(preview).not.toContain(" …");
  });

  // Cair para "Mensagem sem texto" tendo o nome do arquivo em mãos esconderia a única informação
  // útil da mensagem citada.
  it("sem corpo, cita pelo NOME DO ARQUIVO", () => {
    expect(quotedPreview(msg({ body: null, attachment_name: "exame.pdf", attachment_path: "c1/x.pdf" })))
      .toBe("exame.pdf");
  });

  it("sem corpo e sem nome, mas com anexo, diz 'Anexo'", () => {
    expect(quotedPreview(msg({ body: null, attachment_name: null, attachment_path: "c1/x.pdf" }))).toBe("Anexo");
  });

  it("corpo só com espaços conta como vazio", () => {
    expect(quotedPreview(msg({ body: "   " }))).toBe("Mensagem sem texto");
  });
});

describe("indexById", () => {
  it("indexa e junta grupos, com o último vencendo", () => {
    const a = msg({ id: "m1", body: "antigo" });
    const b = msg({ id: "m1", body: "novo" });
    const map = indexById([a], [b]);
    expect(map.size).toBe(1);
    expect(map.get("m1")?.body).toBe("novo");
  });

  it("lista vazia gera índice vazio (não lança)", () => {
    expect(indexById([]).size).toBe(0);
  });
});

describe("resolveQuote — degrada, nunca quebra", () => {
  it("mensagem que NÃO é resposta devolve null (não há bloco de citação)", () => {
    expect(resolveQuote(msg({ reply_to_message_id: null }), indexById([]), authorOf)).toBeNull();
  });

  it("citada presente: traz autor e trecho", () => {
    const parent = msg({ id: "m0", body: "Como foi o treino?", sender_name: "Dr. Bruno" });
    const reply = msg({ id: "m2", reply_to_message_id: "m0" });
    expect(resolveQuote(reply, indexById([parent, reply]), authorOf)).toEqual({
      found: true,
      author: "Dr. Bruno",
      preview: "Como foi o treino?",
    });
  });

  // O caso que não pode virar tela quebrada nem bloco sumido.
  it("citada AUSENTE do índice: found=false e o texto de indisponível, sem autor", () => {
    const reply = msg({ id: "m2", reply_to_message_id: "sumida" });
    expect(resolveQuote(reply, indexById([reply]), authorOf)).toEqual({
      found: false,
      author: null,
      preview: QUOTE_UNAVAILABLE,
    });
  });

  it("índice vazio não lança — degrada igual", () => {
    const reply = msg({ reply_to_message_id: "m0" });
    expect(resolveQuote(reply, new Map(), authorOf)?.found).toBe(false);
  });

  it("citada só-anexo é citada pelo nome do arquivo, não por vazio", () => {
    const parent = msg({ id: "m0", body: null, attachment_name: "dieta.pdf", attachment_path: "c1/d.pdf" });
    const reply = msg({ id: "m2", reply_to_message_id: "m0" });
    expect(resolveQuote(reply, indexById([parent]), authorOf)?.preview).toBe("dieta.pdf");
  });

  // O autor NÃO sai desta camada: quem resolve nome é quem chama (a RLS de profiles esconde
  // colega de profissional comum, e o painel decide o rótulo).
  it("usa o authorOf injetado, sem inventar nome próprio", () => {
    const parent = msg({ id: "m0", sender_name: null });
    const reply = msg({ id: "m2", reply_to_message_id: "m0" });
    expect(resolveQuote(reply, indexById([parent]), authorOf)?.author).toBe("Profissional");
    expect(resolveQuote(reply, indexById([parent]), () => "Paciente")?.author).toBe("Paciente");
  });
});
