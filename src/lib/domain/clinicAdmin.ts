// Derivação PURA do sinal "é admin da clínica?" para a UI (WP-CLINIC-ADMIN-SIGNAL).
// A autoridade REAL vive no banco (RPC public.am_i_clinic_admin → dono OU clinic_role='admin'); aqui só
// consolidamos o resultado com a regra FAIL-CLOSED: só é admin quando o banco respondeu explicitamente
// `true`. Qualquer outro estado (carregando, indefinido, erro) ⇒ NÃO-admin — nunca exibir área de admin
// "no escuro". Testável sem DOM/react (usada pelo hook useIsClinicAdmin).

export interface ClinicAdminInput {
  /** Retorno bruto da RPC am_i_clinic_admin (undefined enquanto carrega/sem dado). */
  data: boolean | undefined;
  /** A query falhou? */
  isError: boolean;
}

/**
 * Resolve "é admin da clínica?" de forma FAIL-CLOSED.
 * `true` somente quando a RPC retornou `true`; erro/indefinido ⇒ `false`.
 */
export function resolveClinicAdmin(input: ClinicAdminInput): boolean {
  if (input.isError) return false;
  return input.data === true;
}
