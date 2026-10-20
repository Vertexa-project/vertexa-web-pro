// Regras PURAS de campanhas (espelham as constraints/RPCs de 20261025090000_wp_campaigns_a.sql).
export type CampaignTrigger = "welcome" | "checkin" | "return" | "reactivation" | "birthday";
export type BroadcastAudience = "mine" | "mine_inactive" | "all" | "all_inactive";

export const TITLE_MAX = 80;
export const BODY_MAX = 500;

export interface TriggerMeta {
  key: CampaignTrigger;
  label: string;
  /** Quando dispara (texto para o profissional). Recebe os dias configurados. */
  when: (days: number | null) => string;
  /** Rótulo do campo de dias, ou null se o gatilho não usa dias. */
  daysLabel: string | null;
  defaultDays: number | null;
}

export const TRIGGERS: readonly TriggerMeta[] = [
  { key: "welcome", label: "Boas-vindas", when: () => "Nos primeiros dias depois que o paciente entra, uma única vez.", daysLabel: null, defaultDays: null },
  { key: "checkin", label: "Check-in periódico", when: (d) => `A cada ${d ?? 15} dias de acompanhamento, pedindo peso e fotos.`, daysLabel: "Repetir a cada (dias)", defaultDays: 15 },
  { key: "return", label: "Lembrete de retorno", when: (d) => `A cada ${d ?? 30} dias de acompanhamento, lembrando de marcar o retorno.`, daysLabel: "Repetir a cada (dias)", defaultDays: 30 },
  { key: "reactivation", label: "Reativação de inativos", when: (d) => `Quando o paciente fica ${d ?? 7} dias ou mais sem registrar nada (uma vez por período de inatividade).`, daysLabel: "Dias sem registrar", defaultDays: 7 },
  { key: "birthday", label: "Aniversário", when: () => "No dia do aniversário do paciente.", daysLabel: null, defaultDays: null },
];

export const triggerMeta = (key: string | null | undefined): TriggerMeta | null => TRIGGERS.find((t) => t.key === key) ?? null;

export const AUDIENCE_LABEL: Record<BroadcastAudience, string> = {
  mine: "Meus pacientes",
  mine_inactive: "Meus pacientes inativos",
  all: "Todos os pacientes da clínica",
  all_inactive: "Todos os pacientes inativos da clínica",
};
export const isInactiveAudience = (a: BroadcastAudience) => a === "mine_inactive" || a === "all_inactive";
/** Audiências que só o administrador da clínica pode usar. */
export const adminOnlyAudience = (a: BroadcastAudience) => a === "all" || a === "all_inactive";
export const availableAudiences = (isAdmin: boolean): BroadcastAudience[] =>
  (Object.keys(AUDIENCE_LABEL) as BroadcastAudience[]).filter((a) => isAdmin || !adminOnlyAudience(a));

/** Troca {nome} pelo primeiro nome (ou "você"), igual ao servidor. */
export function renderMessage(text: string, fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return text.split("{nome}").join(first || "você");
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseDays(raw: string, label: string): Result<number> {
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, error: `${label}: use um número inteiro de 1 a 365.` };
  return { ok: true, value: n };
}

export interface MessageFields { title: string; body: string }
function validateMessage(f: MessageFields): string | null {
  const title = f.title.trim();
  const body = f.body.trim();
  if (!title) return "Informe o título da mensagem.";
  if (title.length > TITLE_MAX) return `O título passa de ${TITLE_MAX} caracteres.`;
  if (!body) return "Escreva a mensagem.";
  if (body.length > BODY_MAX) return `A mensagem passa de ${BODY_MAX} caracteres.`;
  return null;
}

export function validateCampaignEdit(f: MessageFields & { days: string }, meta: TriggerMeta | null): Result<{ title: string; body: string; days: number | null }> {
  const err = validateMessage(f);
  if (err) return { ok: false, error: err };
  let days: number | null = null;
  if (meta?.daysLabel) {
    const d = parseDays(f.days, meta.daysLabel);
    if (!d.ok) return d;
    days = d.value;
  }
  return { ok: true, value: { title: f.title.trim(), body: f.body.trim(), days } };
}

export function validateBroadcast(f: MessageFields & { audience: BroadcastAudience; days: string }): Result<{ title: string; body: string; audience: BroadcastAudience; days: number | null }> {
  const err = validateMessage(f);
  if (err) return { ok: false, error: err };
  let days: number | null = null;
  if (isInactiveAudience(f.audience)) {
    const d = parseDays(f.days, "Dias sem registrar");
    if (!d.ok) return d;
    days = d.value;
  }
  return { ok: true, value: { title: f.title.trim(), body: f.body.trim(), audience: f.audience, days } };
}

export function recipientsText(n: number): string {
  return n === 0 ? "Nenhum paciente nesta audiência." : n === 1 ? "1 paciente vai receber." : `${n} pacientes vão receber.`;
}
