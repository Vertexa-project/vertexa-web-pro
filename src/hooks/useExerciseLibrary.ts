import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { listExerciseLibrary } from "@/lib/api/exerciseLibrary";
import { buildExerciseIndex } from "@/lib/domain/exerciseLibrary";
import { qk } from "@/lib/queryKeys";

/** Catálogo muda raramente: cache longo, uma leitura por sessão. */
export function useExerciseLibrary() {
  const query = useQuery({
    queryKey: qk.exerciseLibrary,
    queryFn: listExerciseLibrary,
    staleTime: 60 * 60 * 1000,
  });
  const index = useMemo(() => buildExerciseIndex(query.data ?? []), [query.data]);
  return { ...query, items: query.data ?? [], index };
}
