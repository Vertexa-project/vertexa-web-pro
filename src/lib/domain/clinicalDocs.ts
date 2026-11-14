// Financeiro/Documentos · Entrega 9: regras puras dos documentos clínicos (receita, atestado, exames, relatório).
// O servidor (doc_* no Postgres) é a autoridade; aqui ficam rótulos, validação do rascunho para mensagem amigável e formatação.

export type DocType = "receita" | "atestado" | "exames" | "relatorio";
export const DOC_TYPES: DocType[] = ["receita", "atestado", "exames", "relatorio"];
export const DOC_TYPE_LABEL: Record<DocType, string> = { receita: "Receita", atestado: "Atestado", exames: "Exames", relatorio: "Relatório" };
export const DOC_TYPE_HINT: Record<DocType, string> = {
  receita: "Medicamentos com dose, posologia e quantidade.",
  atestado: "Texto do atestado.",
  exames: "Solicitação de exames, com a lista do que pedir.",
  relatorio: "Relatório clínico livre.",
};

/** Texto fixo do modo demonstração: aparece na tela, no PDF e na lista, sem esconder. */
export const DEMO_BADGE = "DEMONSTRAÇÃO — sem validade legal";
export const DEMO_NOTICE = "Modo demonstração: este documento é uma simulação e não tem validade legal. Receitas de controlados e de retenção só valem quando emitidas por um provedor de prescrição conectado ao SNCR.";

export interface PrescribedItem { name: string; dose: string; posology: string; quantity: string }
export const EMPTY_ITEM: PrescribedItem = { name: "", dose: "", posology: "", quantity: "" };

export interface DocDraft {
  title: string; content: string; items: PrescribedItem[];
  cpf: string; address: string;
}
export const emptyDraft = (type: DocType): DocDraft => ({
  title: DOC_TYPE_LABEL[type], content: "", items: type === "receita" ? [{ ...EMPTY_ITEM }] : [], cpf: "", address: "",
});

/** Só dígitos do CPF (11) — a validação do dígito verificador é do servidor (fin_valid_tax_id). */
export const cpfDigits = (v: string): string => v.replace(/\D/g, "");
export function formatCpf(v: string | null | undefined): string {
  const d = cpfDigits(v ?? "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (v ?? "");
}

/** Data ISO (yyyy-mm-dd) → dd/mm/aaaa, sem fuso. */
export const isoDateBR = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
/** Data-hora exibida sempre em Brasília. */
export function dateTimeBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface DraftErrors { title?: string; content?: string; items?: string; cpf?: string }
export function validateDraft(type: DocType, d: DocDraft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.title.trim()) e.title = "Informe o título do documento.";
  const items = d.items;
  if (type === "receita") {
    if (items.length === 0) e.items = "Inclua ao menos um medicamento.";
    else if (items.some((i) => !i.name.trim() || !i.dose.trim() || !i.posology.trim() || !i.quantity.trim())) e.items = "Preencha medicamento, dose, posologia e quantidade em todos os itens.";
  } else if (type === "exames") {
    if (items.some((i) => !i.name.trim())) e.items = "Preencha o nome de cada exame ou remova a linha vazia.";
    if (d.content.trim().length < 3 && items.length === 0) e.content = "Liste os exames ou escreva o pedido.";
  } else if (d.content.trim().length < 3) {
    e.content = type === "atestado" ? "Escreva o texto do atestado." : "Escreva o relatório.";
  }
  const cpf = cpfDigits(d.cpf);
  if (d.cpf.trim() && cpf.length !== 11) e.cpf = "O CPF deve ter 11 dígitos.";
  return e;
}

/** Itens a enviar: receita leva os quatro campos; exames só o nome; os demais tipos não têm itens. */
export function itemsForType(type: DocType, items: PrescribedItem[]): PrescribedItem[] {
  if (type === "receita") return items.map((i) => ({ name: i.name.trim(), dose: i.dose.trim(), posology: i.posology.trim(), quantity: i.quantity.trim() }));
  if (type === "exames") return items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), dose: "", posology: "", quantity: "" }));
  return [];
}

const ERROR_TEXT: Record<string, string> = {
  REGISTRY_REQUIRED: "Só profissional com conselho/registro cadastrado emite documento. Cadastre o registro no seu perfil.",
  PROVIDER_NOT_AVAILABLE: "O provedor de prescrição escolhido ainda não está conectado nesta clínica.",
  TYPE_INVALID: "Tipo de documento inválido.",
  ENCOUNTER_INVALID: "O atendimento não pertence a este paciente.",
  APPOINTMENT_INVALID: "O atendimento não pertence a este paciente.",
  SESSION_EXPIRED: "A sessão do provedor venceu. Feche e abra o documento de novo.",
  SESSION_INVALID: "Sessão do provedor inválida. Abra o documento de novo.",
  CONTENT_REQUIRED: "Escreva o conteúdo do documento.",
  TITLE_REQUIRED: "Informe o título do documento.",
  CPF_INVALID: "CPF inválido.",
  ITEMS_REQUIRED: "Inclua ao menos um medicamento.",
  ITEMS_INCOMPLETE: "Preencha medicamento, dose, posologia e quantidade em todos os itens.",
  ITEMS_INVALID: "Itens prescritos inválidos.",
  ITEMS_NOT_ALLOWED: "Este tipo de documento não tem itens prescritos.",
  REASON_REQUIRED: "Informe o motivo (ao menos 3 letras).",
  ALREADY_INVALIDATED: "Este documento já foi invalidado.",
  DOCUMENT_INVALIDATED: "Documento invalidado não pode ser reenviado.",
};
export function docErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? "";
  for (const k of Object.keys(ERROR_TEXT)) if (msg.includes(k)) return ERROR_TEXT[k];
  if (err?.code === "42501" || msg === "forbidden") return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir. Tente novamente.";
}
