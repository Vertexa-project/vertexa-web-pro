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
  type: string;
  created_at: string;
}
interface RawWeightLog {
  measured_at: string;
}
interface RawPhoto {
  taken_at: string;
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
  weight_logs: RawWeightLog[] | null;
  progress_photos: RawPhoto[] | null;
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
       activity_events ( type, created_at ),
       weight_logs ( measured_at ),
       progress_photos ( taken_at )`,
    )
    .order("start_date", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawPatientListRow[];
  return rows.map((row) => {
    const events = row.activity_events ?? [];
    const latestSnap =
      [...(row.adherence_snapshots ?? [])].sort((a, b) => byDateDesc(a.calculated_at, b.calculated_at))[0] ??
      null;
    const lastActivityAt =
      [...events].sort((a, b) => byDateDesc(a.created_at, b.created_at))[0]?.created_at ?? null;
    // Recência por tipo → pendências. Peso = weight_logs (valor canônico); foto =
    // progress_photos; treino = activity_events(type='workout_checked').
    const lastWeightAt =
      [...(row.weight_logs ?? [])].sort((a, b) => byDateDesc(a.measured_at, b.measured_at))[0]?.measured_at ??
      null;
    const lastPhotoAt =
      [...(row.progress_photos ?? [])].sort((a, b) => byDateDesc(a.taken_at, b.taken_at))[0]?.taken_at ?? null;
    const lastWorkoutAt =
      events
        .filter((e) => e.type === "workout_checked")
        .sort((a, b) => byDateDesc(a.created_at, b.created_at))[0]?.created_at ?? null;
    return {
      id: row.id,
      goal: row.goal,
      current_weight: row.current_weight,
      start_date: row.start_date,
      profile: row.profile ?? null,
      snapshot: latestSnap,
      professionals: mapProfessionals(row.professional_patient_links),
      lastActivityAt,
      lastWeightAt,
      lastPhotoAt,
      lastWorkoutAt,
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

// ===== Cadastro de paciente (Sessão 4) =====
// O nome do paciente vive em profiles.full_name (não há name em patients), então o
// cadastro encadeia: profiles (role='patient') -> patients -> professional_patient_links
// (vincula o profissional logado) -> body_assessments (anamnese, opcional).
// ⚠️ NÃO transacional (mesma dívida de saveWorkoutPlan/Nutrition — PENDENCIAS #13): num
// erro no meio, pode sobrar profile/paciente parcial. OK p/ sprint (seed fictício); migrar
// para RPC SECURITY DEFINER + validação de vínculo no servidor antes de dado real (#14).
export interface CreatePatientAnamnese {
  method: string | null; // bioimpedancia | adipometro | dexa | manual
  weight: number | null;
  bodyFatPct: number | null;
  notes: string | null;
}

export interface CreatePatientInput {
  fullName: string;
  email: string | null;
  birthDate: string | null; // ISO date (yyyy-mm-dd)
  sex: string | null;
  heightCm: number | null;
  goal: string | null;
  startWeight: number | null;
  targetWeight: number | null;
  clinicId: string | null; // do profissional logado (isolamento por clínica)
  professionalId: string | null; // professionals.id do profissional logado (vínculo)
  anamnese: CreatePatientAnamnese | null;
}

export async function createPatient(input: CreatePatientInput): Promise<string> {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Nome do paciente é obrigatório.");

  // 1) profile do paciente (role='patient'). full_name + role são NOT NULL.
  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .insert({ role: "patient", full_name: fullName, email: input.email?.trim() || null })
    .select("id")
    .single();
  if (profErr) throw profErr;
  const profileId = (prof as { id: string }).id;

  // 2) paciente (clinic_id = clínica do profissional logado → isolamento).
  const startWeight = input.startWeight ?? null;
  const { data: pat, error: patErr } = await supabase
    .from("patients")
    .insert({
      profile_id: profileId,
      clinic_id: input.clinicId,
      goal: input.goal?.trim() || null,
      birth_date: input.birthDate || null,
      sex: input.sex || null,
      height_cm: input.heightCm ?? null,
      start_weight: startWeight,
      current_weight: startWeight,
      target_weight: input.targetWeight ?? null,
    })
    .select("id")
    .single();
  if (patErr) throw patErr;
  const patientId = (pat as { id: string }).id;

  // 3) vínculo com o profissional logado (se houver profissional resolvido).
  if (input.professionalId) {
    const { error: linkErr } = await supabase
      .from("professional_patient_links")
      .insert({ professional_id: input.professionalId, patient_id: patientId });
    if (linkErr) throw linkErr;
  }

  // 4) anamnese/pré-consulta inicial (opcional) → body_assessments.
  const a = input.anamnese;
  if (a && (a.weight != null || a.bodyFatPct != null || a.method || a.notes)) {
    const { error: baErr } = await supabase.from("body_assessments").insert({
      patient_id: patientId,
      professional_id: input.professionalId,
      method: a.method || null,
      weight: a.weight ?? null,
      body_fat_pct: a.bodyFatPct ?? null,
      measurements: a.notes?.trim() ? { notes: a.notes.trim() } : null,
    });
    if (baErr) throw baErr;
  }

  return patientId;
}
