// Regras do cadastro de item de estoque (escopo-v1 §8.1 + D13/D17/D20). Espelham public.fin_save_stock_item:
// a TELA usa estas regras para travar campos e avisar cedo, mas quem decide é o SERVIDOR (que recusa o mesmo).

export type StockItemType = "medication" | "compounded" | "resale" | "consumable";

export const STOCK_ITEM_TYPE_LABEL: Record<StockItemType, string> = {
  medication: "Medicação aplicada",
  compounded: "Manipulado",
  resale: "Produto de revenda",
  consumable: "Material de consumo",
};

export interface StockItemDraft {
  name: string;
  category: string;
  itemType: StockItemType;
  fractional: boolean;
  openedValidityDays: number | null;
  individualUse: boolean;
  lotControl: boolean;
  sellable: boolean;
  salePriceCents: number | null;
  controlled: boolean;
  purchaseToStock: number;
  stockToConsumption: number;
  ean: string;
}

export interface TypeLocks {
  /** Controle de lote: true+travado (medicação, manipulado). */
  lotControl: { value: boolean | null; locked: boolean };
  /** Venda ao paciente: false+travado (medicação, consumo); true+travado (revenda); livre (manipulado). */
  sellable: { value: boolean | null; locked: boolean };
  /** Uso individual por paciente: padrão "sim" para medicação aplicada. */
  individualUseDefault: boolean;
}

export function typeLocks(type: StockItemType): TypeLocks {
  switch (type) {
    case "medication":
      return { lotControl: { value: true, locked: true }, sellable: { value: false, locked: true }, individualUseDefault: true };
    case "compounded":
      return { lotControl: { value: true, locked: true }, sellable: { value: null, locked: false }, individualUseDefault: false };
    case "resale":
      return { lotControl: { value: null, locked: false }, sellable: { value: true, locked: true }, individualUseDefault: false };
    case "consumable":
      return { lotControl: { value: null, locked: false }, sellable: { value: false, locked: true }, individualUseDefault: false };
  }
}

/** Aplica travas e padrões do tipo a um rascunho (usado ao trocar o tipo na tela). */
export function applyTypeDefaults(draft: StockItemDraft, type: StockItemType, isNew: boolean): StockItemDraft {
  const locks = typeLocks(type);
  return {
    ...draft,
    itemType: type,
    lotControl: locks.lotControl.locked ? Boolean(locks.lotControl.value) : draft.lotControl,
    sellable: locks.sellable.locked ? Boolean(locks.sellable.value) : draft.sellable,
    individualUse: isNew ? locks.individualUseDefault : draft.individualUse,
  };
}

export type StockItemField =
  | "name" | "category" | "controlled" | "lotControl" | "sellable" | "salePrice" | "openedValidity" | "factors" | "ean";

export const CONTROLLED_NOTICE =
  "Medicamentos controlados (Portaria 344) ficam fora desta versão: o sistema não permite cadastrar item como controlado.";

export function validateStockItem(d: StockItemDraft): Partial<Record<StockItemField, string>> {
  const errors: Partial<Record<StockItemField, string>> = {};
  if (!d.name.trim()) errors.name = "Informe o nome do item.";
  if (!d.category.trim()) errors.category = "Informe a categoria.";
  if (d.controlled) errors.controlled = CONTROLLED_NOTICE;
  if ((d.itemType === "medication" || d.itemType === "compounded") && !d.lotControl) {
    errors.lotControl = "Lote e validade são obrigatórios para medicação e manipulado.";
  }
  if (d.itemType === "medication" && d.sellable) errors.sellable = "Medicação aplicada não é vendida ao paciente.";
  if (d.itemType === "consumable" && d.sellable) errors.sellable = "Material de consumo não é vendido ao paciente.";
  const needsPrice = d.itemType === "resale" || (d.itemType === "compounded" && d.sellable);
  if (needsPrice && (d.salePriceCents === null || d.salePriceCents < 0)) errors.salePrice = "Informe o preço de venda.";
  if (d.fractional && !(d.openedValidityDays && d.openedValidityDays > 0)) {
    errors.openedValidity = "Uso fracionado precisa da validade após aberto, em dias.";
  }
  if (!(d.purchaseToStock > 0) || !(d.stockToConsumption > 0)) errors.factors = "Os fatores de conversão devem ser maiores que zero.";
  if (d.ean.trim() && !/^\d{8,14}$/.test(d.ean.trim())) errors.ean = "O código de barras deve ter de 8 a 14 dígitos.";
  return errors;
}

/** Mensagem PT-BR para o código de erro devolvido pela RPC (message do Postgres). */
export function stockServerErrorMessage(error: unknown): string {
  const message = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  const map: Record<string, string> = {
    STOCK_CONTROLLED_BLOCKED: CONTROLLED_NOTICE,
    LOT_CONTROL_REQUIRED: "Lote e validade são obrigatórios para medicação e manipulado.",
    MEDICATION_NOT_SELLABLE: "Medicação aplicada não é vendida ao paciente.",
    CONSUMABLE_NOT_SELLABLE: "Material de consumo não é vendido ao paciente.",
    SALE_PRICE_REQUIRED: "Informe o preço de venda.",
    OPENED_VALIDITY_REQUIRED: "Uso fracionado precisa da validade após aberto, em dias.",
    NAME_AND_CATEGORY_REQUIRED: "Informe nome e categoria.",
    INVALID_FACTOR: "Os fatores de conversão devem ser maiores que zero.",
    INVALID_EAN: "O código de barras deve ter de 8 a 14 dígitos.",
    INVALID_UNITS: "Unidade inválida.",
    REASON_REQUIRED: "Informe o motivo para desativar.",
    "duplicate key": "Já existe um item com esse nome e fabricante.",
  };
  for (const [code, text] of Object.entries(map)) if (message.includes(code)) return text;
  if (typeof error === "object" && error && (error as { code?: string }).code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível salvar agora. Tente novamente.";
}
