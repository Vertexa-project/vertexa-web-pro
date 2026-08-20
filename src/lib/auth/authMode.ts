/**
 * WP-04A — autenticação única: Supabase/Google real.
 *
 * Não há modo demonstração. VITE_AUTH_MODE deixou de escolher comportamento:
 * - ausente / vazio / "real" → segue (a variável na Vercel ficou inócua);
 * - "demo" ou qualquer outro valor → falha fechado no boot, nunca habilita bypass.
 */
export function assertAuthMode(raw: string | undefined = import.meta.env.VITE_AUTH_MODE): void {
  if (raw === undefined || raw === "" || raw === "real") return;
  throw new Error(
    `VITE_AUTH_MODE=${JSON.stringify(raw)} não é suportado. O painel web usa só autenticação Supabase/Google. Remova a variável ou use VITE_AUTH_MODE=real.`,
  );
}
