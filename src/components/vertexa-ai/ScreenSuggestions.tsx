import { useFinContext } from "@/hooks/useFin";
import { hasClinicalAccess, suggestionsFor } from "@/lib/domain/vertexaAi";
import type { AiScreenContext } from "@/types/vertexaAi";

/** SugestoesDaTela: pedidos prontos que mudam conforme a tela (no Hoje "quem ligar", na ficha "resumo para o retorno"). */
export function ScreenSuggestions({
  screen,
  onPick,
  disabled,
}: {
  screen: AiScreenContext;
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  const { access } = useFinContext();
  const clinical = hasClinicalAccess(access.isAdmin, access.roles.map((r) => r.role));
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sugestões para esta tela">
      {suggestionsFor(screen, clinical).map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
