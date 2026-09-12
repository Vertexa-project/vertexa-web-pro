// Camada de dados da EQUIPE DA PACIENTE (WP-2bi-UI).
//
// É o ÚNICO lugar do produto que lê vínculo INATIVO. Todo o resto (listagem de pacientes,
// header do perfil) enxerga só os ativos — ver `mapProfessionals` em lib/api/patients.ts.
//
// LEITURA: SELECT simples em professional_patient_links. A policy `ppl_select` já devolve
// exatamente o que o chamador pode ver:
//     owns_professional(professional_id) OR is_self_patient(patient_id)
//     OR is_clinic_admin(patient_clinic(patient_id))
// ⚠️ CONSEQUÊNCIA REAL: um profissional NÃO-admin recebe APENAS a própria linha — não a equipe
// inteira. Não é limitação desta tela, é a RLS que já estava em produção antes deste WP; a tela
// mostra com honestidade o que o servidor devolve (e avisa quando é uma visão parcial).
//
// ESCRITA: SEMPRE pelas RPCs SECURITY DEFINER
//   `deactivate_patient_link` / `reactivate_patient_link` / `assign_patient_professional`
// Nunca INSERT/UPDATE/DELETE direto em professional_patient_links.
// (migration 20260805090000, aplicada). Não existe caminho de UPDATE direto aqui — e nem poderia:
// a mesma migration REVOGOU `update (status)` de `authenticated`, então um UPDATE do client
// receberia 42501 por privilégio. As RPCs gravam a trilha imutável (ppl_status_events) e
// reconciliam o roster do chat na MESMA transação.
//
// Erros crus são repassados; quem traduz é lib/domain/patientTeam.ts.
import { supabase } from "@/lib/supabase";
import type { ProfessionalType } from "@/types/db";

export interface PatientTeamMember {
  /** professional_patient_links.id */
  linkId: string;
  professionalId: string;
  type: ProfessionalType;
  fullName: string | null;
  /** Vínculo de profissional EXTERNO convidado (is_external). */
  isExternal: boolean;
  avatarPath: string | null;
  avatarUrl: string | null;
  /** Texto livre no banco (sem CHECK). NULO conta como 'active' — ver isActiveLinkStatus. */
  status: string | null;
  /** Carimbo da última mudança de status — preenchido pelo SERVIDOR dentro da RPC. */
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  statusReason: string | null;
}

interface RawTeamRow {
  id: string;
  professional_id: string;
  is_external: boolean | null;
  status: string | null;
  status_changed_at: string | null;
  status_reason: string | null;
  professionals: {
    id: string;
    type: ProfessionalType;
    profile: { full_name: string | null; avatar_path: string | null; avatar_url: string | null } | null;
  } | null;
  changed_by_profile: { full_name: string | null } | null;
}

// O embed de `changed_by_profile` usa o NOME DA FK explicitamente
// (professional_patient_links_status_changed_by_fkey) porque status_changed_by é a única coluna
// desta tabela que aponta para profiles — nomear a FK deixa a intenção explícita e imune a um
// futuro segundo caminho para profiles.
const TEAM_SELECT = `
  id, professional_id, is_external, status, status_changed_at, status_reason,
  professionals ( id, type, profile:profiles!professionals_profile_id_fkey ( full_name, avatar_path, avatar_url ) ),
  changed_by_profile:profiles!professional_patient_links_status_changed_by_fkey ( full_name )
`;

const toMember = (r: RawTeamRow): PatientTeamMember => ({
  linkId: r.id,
  professionalId: r.professional_id,
  type: r.professionals?.type ?? "other",
  fullName: r.professionals?.profile?.full_name ?? null,
  avatarPath: r.professionals?.profile?.avatar_path ?? null,
  avatarUrl: r.professionals?.profile?.avatar_url ?? null,
  isExternal: r.is_external ?? false,
  status: r.status,
  statusChangedAt: r.status_changed_at,
  statusChangedByName: r.changed_by_profile?.full_name ?? null,
  statusReason: r.status_reason,
});

/**
 * Vínculos da paciente — ATIVOS **e** INATIVOS. O `.eq("patient_id", …)` é escopo de consulta,
 * NÃO é o controle de acesso (esse é a policy ppl_select).
 */
export async function listPatientTeam(patientId: string): Promise<PatientTeamMember[]> {
  const { data, error } = await supabase
    .from("professional_patient_links")
    .select(TEAM_SELECT)
    .eq("patient_id", patientId);
  if (error) throw error;
  return ((data ?? []) as unknown as RawTeamRow[]).map(toMember);
}

export interface LinkStatusChangeInput {
  professionalId: string;
  patientId: string;
  /** Motivo OPCIONAL → p_reason. Vira parte da trilha imutável; não é obrigatório. */
  reason: string | null;
}

/**
 * Desativa o vínculo. A RPC, na MESMA transação: vira o status, grava a trilha com o autor
 * resolvido no SERVIDOR (nunca do client) e REMOVE o profissional do roster do chat da paciente —
 * é o que faz a perda de acesso valer para leitura E escrita na hora.
 */
export async function deactivatePatientLink(input: LinkStatusChangeInput): Promise<string> {
  const { data, error } = await supabase.rpc("deactivate_patient_link", {
    p_professional_id: input.professionalId,
    p_patient_id: input.patientId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Reativa o vínculo. WP-05A1: se o canal já existir, a RPC devolve o profissional ao roster na
 * mesma transação. Não cria canal. Nenhum código do client tenta forçar roster.
 */
export async function reactivatePatientLink(input: LinkStatusChangeInput): Promise<string> {
  const { data, error } = await supabase.rpc("reactivate_patient_link", {
    p_professional_id: input.professionalId,
    p_patient_id: input.patientId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data as string;
}

export interface AssignPatientProfessionalInput {
  patientId: string;
  professionalId: string;
}

/**
 * Atribui um profissional da mesma clínica (WP-05A2). ÚNICA escrita de atribuição:
 * RPC `assign_patient_professional`. Sem clinic_id. Sem INSERT direto.
 */
export async function assignPatientProfessional(
  input: AssignPatientProfessionalInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("assign_patient_professional", {
    p_patient_id: input.patientId,
    p_professional_id: input.professionalId,
  });
  if (error) throw error;
  return data as string;
}

export interface PatientWithoutProfessional {
  patientId: string;
  fullName: string | null;
  since: string | null;
}

/**
 * Pacientes da clínica SEM nenhum vínculo interno ativo — a VERDADE DO SERVIDOR, uma chamada por
 * clínica (não uma por paciente, e não derivada do que a listagem já trouxe: a listagem é
 * escopada pela RLS de quem está lendo e responderia outra pergunta).
 * Admin da clínica apenas — para não-admin a RPC responde 42501, por isso o chamador só deve
 * acionar quando o sinal de admin for verdadeiro.
 */
export async function listPatientsWithoutActiveProfessional(
  clinicId: string,
): Promise<PatientWithoutProfessional[]> {
  const { data, error } = await supabase.rpc("patients_without_active_professional", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const rows = (data ?? []) as { patient_id: string; full_name: string | null; since: string | null }[];
  return rows.map((r) => ({ patientId: r.patient_id, fullName: r.full_name, since: r.since }));
}
