// Busca da lista de pacientes (puro, sem I/O). Filtra SOMENTE a lista que a RLS já entregou à
// clínica — não amplia visibilidade nem consulta o servidor.

/** Termo de busca normalizado: sem espaços nas pontas, minúsculo. Vazio = sem filtro. */
export function normalizePatientSearchTerm(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Casa por trecho do nome OU do e-mail, sem diferenciar maiúsculas. Sem heurística de Gmail:
 * "ana.lima" não casa "analima" (o e-mail é comparado como está cadastrado).
 */
export function matchesPatientSearch(
  profile: { full_name?: string | null; email?: string | null } | null | undefined,
  term: string,
): boolean {
  if (!term) return true;
  const name = (profile?.full_name ?? "").toLowerCase();
  const email = (profile?.email ?? "").toLowerCase();
  return name.includes(term) || email.includes(term);
}
