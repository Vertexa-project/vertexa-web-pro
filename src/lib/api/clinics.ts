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
