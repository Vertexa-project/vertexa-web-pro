// Lógica PURA do quadro da jornada (WP-KANBAN B): ordenação de colunas, derivação da coluna inicial
// para paciente SEM estado, agrupamento por coluna e o reducer da atualização OTIMISTA do move.
// Sem React, sem banco — testável isoladamente. A autorização real do move é a RPC do banco.

export interface JourneyColumn {
  id: string;
  clinic_id: string;
  name: string;
  position: number;
  color: string | null;
  is_initial: boolean;
  created_at: string;
}

/** Estado atual: patient_id → column_id. Paciente AUSENTE ⇒ deriva para a coluna inicial. */
export type JourneyStateMap = Record<string, string>;

/** Colunas na ordem do quadro (position asc; desempate estável por nome). */
export function sortColumns(columns: readonly JourneyColumn[]): JourneyColumn[] {
  return [...columns].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** Coluna inicial (is_initial). Fallback defensivo: a primeira por posição. null se não há colunas. */
export function initialColumnId(columns: readonly JourneyColumn[]): string | null {
  const initial = columns.find((c) => c.is_initial);
  if (initial) return initial.id;
  return sortColumns(columns)[0]?.id ?? null;
}

/** Coluna de um paciente: o estado GRAVADO ou (derivado, não gravado) a coluna inicial. */
export function resolvePatientColumn(
  patientId: string,
  state: JourneyStateMap,
  columns: readonly JourneyColumn[],
): string | null {
  return state[patientId] ?? initialColumnId(columns);
}

/**
 * Aplica um move ao mapa de estado de forma IMUTÁVEL (não muta a entrada) — base da atualização
 * otimista: o snapshot anterior permanece intacto para a REVERSÃO se a RPC falhar.
 */
export function applyMove(
  state: JourneyStateMap,
  patientId: string,
  toColumnId: string,
): JourneyStateMap {
  return { ...state, [patientId]: toColumnId };
}

export interface ColumnBucket<P> {
  column: JourneyColumn;
  patients: P[];
}

/**
 * Agrupa pacientes por coluna, na ORDEM do quadro, derivando quem não tem estado para a inicial.
 * Um estado apontando para coluna fora da visão do usuário também cai na inicial (fail-safe).
 */
export function groupPatientsByColumn<P extends { id: string }>(
  patients: readonly P[],
  state: JourneyStateMap,
  columns: readonly JourneyColumn[],
): ColumnBucket<P>[] {
  const ordered = sortColumns(columns);
  const initial = initialColumnId(columns);
  const buckets = new Map<string, P[]>(ordered.map((c) => [c.id, []]));
  for (const p of patients) {
    const target = state[p.id] ?? initial;
    const bucket = (target && buckets.get(target)) || (initial ? buckets.get(initial) : undefined);
    bucket?.push(p);
  }
  return ordered.map((c) => ({ column: c, patients: buckets.get(c.id) ?? [] }));
}
