// Detecção de erros do banco na jornada (WP-KANBAN B) → mensagens claras, SEM PII. A barreira REAL é
// a RLS/RPC do banco; isto só traduz a recusa numa mensagem amigável (defesa em profundidade na UI).

interface DbErrorLike {
  message?: string;
  code?: string;
}

function asErr(err: unknown): DbErrorLike {
  return (err ?? {}) as DbErrorLike;
}

/**
 * Move/ack NEGADO por autorização: a RPC lança 42501 ('not authorized') — ex.: profissional EXTERNO
 * tentando mover, ou vínculo removido. Também cobre violação direta de RLS.
 */
export function isJourneyAuthDenied(err: unknown): boolean {
  const e = asErr(err);
  return (
    e.code === "42501" ||
    /not authorized/i.test(e.message ?? "") ||
    /violates row-level security/i.test(e.message ?? "")
  );
}

/**
 * Coluna EM USO ao remover: FK de patient_journey_state/patient_journey_moves → 23503. O histórico
 * (imutável) fixa as colunas por auditoria, então uma coluna já usada não pode ser removida.
 */
export function isColumnInUse(err: unknown): boolean {
  const e = asErr(err);
  return e.code === "23503" || /foreign key|violates foreign key constraint/i.test(e.message ?? "");
}

/** Tentativa de criar/definir uma SEGUNDA coluna inicial: índice único parcial → 23505. */
export function isDuplicateInitial(err: unknown): boolean {
  const e = asErr(err);
  return (
    e.code === "23505" &&
    /uq_journey_columns_one_initial|is_initial/i.test(e.message ?? "")
  );
}
