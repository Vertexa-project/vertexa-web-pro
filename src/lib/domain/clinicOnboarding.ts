// Regras de onboarding de clínica — PURAS (sem I/O), testáveis em Node.
// Espelham a RPC public.create_clinic_with_owner (WP-ONBOARDING): validação do nome idêntica ao banco
// (obrigatório; 2..120) e tradução dos erros da RPC (via `hint`) para mensagem COMPREENSÍVEL ao usuário
// — nunca erro cru, nunca PII. Mantêm a autoridade no banco; aqui é só UX e classificação de erro.

export const CLINIC_NAME_MIN = 2;
export const CLINIC_NAME_MAX = 120;

export type ClinicNameValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** Valida/normaliza o nome com as MESMAS regras do banco (obrigatório; 2..120 chars, após trim). */
export function validateClinicName(raw: string): ClinicNameValidation {
  const value = raw.trim();
  if (value === "") return { ok: false, message: "Informe o nome da clínica." };
  if (value.length < CLINIC_NAME_MIN)
    return { ok: false, message: `O nome precisa ter ao menos ${CLINIC_NAME_MIN} caracteres.` };
  if (value.length > CLINIC_NAME_MAX)
    return { ok: false, message: `O nome pode ter no máximo ${CLINIC_NAME_MAX} caracteres.` };
  return { ok: true, value };
}

export type ClinicOnboardingMode = "automatic" | "manual_review" | "closed";

export type ClinicCreationRequestStatus = "pending" | "approved" | "rejected";

export interface MyClinicCreationRequest {
  id: string;
  requestedClinicName: string;
  status: ClinicCreationRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
}

export type CreateClinicSurface =
  | "closed"
  | "automatic"
  | "request"
  | "pending"
  | "approved"
  | "rejected";

/** Superfície esquerda do PendingAccess — política + pedido do usuário, sem I/O. */
export function resolveCreateClinicSurface(
  mode: ClinicOnboardingMode,
  request: MyClinicCreationRequest | null,
): CreateClinicSurface {
  if (mode === "closed") return "closed";
  if (mode === "automatic") return "automatic";
  if (request?.status === "pending") return "pending";
  if (request?.status === "approved") return "approved";
  if (request?.status === "rejected") return "rejected";
  return "request";
}

export const CLINIC_ONBOARDING_MODE_LABEL: Record<ClinicOnboardingMode, string> = {
  automatic: "Automática",
  manual_review: "Sob análise",
  closed: "Fechada",
};

export const CLINIC_ONBOARDING_MODE_HELP: Record<ClinicOnboardingMode, string> = {
  automatic:
    "Profissionais elegíveis criam a própria clínica e ela é ativada na hora.",
  manual_review:
    "O profissional solicita. A plataforma analisa e aprova ou recusa antes da criação.",
  closed:
    "Novas solicitações e criações de clínica ficam bloqueadas. Entrar numa clínica existente continua possível.",
};

export function isClinicOnboardingMode(value: string): value is ClinicOnboardingMode {
  return value === "automatic" || value === "manual_review" || value === "closed";
}

// Códigos (hint) emitidos pelas RPCs → mensagem amigável. Autoridade continua no banco.
const HINT_MESSAGES: Record<string, string> = {
  ALREADY_OWNS_CLINIC:
    "Você já é dona(o) de uma clínica. Cada perfil pode criar apenas uma clínica.",
  NAME_REQUIRED: "Informe o nome da clínica.",
  NAME_TOO_SHORT: `O nome precisa ter ao menos ${CLINIC_NAME_MIN} caracteres.`,
  NAME_TOO_LONG: `O nome pode ter no máximo ${CLINIC_NAME_MAX} caracteres.`,
  NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente para criar a clínica.",
  ONBOARDING_NOT_ALLOWED: "A criação de clínicas ainda não está liberada para esta conta.",
  ONBOARDING_CLOSED: "Novos cadastros de clínicas estão temporariamente indisponíveis.",
  REQUEST_ALREADY_PENDING: "Você já tem uma solicitação aguardando análise.",
  REQUEST_NOT_NEEDED: "Neste momento você pode criar a clínica diretamente.",
  REQUEST_NOT_PENDING: "Esta solicitação não está mais aguardando análise.",
  REQUEST_ALREADY_DECIDED: "Esta solicitação já foi decidida.",
  REQUEST_NOT_FOUND: "Não encontramos esta solicitação.",
  NOT_PLATFORM_ADMIN: "Esta ação é restrita à administração da plataforma.",
  INVALID_POLICY_MODE: "Modo de entrada inválido.",
  APPROVED_CLINIC_NAME_MISMATCH:
    "A criação deve usar o nome aprovado na análise. Para outro nome, é preciso uma nova análise.",
  REQUEST_ALREADY_APPROVED:
    "Você já tem uma solicitação aprovada. Conclua a criação da clínica com o nome aprovado.",
};

/** Extrai um `hint` CONHECIDO de um erro de RPC (PostgrestError expõe `hint`). Senão, null. */
export function onboardingErrorHint(error: unknown): string | null {
  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint in HINT_MESSAGES) return hint;
  }
  return null;
}

/** Erro ESPERADO (validação/guarda-corpo) — não deve ir ao Sentry (evita ruído), como isDisciplineDenied. */
export function isExpectedOnboardingError(error: unknown): boolean {
  return onboardingErrorHint(error) !== null;
}

/** Mensagem compreensível para QUALQUER erro da criação (nunca erro cru; sem PII). */
export function onboardingErrorMessage(error: unknown): string {
  const hint = onboardingErrorHint(error);
  if (hint) return HINT_MESSAGES[hint];
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}
