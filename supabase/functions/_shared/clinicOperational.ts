import { jsonResponse } from "./cors.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** service_role lê clinics.status. Fail-closed: missing/null/suspended → 403. */
export async function rejectIfClinicNotOperational(
  db: SupabaseClient,
  clinicId: string,
): Promise<Response | null> {
  const { data } = await db.from("clinics").select("status").eq("id", clinicId).maybeSingle();
  if (data?.status === "active") return null;
  return jsonResponse({ error: "clinic_suspended" }, 403);
}
