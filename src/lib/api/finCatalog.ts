// Financeiro · cadastros: serviços (com kit), pacotes e meios de pagamento. Leitura por RLS, escrita só por RPC.
import { supabase } from "@/lib/supabase";

export type ServiceCategory = "consulta" | "procedimento" | "aplicacao" | "avaliacao" | "sessao" | "outro";
export type ServiceRole = "responsavel" | "executor" | "auxiliar";

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  consulta: "Consulta",
  procedimento: "Procedimento",
  aplicacao: "Aplicação",
  avaliacao: "Avaliação",
  sessao: "Sessão",
  outro: "Outro",
};
export const SERVICE_ROLE_LABEL: Record<ServiceRole, string> = { responsavel: "Responsável", executor: "Executor", auxiliar: "Auxiliar" };

export interface FinService {
  id: string;
  name: string;
  category: ServiceCategory;
  default_price_cents: number;
  roles: ServiceRole[];
  is_active: boolean;
  unit_prices: { unit_id: string; price_cents: number }[];
  kit: { item_id: string; quantity: number }[];
}

export async function listServices(clinicId: string): Promise<FinService[]> {
  const { data, error } = await supabase
    .from("fin_services")
    .select("id, name, category, default_price_cents, roles, is_active, fin_service_unit_prices(unit_id, price_cents), fin_service_kit_items(item_id, quantity)")
    .eq("clinic_id", clinicId)
    .order("name");
  if (error) throw error;
  type Raw = Omit<FinService, "unit_prices" | "kit"> & {
    fin_service_unit_prices: { unit_id: string; price_cents: number }[];
    fin_service_kit_items: { item_id: string; quantity: number | string }[];
  };
  return ((data ?? []) as unknown as Raw[]).map((s) => ({
    id: s.id, name: s.name, category: s.category, default_price_cents: s.default_price_cents, roles: s.roles, is_active: s.is_active,
    unit_prices: s.fin_service_unit_prices ?? [],
    kit: (s.fin_service_kit_items ?? []).map((k) => ({ item_id: k.item_id, quantity: Number(k.quantity) })),
  }));
}

export interface SaveServiceInput {
  id: string | null;
  name: string;
  category: ServiceCategory;
  defaultPriceCents: number;
  roles: ServiceRole[];
  isActive: boolean;
  unitPrices: { unitId: string; priceCents: number }[];
  kit: { itemId: string; quantity: number }[];
  reason?: string;
}

/** Salva o serviço e, em seguida, o kit (duas RPCs; cada uma grava o seu log). */
export async function saveService(clinicId: string, input: SaveServiceInput): Promise<string> {
  const { data, error } = await supabase.rpc("fin_save_service", {
    p_clinic: clinicId,
    p_id: input.id,
    p_data: { name: input.name, category: input.category, default_price_cents: input.defaultPriceCents, roles: input.roles, is_active: input.isActive },
    p_unit_prices: input.unitPrices.map((u) => ({ unit_id: u.unitId, price_cents: u.priceCents })),
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  const id = data as string;
  const { error: kitError } = await supabase.rpc("fin_set_service_kit", {
    p_service: id,
    p_items: input.kit.map((k) => ({ item_id: k.itemId, quantity: k.quantity })),
    p_reason: input.reason ?? null,
  });
  if (kitError) throw kitError;
  return id;
}

export interface FinPackageItem {
  item_type: "service" | "product";
  service_id: string | null;
  stock_item_id: string | null;
  quantity: number;
  reference_price_cents: number;
  allocated_unit_cents: number;
  allocated_total_cents: number;
}
export interface FinPackage {
  id: string;
  name: string;
  price_cents: number;
  validity_days: number;
  is_active: boolean;
  items: FinPackageItem[];
}

export async function listPackages(clinicId: string): Promise<FinPackage[]> {
  const { data, error } = await supabase
    .from("fin_packages")
    .select("id, name, price_cents, validity_days, is_active, fin_package_items(item_type, service_id, stock_item_id, quantity, reference_price_cents, allocated_unit_cents, allocated_total_cents, position)")
    .eq("clinic_id", clinicId)
    .order("name");
  if (error) throw error;
  type Raw = Omit<FinPackage, "items"> & { fin_package_items: (Omit<FinPackageItem, "quantity"> & { quantity: number | string; position: number })[] };
  return ((data ?? []) as unknown as Raw[]).map((p) => ({
    id: p.id, name: p.name, price_cents: p.price_cents, validity_days: p.validity_days, is_active: p.is_active,
    items: [...(p.fin_package_items ?? [])].sort((a, b) => a.position - b.position).map((i) => ({ ...i, quantity: Number(i.quantity) })),
  }));
}

export interface SavePackageInput {
  id: string | null;
  name: string;
  priceCents: number;
  validityDays: number;
  isActive: boolean;
  items: { itemType: "service" | "product"; serviceId: string | null; stockItemId: string | null; quantity: number; referencePriceCents: number }[];
  reason?: string;
}

export async function savePackage(clinicId: string, input: SavePackageInput): Promise<string> {
  const { data, error } = await supabase.rpc("fin_save_package", {
    p_clinic: clinicId,
    p_id: input.id,
    p_data: { name: input.name, price_cents: input.priceCents, validity_days: input.validityDays, is_active: input.isActive },
    p_items: input.items.map((i) => ({
      item_type: i.itemType, service_id: i.serviceId, stock_item_id: i.stockItemId, quantity: i.quantity, reference_price_cents: i.referencePriceCents,
    })),
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return data as string;
}

export type AcquirerKind = "machine" | "pix" | "cash" | "transfer" | "boleto";
export type FeeModality = "debit" | "credit_1" | "credit_2_6" | "credit_7_12";
export const FEE_MODALITY_LABEL: Record<FeeModality, string> = {
  debit: "Débito",
  credit_1: "Crédito à vista",
  credit_2_6: "Parcelado 2–6",
  credit_7_12: "Parcelado 7–12",
};
export const ACQUIRER_KIND_LABEL: Record<AcquirerKind, string> = {
  machine: "Maquininha",
  pix: "Pix",
  cash: "Dinheiro",
  transfer: "Transferência",
  boleto: "Boleto",
};

export interface FeeRow {
  brand: string;
  modality: FeeModality;
  fee_pct: number;
  settle_days: number;
  anticipation: boolean;
  anticipation_fee_pct: number;
  anticipation_days: number;
}
export interface Acquirer {
  id: string;
  unit_id: string | null;
  name: string;
  kind: AcquirerKind;
  flat_fee_pct: number;
  flat_fee_cents: number;
  settle_days: number;
  is_active: boolean;
  fees: FeeRow[];
}

export async function listAcquirers(clinicId: string): Promise<Acquirer[]> {
  const { data, error } = await supabase
    .from("fin_acquirers")
    .select("id, unit_id, name, kind, flat_fee_pct, flat_fee_cents, settle_days, is_active, fin_fee_rows(brand, modality, fee_pct, settle_days, anticipation, anticipation_fee_pct, anticipation_days)")
    .eq("clinic_id", clinicId)
    .order("kind")
    .order("name");
  if (error) throw error;
  type RawFee = { brand: string; modality: FeeModality; fee_pct: number | string; settle_days: number; anticipation: boolean; anticipation_fee_pct: number | string; anticipation_days: number };
  type Raw = Omit<Acquirer, "fees" | "flat_fee_pct"> & { flat_fee_pct: number | string; fin_fee_rows: RawFee[] };
  return ((data ?? []) as unknown as Raw[]).map((a) => ({
    id: a.id, unit_id: a.unit_id, name: a.name, kind: a.kind, flat_fee_pct: Number(a.flat_fee_pct), flat_fee_cents: a.flat_fee_cents,
    settle_days: a.settle_days, is_active: a.is_active,
    fees: (a.fin_fee_rows ?? []).map((f) => ({ ...f, fee_pct: Number(f.fee_pct), anticipation_fee_pct: Number(f.anticipation_fee_pct) })),
  }));
}

export interface SaveAcquirerInput {
  id: string | null;
  name: string;
  unitId: string | null;
  isActive: boolean;
  flatFeePct: number;
  flatFeeCents: number;
  settleDays: number;
  fees: FeeRow[];
  reason?: string;
}

export async function saveAcquirer(clinicId: string, input: SaveAcquirerInput): Promise<string> {
  const { data, error } = await supabase.rpc("fin_save_acquirer", {
    p_clinic: clinicId,
    p_id: input.id,
    p_data: {
      name: input.name, unit_id: input.unitId, is_active: input.isActive, kind: input.id ? undefined : "machine",
      flat_fee_pct: input.flatFeePct, flat_fee_cents: input.flatFeeCents, settle_days: input.settleDays,
    },
    p_fees: input.fees,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return data as string;
}
