import { supabase } from "@/lib/supabase";

/** Provisiona public.profiles do chamador (Google legado sem profile). Sem PA. */
export async function ensureMyProfile(): Promise<void> {
  const { error } = await supabase.rpc("ensure_my_profile");
  if (error) throw error;
}
