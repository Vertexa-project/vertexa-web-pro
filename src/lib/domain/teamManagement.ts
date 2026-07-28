// Regras da tela de GESTÃO DE EQUIPE (WP-TEAM-2a) — PURAS (sem I/O), testáveis em Node.
// Mesma convenção de clinicJoin.ts / clinicOnboarding.ts / disciplines.ts.
//
// Traduzem os erros de approve_join_request / reject_join_request (migration 20260803090000)
// para mensagem compreensível, decidem a ordem da fila e derivam os rótulos da lista — nunca
// erro cru, nunca PII em telemetria. A AUTORIDADE continua no banco: a UI só espelha.

import type { ClinicJoinRequest } from "@/lib/api/clinicJoin";
import type { ProfessionalWithDisciplines } from "@/lib/api/disciplines";

/** SQLSTATE de um erro de RPC (PostgrestError expõe `code`). Senão, null. */
export function decisionErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** Erros ESPERADOS (autorização/estado) — viram mensagem, não vão ao Sentry. */
const EXPECTED = new Set(["42501", "22023", "P0002"]);

export function isExpectedDecisionError(error: unknown): boolean {
  const code = decisionErrorCode(error);
  return code !== null && EXPECTED.has(code);
}

/**
 * Mensagem para Aprovar/Rejeitar um pedido. Os três códigos vêm das RPCs:
 *   42501 — não autenticado OU não é admin DESTA clínica (o mesmo portão cobre clínica alheia)
 *   22023 — o pedido já foi decidido por alguém
 *   P0002 — o pedido não existe mais
 */
export function decisionErrorMessage(error: unknown): string {
  switch (decisionErrorCode(error)) {
    case "42501":
      return "Você não tem permissão de administrador nesta clínica.";
    case "22023":
      return "Esta solicitação já foi respondida. Atualize a lista.";
    case "P0002":
      return "Esta solicitação não existe mais. Atualize a lista.";
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}

/**
 * Fila do admin: MAIS ANTIGO PRIMEIRO. Quem esperou mais tempo aparece no topo — é uma fila
 * de atendimento, não um feed de novidades. (`listMyJoinRequests` ordena ao contrário porque
 * ali a pergunta é "o que eu pedi mais recentemente".)
 */
export function sortPendingFirstIn(requests: readonly ClinicJoinRequest[]): ClinicJoinRequest[] {
  return [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Só os pedidos que ainda aguardam decisão. */
export function onlyPending(requests: readonly ClinicJoinRequest[]): ClinicJoinRequest[] {
  return requests.filter((r) => r.status === "pending");
}

/**
 * Rótulo de quem pediu. Cai para o e-mail e, por fim, para um genérico — os campos são
 * denormalizados e anuláveis (um pedido criado antes do WP-JOIN-1b não teria snapshot).
 */
export function requesterLabel(request: Pick<ClinicJoinRequest, "requesterName" | "requesterEmail">): string {
  const name = request.requesterName?.trim();
  if (name) return name;
  const email = request.requesterEmail?.trim();
  if (email) return email;
  return "Profissional";
}

/**
 * Gate de visibilidade da tela. FAIL-CLOSED: enquanto o sinal de admin carrega, NÃO é "pode" —
 * é "aguarde". Nunca abre a área no escuro (mesmo padrão de DisciplinesAdminPage).
 */
export type TeamAccess = "loading" | "allowed" | "denied";

export function resolveTeamAccess(input: { isClinicAdmin: boolean; isLoading: boolean }): TeamAccess {
  if (input.isLoading) return "loading";
  return input.isClinicAdmin ? "allowed" : "denied";
}

export interface TeamSummary {
  total: number;
  /** Sem NENHUMA disciplina ⇒ não escreve nada clínico. É a pendência acionável da lista. */
  withoutDiscipline: number;
}

/** Resumo da equipe para o cabeçalho da lista. */
export function summarizeTeam(team: readonly ProfessionalWithDisciplines[]): TeamSummary {
  return {
    total: team.length,
    withoutDiscipline: team.filter((p) => p.disciplines.length === 0).length,
  };
}
