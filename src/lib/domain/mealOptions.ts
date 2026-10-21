// Opções de refeição (PDF do Ernâni, tela 19). A "Opção 1" é a própria refeição; as alternativas vêm em meal.options.
export const MAX_ALTERNATIVES = 5;
/** Alternativa com valor calórico "parecido": até 15% de diferença da refeição. */
export const SIMILAR_KCAL_PCT = 15;

export interface MealOption { items: string[]; calories: number | null }

/** Lê o jsonb do banco com segurança (valor inesperado vira lista vazia). */
export function parseOptions(raw: unknown): MealOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    const items = Array.isArray(o?.items) ? o.items.filter((x: unknown): x is string => typeof x === "string" && x.trim() !== "") : [];
    if (items.length === 0) return [];
    const c = o?.calories;
    return [{ items, calories: typeof c === "number" && Number.isFinite(c) ? c : null }];
  });
}

/** Aviso quando a alternativa foge do valor da refeição; null se está parecida ou falta número para comparar. */
export function kcalWarning(base: number | null, option: number | null): string | null {
  if (!base || option == null || base <= 0) return null;
  const pct = Math.round((Math.abs(option - base) / base) * 100);
  return pct > SIMILAR_KCAL_PCT ? `${pct}% de diferença da refeição (${base} kcal). Opções costumam ter valor parecido.` : null;
}
