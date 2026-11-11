import { useState } from "react";
import { Dumbbell } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ExerciseLibraryItem } from "@/lib/domain/exerciseLibrary";

/**
 * Animação do exercício da biblioteca. Tenta o webp animado (leve); se falhar, cai no GIF original;
 * se também falhar, mostra o ícone neutro em vez de imagem quebrada.
 */
export function ExerciseMedia({
  item,
  className,
  lazy = true,
}: {
  item: ExerciseLibraryItem;
  className?: string;
  lazy?: boolean;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  if (stage === 2) {
    return (
      <div className={cn("flex items-center justify-center bg-neutral-900 text-neutral-500", className)} aria-label={item.name}>
        <Dumbbell className="h-1/3 w-1/3" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={stage === 0 ? item.mediaUrl : item.gifUrl}
      alt={item.name}
      loading={lazy ? "lazy" : "eager"}
      decoding="async"
      onError={() => setStage((s) => (s === 0 ? 1 : 2))}
      className={cn("bg-neutral-900 object-cover", className)}
    />
  );
}
