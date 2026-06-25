import { Settings2 } from "lucide-react";

/**
 * Tela de configuração ausente. Exibida no boot quando faltam as variáveis do Supabase
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Substitui o antigo throw em
 * lib/supabase.ts, que deixava a aplicação em tela branca (React nem montava).
 *
 * Em DEV, mostra exatamente o que falta + como resolver. Em produção, mensagem genérica
 * (sem expor detalhes de infraestrutura).
 */
export function EnvConfigError() {
  const isDev = import.meta.env.DEV;
  const missing = [
    import.meta.env.VITE_SUPABASE_URL ? null : "VITE_SUPABASE_URL",
    import.meta.env.VITE_SUPABASE_ANON_KEY ? null : "VITE_SUPABASE_ANON_KEY",
  ].filter(Boolean) as string[];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Settings2 className="h-7 w-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Configuração necessária</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          O painel não conseguiu encontrar as credenciais de acesso aos dados. Avise o
          responsável técnico para concluir a configuração.
        </p>
      </div>

      {isDev ? (
        <div className="max-w-xl space-y-3 rounded-lg border border-border bg-card px-5 py-4 text-left">
          <p className="text-sm font-medium text-foreground">Variáveis ausentes (DEV):</p>
          <ul className="list-inside list-disc text-sm text-destructive">
            {missing.map((v) => (
              <li key={v}>
                <code>{v}</code>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Copie <code>.env.example</code> para <code>.env</code> e preencha os valores do
            projeto Supabase compartilhado. Depois, reinicie <code>npm run dev</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
