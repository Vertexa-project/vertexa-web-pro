// ESTADO DO PROFISSIONAL NA CLÍNICA (consome o WP-TEAM-2b-ii, migration 20260808090000).
//
// A AUTORIDADE é o banco, não esta camada:
//   · `deactivate_professional` / `reactivate_professional` são SECURITY DEFINER e fail-closed —
//     42501 para quem não é admin da clínica DAQUELE profissional, com `hint` distinguindo as
//     duas recusas de regra (dono e autodesativação).
//   · `authenticated` NÃO tem UPDATE nas colunas de estado (revoke de coluna na migration), então
//     não existe caminho de escrita fora dessas RPCs.
//   · `professional_status_events` é append-only: só existe policy de SELECT (admin da clínica).
// O que mora aqui é chamada e mapeamento. Nada de decisão de permissão.
import { supabase } from "@/lib/supabase";

/**
 * Desativa o profissional na clínica. Cascateia no servidor: todos os vínculos ativos dele viram
 * histórico e ele sai do roster das conversas, na MESMA transação.
 * Erros repassados crus (a UI traduz por SQLSTATE + hint): 42501 (não-admin, dono, autodesativação),
 * 22023 (parâmetro ausente), P0002 (profissional inexistente).
 */
export async function deactivateProfessional(
  professionalId: string,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("deactivate_professional", {
    p_professional_id: professionalId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * Reativa o profissional na clínica. ⚠️ NÃO religa vínculo nenhum — assimetria deliberada do
 * banco: devolver o poder de agir na clínica é uma coisa, devolver acesso ao dado clínico de uma
 * paciente é outra, e se reconquista vínculo por vínculo.
 */
export async function reactivateProfessional(
  professionalId: string,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("reactivate_professional", {
    p_professional_id: professionalId,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Um evento da trilha imutável de estado do profissional. */
export interface ProfessionalStatusEvent {
  professionalId: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  changedAt: string;
  /** Nome de quem mudou. `null` quando a RLS de profiles não deixa o leitor ver o autor. */
  changedByName: string | null;
}

interface RawStatusEventRow {
  professional_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  changed_at: string;
  changed_by_profile: { full_name: string | null } | null;
}

/**
 * Trilha de estado dos profissionais da clínica, mais recente primeiro.
 *
 * RLS: `professional_status_events_select` é `is_clinic_admin(clinic_id)` — para quem não é admin
 * a consulta volta VAZIA (não erra). Por isso a tela só a habilita para admin: lista vazia aqui
 * significaria "nunca ninguém foi desativado", e seria mentira para o não-admin.
 *
 * ⚠️ O nome do autor vem por embed em `profiles`, que é governado por `can_see_profile` — se o
 * leitor não enxergar aquele profile, o embed chega NULO (não erra). A tela degrada para um
 * genérico em vez de sumir com a informação.
 */
export async function listProfessionalStatusEvents(
  clinicId: string,
): Promise<ProfessionalStatusEvent[]> {
  const { data, error } = await supabase
    .from("professional_status_events")
    .select(
      "professional_id, from_status, to_status, reason, changed_at, changed_by_profile:profiles ( full_name )",
    )
    .eq("clinic_id", clinicId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as RawStatusEventRow[]).map((r) => ({
    professionalId: r.professional_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    reason: r.reason,
    changedAt: r.changed_at,
    changedByName: r.changed_by_profile?.full_name ?? null,
  }));
}

/** Uma clínica em que o profissional logado tem cadastro, e o status dele nela. */
export interface ClinicMembership {
  clinicId: string;
  clinicName: string;
  status: string;
}

interface RawMembershipRow {
  clinic_id: string;
  clinic_name: string | null;
  status: string | null;
}

/**
 * As clínicas do PRÓPRIO chamador e o status dele em cada uma — RPC `my_clinic_memberships`.
 *
 * É o caminho ESTREITO que o WP-TEAM-2b-ii abriu justamente porque o desativado deixa de ler
 * `public.clinics` (o registro inteiro incluía o `join_code`, que é credencial de entrada). A RPC
 * devolve TRÊS colunas e nada mais: clinic_id, nome e o meu status. Não existe parâmetro — não há
 * como perguntar pelo status de outra pessoa.
 *
 * Fail-closed no servidor: sem profile resolvido devolve VAZIO, não erro.
 */
export async function listMyClinicMemberships(): Promise<ClinicMembership[]> {
  const { data, error } = await supabase.rpc("my_clinic_memberships");
  if (error) throw error;
  return ((data ?? []) as unknown as RawMembershipRow[]).map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name?.trim() || "sua clínica",
    status: r.status ?? "active",
  }));
}
