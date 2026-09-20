/**
 * Pix Automático — superfície administrativa de REISSUE (WP-ASAAS-05G1).
 * A autoridade é o banco + Edge. Aqui só rótulo, oferta de CTA e erro seguro.
 */

export const PIX_AUTOMATIC_STATUSES = [
  "INTENT",
  "CREATED",
  "ACTIVE",
  "CANCELLED",
  "EXPIRED",
  "REFUSED",
] as const;

export type PixAutomaticProviderStatus = (typeof PIX_AUTOMATIC_STATUSES)[number];

export function isPixAutomaticProviderStatus(
  value: string | null | undefined,
): value is PixAutomaticProviderStatus {
  return PIX_AUTOMATIC_STATUSES.includes(value as PixAutomaticProviderStatus);
}

export function pixAutomaticStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "REFUSED":
      return "Recusado";
    case "INTENT":
      return "Aguardando autorização";
    case "CREATED":
      return "Criado";
    case "ACTIVE":
      return "Ativo";
    case "CANCELLED":
      return "Cancelado";
    case "EXPIRED":
      return "Expirado";
    default:
      return "Sem autorização";
  }
}

export function canReissuePixAutomatic(status: string | null | undefined): boolean {
  return status === "REFUSED";
}

export interface PlatformClinicPixAutomaticStatus {
  clinicId: string;
  commercialContractId: string;
  authorizationId: string;
  providerStatus: string;
  generation: number;
}

export interface ReissuePixAutomaticResult {
  outcome: "reissued" | "already_reissued";
  oldAuthorizationId: string;
  newAuthorizationId: string;
  oldGeneration: number;
  newGeneration: number;
  newStatus: string;
  operationId: string | null;
}

const EXPECTED_REISSUE_ERRORS = new Set([
  "forbidden",
  "authorization_not_refused",
  "authorization_status_unsupported",
  "authorization_not_primary",
  "resource_mismatch",
  "environment_mismatch",
  "reissue_conflict",
  "not_found",
  "reissue_ids_required",
  "provider_payload_forbidden",
  "reissue_failed",
]);

export function pixAutomaticReissueErrorCode(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const rec = error as { error?: unknown; hint?: unknown; message?: unknown };
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
    if (typeof rec.hint === "string" && rec.hint.trim()) return rec.hint.trim();
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
  }
  return null;
}

export function isExpectedPixAutomaticReissueError(error: unknown): boolean {
  const code = pixAutomaticReissueErrorCode(error);
  return code !== null && EXPECTED_REISSUE_ERRORS.has(code);
}

export function pixAutomaticReissueErrorMessage(error: unknown): string {
  switch (pixAutomaticReissueErrorCode(error)) {
    case "forbidden":
    case "NOT_PLATFORM_ADMIN":
      return "Apenas um operador da plataforma pode gerar uma nova autorização.";
    case "authorization_not_refused":
    case "BILLING_REISSUE_NOT_REFUSED":
      return "Só é possível gerar uma nova autorização quando o estado atual é Recusado.";
    case "authorization_status_unsupported":
    case "BILLING_REISSUE_STATUS_UNSUPPORTED":
      return "Este estado de autorização não admite nova tentativa.";
    case "authorization_not_primary":
    case "BILLING_REISSUE_NOT_PRIMARY":
      return "A autorização mudou enquanto a ação era confirmada. Atualize a lista.";
    case "resource_mismatch":
    case "BILLING_CLINIC_MISMATCH":
    case "BILLING_CONTRACT_MISMATCH":
      return "A clínica ou o contrato não correspondem a esta autorização.";
    case "environment_mismatch":
    case "BILLING_ENVIRONMENT_MISMATCH":
      return "O ambiente desta autorização não pode ser alterado por esta ação.";
    case "reissue_conflict":
    case "BILLING_REISSUE_PRIMARY_RACE":
      return "Outra tentativa já está em andamento. Atualize a lista.";
    case "not_found":
      return "Não encontramos a autorização desta clínica.";
    default:
      return "Não foi possível gerar a nova autorização. Tente de novo.";
  }
}
