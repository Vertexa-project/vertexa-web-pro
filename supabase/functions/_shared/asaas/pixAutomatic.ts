// Fundação Pix Automático — só constantes e helpers locais.
// NÃO faz HTTP. NÃO envia billingType=PIX.

export const PIX_AUTOMATIC_POLICY = {
  frequency: "MONTHLY",
  paymentCreationMode: "SUBSCRIPTION",
  retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
  finishDate: null,
  timezone: "America/Sao_Paulo",
  description: "Vertexa - assinatura mensal",
} as const;

export const ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED =
  "ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED";

export function pixAutomaticProviderContractId(commercialContractId: string): string {
  const compact = commercialContractId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("invalid_commercial_contract_id");
  }
  return compact;
}
