// Vertexa IA (painel lateral) — regras PURAS: contexto por tela, sugestões, estado do rascunho e histórico da sessão.
// Regras do guia: resultado nasce RASCUNHO; nada é salvo sem o profissional confirmar; contexto sempre visível.
import { PATIENT_TABS, resolvePatientTab } from "@/lib/domain/patientTabs";
import type { AiAskResult, AiDraft, AiReply, AiScreenContext } from "@/types/vertexaAi";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCREEN_LABEL: Record<AiScreenContext["screen"], string> = {
  hoje: "Hoje",
  pacientes: "Pacientes",
  paciente: "Ficha do paciente",
  agenda: "Agenda",
  jornada: "Jornada",
  relacionamento: "Relacionamento",
  gestao: "Gestão",
  biblioteca: "Biblioteca",
  configuracoes: "Configurações",
  outra: "Vertexa",
};

/** Tela atual a partir da rota. Na ficha (/pacientes/:id) leva o paciente e a aba. */
export function screenFromLocation(pathname: string, search = ""): AiScreenContext {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const m = clean.match(/^\/pacientes\/([^/]+)/);
  if (m && UUID.test(m[1])) {
    const params = new URLSearchParams(search);
    const { tab } = resolvePatientTab(params.get("tab"), params.get("sub"));
    return { screen: "paciente", patientId: m[1], tab };
  }
  const table: Array<[RegExp, AiScreenContext["screen"]]> = [
    [/^\/$/, "hoje"],
    [/^\/pacientes/, "pacientes"],
    [/^\/agenda/, "agenda"],
    [/^\/jornada/, "jornada"],
    [/^\/(relacionamento|mensagens|campanhas)/, "relacionamento"],
    [/^\/(gestao|financeiro|estoque|documentos)/, "gestao"],
    [/^\/biblioteca/, "biblioteca"],
    [/^\/configuracoes/, "configuracoes"],
  ];
  const hit = table.find(([re]) => re.test(clean));
  return { screen: hit ? hit[1] : "outra", patientId: null, tab: null };
}

/** Texto do "Vendo: …" do painel. Na ficha: nome inteiro do paciente + aba. */
export function contextLabel(ctx: AiScreenContext, patientName?: string | null): string {
  if (ctx.screen !== "paciente") return SCREEN_LABEL[ctx.screen];
  const tab = PATIENT_TABS.find((t) => t.id === ctx.tab)?.label;
  const who = patientName?.trim() || "Paciente";
  return tab ? `${who} · ${tab}` : who;
}

/** SugestoesDaTela: pedidos prontos que dependem da tela atual. */
export function suggestionsFor(ctx: AiScreenContext): string[] {
  switch (ctx.screen) {
    case "hoje":
      return ["Quem eu devo ligar hoje?", "Como está minha agenda de hoje?", "Quem está sem registrar?"];
    case "paciente":
      return ["Prepara o resumo para o retorno", "Escreve um rascunho de mensagem para este paciente"];
    case "pacientes":
      return ["Quem está sem registrar?", "Quem precisa de mim hoje?"];
    case "agenda":
      return ["Como está minha agenda de hoje?", "Quem precisa de mim hoje?"];
    case "gestao":
      return ["Quem precisa de mim hoje?", "Como está minha agenda de hoje?"];
    case "relacionamento":
      return ["Quem está sem registrar?", "Quem eu devo ligar hoje?"];
    case "jornada":
      return ["Quem precisa de mim hoje?", "Quem está sem registrar?"];
    default:
      return ["Quem precisa de mim hoje?", "Como está minha agenda de hoje?"];
  }
}

/** Ações rápidas do painel (o que ela pode fazer nesta versão — sem criar treino/dieta, sem pagamento). */
export const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Resumir o dia", prompt: "Quem precisa de mim hoje?" },
  { label: "Preparar retorno", prompt: "Prepara o resumo para o retorno" },
  { label: "Rascunhar mensagem", prompt: "Escreve um rascunho de mensagem" },
];

export function greetingFor(hour: number): string {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Hora (0–23) em Brasília — nunca a do aparelho. */
export function hourBR(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now)) % 24;
}

export function introMessage(who: string | null, contextText: string, hour: number): string {
  const nome = who ? `, ${who}` : "";
  return `${greetingFor(hour)}${nome}. Estou vendo: ${contextText}. Posso resumir o dia, preparar um retorno ou rascunhar uma mensagem. Tudo o que eu fizer nasce como rascunho e nada é salvo sem a sua confirmação.`;
}

// ---------------------------------------------------------------- rascunho

export type DraftStatus = "rascunho" | "em_revisao" | "usado" | "descartado";
export type DraftAction = "revisar" | "usar" | "descartar";

/** Efeito de "Usar": só entrega ao humano (copiar/abrir tela). NUNCA grava dado nem envia. */
export type DraftEffect =
  | { type: "copiar_e_abrir"; text: string; to: string | null }
  | { type: "preencher_mensagem"; patientId: string; text: string; to: string }
  | { type: "nenhum" };

export interface DraftView {
  draft: AiDraft;
  status: DraftStatus;
  /** Texto atual (o profissional pode editar na revisão). */
  text: string;
}

export function newDraftView(draft: AiDraft): DraftView {
  return { draft, status: "rascunho", text: draft.body };
}

export function applyDraftAction(view: DraftView, action: DraftAction): { view: DraftView; effect: DraftEffect } {
  if (view.status === "usado" || view.status === "descartado") return { view, effect: { type: "nenhum" } };
  if (action === "revisar") return { view: { ...view, status: "em_revisao" }, effect: { type: "nenhum" } };
  if (action === "descartar") return { view: { ...view, status: "descartado" }, effect: { type: "nenhum" } };
  const { draft, text } = view;
  const used: DraftView = { ...view, status: "usado" };
  if (draft.kind === "mensagem" && draft.patientId) {
    return { view: used, effect: { type: "preencher_mensagem", patientId: draft.patientId, text, to: `/mensagens?patient=${draft.patientId}` } };
  }
  const to = draft.kind === "resumo_retorno" && draft.patientId ? `/pacientes/${draft.patientId}` : null;
  return { view: used, effect: { type: "copiar_e_abrir", text, to } };
}

/** Rótulo do botão "Usar" por tipo (diz o que acontece de verdade). */
export function draftUseLabel(draft: AiDraft): string {
  if (draft.kind === "mensagem") return "Usar em Mensagens";
  if (draft.kind === "resumo_retorno") return "Copiar resumo";
  return "Copiar lista";
}

// ---------------------------------------------------------------- histórico da sessão

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Tela em que o pedido foi feito (contexto visível no histórico). */
  context: string;
  mode?: "demo" | "openai";
  reply?: AiReply;
  requestId?: string | null;
  draft?: DraftView | null;
  error?: boolean;
}

export function assistantMessage(id: string, res: AiAskResult, context: string): ChatMessage {
  return {
    id, role: "assistant", text: res.reply.text, context, mode: res.mode, reply: res.reply,
    requestId: res.request_id, draft: res.reply.draft ? newDraftView(res.reply.draft) : null,
  };
}

/** Quantas mensagens a sessão guarda (só em memória; fecha a aba, some). */
export const HISTORY_LIMIT = 40;
export function pushMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  return [...list, m].slice(-HISTORY_LIMIT);
}

export function patchDraft(list: ChatMessage[], id: string, view: DraftView): ChatMessage[] {
  return list.map((m) => (m.id === id ? { ...m, draft: view } : m));
}

// ---------------------------------------------------------------- entrega do rascunho de mensagem

const KEY_PREFIX = "vertexa-ai:draft:";
/** Guarda o texto para o campo de resposta da conversa daquele paciente. */
export function stashMessageDraft(patientId: string, text: string, storage: Pick<Storage, "setItem"> = sessionStorage): void {
  storage.setItem(KEY_PREFIX + patientId, text);
}
/** Lê sem apagar (seguro para inicializador de useState em StrictMode). */
export function peekMessageDraft(patientId: string, storage: Pick<Storage, "getItem"> = sessionStorage): string {
  return storage.getItem(KEY_PREFIX + patientId) ?? "";
}
/** Apaga depois de entregue ao campo: o rascunho só aparece uma vez. */
export function clearMessageDraft(patientId: string, storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  storage.removeItem(KEY_PREFIX + patientId);
}
