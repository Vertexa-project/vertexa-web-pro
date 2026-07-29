// RÓTULOS DA EQUIPE NO CHAT DO PAINEL (WP-CHAT-B itens 1, 3 e 5).
//
// Funções PURAS sobre o que a RPC `public.channel_professionals` devolve (profile_id, full_name,
// type, specialty, disciplines). Nada de embed, nada de mock.
//
// POR QUE A RPC: `professionals_select` é `profile_id = current_profile_id() OR
// is_clinic_admin(clinic_id)`. Um profissional COMUM não lê a linha do COLEGA — e `profiles_select`
// (`can_see_profile`) também não, porque nenhum dos 4 ramos cobre "colega da mesma clínica". Embed
// bloqueado por RLS não devolve erro: devolve VAZIO. A RPC é SECURITY DEFINER com portão
// `can_read_channel` e é o único caminho que não some com a informação em silêncio.
import { professionalTypeLabel } from "@/lib/domain/format";
import type { ChannelProfessional, ChatMessageView } from "@/types/db";

/**
 * Exibido quando a RPC não trouxe disciplina, especialidade NEM tipo. É DELIBERADO que exista: o
 * bug desta família é a informação sumir sem que nada indique falta. Ausência vira fato visível.
 */
export const DISCIPLINE_NOT_INFORMED = "Disciplina não informada";

/**
 * Rótulo de uma disciplina. Os rótulos são do BANCO (public.disciplines) — a convenção do painel é
 * não hardcodar rótulo de disciplina na UI. Code desconhecido (ou catálogo ainda não carregado) NÃO
 * desaparece da tela: vira texto legível a partir do próprio code.
 */
export function disciplineLabel(code: string, labelByCode: ReadonlyMap<string, string>): string {
  const known = labelByCode.get(code);
  if (known?.trim()) return known;
  const humanized = code.replace(/_/g, " ").trim();
  return humanized ? humanized.charAt(0).toUpperCase() + humanized.slice(1) : code;
}

/**
 * Qualificação do profissional, por PRECEDÊNCIA: disciplines (catálogo) > specialty > type.
 * `null` só quando a RPC não trouxe nenhuma das três — quem chama mostra DISCIPLINE_NOT_INFORMED,
 * nunca um espaço em branco.
 */
export function professionalQualification(
  prof: Pick<ChannelProfessional, "disciplines" | "specialty" | "type">,
  labelByCode: ReadonlyMap<string, string>,
): string | null {
  const codes = (prof.disciplines ?? []).filter((c) => c.trim());
  if (codes.length > 0) return codes.map((c) => disciplineLabel(c, labelByCode)).join(" · ");

  const specialty = prof.specialty?.trim();
  if (specialty) return specialty;

  return prof.type ? professionalTypeLabel(prof.type) : null;
}

/**
 * Índice profile_id -> nome, a partir da RPC. É o que permite pôr nome no AUTOR DA CITAÇÃO quando
 * o remetente é um colega — caso em que o embed de `profiles` chega nulo por RLS.
 */
export function namesByProfileId(professionals: ChannelProfessional[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of professionals) {
    const name = p.name.trim();
    if (name) map.set(p.profileId, name);
  }
  return map;
}

/** true se o profissional logado foi marcado NESTA mensagem. `null` de perfil nunca casa. */
export function mentionsProfile(
  message: Pick<ChatMessageView, "mentioned_profile_ids">,
  profileId: string | null,
): boolean {
  if (!profileId) return false;
  return message.mentioned_profile_ids.includes(profileId);
}
