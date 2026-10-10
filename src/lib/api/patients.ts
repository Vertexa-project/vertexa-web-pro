import { supabase } from "@/lib/supabase";
import { activeProfessionalsFromLinks } from "@/lib/domain/patientTeam";
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
  /** professional_patient_links.status — text livre no banco; NULO conta como 'active'. */
  status: string | null;
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
  birth_date: string | null;
  profile: Pick<Profile, "full_name" | "email" | "avatar_url" | "avatar_path"> | null;
  adherence_snapshots: RawSnap[] | null;
  professional_patient_links: RawLink[] | null;
  activity_events: RawEvent[] | null;
  weight_logs: RawWeightLog[] | null;
  progress_photos: RawPhoto[] | null;
}

function byDateDesc(a: string | null, b: string | null): number {
  return (b ?? "").localeCompare(a ?? "");
}

/**
 * Responsáveis da paciente para LEITURA CORRIDA (listagem e header do perfil): SÓ VÍNCULOS
 * ATIVOS (WP-2bi-UI).
 *
 * POR QUE O FILTRO EXISTE: desde a migration `20260805090000` (aplicada em produção) o admin
 * pode DESATIVAR um vínculo. O desativado perde o acesso clínico na hora — os helpers de RLS
 * filtram `coalesce(status,'active')='active'` — mas continuaria aparecendo aqui como
 * "responsável" se a UI não filtrasse, porque a linha do vínculo é PRESERVADA de propósito (é o
 * histórico). Ou seja: sem este filtro a tela afirmaria algo que o banco já nega.
 *
 * O filtro é do CLIENT, e de propósito: um filtro embutido no PostgREST (`!inner`) removeria a
 * PACIENTE da listagem quando ela não tivesse nenhum vínculo ativo — exatamente o caso que o
 * badge "sem responsável ativo" precisa enxergar.
 *
 * A ÚNICA superfície que mostra vínculo INATIVO é a seção "Equipe da paciente"
 * (lib/api/patientTeam.ts), que consulta a tabela por conta própria.
 */
function mapProfessionals(links: RawLink[] | null): ProfessionalSummary[] {
  return activeProfessionalsFromLinks<RawProfessional>(links).map((p) => ({
    id: p.id,
    type: p.type,
    full_name: p.profile?.full_name ?? null,
  }));
}

export async function listPatients(): Promise<PatientListItem[]> {
  const { data, error } = await supabase
    .from("patients")
    .select(
      `id, goal, current_weight, start_date, birth_date,
       profile:profiles ( full_name, email, avatar_url, avatar_path ),
       adherence_snapshots ( score, level, status, weekly_completion_rate, calculated_at ),
       professional_patient_links ( status, professionals ( id, type, profile:profiles!professionals_profile_id_fkey ( full_name ) ) ),
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
      birth_date: row.birth_date,
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
       professional_patient_links ( status, professionals ( id, type, profile:profiles!professionals_profile_id_fkey ( full_name ) ) )`,
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
// O nome do paciente vive em profiles.full_name (não há name em patients). Sob a RLS real
// (WP-05B), o client NÃO insere em `profiles` (nasce via trigger handle_new_user). O cadastro
// roda pela RPC SECURITY DEFINER `create_patient` (WP-APP-1 / ACCESS-PARTNER-01A), que — de
// forma TRANSACIONAL e com AUTORIZAÇÃO INTERNA (o chamador tem de ser admin/owner da
// clínica-alvo; member não cria) — encadeia
// profiles(role='patient') -> patients -> professional_patient_links(vínculo amarrado ao
// chamador, se ele tiver professional row) -> body_assessments(anamnese opcional). VÍNCULO COM A CONTA (WP-VINCULO-1): os dois
// sentidos são cobertos, e por mecanismos diferentes. Cadastro ANTES do 1º login -> o paciente
// entra sem auth_user_id e o handle_new_user liga por match-by-email no login. Conta JÁ existente
// no momento do cadastro -> a própria create_patient procura em auth.users (mesma normalização
// lower(btrim(...)) do gatilho) e o profile NASCE vinculado; só reivindica uid LIVRE, nunca um já
// usado por outro profile. professionalId do input não é mais enviado: o servidor deriva o vínculo
// do próprio chamador (anti-forja).
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
  if (!input.clinicId) throw new Error("Clínica do profissional não resolvida.");

  // Caminho de escrita CONTROLADO: RPC SECURITY DEFINER (transacional; autorização e vínculo
  // revalidados no servidor). O provisionamento inteiro (profile+patient+link+anamnese) é
  // atômico — erro no meio não deixa paciente/perfil parcial.
  const a = input.anamnese;
  const { data, error } = await supabase.rpc("create_patient", {
    p_clinic_id: input.clinicId,
    p_full_name: fullName,
    p_email: input.email?.trim() || null,
    p_birth_date: input.birthDate || null,
    p_sex: input.sex || null,
    p_height_cm: input.heightCm ?? null,
    p_goal: input.goal?.trim() || null,
    p_start_weight: input.startWeight ?? null,
    p_target_weight: input.targetWeight ?? null,
    p_anamnese_method: a?.method || null,
    p_anamnese_weight: a?.weight ?? null,
    p_anamnese_body_fat_pct: a?.bodyFatPct ?? null,
    p_anamnese_notes: a?.notes?.trim() || null,
  });
  if (error) throw error;
  return data as string; // patients.id do paciente criado
}

// ===== Edição de cadastro (WP-PATIENT-ADMIN-EDIT-01) =====
// Única via de escrita: RPC SECURITY DEFINER `update_patient_registration`. O servidor deriva a
// clínica do PACIENTE (nunca do browser), exige admin da clínica, serializa a decisão de identidade
// por e-mail e nunca toca auth_user_id/clinic_id/profile_id/current_weight/billing. Sem `.from()`.
export interface UpdatePatientRegistrationInput {
  patientId: string;
  fullName: string;
  /** Enviado sempre; com Auth o servidor só aceita o valor atual (no-op). */
  email: string | null;
  birthDate: string | null; // yyyy-mm-dd
  sex: string | null;
  heightCm: number | null;
  goal: string | null;
  startWeight: number | null;
  targetWeight: number | null;
  /** Nulo = manter a data atual. */
  startDate: string | null;
}

export interface UpdatePatientRegistrationResult {
  patientId: string;
  changedFields: string[];
  loginEmailLocked: boolean;
}

export async function updatePatientRegistration(
  input: UpdatePatientRegistrationInput,
): Promise<UpdatePatientRegistrationResult> {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Nome do paciente é obrigatório.");

  const { data, error } = await supabase.rpc("update_patient_registration", {
    p_patient_id: input.patientId,
    p_full_name: fullName,
    p_email: input.email?.trim() || null,
    p_birth_date: input.birthDate || null,
    p_sex: input.sex || null,
    p_height_cm: input.heightCm ?? null,
    p_goal: input.goal?.trim() || null,
    p_start_weight: input.startWeight ?? null,
    p_target_weight: input.targetWeight ?? null,
    p_start_date: input.startDate || null,
  });
  if (error) throw error;

  const row = (data ?? {}) as {
    patient_id?: string;
    changed_fields?: string[];
    login_email_locked?: boolean;
  };
  return {
    patientId: row.patient_id ?? input.patientId,
    changedFields: row.changed_fields ?? [],
    loginEmailLocked: row.login_email_locked === true,
  };
}

export interface PatientRegistrationAccess {
  hasLoginAccount: boolean;
  /** null quando não há conta; false = e-mail do cadastro diverge do da conta (drift legado). */
  loginEmailMatchesRegistration: boolean | null;
}

// ===== Exclusão de cadastro não utilizado (WP-PATIENT-DIAG-DELETE-01) =====
// Única via: RPCs SECURITY DEFINER. O servidor deriva paciente/profile/clínica, exige admin da
// clínica do paciente e recalcula a elegibilidade sob lock. Sem `.from().delete()`.
export interface PatientDeletionEligibility {
  eligible: boolean;
  /** Código UPPER_SNAKE do servidor (PATIENT_DELETE_*). */
  reason: string;
}

export async function getPatientDeletionEligibility(patientId: string): Promise<PatientDeletionEligibility> {
  const { data, error } = await supabase.rpc("get_patient_deletion_eligibility", {
    p_patient_id: patientId,
  });
  if (error) throw error;
  const row = (data ?? {}) as { eligible?: boolean; reason?: string };
  return { eligible: row.eligible === true, reason: row.reason ?? "" };
}

export async function deleteUnusedPatientRegistration(patientId: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_unused_patient_registration", {
    p_patient_id: patientId,
  });
  if (error) throw error;
  if ((data as { deleted?: boolean } | null)?.deleted !== true) {
    throw new Error("Exclusão não confirmada pelo servidor.");
  }
}

/** Estado de acesso (admin-only, só booleanos). Define se o e-mail é editável na UI. */
export async function getPatientRegistrationAccess(patientId: string): Promise<PatientRegistrationAccess> {
  const { data, error } = await supabase.rpc("get_patient_registration_access", {
    p_patient_id: patientId,
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    has_login_account?: boolean;
    login_email_matches_registration?: boolean | null;
  };
  return {
    hasLoginAccount: row.has_login_account === true,
    loginEmailMatchesRegistration:
      row.login_email_matches_registration === undefined ? null : row.login_email_matches_registration,
  };
}
