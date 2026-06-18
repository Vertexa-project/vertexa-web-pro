import { supabase } from "@/lib/supabase";

/** Nome (full_name) de um profile pelo id. Usado p/ saudar o profissional atuante. */
export async function getProfileName(profileId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  return (data as { full_name: string | null } | null)?.full_name ?? null;
}
