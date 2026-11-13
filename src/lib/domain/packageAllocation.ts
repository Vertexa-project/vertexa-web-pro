// Rateio do pacote/programa (escopo-v1 §5.4): valor da linha = referência × (valor do pacote ÷ Σ referência×qtd).
// Diferença de arredondamento vai para a ÚLTIMA linha. Espelha public.fin_save_package (SQL) — mesmo arredondamento
// meio-para-cima, feito com BigInt para não perder precisão. Valores em CENTAVOS; quantidade em unidades (até 3 casas).

export interface PackageLineInput {
  quantity: number;
  /** Valor de referência POR UNIDADE, em centavos. */
  referenceCents: number;
}

export interface PackageLineAllocation {
  /** Valor rateado de 1 unidade (centavos). */
  unitCents: number;
  /** Valor rateado da linha toda, já com o ajuste (centavos). */
  totalCents: number;
  /** Diferença de arredondamento somada a esta linha (só a última pode ter ≠ 0). */
  adjustCents: number;
}

export interface PackageAllocation {
  lines: PackageLineAllocation[];
  /** Fator valor ÷ soma das referências (para exibir: 0,9). */
  factor: number;
  referenceSumCents: number;
}

const milli = (qty: number) => BigInt(Math.round(qty * 1000));

/** floor((2a + b) / (2b)) = a/b arredondado meio-para-cima (a ≥ 0, b > 0). */
function divHalfUp(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

export function allocatePackage(priceCents: number, lines: PackageLineInput[]): PackageAllocation | null {
  if (lines.length === 0 || !(priceCents > 0)) return null;
  const sumMilli = lines.reduce((acc, l) => acc + BigInt(l.referenceCents) * milli(l.quantity), 0n); // Σ ref×qtd em milésimos
  if (sumMilli <= 0n) return null;
  const price = BigInt(priceCents);
  let running = 0n;
  const out: PackageLineAllocation[] = lines.map((l) => {
    // unit = ref × preço ÷ Σ(ref×qtd)  =  ref × preço × 1000 ÷ sumMilli
    const unit = divHalfUp(BigInt(l.referenceCents) * price * 1000n, sumMilli);
    const total = divHalfUp(unit * milli(l.quantity), 1000n);
    running += total;
    return { unitCents: Number(unit), totalCents: Number(total), adjustCents: 0 };
  });
  const diff = Number(price - running);
  if (diff !== 0) {
    const last = out[out.length - 1];
    last.totalCents += diff;
    last.adjustCents = diff;
  }
  return { lines: out, factor: Number(price) / (Number(sumMilli) / 1000), referenceSumCents: Number(sumMilli / 1000n) };
}
