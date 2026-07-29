import { AlertTriangle, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DISCIPLINE_NOT_INFORMED, professionalQualification } from "@/lib/domain/chatTeam";
import type { ChannelProfessional } from "@/types/db";

interface MentionPickerProps {
  professionals: ChannelProfessional[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onPick: (professional: ChannelProfessional) => void;
  /** code -> label de public.disciplines. Vazio degrada para o code humanizado, nunca para branco. */
  labelByCode: ReadonlyMap<string, string>;
}

/**
 * Seletor de @ do painel (WP-CHAT-B item 1). QUATRO estados explícitos — carregando, erro com nova
 * tentativa, ninguém para marcar, lista — e nenhum deles é "não acontece nada".
 *
 * ⚠️ O PAINEL ABRE SEMPRE. A tentação é renderizar só quando `professionals.length > 0`: aí uma
 * falha da RPC vira um botão de @ que não faz nada, que é indistinguível de "não há ninguém" e é
 * exatamente o defeito silencioso que este WP existe para matar. O erro é VISÍVEL e tem retry.
 */
export function MentionPicker({
  professionals,
  isLoading,
  isError,
  onRetry,
  onPick,
  labelByCode,
}: MentionPickerProps) {
  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-lg"
      role="dialog"
      aria-label="Marcar um profissional"
    >
      <div className="border-b px-3 py-2">
        <p className="text-xs font-medium text-foreground">Marcar um profissional</p>
        <p className="text-xs text-muted-foreground">Quem você marcar recebe um aviso desta conversa.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando a equipe…
        </div>
      ) : isError ? (
        <div className="px-3 py-4" role="alert">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <span>Não foi possível carregar a equipe desta conversa.</span>
          </p>
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : professionals.length === 0 ? (
        <div className="px-3 py-6 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Nenhum outro profissional nesta conversa para marcar.</span>
          </p>
        </div>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {professionals.map((p) => {
            const qualification = professionalQualification(p, labelByCode);
            return (
              <li key={p.profileId}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                >
                  <span className="text-sm font-medium text-foreground">{p.name}</span>
                  {/* Ausência de disciplina VIRA TEXTO. Nunca uma linha em branco. */}
                  <span className="text-xs text-muted-foreground">
                    {qualification ?? DISCIPLINE_NOT_INFORMED}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
