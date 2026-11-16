// Vertexa IA — tipos compartilhados da função (Deno) e testados sob Vitest. Sem I/O.
export type ScreenKey =
  | "hoje" | "pacientes" | "paciente" | "agenda" | "jornada"
  | "relacionamento" | "gestao" | "biblioteca" | "configuracoes" | "outra";

export interface ScreenContext {
  screen: ScreenKey;
  /** Rótulo mostrado no painel ("Hoje", "Mariana Teste · Resumo"). */
  label: string;
  patientId: string | null;
  tab: string | null;
}

/** Fato do SISTEMA. A IA só pode citar número que esteja num fato (regra: número vem do sistema). */
export interface Fact {
  key: string;
  label: string;
  value: string | number | null;
  /** Origem mostrada ao profissional ("Foco do dia", "Agenda", "Adesão"). */
  source: string;
  patientId?: string | null;
  /** Dado fraco/ausente: aparece em laranja. */
  uncertain?: boolean;
  /** Motivo de atenção (Foco do dia), para escolher a ação e o texto do rascunho. */
  reason?: "adherence_drop" | "never_registered" | "no_record" | null;
}

export interface ReplyItem { text: string; source: string; uncertain?: boolean }
export interface DraftField { label: string; value: string; source: string; uncertain?: boolean }

export type DraftKind = "mensagem" | "resumo_retorno" | "lista_ligacoes";
export interface Draft {
  kind: DraftKind;
  title: string;
  patientId: string | null;
  patientName: string | null;
  /** Texto que o profissional vai revisar/usar (mensagem pronta, resumo...). */
  body: string;
  fields: DraftField[];
}

export interface ReplyAction { label: string; to: string }

export interface AiReply {
  text: string;
  items: ReplyItem[];
  draft: Draft | null;
  actions: ReplyAction[];
  blocked: null | "sem_acesso" | "fora_do_escopo";
}

export type Intent =
  | "quem_hoje" | "agenda_hoje" | "resumo_retorno" | "rascunho_mensagem" | "sem_registrar"
  | "financeiro" | "pagamento" | "diagnostico" | "treino" | "ajuda";
