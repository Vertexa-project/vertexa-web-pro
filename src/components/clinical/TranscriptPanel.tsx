import { useEffect, useRef } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TranscriptSegment } from "@/lib/api/clinical";
import { cn } from "@/lib/utils";

export function TranscriptPanel({
  segments,
  loading,
  highlightOrd,
  live,
}: {
  segments: TranscriptSegment[];
  loading: boolean;
  highlightOrd: number | null;
  live: boolean;
}) {
  const refs = useRef(new Map<number, HTMLLIElement>());
  useEffect(() => {
    if (highlightOrd != null) refs.current.get(highlightOrd)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightOrd]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Transcrição ao vivo</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : segments.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="transcript-empty">
            {live ? "Os trechos aparecem aqui poucos minutos depois de cada pedaço gravado." : "Nenhum trecho transcrito neste atendimento."}
          </p>
        ) : (
          <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1" data-testid="transcript-list">
            {segments.map((s, i) => (
              <li
                key={s.id}
                ref={(el) => {
                  if (el) refs.current.set(s.ord, el);
                }}
                data-ord={s.ord}
                className={cn("rounded-md border p-3 text-sm transition-colors", highlightOrd === s.ord && "border-primary bg-primary/5")}
              >
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Trecho {i + 1}
                  {s.speaker ? ` · ${s.speaker}` : ""}
                </p>
                <p className="break-words">{s.text}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
