import { supabase } from "@/lib/supabase";
import type { Campaign, CampaignBroadcast } from "@/types/db";
import type { BroadcastAudience } from "@/lib/domain/campaigns";

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

/** Cria (desligados) os modelos padrão da clínica. Só admin; idempotente. Retorna quantos criou. */
export async function ensureClinicCampaigns(clinicId: string): Promise<number> {
  const { data, error } = await supabase.rpc("ensure_clinic_campaigns", { p_clinic: clinicId });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function updateCampaign(input: { id: string; title?: string; body?: string; days?: number | null; isActive?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.message_template = input.body;
  if (input.days !== undefined) patch.days_threshold = input.days;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  const { data, error } = await supabase.from("campaigns").update(patch).eq("id", input.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("forbidden: campaign not updated");
}

/** Envios por campanha nos últimos 30 dias. */
export async function listSendCounts(): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("campaign_sends").select("campaign_id").gte("sent_at", since).limit(10000);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ campaign_id: string }>) out[r.campaign_id] = (out[r.campaign_id] ?? 0) + 1;
  return out;
}

export async function listBroadcasts(): Promise<CampaignBroadcast[]> {
  const { data, error } = await supabase.from("campaign_broadcasts").select("*").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as CampaignBroadcast[];
}

export async function previewBroadcast(clinicId: string, audience: BroadcastAudience, days: number | null): Promise<number> {
  const { data, error } = await supabase.rpc("preview_broadcast", { p_clinic: clinicId, p_audience: audience, p_days: days });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function sendBroadcast(input: { clinicId: string; audience: BroadcastAudience; days: number | null; title: string; body: string }): Promise<{ recipients: number }> {
  const { data, error } = await supabase.rpc("send_broadcast", { p_clinic: input.clinicId, p_audience: input.audience, p_days: input.days, p_title: input.title, p_body: input.body });
  if (error) throw error;
  return { recipients: Number((data as { recipients?: number } | null)?.recipients ?? 0) };
}
