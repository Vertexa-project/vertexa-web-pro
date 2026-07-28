// Camada de dados do JOIN de clínica (WP-JOIN-1).
//
// DIREÇÃO DO FLUXO: o profissional PEDE acesso a uma clínica apresentando o código dela; o admin
// aprova. A web NUNCA consulta pendentes globalmente — não existe função aqui para isso, de
// propósito. A leitura da fila é um SELECT simples: a RLS de clinic_join_requests devolve
// exatamente o que o chamador pode ver (os próprios pedidos, ou os da clínica que ele administra).
//
// Escrita SEMPRE por RPC SECURITY DEFINER; o autor do pedido é derivado do servidor (auth.uid()),
// nunca enviado pelo client. Erros crus são repassados — quem traduz é lib/domain/clinicJoin.ts.
import { supabase } from "@/lib/supabase";

export type JoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ClinicJoinRequest {
  id: string;
  profileId: string;
  clinicId: string;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
}

interface RawRow {
  id: string;
  profile_id: string;
  clinic_id: string;
  status: JoinRequestStatus;
  created_at: string;
  decided_at: string | null;
}

const toRequest = (r: RawRow): ClinicJoinRequest => ({
  id: r.id,
  profileId: r.profile_id,
  clinicId: r.clinic_id,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

/**
 * Solicita acesso a uma clínica pelo CÓDIGO. Idempotente no banco: reapresentar o mesmo código
 * devolve o pedido aberto que já existe, em vez de criar outro. Retorna o id do pedido.
 */
export async function requestClinicAccess(joinCode: string): Promise<string> {
  const { data, error } = await supabase.rpc("request_clinic_access", { p_join_code: joinCode });
  if (error) throw error;
  return data as string;
}

/**
 * Os pedidos DO USUÁRIO LOGADO. Sem filtro por profile: a policy já restringe
 * (profile_id = current_profile_id() OR is_clinic_admin(clinic_id)) — por isso filtramos por
 * status/ordem aqui e deixamos a autoridade no banco. Mais recente primeiro.
 */
export async function listMyJoinRequests(): Promise<ClinicJoinRequest[]> {
  const { data, error } = await supabase
    .from("clinic_join_requests")
    .select("id, profile_id, clinic_id, status, created_at, decided_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as RawRow[]).map(toRequest);
}

/**
 * Quantos pedidos PENDENTES a clínica tem. Usado só como INDICADOR no painel do admin — a tela
 * de aprovação (com a lista) é o WP-2. A RLS garante que um admin só conta a própria clínica.
 */
export async function countPendingJoinRequests(clinicId: string): Promise<number> {
  const { count, error } = await supabase
    .from("clinic_join_requests")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/** Gera um novo código de acesso para a clínica (RPC admin-only). Invalida o anterior. */
export async function rotateClinicJoinCode(clinicId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rotate_clinic_join_code", { p_clinic_id: clinicId });
  if (error) throw error;
  return data as string;
}
