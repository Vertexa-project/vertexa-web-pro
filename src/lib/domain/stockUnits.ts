// Conversão entre unidades do item de estoque (escopo-v1 §8.1): compra → estoque → consumo.
// Ex.: caixa com 10 ampolas (compra→estoque ×10); frasco de 30 ml (estoque→consumo ×30).
import { roundQty } from "./money";

export type StockUnitKind = "purchase" | "stock" | "consumption";

export interface UnitFactors {
  /** Quantas unidades de ESTOQUE cabem em 1 unidade de COMPRA. */
  purchaseToStock: number;
  /** Quantas unidades de CONSUMO cabem em 1 unidade de ESTOQUE. */
  stockToConsumption: number;
}

const ORDER: StockUnitKind[] = ["purchase", "stock", "consumption"];

/** Fator para ir de `from` até `to`; quantidades com até 3 casas (arredondamento meio-para-cima). */
export function convertQty(qty: number, from: StockUnitKind, to: StockUnitKind, factors: UnitFactors): number {
  if (!(factors.purchaseToStock > 0) || !(factors.stockToConsumption > 0)) {
    throw new Error("Fator de conversão deve ser maior que zero.");
  }
  // Base comum: consumo.
  const toConsumption: Record<StockUnitKind, number> = {
    purchase: factors.purchaseToStock * factors.stockToConsumption,
    stock: factors.stockToConsumption,
    consumption: 1,
  };
  if (ORDER.indexOf(from) < 0 || ORDER.indexOf(to) < 0) throw new Error("Unidade desconhecida.");
  return roundQty((qty * toConsumption[from]) / toConsumption[to]);
}
