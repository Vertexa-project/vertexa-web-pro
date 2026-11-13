// Estoque · cadastro de itens (Entrega 1). Leitura por RLS, escrita só pela RPC fin_save_stock_item (regras no servidor).
import { supabase } from "@/lib/supabase";
import type { StockItemType } from "@/lib/domain/stockItemRules";

export interface StockItem {
  id: string;
  name: string;
  category: string;
  manufacturer: string | null;
  item_type: StockItemType;
  purchase_unit: string;
  stock_unit: string;
  consumption_unit: string;
  purchase_to_stock_factor: number;
  stock_to_consumption_factor: number;
  fractional: boolean;
  opened_validity_days: number | null;
  individual_use: boolean;
  lot_control: boolean;
  sellable: boolean;
  ean: string | null;
  anvisa_reg: string | null;
  sale_price_cents: number | null;
  controlled: boolean;
  is_active: boolean;
  minimums: { unit_id: string; min_qty: number }[];
}

export async function listStockItems(clinicId: string): Promise<StockItem[]> {
  const { data, error } = await supabase
    .from("stock_items")
    .select("*, stock_item_minimums(unit_id, min_qty)")
    .eq("clinic_id", clinicId)
    .order("name");
  if (error) throw error;
  type Raw = Omit<StockItem, "minimums" | "purchase_to_stock_factor" | "stock_to_consumption_factor"> & {
    purchase_to_stock_factor: number | string;
    stock_to_consumption_factor: number | string;
    stock_item_minimums: { unit_id: string; min_qty: number | string }[];
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const { stock_item_minimums, ...rest } = r;
    return {
      ...rest,
      purchase_to_stock_factor: Number(r.purchase_to_stock_factor),
      stock_to_consumption_factor: Number(r.stock_to_consumption_factor),
      minimums: (stock_item_minimums ?? []).map((m) => ({ unit_id: m.unit_id, min_qty: Number(m.min_qty) })),
    };
  });
}

export interface SaveStockItemInput {
  id: string | null;
  name: string;
  category: string;
  manufacturer: string;
  itemType: StockItemType;
  purchaseUnit: string;
  stockUnit: string;
  consumptionUnit: string;
  purchaseToStock: number;
  stockToConsumption: number;
  fractional: boolean;
  openedValidityDays: number | null;
  individualUse: boolean;
  lotControl: boolean;
  sellable: boolean;
  ean: string;
  anvisaReg: string;
  salePriceCents: number | null;
  controlled: boolean;
  isActive: boolean;
  minimums: { unitId: string; minQty: number }[];
  reason?: string;
}

export async function saveStockItem(clinicId: string, i: SaveStockItemInput): Promise<string> {
  const { data, error } = await supabase.rpc("fin_save_stock_item", {
    p_clinic: clinicId,
    p_id: i.id,
    p_data: {
      name: i.name, category: i.category, manufacturer: i.manufacturer, item_type: i.itemType, purchase_unit: i.purchaseUnit, stock_unit: i.stockUnit,
      consumption_unit: i.consumptionUnit, purchase_to_stock_factor: i.purchaseToStock, stock_to_consumption_factor: i.stockToConsumption,
      fractional: i.fractional, opened_validity_days: i.openedValidityDays, individual_use: i.individualUse, lot_control: i.lotControl,
      sellable: i.sellable, ean: i.ean, anvisa_reg: i.anvisaReg, sale_price_cents: i.salePriceCents, controlled: i.controlled, is_active: i.isActive,
    },
    p_minimums: i.minimums.map((m) => ({ unit_id: m.unitId, min_qty: m.minQty })),
    p_reason: i.reason ?? null,
  });
  if (error) throw error;
  return data as string;
}
