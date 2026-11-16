// Vertexa IA — contrato da Edge Function `vertexa-ai` (espelho de supabase/functions/_shared/vertexa/types.ts).
export type AiScreenKey =
  | "hoje" | "pacientes" | "paciente" | "agenda" | "jornada"
  | "relacionamento" | "gestao" | "biblioteca" | "configuracoes" | "outra";

export interface AiScreenContext {
  screen: AiScreenKey;
  patientId: string | null;
  /** Aba da ficha (resumo, timeline...). */
  tab: string | null;
}

export interface AiReplyItem { text: string; source: string; uncertain?: boolean }
export interface AiDraftField { label: string; value: string; source: string; uncertain?: boolean }
export type AiDraftKind = "mensagem" | "resumo_retorno" | "lista_ligacoes";
export interface AiDraft {
  kind: AiDraftKind;
  title: string;
  patientId: string | null;
  patientName: string | null;
  body: string;
  fields: AiDraftField[];
}
export interface AiReplyAction { label: string; to: string }
export interface AiReply {
  text: string;
  items: AiReplyItem[];
  draft: AiDraft | null;
  actions: AiReplyAction[];
  blocked: null | "sem_acesso" | "fora_do_escopo";
}
export interface AiAskResult {
  mode: "demo" | "openai";
  reply: AiReply;
  /** Id do rastro (quem pediu). Null se o rastro não pôde ser gravado. */
  request_id: string | null;
  traced: boolean;
}
