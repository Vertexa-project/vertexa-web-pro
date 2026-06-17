import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/types/db";

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}
