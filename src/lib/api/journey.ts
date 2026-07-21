// Camada de dados da JORNADA do paciente (WP-KANBAN B). Lê journey_columns (por clínica),
// patient_journey_state (estado atual) e journey_milestone_ack (reconhecimentos); move via RPC
// move_patient_journey e reconhece marcos via RPC ack_journey_milestone. A RLS/RPC do banco é o
// gate REAL: membro lê colunas / só admin escreve; leitura de estado/histórico/ack por quem acessa
// o paciente; ESCRITA de estado/histórico SÓ pelas RPCs (o autor é derivado do servidor).
import { supabase } from "@/lib/supabase";
import type { JourneyColumn, JourneyStateMap } from "@/lib/domain/journeyBoard";

export type { JourneyColumn } from "@/lib/domain/journeyBoard";

/** Colunas da clínica, na ordem definida (position asc). */
export async function listJourneyColumns(clinicId: string): Promise<JourneyColumn[]> {
  const { data, error } = await supabase
    .from("journey_columns")
    .select("id, clinic_id, name, position, color, is_initial, created_at")
    .eq("clinic_id", clinicId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JourneyColumn[];
}

/** Estado atual (patient_id → column_id). A RLS devolve só os pacientes que o usuário acessa. */
export async function listJourneyState(): Promise<JourneyStateMap> {
  const { data, error } = await supabase.from("patient_journey_state").select("patient_id, column_id");
  if (error) throw error;
  const map: JourneyStateMap = {};
  for (const row of (data ?? []) as { patient_id: string; column_id: string }[]) {
    map[row.patient_id] = row.column_id;
  }
  return map;
}

export interface MilestoneAck {
  patientId: string;
  key: string;
}

/** Marcos reconhecidos (patient_id + milestone_key). RLS escopa aos pacientes acessíveis. */
export async function listMilestoneAcks(): Promise<MilestoneAck[]> {
  const { data, error } = await supabase.from("journey_milestone_ack").select("patient_id, milestone_key");
  if (error) throw error;
  return ((data ?? []) as { patient_id: string; milestone_key: string }[]).map((r) => ({
    patientId: r.patient_id,
    key: r.milestone_key,
  }));
}

/**
 * Move o paciente de coluna via RPC (estado + histórico atômicos; autor derivado do servidor).
 * O banco RECUSA externo/não-vinculado (42501) e coluna de outra clínica — nunca confiar só na UI.
 */
export async function movePatientJourney(patientId: string, toColumnId: string): Promise<void> {
  const { error } = await supabase.rpc("move_patient_journey", {
    p_patient_id: patientId,
    p_to_column_id: toColumnId,
  });
  if (error) throw error;
}

/** Reconhece um marco (chave canônica: 'start' | 'birthday:YYYY' | 'day_<offset>'). Autor do servidor. */
export async function ackJourneyMilestone(patientId: string, milestoneKey: string): Promise<void> {
  const { error } = await supabase.rpc("ack_journey_milestone", {
    p_patient_id: patientId,
    p_milestone_key: milestoneKey,
  });
  if (error) throw error;
}

// ===== Administração de colunas (SÓ admin — a RLS de escrita exige is_clinic_admin) =====

export interface NewJourneyColumn {
  clinicId: string;
  name: string;
  color: string | null;
  position: number;
}

export interface JourneyColumnPatch {
  name?: string;
  color?: string | null;
  position?: number;
}

/** Cria coluna (is_initial começa false — a inicial se define à parte, nunca duas ao mesmo tempo). */
export async function createJourneyColumn(input: NewJourneyColumn): Promise<void> {
  const { error } = await supabase.from("journey_columns").insert({
    clinic_id: input.clinicId,
    name: input.name,
    color: input.color,
    position: input.position,
    is_initial: false,
  });
  if (error) throw error;
}

/** Renomeia / muda cor / reordena uma coluna. */
export async function updateJourneyColumn(id: string, patch: JourneyColumnPatch): Promise<void> {
  const { error } = await supabase.from("journey_columns").update(patch).eq("id", id);
  if (error) throw error;
}

/** Remove uma coluna. O banco recusa (FK 23503) se houver estado/histórico apontando para ela. */
export async function deleteJourneyColumn(id: string): Promise<void> {
  const { error } = await supabase.from("journey_columns").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Troca as posições de duas colunas (reordenação por vizinho — mover ↑/↓). `position` NÃO é única no
 * banco, então não há conflito transitório ao trocar os valores.
 */
export async function swapColumnPositions(
  a: { id: string; position: number },
  b: { id: string; position: number },
): Promise<void> {
  const r1 = await supabase.from("journey_columns").update({ position: b.position }).eq("id", a.id);
  if (r1.error) throw r1.error;
  const r2 = await supabase.from("journey_columns").update({ position: a.position }).eq("id", b.id);
  if (r2.error) throw r2.error;
}

/**
 * Define a coluna INICIAL respeitando o índice único parcial (uq_journey_columns_one_initial):
 * LIMPA a inicial atual e SÓ ENTÃO marca a nova — nunca há duas iniciais ao mesmo tempo (0 é válido).
 */
export async function setInitialColumn(clinicId: string, columnId: string): Promise<void> {
  // 1) Limpa a inicial atual — EXCETO a própria alvo (se ela já for a inicial, nada muda). Respeita o
  //    índice único parcial: nunca há duas iniciais ao mesmo tempo (0 é válido momentaneamente).
  const clear = await supabase
    .from("journey_columns")
    .update({ is_initial: false })
    .eq("clinic_id", clinicId)
    .eq("is_initial", true)
    .neq("id", columnId);
  if (clear.error) throw clear.error;
  // 2) Marca a nova E CONFIRMA que uma linha foi afetada. Sem a checagem, um alvo removido
  //    concorrentemente daria 0 linhas SEM erro — deixando a clínica com ZERO inicial em silêncio.
  //    Aqui isso vira erro explícito (o onError da UI avisa e o onSettled reconcilia a lista).
  const set = await supabase
    .from("journey_columns")
    .update({ is_initial: true })
    .eq("id", columnId)
    .eq("clinic_id", clinicId)
    .select("id");
  if (set.error) throw set.error;
  if (!set.data || set.data.length === 0) {
    throw new Error("setInitialColumn: coluna-alvo não encontrada (pode ter sido removida).");
  }
}
