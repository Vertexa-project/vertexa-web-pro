// ESTADO DO PROFISSIONAL NA CLÍNICA — regras PURAS (sem I/O), testáveis em Node.
// Mesma convenção de patientTeam.ts / teamManagement.ts / clinicAdmin.ts.
//
// A AUTORIDADE é o banco (WP-TEAM-2b-ii, migration 20260808090000): as RPCs
// deactivate_professional / reactivate_professional são fail-closed, recusam o DONO e a
// autodesativação, e `authenticated` não escreve as colunas de estado. O que mora aqui é o que a
// UI precisa DECIDIR e EXIBIR — nunca o que ela pode permitir.

import type { ClinicMembership, ProfessionalStatusEvent } from "@/lib/api/professionalStatus";

export const PROFESSIONAL_STATUS_ACTIVE = "active";
export const PROFESSIONAL_STATUS_INACTIVE = "inactive";

/**
 * ESPELHO EXATO DA REGRA DO BANCO. Os seis helpers que o 2b-ii passou a filtrar usam
 * `coalesce(pr.status,'active') = 'active'`.
 *
 * Consequência que NÃO pode ser "simplificada": status NULO conta como ATIVO. A coluna nasceu
 * NOT NULL com default, mas o tipo da web a trata como opcional (um build pode rodar contra um
 * banco anterior à migration) — e tratar null como inativo marcaria como "desativado" alguém que
 * o banco considera ativo. Mesma decisão de `isActiveLinkStatus` para o vínculo.
 */
export function isActiveProfessionalStatus(status: string | null | undefined): boolean {
  return (status ?? PROFESSIONAL_STATUS_ACTIVE) === PROFESSIONAL_STATUS_ACTIVE;
}

/** Rótulo pt-BR. Qualquer coisa que não seja ativo é "Inativo". */
export function professionalStatusLabel(status: string | null | undefined): string {
  return isActiveProfessionalStatus(status) ? "Ativo" : "Inativo";
}

export interface TeamStatusSummary {
  total: number;
  active: number;
  inactive: number;
}

/** Resumo para o cabeçalho da lista de equipe. */
export function summarizeTeamStatus(
  members: readonly { status?: string | null }[],
): TeamStatusSummary {
  const active = members.filter((m) => isActiveProfessionalStatus(m.status)).length;
  return { total: members.length, active, inactive: members.length - active };
}

/**
 * Ordem da lista: ATIVOS primeiro, depois inativos; dentro de cada grupo, por nome (pt-BR, para
 * acentuação sair na ordem certa). Quem está na clínica hoje aparece antes de quem saiu — a tela
 * é operacional, não um histórico cronológico. Mesma regra de `sortPatientTeam`.
 */
export function sortTeamByStatus<T extends { status?: string | null; fullName: string | null }>(
  members: readonly T[],
): T[] {
  return [...members].sort((a, b) => {
    const aActive = isActiveProfessionalStatus(a.status);
    const bActive = isActiveProfessionalStatus(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR");
  });
}

/**
 * O evento MAIS RECENTE por profissional. A trilha é append-only e cresce; a linha da pessoa só
 * precisa do último ("quem desativou, quando e por quê").
 *
 * NÃO confia na ordem de chegada: compara `changed_at`. A consulta já ordena desc, mas uma
 * função pura que depende da ordem do chamador é uma armadilha para o próximo WP.
 */
export function latestStatusEventByProfessional(
  events: readonly ProfessionalStatusEvent[] | null | undefined,
): Map<string, ProfessionalStatusEvent> {
  const latest = new Map<string, ProfessionalStatusEvent>();
  for (const ev of events ?? []) {
    const current = latest.get(ev.professionalId);
    if (!current || ev.changedAt > current.changedAt) latest.set(ev.professionalId, ev);
  }
  return latest;
}

/**
 * Quem mudou o estado. Cai para um genérico: `changed_by` é anulável e o embed de `profiles` pode
 * vir nulo por `can_see_profile`. A ausência NÃO some da tela — vira texto honesto.
 */
export function changedByLabel(event: Pick<ProfessionalStatusEvent, "changedByName">): string {
  const name = event.changedByName?.trim();
  return name ? name : "um administrador da clínica";
}

/** Por que a pessoa NÃO tem botão. Cada motivo tem um texto próprio na tela. */
export type NoActionReason = "loading" | "not-admin" | "owner" | "self";

export type MemberAction =
  | { kind: "deactivate" }
  | { kind: "reactivate" }
  | { kind: "none"; reason: NoActionReason };

export interface MemberActionInput {
  /** Sinal REAL do banco (RPC am_i_clinic_admin), via useIsClinicAdmin. */
  isClinicAdmin: boolean;
  /** O sinal de admin ainda está carregando. */
  isAdminLoading: boolean;
  /** Esta linha é o próprio usuário logado. */
  isSelf: boolean;
  /** Esta linha é o DONO da clínica (clinics.owner_profile_id). */
  isOwner: boolean;
  /** Estado atual da pessoa (`null` = ativo). */
  status: string | null | undefined;
}

/**
 * "Que ação eu posso OFERECER nesta linha?" — FAIL-CLOSED e na MESMA ORDEM das recusas do banco.
 *
 * A ordem importa e não é estética: o servidor checa admin → dono → autodesativação, então a UI
 * que checasse em outra ordem explicaria a recusa errada (ex.: dizer "você não pode desativar a
 * si mesmo" para o dono que também é o usuário logado, quando a razão real é a posse).
 *
 * Isto NÃO é autorização: a autorização é a RPC, que devolve 42501 com `hint`. É higiene de
 * interface — não oferecer um botão que o banco vai recusar.
 */
export function resolveMemberAction(input: MemberActionInput): MemberAction {
  if (input.isAdminLoading) return { kind: "none", reason: "loading" };
  if (!input.isClinicAdmin) return { kind: "none", reason: "not-admin" };
  if (input.isOwner) return { kind: "none", reason: "owner" };
  if (input.isSelf) return { kind: "none", reason: "self" };
  return isActiveProfessionalStatus(input.status) ? { kind: "deactivate" } : { kind: "reactivate" };
}

/** O texto que substitui o botão quando não há ação. `null` enquanto carrega (nada a dizer ainda). */
export function noActionExplanation(reason: NoActionReason): string | null {
  switch (reason) {
    case "owner":
      return "Dono da clínica — transfira a posse antes de desativar.";
    case "self":
      return "Você não pode desativar o próprio cadastro. Peça a outro administrador.";
    case "not-admin":
      return "Apenas o administrador da clínica altera o acesso da equipe.";
    case "loading":
      return null;
  }
}

/** SQLSTATE de um erro de RPC (PostgrestError expõe `code`). Senão, null. */
export function memberStatusErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** `hint` do erro — é o que distingue as DUAS recusas de regra, ambas 42501. */
export function memberStatusErrorHint(error: unknown): string | null {
  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint.trim()) return hint.trim();
  }
  return null;
}

const EXPECTED = new Set(["42501", "22023", "P0002"]);

/** Erros ESPERADOS (autorização/estado) — viram mensagem, não vão ao Sentry. */
export function isExpectedMemberStatusError(error: unknown): boolean {
  const code = memberStatusErrorCode(error);
  return code !== null && EXPECTED.has(code);
}

/**
 * Mensagem para Desativar/Reativar. Os códigos vêm das RPCs do WP-TEAM-2b-ii:
 *   42501 + OWNER_CANNOT_BE_DEACTIVATED  — é o dono da clínica
 *   42501 + SELF_DEACTIVATION_NOT_ALLOWED — está desativando a si mesmo
 *   42501 (sem hint)                      — não é admin da clínica daquele profissional
 *   22023 — parâmetro obrigatório ausente
 *   P0002 — o profissional não existe mais
 *
 * As duas primeiras são regra de negócio, não falta de permissão — e o texto tem de dizer o que
 * fazer, não só que não deu.
 */
export function memberStatusErrorMessage(error: unknown): string {
  const hint = memberStatusErrorHint(error);
  if (hint === "OWNER_CANNOT_BE_DEACTIVATED") {
    return "O dono da clínica não pode ser desativado. Transfira a posse da clínica antes.";
  }
  if (hint === "SELF_DEACTIVATION_NOT_ALLOWED") {
    return "Você não pode desativar o próprio cadastro. Peça a outro administrador.";
  }
  switch (memberStatusErrorCode(error)) {
    case "42501":
      return "Apenas o administrador desta clínica pode alterar o acesso da equipe.";
    case "22023":
      return "Dados incompletos para concluir a alteração. Atualize a página e tente de novo.";
    case "P0002":
      return "Este profissional não existe mais. Atualize a lista.";
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ACESSO DO PRÓPRIO USUÁRIO À CLÍNICA (o que a tela de explicação usa)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `ok`           — tem pelo menos UMA clínica ativa: o painel abre normalmente.
 * `deactivated`  — TEM cadastro, e em nenhuma clínica ele está ativo: foi desativado.
 * `no-clinic`    — a RPC não devolveu clínica nenhuma: estado honesto e DIFERENTE do anterior
 *                  (aqui não houve corte; nunca houve vínculo com clínica).
 * `unknown`      — não deu para saber (erro na RPC). Ver a nota de fail-open abaixo.
 * `loading`      — ainda perguntando.
 */
export type ClinicAccess = "loading" | "ok" | "deactivated" | "no-clinic" | "unknown";

export interface ClinicAccessInput {
  memberships: readonly ClinicMembership[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Decide o que o painel deve dizer ao profissional logado sobre o PRÓPRIO acesso.
 *
 * ⚠️ FAIL-OPEN DE PROPÓSITO, e é a única regra desta família que não é fail-closed: em erro a
 * resposta é `unknown` e o painel abre. Esta tela NÃO é portão de segurança — o portão é a RLS,
 * que já devolve zero linha para quem foi cortado. Se a RPC falhar (rede, deploy), fechar o
 * painel trancaria do lado de fora gente ATIVA, trocando uma explicação por um incidente. O
 * inverso — deixar entrar quem foi cortado — não expõe nada: ele encontra um painel vazio, que é
 * exatamente o que este WP existe para explicar.
 */
export function resolveClinicAccess(input: ClinicAccessInput): ClinicAccess {
  if (input.isLoading) return "loading";
  if (input.isError) return "unknown";
  const rows = input.memberships;
  if (!rows) return "unknown";
  if (rows.length === 0) return "no-clinic";
  return rows.some((m) => isActiveProfessionalStatus(m.status)) ? "ok" : "deactivated";
}

/**
 * As clínicas em que o acesso está desativado — é o que a tela nomeia. A RPC devolve apenas
 * clinic_id, nome e status: a tela não inventa nada além disso.
 */
export function deactivatedClinics(
  memberships: readonly ClinicMembership[] | undefined,
): ClinicMembership[] {
  return (memberships ?? []).filter((m) => !isActiveProfessionalStatus(m.status));
}
