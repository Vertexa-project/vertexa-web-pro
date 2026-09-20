import { supabase } from "@/lib/supabase";
import {
  FOUNDER_CHECKOUT,
  commercialContractCreatePayload,
  sanitizeSellablePlans,
  type ClinicCommercialCheckout,
  type CommercialContractStatus,
  type PixAuthorizationStatus,
  type SellableBillingPlan,
} from "@/lib/domain/billingCheckout";

interface RawPlan {
  plan_id?: string;
  plan_version_id?: string;
  code?: string;
  display_name?: string;
  price_cents?: number;
  currency?: string;
  billing_cycle?: string;
  tagline?: string | null;
  marketing_message?: string | null;
  features?: string[] | null;
  sellable?: boolean;
}

interface RawCatalog {
  plans?: RawPlan[];
  founder_checkout?: string;
}

interface RawContract {
  id?: string;
  status?: string;
  plan_id?: string;
  plan_version_id?: string;
  plan_code?: string;
  plan_display_name?: string;
  price_cents?: number;
  currency?: string;
  billing_cycle?: string;
}

interface RawCheckout {
  clinic_id?: string;
  founder_checkout?: string;
  identity_exists?: boolean;
  identity_complete?: boolean;
  local_billing_account_exists?: boolean;
  commercial_contract?: RawContract | null;
  pix_authorization_status?: string | null;
  entitlement_enforcement?: string;
  entitlement_granted?: boolean;
}

function mapPlan(row: RawPlan): SellableBillingPlan | null {
  if (!row.plan_id || !row.plan_version_id || !row.code || !row.display_name) return null;
  if (typeof row.price_cents !== "number") return null;
  return {
    planId: row.plan_id,
    planVersionId: row.plan_version_id,
    code: row.code,
    displayName: row.display_name,
    priceCents: row.price_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    billingCycle: "monthly",
    tagline: row.tagline ?? null,
    marketingMessage: row.marketing_message ?? null,
    features: Array.isArray(row.features) ? row.features.filter((f) => typeof f === "string") : [],
    sellable: row.sellable !== false,
  };
}

function mapContract(row: RawContract | null | undefined): ClinicCommercialCheckout["commercialContract"] {
  if (!row?.id || !row.status || !row.plan_version_id || typeof row.price_cents !== "number") return null;
  return {
    id: row.id,
    status: row.status as CommercialContractStatus,
    planId: row.plan_id ?? "",
    planVersionId: row.plan_version_id,
    planCode: row.plan_code ?? "",
    planDisplayName: row.plan_display_name ?? row.plan_code ?? "",
    priceCents: row.price_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    billingCycle: "monthly",
  };
}

function mapCheckout(row: RawCheckout, fallbackClinicId: string): ClinicCommercialCheckout {
  return {
    clinicId: row.clinic_id ?? fallbackClinicId,
    founderCheckout: FOUNDER_CHECKOUT,
    identityExists: row.identity_exists === true,
    identityComplete: row.identity_complete === true,
    localBillingAccountExists: row.local_billing_account_exists === true,
    commercialContract: mapContract(row.commercial_contract),
    pixAuthorizationStatus: (row.pix_authorization_status as PixAuthorizationStatus | null) ?? null,
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
  };
}

export async function listSellableBillingPlans(): Promise<SellableBillingPlan[]> {
  const { data, error } = await supabase.rpc("list_sellable_billing_plans");
  if (error) throw error;
  const raw = (data ?? {}) as RawCatalog;
  const plans = (raw.plans ?? []).map(mapPlan).filter((plan): plan is SellableBillingPlan => plan !== null);
  return sanitizeSellablePlans(plans);
}

export async function getMyClinicCommercialCheckout(clinicId: string): Promise<ClinicCommercialCheckout> {
  const { data, error } = await supabase.rpc("get_my_clinic_commercial_checkout", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  return mapCheckout((data ?? {}) as RawCheckout, clinicId);
}

export async function createMyClinicCommercialContract(input: {
  clinicId: string;
  planVersionId: string;
}): Promise<ClinicCommercialCheckout> {
  const payload = commercialContractCreatePayload(input);
  const { data, error } = await supabase.rpc("create_my_clinic_commercial_contract", payload);
  if (error) throw error;
  return mapCheckout((data ?? {}) as RawCheckout, input.clinicId);
}
