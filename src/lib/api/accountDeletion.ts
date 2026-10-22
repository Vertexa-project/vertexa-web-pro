import { supabase } from "@/lib/supabase";

export interface DeletionRequest { id: string; patientId: string; patientName: string; requestedAt: string }
export interface StoredFile { bucket: string; path: string }

/** Pedidos de exclusão abertos da clínica (a política de leitura já limita ao admin da clínica). */
export async function listOpenDeletionRequests(): Promise<DeletionRequest[]> {
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("id, patient_id, requested_at, patients(profiles(full_name))")
    .eq("status", "open")
    .order("requested_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; patient_id: string; requested_at: string; patients: { profiles: { full_name: string } | null } | null }[]).map((r) => ({
    id: r.id, patientId: r.patient_id, requestedAt: r.requested_at, patientName: r.patients?.profiles?.full_name ?? "Paciente",
  }));
}

/** Anonimiza o cadastro no banco e devolve os arquivos que ainda precisam sair do Storage. */
export async function executeAccountDeletion(requestId: string): Promise<StoredFile[]> {
  const { data, error } = await supabase.rpc("execute_account_deletion", { p_request: requestId });
  if (error) throw error;
  return (data ?? []) as StoredFile[];
}

/** Remove os arquivos pela API do Storage (o banco não deixa apagar direto) e confirma. Devolve quantos NÃO saíram. */
export async function removeStoredFiles(requestId: string, files: StoredFile[]): Promise<number> {
  const byBucket = new Map<string, string[]>();
  for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  let failed = 0;
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) failed += paths.length;
  }
  if (failed === 0) {
    const { error } = await supabase.rpc("account_files_removed", { p_request: requestId });
    if (error) throw error;
  }
  return failed;
}
