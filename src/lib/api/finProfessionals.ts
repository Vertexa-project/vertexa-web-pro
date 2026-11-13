// Financeiro · dados financeiros do profissional (LGPD): leitura/escrita só por RPC; cada leitura sensível é registrada.
import { supabase } from "@/lib/supabase";

export type BondType = "pj" | "autonomo" | "clt" | "socio";
export const BOND_LABEL: Record<BondType, string> = { pj: "PJ", autonomo: "Autônomo", clt: "CLT", socio: "Sócio" };

export type WithholdingType = "irrf" | "pis_cofins_csll" | "iss" | "outra";
export const WITHHOLDING_LABEL: Record<WithholdingType, string> = { irrf: "IRRF", pis_cofins_csll: "PIS/COFINS/CSLL", iss: "ISS", outra: "Outra" };

export interface ProFinanceListRow {
  professional_id: string;
  full_name: string | null;
  bond_type: BondType | null;
  simples_optant: boolean | null;
  requires_invoice: boolean | null;
  has_tax_id: boolean;
  has_payment_data: boolean;
  retentions_count: number;
}

export interface Withholding {
  id?: string;
  rule_type: WithholdingType;
  label: string | null;
  rate_pct: number;
  min_base_cents: number;
  waive_if_simples: boolean;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

export interface ProFinanceDetail {
  data: {
    bond_type: BondType;
    tax_id: string | null;
    simples_optant: boolean;
    pix_key: string | null;
    bank_name: string | null;
    bank_agency: string | null;
    bank_account: string | null;
    requires_invoice: boolean;
    all_units: boolean;
    unit_ids: string[];
  } | null;
  withholdings: Withholding[];
}

export async function listProFinance(clinicId: string): Promise<ProFinanceListRow[]> {
  const { data, error } = await supabase.rpc("fin_list_professional_finance", { p_clinic: clinicId });
  if (error) throw error;
  return ((data ?? []) as (ProFinanceListRow & { retentions_count: number | string })[]).map((r) => ({ ...r, retentions_count: Number(r.retentions_count) }));
}

export async function getProFinance(professionalId: string): Promise<ProFinanceDetail> {
  const { data, error } = await supabase.rpc("fin_get_professional_finance", { p_professional: professionalId });
  if (error) throw error;
  const d = data as { data: ProFinanceDetail["data"]; withholdings: (Withholding & { rate_pct: number | string })[] };
  return { data: d.data, withholdings: (d.withholdings ?? []).map((w) => ({ ...w, rate_pct: Number(w.rate_pct) })) };
}

export interface SaveProFinanceInput {
  professionalId: string;
  bondType: BondType;
  taxId: string;
  simplesOptant: boolean;
  pixKey: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  requiresInvoice: boolean;
  allUnits: boolean;
  unitIds: string[];
  withholdings: Withholding[];
  reason?: string;
}

export async function saveProFinance(input: SaveProFinanceInput): Promise<void> {
  const { error } = await supabase.rpc("fin_save_professional_finance", {
    p_professional: input.professionalId,
    p_data: {
      bond_type: input.bondType, tax_id: input.taxId, simples_optant: input.simplesOptant, pix_key: input.pixKey, bank_name: input.bankName,
      bank_agency: input.bankAgency, bank_account: input.bankAccount, requires_invoice: input.requiresInvoice, all_units: input.allUnits,
      unit_ids: input.allUnits ? [] : input.unitIds,
    },
    p_withholdings: input.withholdings,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
}
