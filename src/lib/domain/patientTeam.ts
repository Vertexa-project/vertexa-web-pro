// Regras da EQUIPE DA PACIENTE (WP-2bi-UI) — PURAS (sem I/O), testáveis em Node.
// Mesma convenção de teamManagement.ts / clinicJoin.ts / clinicAdmin.ts.
//
// A AUTORIDADE é sempre o banco: as RPCs deactivate/reactivate/assign_patient_professional são fail-closed
// (42501 para quem não é admin da clínica da paciente) e a migration 20260805090000 revogou
// `update (status)` de `authenticated`, de modo que não existe caminho de escrita fora delas.
// O que mora aqui é só o que a UI precisa DECIDIR e EXIBIR — nunca o que ela pode permitir.

import type { ProfessionalWithDisciplines } from "@/lib/api/disciplines";
import type { PatientTeamMember, PatientWithoutProfessional } from "@/lib/api/patientTeam";
import { disciplineLabel } from "@/lib/domain/chatTeam";
import { professionalTypeLabel } from "@/lib/domain/format";
import { isActiveProfessionalStatus } from "@/lib/domain/professionalStatus";

export const LINK_STATUS_ACTIVE = "active";
export const LINK_STATUS_INACTIVE = "inactive";

/**
 * ESPELHO EXATO DA REGRA DO BANCO. Os helpers de RLS que governam o acesso clínico
 * (`private.is_common_professional_of_patient` e `is_external_professional_of_patient`) filtram
 * `coalesce(status,'active') = 'active'`.
 *
 * Consequência que NÃO pode ser "simplificada": status NULO conta como ATIVO. A coluna é text
 * livre e sem CHECK, e vínculos antigos podem ter null. Se a UI tratasse null como inativo,
 * esconderia como "desativado" um profissional que o banco considera responsável — e ainda
 * marcaria a paciente como "sem responsável" enquanto o servidor discorda.
 */
export function isActiveLinkStatus(status: string | null | undefined): boolean {
  return (status ?? LINK_STATUS_ACTIVE) === LINK_STATUS_ACTIVE;
}

/** Rótulo pt-BR do status do vínculo. Qualquer coisa que não seja ativo é "Inativo". */
export function linkStatusLabel(status: string | null | undefined): string {
  return isActiveLinkStatus(status) ? "Ativo" : "Inativo";
}

/** Só os vínculos ATIVOS — o que a leitura corrida (listagem/header) tem direito de mostrar. */
export function onlyActiveMembers(members: readonly PatientTeamMember[]): PatientTeamMember[] {
  return members.filter((m) => isActiveLinkStatus(m.status));
}

/** Forma mínima de uma linha de vínculo embutida num select do PostgREST. */
export interface LinkWithProfessional<T> {
  status: string | null;
  professionals: T | null;
}

/**
 * Dos vínculos embutidos, só os profissionais com vínculo ATIVO. É EXATAMENTE o filtro que
 * `listPatients`/`getPatient` aplicam (lib/api/patients.ts) — mora aqui, puro e genérico, para
 * ser testável em Node: o módulo de api importa o client do Supabase e não roda no runner.
 *
 * Descarta também `professionals` nulo (vínculo cujo profissional o leitor não enxerga pela RLS).
 */
export function activeProfessionalsFromLinks<T>(
  links: readonly LinkWithProfessional<T>[] | null | undefined,
): T[] {
  return (links ?? [])
    .filter((l) => isActiveLinkStatus(l.status))
    .map((l) => l.professionals)
    .filter((p): p is T => Boolean(p));
}

export interface PatientTeamPermissionInput {
  /** Sinal REAL do banco (RPC am_i_clinic_admin), via useIsClinicAdmin. */
  isClinicAdmin: boolean;
  /** O sinal ainda está carregando. */
  isLoading: boolean;
}

/**
 * "Posso OFERECER os botões Desativar/Reativar?" — FAIL-CLOSED.
 *
 * Enquanto o sinal de admin carrega a resposta é NÃO, nunca "talvez": um botão exibido no escuro
 * seria um botão que o servidor recusa com 42501, e erro de permissão em ação destrutiva é a pior
 * forma de descobrir que não se podia. Para quem não é admin a seção continua existindo — só que
 * SOMENTE LEITURA, sem nenhuma ação.
 *
 * Isto NÃO é autorização: a autorização é a RPC. É higiene de interface.
 */
export function canManagePatientTeam(input: PatientTeamPermissionInput): boolean {
  if (input.isLoading) return false;
  return input.isClinicAdmin;
}

/**
 * Ordem da lista: ATIVOS primeiro, depois inativos; dentro de cada grupo, por nome (pt-BR, para
 * acentuação sair na ordem certa). Quem está cuidando da paciente hoje aparece antes de quem
 * saiu — a seção é operacional, não um histórico cronológico.
 */
export function sortPatientTeam(members: readonly PatientTeamMember[]): PatientTeamMember[] {
  return [...members].sort((a, b) => {
    const aActive = isActiveLinkStatus(a.status);
    const bActive = isActiveLinkStatus(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR");
  });
}

export interface PatientTeamSummary {
  total: number;
  active: number;
  inactive: number;
}

export function summarizePatientTeam(members: readonly PatientTeamMember[]): PatientTeamSummary {
  const active = members.filter((m) => isActiveLinkStatus(m.status)).length;
  return { total: members.length, active, inactive: members.length - active };
}

/** Quem desativou. Cai para um genérico: o carimbo é anulável (vínculo nunca desativado, ou
 *  profile que o leitor não enxerga por `can_see_profile`). */
export function changedByLabel(member: Pick<PatientTeamMember, "statusChangedByName">): string {
  const name = member.statusChangedByName?.trim();
  return name ? name : "—";
}

/** SQLSTATE de um erro de RPC (PostgrestError expõe `code`). Senão, null. */
export function linkActionErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** Erros ESPERADOS (autorização/estado) — viram mensagem, não vão ao Sentry. */
const EXPECTED = new Set(["42501", "22023", "P0002"]);

export function isExpectedLinkActionError(error: unknown): boolean {
  const code = linkActionErrorCode(error);
  return code !== null && EXPECTED.has(code);
}

/**
 * Mensagem para Desativar/Reativar. Os três códigos vêm das RPCs (migration 20260805090000):
 *   42501 — não é admin da clínica DA PACIENTE, ou o profissional é de outra clínica
 *   22023 — parâmetro obrigatório ausente
 *   P0002 — o vínculo não existe mais
 */
export function linkActionErrorMessage(error: unknown): string {
  switch (linkActionErrorCode(error)) {
    case "42501":
      return "Apenas o administrador da clínica pode alterar os vínculos desta paciente.";
    case "22023":
      return "Dados incompletos para concluir a alteração. Atualize a página e tente de novo.";
    case "P0002":
      return "Este vínculo não existe mais. Atualize a lista.";
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}

/**
 * Quem o seletor PODE oferecer. Fonte: profissionais da MESMA clínica (consulta já escopada).
 * Fora: inativo na clínica, vínculo já ATIVO. Vínculo inativo ENTRA — assign reativa a linha.
 * Isto não autoriza: a RPC continua fail-closed.
 */
export function eligibleProfessionalsForAssign(
  clinicProfessionals: readonly ProfessionalWithDisciplines[],
  team: readonly PatientTeamMember[],
): ProfessionalWithDisciplines[] {
  const activeLinked = new Set(
    team.filter((m) => isActiveLinkStatus(m.status)).map((m) => m.professionalId),
  );
  return clinicProfessionals
    .filter((p) => isActiveProfessionalStatus(p.status) && !activeLinked.has(p.professionalId))
    .slice()
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR"));
}

/** Qualificação no seletor: todas as disciplinas reais, ou o tipo se o catálogo vier vazio. */
export function formatAssignCandidateQualification(
  professional: Pick<ProfessionalWithDisciplines, "disciplines" | "type">,
  labelByCode: ReadonlyMap<string, string>,
): string {
  const codes = professional.disciplines.filter((c) => c.trim());
  if (codes.length > 0) return codes.map((c) => disciplineLabel(c, labelByCode)).join(" · ");
  return professionalTypeLabel(professional.type);
}

/** Erro do assign. 42501 reusa a tradução já existente; o resto é mensagem genérica segura. */
export function assignActionErrorMessage(error: unknown): string {
  if (linkActionErrorCode(error) === "42501") return linkActionErrorMessage(error);
  return "Não foi possível adicionar este profissional. Atualize a página e tente novamente.";
}

/**
 * Conjunto de `patients.id` SEM responsável ativo, vindo da RPC
 * `patients_without_active_professional`. A listagem consulta este conjunto em vez de deduzir
 * dos vínculos que ela mesma trouxe: a RPC responde pela CLÍNICA inteira e usa o mesmo critério
 * do banco (nenhum vínculo INTERNO ativo — vínculo só externo não conta como responsável),
 * enquanto a listagem é escopada pela RLS de quem está lendo.
 */
export function patientsWithoutProfessionalIds(
  rows: readonly PatientWithoutProfessional[] | undefined,
): Set<string> {
  return new Set((rows ?? []).map((r) => r.patientId));
}
