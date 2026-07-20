// Sinal REAL de "sou admin desta clínica?" — chama a RPC public.am_i_clinic_admin (SECURITY DEFINER),
// que responde com a MESMA lógica do banco: DONO (clinics.owner_profile_id) OU co-admin
// (professionals.clinic_role='admin'). NÃO usa profiles.role (o anti-padrão AUTH-ADMIN-1). Quando
// clinicId é null, o servidor resolve a clínica do profissional logado. Só retorna boolean.
import { supabase } from "@/lib/supabase";

/** Pergunta ao banco se o usuário logado é admin da clínica (dele, se clinicId ausente). */
export async function amIClinicAdmin(clinicId?: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc("am_i_clinic_admin", {
    p_clinic: clinicId ?? null,
  });
  if (error) throw error;
  return data === true;
}
