// Permissões de UI por DISCIPLINA (WP-DISC B). ESPELHO do mapa do banco (migration
// 20260725090000_wp_disc_a_disciplines.sql). ⚠️ MANTER EM SINCRONIA com as policies de ESCRITA:
// qualquer mudança no mapa do banco DEVE ser refletida aqui (o teste `disciplines.test.ts` trava o
// espelho). A autorização REAL é a RLS por disciplina no banco; isto é gating de UI, não autorização.
//
// Regras (do banco):
//   nutrition_plans, meals, supplements ......... nutricionista
//   workout_plans, workouts, workout_exercises .. educador_fisico OU fisioterapeuta
//   body_assessments ............................ nutricionista | educador_fisico | fisioterapeuta | medico
//   patient_documents, appointments ............. NÃO escopados (ausentes deste mapa de propósito)
// Autorização é UNIÃO (OU): pode escrever se possuir QUALQUER disciplina exigida. Acumular só amplia.

/** Códigos canônicos (= public.disciplines.code). Os RÓTULOS vêm do banco (não hardcodar na UI). */
export const DISCIPLINE_CODES = [
  "medico",
  "nutricionista",
  "fisioterapeuta",
  "educador_fisico",
  "psicologo",
  "outro",
] as const;
export type DisciplineCode = (typeof DISCIPLINE_CODES)[number];

/** Superfícies de escrita ESCOPADAS por disciplina (documentos/agenda NÃO entram — não são escopados). */
export type ScopedSurface = "nutrition" | "supplements" | "workout" | "bodyAssessment";

/** ESPELHO do mapa do banco: superfície → disciplinas que podem escrever (UNIÃO). */
export const DISCIPLINE_WRITE_MAP: Record<ScopedSurface, readonly DisciplineCode[]> = {
  nutrition: ["nutricionista"],
  supplements: ["nutricionista"],
  workout: ["educador_fisico", "fisioterapeuta"],
  bodyAssessment: ["nutricionista", "educador_fisico", "fisioterapeuta", "medico"],
};

export interface DisciplinePermissions {
  canEditNutrition: boolean;
  canEditSupplements: boolean;
  canEditWorkout: boolean;
  canEditBodyAssessment: boolean;
}

/**
 * Deriva as permissões da UNIÃO das disciplinas do profissional. NUNCA interseção; NUNCA de `type`.
 * Acumular disciplinas só amplia. Conjunto vazio ⇒ nenhuma escrita escopada (mas lê tudo — a leitura
 * é integrada e independe disto).
 */
export function derivePermissions(disciplines: readonly string[]): DisciplinePermissions {
  const owns = (required: readonly DisciplineCode[]) => required.some((d) => disciplines.includes(d));
  return {
    canEditNutrition: owns(DISCIPLINE_WRITE_MAP.nutrition),
    canEditSupplements: owns(DISCIPLINE_WRITE_MAP.supplements),
    canEditWorkout: owns(DISCIPLINE_WRITE_MAP.workout),
    canEditBodyAssessment: owns(DISCIPLINE_WRITE_MAP.bodyAssessment),
  };
}

/** Permissões de quem não possui disciplina (não escreve nada escopado). */
export const NO_DISCIPLINE_PERMISSIONS: DisciplinePermissions = derivePermissions([]);

/** Motivo PT-BR do bloqueio por disciplina (exibido quando a ação fica desabilitada). */
export const DISCIPLINE_REASON: Record<ScopedSurface, string> = {
  nutrition: "Requer a disciplina Nutricionista.",
  supplements: "Requer a disciplina Nutricionista.",
  workout: "Requer a disciplina Educador Físico ou Fisioterapeuta.",
  bodyAssessment:
    "Requer uma disciplina clínica (Nutricionista, Educador Físico, Fisioterapeuta ou Médico).",
};

/** true se a superfície é permitida pelas permissões derivadas. */
export function canWriteSurface(perms: DisciplinePermissions, surface: ScopedSurface): boolean {
  switch (surface) {
    case "nutrition":
      return perms.canEditNutrition;
    case "supplements":
      return perms.canEditSupplements;
    case "workout":
      return perms.canEditWorkout;
    case "bodyAssessment":
      return perms.canEditBodyAssessment;
  }
}

/**
 * Erro de escrita bloqueada no CLIENTE (defesa em profundidade, antes de tocar o banco). Sem PII.
 * A barreira real é a RLS/RPC; isto evita um caminho de escrita que só falharia no banco.
 */
export class WriteForbiddenError extends Error {
  readonly surface: ScopedSurface;
  constructor(surface: ScopedSurface) {
    super(`forbidden: requires discipline for ${surface}`);
    this.name = "WriteForbiddenError";
    this.surface = surface;
  }
}

/**
 * Detecta negação de escrita por disciplina — vinda do CLIENTE (WriteForbiddenError) OU do BANCO:
 * RPC `save_*` lança 'forbidden: requires <disciplina>'; as policies diretas violam RLS. Sem PII.
 */
export function isDisciplineDenied(err: unknown): boolean {
  if (err instanceof WriteForbiddenError) return true;
  const anyErr = err as { message?: string; code?: string } | null;
  const msg = anyErr?.message ?? "";
  return (
    /forbidden:\s*requires/i.test(msg) ||
    /violates row-level security/i.test(msg) ||
    anyErr?.code === "42501"
  );
}

/**
 * Mensagem amigável para uma escrita negada. Se a superfície é conhecida (WriteForbiddenError ou
 * passada explicitamente), usa o motivo específico; senão, mensagem genérica. Nunca vaza stack/PII.
 */
export function writeDeniedMessage(err: unknown, surface?: ScopedSurface): string {
  const s = err instanceof WriteForbiddenError ? err.surface : surface;
  if (s) return DISCIPLINE_REASON[s];
  return "Você não tem a disciplina necessária para editar isto.";
}

/**
 * Mapeamento SÓ-DEMO: persona do seletor de demonstração → disciplinas. Sob auth REAL, as
 * disciplinas vêm do banco (professional_disciplines), NUNCA daqui (o demo não tem dados no banco).
 */
export function demoDisciplinesForRole(role: string): DisciplineCode[] {
  switch (role) {
    case "doctor":
      return ["medico"];
    case "nutritionist":
      return ["nutricionista"];
    case "trainer":
      return ["educador_fisico"];
    case "physio":
      return ["fisioterapeuta"];
    default:
      return []; // admin / other: sem disciplina clínica
  }
}
