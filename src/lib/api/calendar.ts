// Camada de dados da integração Google Calendar — read-only, dono = professional autenticado.
// Leituras (connection/cache) vão direto às tabelas (só METADADO — tokens são DENY-ALL no banco).
// Connect/sync/disconnect chamam as Edge Functions (Deno) via supabase.functions.invoke.
// clinicId/professionalId no body são HINTS validados no servidor contra o JWT.
import { supabase } from "@/lib/supabase";
import { selectOwnGoogleConnection } from "@/lib/domain/calendarPolicy";
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

const CONNECTION_SELECT =
  "id, clinic_id, professional_id, provider, google_account_email, google_calendar_id, calendar_name, scopes, status, last_synced_at, created_at, updated_at";

/** Conexão Google do PRÓPRIO profissional. Nunca a de outro membro da clínica. Sem token. */
export async function getCalendarConnection(
  clinicId: string,
  professionalId: string,
): Promise<CalendarConnection | null> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select(CONNECTION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("professional_id", professionalId)
    .eq("provider", "google");
  if (error) throw error;
  const chosen = selectOwnGoogleConnection(data ?? [], professionalId, clinicId);
  if (!chosen) return null;
  return (data ?? []).find((row) => row.id === chosen.id) as CalendarConnection | null;
}

/** Eventos do cache da conexão do caller (não a clínica inteira). */
export async function listCalendarEvents(
  connectionId: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarEventCache[]> {
  const { data, error } = await supabase
    .from("calendar_event_cache")
    .select("id, connection_id, clinic_id, google_event_id, title, starts_at, ends_at, all_day, status, synced_at")
    .eq("connection_id", connectionId)
    .gte("starts_at", fromISO)
    .lt("starts_at", toISO)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CalendarEventCache[];
}

export interface StartConnectInput {
  clinicId: string;
  professionalId: string;
  redirectTo: string;
}

/** Inicia o OAuth. Hints são validados no servidor contra o JWT. */
export async function startGoogleCalendarConnect(input: StartConnectInput): Promise<{ url: string }> {
  return invokeFn<{ url: string }>("google-calendar-auth", {
    clinicId: input.clinicId,
    professionalId: input.professionalId,
    redirectTo: input.redirectTo,
  });
}

export interface CalendarTargetInput {
  clinicId: string;
  professionalId: string;
}

export async function syncGoogleCalendar(
  input: CalendarTargetInput,
): Promise<{ synced: number; status: string }> {
  return invokeFn<{ synced: number; status: string }>("google-calendar-sync", {
    clinicId: input.clinicId,
    professionalId: input.professionalId,
  });
}

export async function disconnectGoogleCalendar(
  input: CalendarTargetInput,
): Promise<{ disconnected: boolean; removed: number }> {
  return invokeFn<{ disconnected: boolean; removed: number }>("google-calendar-disconnect", {
    clinicId: input.clinicId,
    professionalId: input.professionalId,
  });
}
