// WP-ASAAS-04 — conversão de valores monetários Asaas (reais decimais) para centavos inteiros.
//
// A API Asaas expõe valores como number decimal em reais (ex.: 10, 10.01, 99.99). Persistimos
// SEMPRE em centavos inteiros (bigint) para nunca carregar float em coluna financeira. A
// conversão ingênua Math.round(value * 100) sofre com erro de ponto flutuante e, pior, aceita
// silenciosamente valores com mais de 2 casas decimais (ex.: 10.005) como se fossem centavos
// exatos. Aqui: rejeitamos qualquer valor que não seja um número finito, não-negativo E
// exatamente representável em centavos (tolerância de 1e-6 sobre o produto por 100).
//
// Retorna null em vez de lançar: o caller (normalizePaymentSnapshot) decide o errorCode e o
// event vira failed non-retryable (value_not_exact_cents) — nunca um snapshot com valor errado.

const CENTS_TOLERANCE = 1e-6;

/**
 * Converte um valor decimal em reais para centavos inteiros.
 * @returns centavos (>= 0) ou null se o valor for inválido / não exatamente representável.
 *
 * Aceita: number finito >= 0 com no máximo 2 casas decimais efetivas (10, 10.00, 10.01, 0.1,
 * 99.99, 1000.05, 0). Rejeita: null/undefined, não-number, NaN, ±Infinity, negativo, e
 * qualquer valor cujo *100 não caia dentro de CENTS_TOLERANCE de um inteiro (ex.: 10.005).
 */
export function parseAsaasAmountToCents(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;

  const raw = value * 100;
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) > CENTS_TOLERANCE) return null;

  // rounded já é inteiro seguro para os ranges financeiros do Vertexa; garante Number seguro.
  if (!Number.isSafeInteger(rounded)) return null;
  return rounded;
}
