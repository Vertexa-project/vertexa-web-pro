import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { captureException } from "@/lib/observability/sentry";

/**
 * Extrai um rótulo NÃO-sensível do query key (primeiro segmento, ex.: "patient",
 * "appointments") para agrupar erros no Sentry. O restante do key pode conter id de
 * paciente (UUID) → NÃO é anexado ao evento.
 */
function queryScope(key: unknown): string | undefined {
  return Array.isArray(key) && typeof key[0] === "string" ? key[0] : undefined;
}

/**
 * Ponto único onde TODA leitura/escrita via react-query (logo, todo erro do Supabase que
 * sobe pela camada `api/`) é reportado à observabilidade — sem tocar em `api/`/`hooks/`.
 * Report-only: não re-lança, não muda UI nem retry. Comportamento de produto inalterado.
 * O objeto de erro do Supabase passa por scrubbing no `beforeSend` antes de sair.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      captureException(error, { source: "react-query", scope: queryScope(query.queryKey) });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      captureException(error, {
        source: "react-query",
        scope: queryScope(mutation.options.mutationKey) ?? "mutation",
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
