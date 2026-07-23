// Camada de dados das DISCIPLINAS (WP-DISC B). Lê public.disciplines (lista canônica) e
// public.professional_disciplines (do profissional logado; da equipe, p/ admin) e chama as RPCs
// admin-only assign_professional_discipline / revoke_professional_discipline. RLS do banco é o gate
// real: o profissional lê as próprias; staff/admin da clínica leem as da equipe; só admin escreve —
// inclusive sobre as PRÓPRIAS disciplinas (WP-DISC-FIX).
import { supabase } from "@/lib/supabase";
import type { ProfessionalType } from "@/types/db";

/** Uma disciplina canônica (public.disciplines). O RÓTULO vem daqui, não hardcodado na UI. */
export interface Discipline {
  code: string;
  label: string;
  isClinical: boolean;
}

/** Lista canônica de disciplinas (para rótulos e para a tela de administração). */
export async function listDisciplines(): Promise<Discipline[]> {
  const { data, error } = await supabase
    .from("disciplines")
    .select("code, label, is_clinical")
    .order("label", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { code: string; label: string; is_clinical: boolean }[]).map((d) => ({
    code: d.code,
    label: d.label,
    isClinical: d.is_clinical,
  }));
}

/** Disciplinas (codes) do profissional logado. Vazio quando não há profissional/disciplina. */
export async function getMyDisciplines(professionalId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("professional_disciplines")
    .select("discipline")
    .eq("professional_id", professionalId);
  if (error) throw error;
  return ((data ?? []) as { discipline: string }[]).map((r) => r.discipline);
}

/** Um profissional da clínica com suas disciplines (para a administração pelo admin). */
export interface ProfessionalWithDisciplines {
  professionalId: string;
  fullName: string | null;
  type: ProfessionalType;
  disciplines: string[];
}

interface RawClinicRow {
  id: string;
  type: ProfessionalType;
  profile: { full_name: string | null } | null;
  professional_disciplines: { discipline: string }[] | null;
}

/**
 * Profissionais da clínica + suas disciplinas (uma consulta, join). Escopado por clinic_id; a RLS
 * de professional_disciplines só devolve linhas que o chamador (staff/admin da clínica) pode ler.
 */
export async function listClinicProfessionalDisciplines(
  clinicId: string,
): Promise<ProfessionalWithDisciplines[]> {
  const { data, error } = await supabase
    .from("professionals")
    .select("id, type, profile:profiles ( full_name ), professional_disciplines ( discipline )")
    .eq("clinic_id", clinicId);
  if (error) throw error;
  return ((data ?? []) as unknown as RawClinicRow[]).map((r) => ({
    professionalId: r.id,
    fullName: r.profile?.full_name ?? null,
    type: r.type,
    disciplines: (r.professional_disciplines ?? []).map((d) => d.discipline),
  }));
}

/**
 * Concede uma disciplina a um profissional (RPC admin-only). O banco nega não-admin e clínica alheia.
 * WP-DISC-FIX: o admin PODE conceder a SI MESMO (destrava a clínica solo) — a auto-atribuição deixou de
 * ser bloqueada; o único gate é ser admin da clínica do profissional-alvo.
 */
export async function assignDiscipline(professionalId: string, discipline: string): Promise<void> {
  const { error } = await supabase.rpc("assign_professional_discipline", {
    p_professional_id: professionalId,
    p_discipline: discipline,
  });
  if (error) throw error;
}

/** Revoga uma disciplina de um profissional (RPC admin-only). */
export async function revokeDiscipline(professionalId: string, discipline: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_professional_discipline", {
    p_professional_id: professionalId,
    p_discipline: discipline,
  });
  if (error) throw error;
}
