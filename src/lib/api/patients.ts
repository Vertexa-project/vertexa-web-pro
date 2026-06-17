import { supabase } from "@/lib/supabase";
import type {
  Patient,
  PatientDetail,
  PatientListItem,
  PatientStatus,
  Profile,
  ProfessionalSummary,
  ProfessionalType,
} from "@/types/db";

// Shapes crus retornados pelos selects aninhados do Supabase.
interface RawSnap {
  score: number | null;
  level: string | null;
  status: PatientStatus | null;
  weekly_completion_rate: number | null;
  calculated_at: string;
}
interface RawProfessional {
  id: string;
  type: ProfessionalType;
  profile: { full_name: string | null } | null;
}
interface RawLink {
  professionals: RawProfessional | null;
}
interface RawEvent {
  created_at: string;
}
interface RawPatientListRow {
  id: string;
  goal: string | null;
  current_weight: number | null;
  start_date: string | null;
  profile: Pick<Profile, "full_name" | "email" | "avatar_url"> | null;
  adherence_snapshots: RawSnap[] | null;
  professional_patient_links: RawLink[] | null;
  activity_events: RawEvent[] | null;
}

function byDateDesc(a: string | null, b: string | null): number {
  return (b ?? "").localeCompare(a ?? "");
}

function mapProfessionals(links: RawLink[] | null): ProfessionalSummary[] {
  return (links ?? [])
    .map((l) => l.professionals)
    .filter((p): p is RawProfessional => Boolean(p))
    .map((p) => ({ id: p.id, type: p.type, full_name: p.profile?.full_name ?? null }));
}

export async function listPatients(): Promise<PatientListItem[]> {
  const { data, error } = await supabase
    .from("patients")
    .select(
      `id, goal, current_weight, start_date,
       profile:profiles ( full_name, email, avatar_url ),
       adherence_snapshots ( score, level, status, weekly_completion_rate, calculated_at ),
       professional_patient_links ( professionals ( id, type, profile:profiles ( full_name ) ) ),
       activity_events ( created_at )`,
    )
    .order("start_date", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawPatientListRow[];
  return rows.map((row) => {
    const latestSnap =
      [...(row.adherence_snapshots ?? [])].sort((a, b) => byDateDesc(a.calculated_at, b.calculated_at))[0] ??
      null;
    const lastActivityAt =
      [...(row.activity_events ?? [])].sort((a, b) => byDateDesc(a.created_at, b.created_at))[0]?.created_at ??
      null;
    return {
      id: row.id,
      goal: row.goal,
      current_weight: row.current_weight,
      start_date: row.start_date,
      profile: row.profile ?? null,
      snapshot: latestSnap,
      professionals: mapProfessionals(row.professional_patient_links),
      lastActivityAt,
    };
  });
}

interface RawPatientDetailRow extends Patient {
  profile: Profile | null;
  professional_patient_links: RawLink[] | null;
}

export async function getPatient(id: string): Promise<PatientDetail> {
  const { data, error } = await supabase
    .from("patients")
    .select(
      `*,
       profile:profiles ( * ),
       professional_patient_links ( professionals ( id, type, profile:profiles ( full_name ) ) )`,
    )
    .eq("id", id)
    .single();
  if (error) throw error;

  const row = data as unknown as RawPatientDetailRow;
  return {
    ...row,
    profile: row.profile ?? null,
    professionals: mapProfessionals(row.professional_patient_links),
  };
}
