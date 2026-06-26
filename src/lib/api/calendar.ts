// Camada de dados da integração Google Calendar (Sessão 10) — read-only, multi-tenant.
// Leituras (connection/cache) vão direto às tabelas (só METADADO — tokens são DENY-ALL no banco).
// Connect/sync/disconnect chamam as Edge Functions (Deno) via supabase.functions.invoke —
// é lá (service_role) que os tokens são trocados/guardados. O client NUNCA vê client_secret/refresh_token.
import { supabase } from "@/lib/supabase";
import type { CalendarConnection, CalendarEventCache } from "@/types/db";

/** Invoca uma Edge Function e normaliza o erro para um código legível (ex.: "google_not_configured"). */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = "function_error";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload?.error) code = String(payload.error);
      } catch (_e) {
        // corpo não-JSON: mantém o código genérico.
      }
    }
    throw new Error(code);
  }
  return data as T;
}

/** Conexão (metadado) da clínica, se existir. Mais recente primeiro. Nunca expõe token. */
export async function getCalendarConnection(clinicId: string): Promise<CalendarConnection | null> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select(
      "id, clinic_id, professional_id, provider, google_account_email, google_calendar_id, calendar_name, scopes, status, last_synced_at, created_at, updated_at",
    )
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CalendarConnection | null) ?? null;
}

/** Eventos espelhados do Google na janela [from, to), escopados por clínica e ordenados por início. */
export async function listCalendarEvents(
  clinicId: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarEventCache[]> {
  const { data, error } = await supabase
    .from("calendar_event_cache")
    .select("id, connection_id, clinic_id, google_event_id, title, starts_at, ends_at, all_day, status, synced_at")
    .eq("clinic_id", clinicId)
    .gte("starts_at", fromISO)
    .lt("starts_at", toISO)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CalendarEventCache[];
}

export interface StartConnectInput {
  clinicId: string;
  professionalId: string | null;
  /** Origem do SPA p/ o callback voltar (ex.: window.location.origin). */
  redirectTo: string;
}

/** Inicia o OAuth: a Edge Function gera o state e devolve a URL de consentimento do Google. */
export async function startGoogleCalendarConnect(input: StartConnectInput): Promise<{ url: string }> {
  return invokeFn<{ url: string }>("google-calendar-auth", {
    clinicId: input.clinicId,
    professionalId: input.professionalId,
    redirectTo: input.redirectTo,
  });
}

export interface CalendarTargetInput {
  clinicId: string;
  professionalId?: string | null;
}

/** Sincroniza (read-only) os eventos da agenda conectada para o cache. */
export async function syncGoogleCalendar(
  input: CalendarTargetInput,
): Promise<{ synced: number; status: string }> {
  return invokeFn<{ synced: number; status: string }>("google-calendar-sync", {
    clinicId: input.clinicId,
    professionalId: input.professionalId ?? null,
  });
}

/** Desconecta: revoga no Google (best-effort) e apaga conexão + tokens + cache (cascade). */
export async function disconnectGoogleCalendar(
  input: CalendarTargetInput,
): Promise<{ disconnected: boolean; removed: number }> {
  return invokeFn<{ disconnected: boolean; removed: number }>("google-calendar-disconnect", {
    clinicId: input.clinicId,
    professionalId: input.professionalId ?? null,
  });
}
