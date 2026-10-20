import { supabase } from "@/lib/supabase";
import type { Supplement } from "@/types/db";

/**
 * AUTORIA de suplementos pela WEB (editor do profissional). A tabela `supplements` foi criada pela
 * S3 do app e o APP a LÊ (getMySupplements, ordena por `order_index`). Escrevemos EXATAMENTE as
 * colunas que o app consome (name, dose, time_label, order_index; patient_id no create) — sem
 * renomear/remover nada. NÃO tocamos em `supplement_intakes` (o "tomado" é do paciente/app).
 * Policies sprint: `sprint_supplement_write` (ALL anon/auth) já permite INSERT/UPDATE/DELETE.
 */

/** Lista de suplementos do paciente, na MESMA ordem que o app lê (order_index asc). */
export async function listPatientSupplements(patientId: string): Promise<Supplement[]> {
  const { data, error } = await supabase
    .from("supplements")
    .select("*")
    .eq("patient_id", patientId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true }); // desempate estável
  if (error) throw error;
  return (data ?? []) as Supplement[];
}

export interface CreateSupplementInput {
  patientId: string;
  name: string;
  dose?: string | null;
  timeLabel?: string | null;
  /** 'supplement' (padrão) ou 'medication' (só médico — a RLS impõe). */
  kind?: "supplement" | "medication";
  brand?: string | null;
  notes?: string | null;
  /** "HH:MM:SS" ou null. */
  reminderTime?: string | null;
  /** Posição na lista; se omitido, entra no fim (max(order_index)+1). */
  orderIndex?: number;
}

export async function createSupplement(input: CreateSupplementInput): Promise<Supplement> {
  const { patientId, name } = input;
  let orderIndex = input.orderIndex;
  if (orderIndex == null) {
    // Append ao fim: a lista do app é ordenada por order_index, então o novo item vai por último.
    const { data: last, error: qErr } = await supabase
      .from("supplements")
      .select("order_index")
      .eq("patient_id", patientId)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (qErr) throw qErr;
    orderIndex = ((last as { order_index: number } | null)?.order_index ?? -1) + 1;
  }
  const { data, error } = await supabase
    .from("supplements")
    .insert({
      patient_id: patientId,
      name: name.trim(),
      dose: input.dose?.trim() || null,
      time_label: input.timeLabel?.trim() || null,
      kind: input.kind ?? "supplement",
      brand: input.brand?.trim() || null,
      notes: input.notes?.trim() || null,
      reminder_time: input.reminderTime || null,
      order_index: orderIndex,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Supplement;
}

export interface UpdateSupplementInput {
  id: string;
  name?: string;
  dose?: string | null;
  timeLabel?: string | null;
  brand?: string | null;
  notes?: string | null;
  reminderTime?: string | null;
  orderIndex?: number;
}

export async function updateSupplement(input: UpdateSupplementInput): Promise<Supplement> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.dose !== undefined) patch.dose = input.dose?.trim() || null;
  if (input.timeLabel !== undefined) patch.time_label = input.timeLabel?.trim() || null;
  if (input.brand !== undefined) patch.brand = input.brand?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.reminderTime !== undefined) patch.reminder_time = input.reminderTime || null;
  if (input.orderIndex !== undefined) patch.order_index = input.orderIndex;

  const { data, error } = await supabase
    .from("supplements")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Supplement;
}

/**
 * Remove um suplemento da lista. NÃO escrevemos em `supplement_intakes`; a FK
 * `supplement_intakes.supplement_id ON DELETE CASCADE` limpa marcações órfãs no banco — e o app
 * já intersecta os intakes com os ids da lista, então não conta itens removidos.
 */
export async function deleteSupplement(id: string): Promise<void> {
  const { error } = await supabase.from("supplements").delete().eq("id", id);
  if (error) throw error;
}
