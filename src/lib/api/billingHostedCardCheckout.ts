import { supabase } from "@/lib/supabase";

export const CREATE_HOSTED_CARD_CHECKOUT_ACTION = "create_hosted_card_checkout";

export function createHostedCardCheckoutPayload(clinicId: string) {
  return { action: CREATE_HOSTED_CARD_CHECKOUT_ACTION, clinicId };
}

export async function createMyClinicHostedCardCheckout(clinicId: string): Promise<{ hostedUrl: string }> {
  const { data, error } = await supabase.functions.invoke("asaas-outbound", {
    body: createHostedCardCheckoutPayload(clinicId),
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const payload = await context.json() as { error?: string };
        if (payload.error) throw new Error(payload.error);
      } catch (cause) {
        if (cause instanceof Error) throw cause;
      }
    }
    throw new Error("hosted_card_checkout_failed");
  }
  if (!data || typeof data !== "object" || typeof (data as { hostedUrl?: unknown }).hostedUrl !== "string") {
    throw new Error("hosted_card_checkout_invalid_response");
  }
  return { hostedUrl: (data as { hostedUrl: string }).hostedUrl };
}
