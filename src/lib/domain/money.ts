// Dinheiro e quantidades do módulo Financeiro/Estoque (escopo-v1 §3): valores em reais com 2 casas,
// arredondamento meio-para-cima em CADA linha; totais somam as linhas já arredondadas; quantidades até 3 casas.
// Internamente tudo é inteiro (centavos / milésimos) para não herdar erro de ponto flutuante.

/** Arredonda para `decimals` casas, meio-para-cima (positivos) e simétrico para negativos (estorno = espelho). */
export function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  // Passa por notação exponencial em texto: 1.005 → "1.005e2" → 100.5 (e não 100.49999…).
  const shifted = Number(`${Math.abs(value)}e${decimals}`);
  const rounded = Math.round(shifted);
  return sign * Number(`${rounded}e-${decimals}`);
}

/** Reais → centavos inteiros, meio-para-cima. */
export function toCents(reais: number): number {
  return Math.round(roundHalfUp(reais, 2) * 100);
}

/** Centavos → reais (2 casas). */
export function fromCents(cents: number): number {
  return roundHalfUp(cents / 100, 2);
}

/** Quantidade de estoque: até 3 casas. */
export function roundQty(value: number): number {
  return roundHalfUp(value, 3);
}

/** Quantidade em milésimos inteiros. */
export function toMilli(qty: number): number {
  return Math.round(roundQty(qty) * 1000);
}

/** Porcentagem de um valor em centavos, arredondada por linha em centavos. */
export function percentOfCents(cents: number, pct: number): number {
  return roundHalfUp((cents * pct) / 100, 0);
}

/** Soma de linhas JÁ arredondadas (centavos). */
export function sumCents(lines: number[]): number {
  return lines.reduce((acc, v) => acc + v, 0);
}

/** "1.234,50" (sem símbolo) — para campos de edição e exportação legível. */
export function formatDecimalBR(value: number, decimals = 2): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "12,5" / "12.5" → número; vazio/ inválido → null. Aceita até `maxDecimals` casas. */
export function parseDecimalBR(raw: string, maxDecimals = 4): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const decimals = normalized.split(".")[1]?.length ?? 0;
  if (decimals > maxDecimals) return null;
  return Number(normalized);
}
