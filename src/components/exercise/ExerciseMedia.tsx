import { useState } from "react";
import { Dumbbell } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ExerciseLibraryItem } from "@/lib/domain/exerciseLibrary";

/**
 * Animação do exercício da biblioteca. Tenta o webp animado (leve); se falhar, cai no GIF original;
 * se também falhar, mostra o ícone neutro em vez de imagem quebrada. Enquanto a imagem não chega
 * (ou se ainda é a arte escura do arquivo), o ícone aparece por baixo — nunca um quadro escuro vazio.
 * `zoom` aproxima a figura nas miniaturas (a arte tem muito fundo preto em volta do exercício).
 */
export function ExerciseMedia({
  item,
  className,
  lazy = true,
  zoom = false,
}: {
  item: ExerciseLibraryItem;
  className?: string;
  lazy?: boolean;
  zoom?: boolean;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [loaded, setLoaded] = useState(false);
  const placeholder = (
    <span className="absolute inset-0 flex items-center justify-center text-neutral-500" data-testid="exercise-media-icon">
      <Dumbbell className="h-1/3 w-1/3" aria-hidden />
    </span>
  );
  if (stage === 2) {
    return (
      <div className={cn("relative flex items-center justify-center overflow-hidden bg-neutral-900 text-neutral-500", className)} aria-label={item.name}>
        {placeholder}
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-neutral-900", className)}>
      {loaded ? null : placeholder}
      <img
        key={stage}
        src={stage === 0 ? item.mediaUrl : item.gifUrl}
        alt={item.name}
        loading={lazy ? "lazy" : "eager"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setStage((s) => (s === 0 ? 1 : 2));
        }}
        className={cn("absolute inset-0 h-full w-full object-cover transition-opacity", loaded ? "opacity-100" : "opacity-0", zoom && "scale-[1.45]")}
      />
    </div>
  );
}
