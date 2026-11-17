// Regras PURAS do reengajamento do paciente sumido (A6). Espelham as constraints/RPCs de
// 20261124120000_auto_a6_reengajamento.sql: 3 mensagens, em dias crescentes sem interação, entre 1 e 365.
import { BODY_MAX, TITLE_MAX, type Result } from "@/lib/domain/campaigns";

export const STEPS = [1, 2, 3] as const;

export interface ReengagementStepConfig { day: number; title: string; body: string }
export interface ReengagementConfig { isActive: boolean; sendChat: boolean; steps: [ReengagementStepConfig, ReengagementStepConfig, ReengagementStepConfig] }

/** Mensagens padrão (tom próximo, sem cobrança, sem falar de peso). A clínica troca tudo na tela Campanhas. */
export const DEFAULT_CONFIG: ReengagementConfig = {
  isActive: false,
  sendChat: true,
  steps: [
    { day: 5, title: "Oi, {nome}, tudo bem?", body: "Percebi que faz uns dias que a gente não se fala. Está tudo certo e sem nenhuma dúvida, ou o plano está difícil de seguir? Me conta por aqui, sem pressão: estou aqui para ajustar o que for preciso." },
    { day: 8, title: "Passando para saber de você", body: "{nome}, voltei para saber como você está. Às vezes a rotina aperta e o plano fica para depois, acontece com todo mundo. Se quiser, responda por aqui e a gente encontra juntos um jeito que caiba na sua semana." },
    { day: 12, title: "Sua equipe continua aqui", body: "{nome}, quero que você saiba que não está sozinho(a) nesse processo. Quando puder, me responda por aqui ou registre algo no app, mesmo que seja pouco. A gente retoma de onde você parou, no seu ritmo." },
  ],
};

export interface ReengagementFormStep { day: string; title: string; body: string }

export const toForm = (c: ReengagementConfig): ReengagementFormStep[] => c.steps.map((s) => ({ day: String(s.day), title: s.title, body: s.body }));

export function validateSequence(form: ReengagementFormStep[]): Result<ReengagementConfig["steps"]> {
  if (form.length !== 3) return { ok: false, error: "A sequência tem 3 mensagens." };
  const steps: ReengagementStepConfig[] = [];
  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    const f = form[i]!;
    const day = Number(f.day.trim());
    if (!Number.isInteger(day) || day < 1 || day > 365) return { ok: false, error: `Mensagem ${n}: os dias sem interação são um número inteiro de 1 a 365.` };
    const title = f.title.trim();
    const body = f.body.trim();
    if (!title) return { ok: false, error: `Mensagem ${n}: informe o título.` };
    if (title.length > TITLE_MAX) return { ok: false, error: `Mensagem ${n}: o título passa de ${TITLE_MAX} caracteres.` };
    if (!body) return { ok: false, error: `Mensagem ${n}: escreva a mensagem.` };
    if (body.length > BODY_MAX) return { ok: false, error: `Mensagem ${n}: a mensagem passa de ${BODY_MAX} caracteres.` };
    steps.push({ day, title, body });
  }
  if (!(steps[0]!.day < steps[1]!.day && steps[1]!.day < steps[2]!.day)) return { ok: false, error: "Os dias precisam ser crescentes (a mensagem 2 vem depois da 1, e a 3 depois da 2)." };
  return { ok: true, value: steps as ReengagementConfig["steps"] };
}

export type ReengagementState = "em_andamento" | "concluida" | "respondeu" | "aguardando";
export const STATE_LABEL: Record<ReengagementState, string> = {
  em_andamento: "Em andamento",
  concluida: "Sequência concluída",
  respondeu: "Parou: voltou a interagir",
  aguardando: "Aguardando a 1ª mensagem",
};
export const STATE_TONE: Record<ReengagementState, "primary" | "muted" | "success" | "warning"> = {
  em_andamento: "primary", concluida: "muted", respondeu: "success", aguardando: "warning",
};

/** "2025-11-24" → "24/11" (sem passar por Date: evita virar o dia por fuso). */
export function fmtDayMonth(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}` : "—";
}

export interface ReengagementLineData { step: number; sent_on: string; state: Exclude<ReengagementState, "aguardando"> }

/** Linha da ficha. "respondeu" = o paciente voltou a interagir depois da última mensagem. */
export function lineText(l: ReengagementLineData): string {
  const base = `mensagem ${l.step} de 3 enviada em ${fmtDayMonth(l.sent_on)}`;
  if (l.state === "respondeu") return `${base}; parou porque o paciente voltou a interagir`;
  if (l.state === "concluida") return `${base}; sequência concluída`;
  return base;
}

export const whenText = (c: ReengagementConfig) =>
  `Quando o paciente fica ${c.steps[0].day}, ${c.steps[1].day} e ${c.steps[2].day} dias sem interagir (registro no app, mensagem na conversa, peso ou foto), uma mensagem em cada etapa. Para quando ele interage; recomeça só num novo sumiço.`;
