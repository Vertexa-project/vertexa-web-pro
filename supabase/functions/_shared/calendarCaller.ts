// CALENDAR-02A — resolve o caller a partir do JWT (nunca do body como autoridade).
// Cadeia canônica: auth.uid() → profiles.auth_user_id → professionals.profile_id → clinic.
// Reusa o mesmo contrato de private.current_profile_id / owns_professional — sem RPC nova.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";
import {
  calendarAuthHttpStatus,
  selectCallerMembership,
  type CalendarAuthError,
  type CalendarHints,
  type CalendarMembership,
} from "./calendarPolicy.ts";

export interface CalendarCaller {
  authUserId: string;
  profileId: string;
  professionalId: string;
  clinicId: string;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function deny(error: CalendarAuthError): Response {
  return jsonResponse({ error }, calendarAuthHttpStatus(error));
}

async function verifyJwtUser(req: Request): Promise<{ userId: string } | Response> {
  const token = bearerToken(req);
  if (!token) return deny("unauthenticated");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon) return deny("unauthenticated");

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user?.id) return deny("unauthenticated");
  return { userId: data.user.id };
}

interface ProfessionalRow {
  id: string;
  clinic_id: string | null;
  status: string | null;
  clinics: { status: string | null } | { status: string | null }[] | null;
}

function clinicStatusOf(row: ProfessionalRow): string | null {
  const c = row.clinics;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.status ?? null;
  return c.status ?? null;
}

export async function resolveCalendarCaller(
  req: Request,
  db: SupabaseClient,
  hints: CalendarHints = {},
): Promise<{ ok: true; caller: CalendarCaller } | { ok: false; response: Response }> {
  const user = await verifyJwtUser(req);
  if (user instanceof Response) return { ok: false, response: user };

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.userId)
    .maybeSingle();
  if (!profile?.id) return { ok: false, response: deny("not_professional") };

  const { data: rows } = await db
    .from("professionals")
    .select("id, clinic_id, status, clinics(status)")
    .eq("profile_id", profile.id);

  const memberships: CalendarMembership[] = [];
  for (const row of (rows ?? []) as ProfessionalRow[]) {
    if (!row.clinic_id) continue;
    memberships.push({
      professionalId: row.id,
      clinicId: row.clinic_id,
      professionalStatus: row.status,
      clinicStatus: clinicStatusOf(row),
    });
  }

  const selected = selectCallerMembership(memberships, hints);
  if (!selected.ok) return { ok: false, response: deny(selected.error) };

  return {
    ok: true,
    caller: {
      authUserId: user.userId,
      profileId: profile.id,
      professionalId: selected.membership.professionalId,
      clinicId: selected.membership.clinicId,
    },
  };
}

export function readHints(body: { clinicId?: string; professionalId?: string }): CalendarHints {
  return {
    clinicId: body.clinicId ?? null,
    professionalId: body.professionalId ?? null,
  };
}
