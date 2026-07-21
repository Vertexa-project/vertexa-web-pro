import { supabase } from "@/lib/supabase";
import type { Clinic } from "@/types/db";

/**
 * Clínica pelo id — usada no cabeçalho de relatórios (nome da clínica). A web só LÊ.
 * Isolamento real por clínica é dívida de RLS (#11–#14); aqui só resolvemos o nome.
 */
export async function getClinic(clinicId: string): Promise<Clinic | null> {
  const { data, error } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Clinic | null;
}

export interface CreateClinicResult {
  clinicId: string;
  professionalId: string;
}

/**
 * Cria a PRÓPRIA clínica do usuário logado via RPC SECURITY DEFINER `create_clinic_with_owner`
 * (WP-ONBOARDING). O DONO é derivado do SERVIDOR (auth.uid()) — a web NÃO envia owner (não forjável).
 * A RPC é transacional (cria clínica + linha de professionals admin + destrava o perfil, tudo-ou-nada)
 * e recusa a segunda clínica do mesmo dono (guarda-corpo). Repassa o erro cru (a UI o traduz por `hint`).
 */
export async function createClinicWithOwner(name: string): Promise<CreateClinicResult> {
  const { data, error } = await supabase.rpc("create_clinic_with_owner", { p_name: name });
  if (error) throw error;
  const row = (data ?? {}) as { clinic_id?: string; professional_id?: string };
  return { clinicId: row.clinic_id ?? "", professionalId: row.professional_id ?? "" };
}
