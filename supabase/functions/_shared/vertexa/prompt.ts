import type { Fact, ScreenContext } from "./types.ts";

export const REPLY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "items", "draft"],
  properties: {
    text: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "source", "uncertain"],
        properties: { text: { type: "string" }, source: { type: "string" }, uncertain: { type: "boolean" } },
      },
    },
    draft: {
      anyOf: [
        { type: "null" },
        {
          type: "object", additionalProperties: false, required: ["kind", "title", "body", "fields"],
          properties: {
            kind: { type: "string", enum: ["mensagem", "resumo_retorno", "lista_ligacoes"] },
            title: { type: "string" },
            body: { type: "string" },
            fields: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["label", "value", "source", "uncertain"],
                properties: { label: { type: "string" }, value: { type: "string" }, source: { type: "string" }, uncertain: { type: "boolean" } },
              },
            },
          },
        },
      ],
    },
  },
} as const;

export function buildSystemPrompt(): string {
  return [
    "Você é a Vertexa IA, assistente de uma clínica multiprofissional. Responda SEMPRE em português do Brasil, curto e direto.",
    "Use APENAS os FATOS fornecidos. Não invente nada.",
    "Número: só cite número que esteja nos FATOS, exatamente como está. Nunca calcule, estime ou arredonde por conta própria.",
    "Cada frase de 'items' e cada campo do rascunho tem 'source' (a fonte do fato). Se o dado for fraco ou faltar, marque uncertain=true.",
    "Tudo o que você produz é RASCUNHO para o profissional revisar. Nunca diga que enviou, salvou, agendou ou marcou algo.",
    "Você NÃO diagnostica, NÃO prescreve, NÃO sugere dose ou medicamento, NÃO marca pagamento e NÃO movimenta caixa.",
    "Mensagens ao paciente: tom acolhedor e direto, sem conselho clínico e sem números que não estejam nos FATOS.",
    "Se faltar dado para o pedido, diga o que falta em 'text' e devolva draft=null.",
  ].join("\n");
}

export function buildUserPrompt(screen: ScreenContext, message: string, facts: Fact[]): string {
  const lines = facts.map((f) => `- [${f.key}] ${f.label}: ${f.value ?? "—"} (fonte: ${f.source}${f.uncertain ? "; incerto" : ""})`);
  return `TELA ATUAL: ${screen.label}\nFATOS:\n${lines.join("\n")}\n\nPEDIDO DO PROFISSIONAL:\n${message}`;
}
