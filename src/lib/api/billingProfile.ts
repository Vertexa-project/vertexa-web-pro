import { supabase } from "@/lib/supabase";
import type { ClinicBillingIdentity } from "@/lib/domain/billingProfile";

interface RawIdentity {
  clinic_id?: string;
  exists?: boolean;
  is_complete?: boolean;
  is_checkout_ready?: boolean;
  checkout_readiness_error?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  tax_id_masked?: string | null;
  email?: string | null;
  mobile_phone?: string | null;
  billing_address?: string | null;
  billing_address_number?: string | null;
  updated_at?: string | null;
}

function mapIdentity(row: RawIdentity, fallbackClinicId: string): ClinicBillingIdentity {
  return {
    clinicId: row.clinic_id ?? fallbackClinicId,
    exists: row.exists === true,
    isComplete: row.is_complete === true,
    isCheckoutReady: row.is_checkout_ready === true,
    checkoutReadinessError: row.checkout_readiness_error ?? null,
    legalName: row.legal_name ?? null,
    taxId: row.tax_id ?? null,
    taxIdMasked: row.tax_id_masked ?? null,
    email: row.email ?? null,
    mobilePhone: row.mobile_phone ?? null,
    billingAddress: row.billing_address ?? null,
    billingAddressNumber: row.billing_address_number ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getMyClinicBillingIdentity(clinicId: string): Promise<ClinicBillingIdentity> {
  const { data, error } = await supabase.rpc("get_my_clinic_billing_identity", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  return mapIdentity((data ?? {}) as RawIdentity, clinicId);
}

export async function upsertMyClinicBillingIdentity(input: {
  clinicId: string;
  legalName: string;
  taxId: string;
  email: string;
  mobilePhone: string | null;
  billingAddress: string;
  billingAddressNumber: string;
}): Promise<ClinicBillingIdentity> {
  const { data, error } = await supabase.rpc("upsert_my_clinic_billing_identity", {
    p_clinic_id: input.clinicId,
    p_legal_name: input.legalName,
    p_tax_id: input.taxId,
    p_email: input.email,
    p_mobile_phone: input.mobilePhone,
    p_billing_address: input.billingAddress,
    p_billing_address_number: input.billingAddressNumber,
  });
  if (error) throw error;
  return mapIdentity((data ?? {}) as RawIdentity, input.clinicId);
}
