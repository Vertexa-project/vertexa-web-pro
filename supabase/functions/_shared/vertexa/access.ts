// Papel → acesso a dados clínicos. A barreira REAL é a RLS + public.vertexa_ai_can_access_patient;
// isto só decide o que a IA nem tenta ler (Recepção/Financeiro/Estoque ficam só com a agenda).
const NON_CLINICAL_ROLES = new Set(["recepcao", "financeiro", "estoquista"]);

export function hasClinicalAccess(isAdmin: boolean, staffRoles: string[]): boolean {
  if (isAdmin) return true;
  if (staffRoles.length === 0) return true;
  return !staffRoles.every((r) => NON_CLINICAL_ROLES.has(r));
}

export const MAX_MESSAGE = 600;
export function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= MAX_MESSAGE ? t : null;
}
