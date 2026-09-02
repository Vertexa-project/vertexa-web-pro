/**
 * Lifecycle administrativo da clínica (PLATFORM-02).
 *
 * A autoridade é o banco: `suspend_platform_clinic` / `reactivate_platform_clinic`.
 * Aqui só: rótulo, oferta de botão e tradução de erro. Sem I/O.
 */

export const CLINIC_STATUS_ACTIVE = "active";
export const CLINIC_STATUS_SUSPENDED = "suspended";

export function isOperationalClinicStatus(status: string | null | undefined): boolean {
  return (status ?? CLINIC_STATUS_ACTIVE) === CLINIC_STATUS_ACTIVE;
}

export function clinicLifecycleLabel(status: string | null | undefined): string {
  return isOperationalClinicStatus(status) ? "Ativa" : "Suspensa";
}

export function canSuspendClinic(status: string | null | undefined): boolean {
  return isOperationalClinicStatus(status);
}

export function canReactivateClinic(status: string | null | undefined): boolean {
  return status === CLINIC_STATUS_SUSPENDED;
}

/** Motivo obrigatório na suspensão: trim, mínimo 3 caracteres. */
export function normalizeSuspendReason(reason: string | null | undefined): string | null {
  const trimmed = (reason ?? "").trim();
  return trimmed.length >= 3 ? trimmed : null;
}

export function clinicLifecycleErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export function clinicLifecycleErrorHint(error: unknown): string | null {
  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint.trim()) return hint.trim();
  }
  return null;
}

const EXPECTED = new Set(["42501", "22023", "P0002"]);

export function isExpectedClinicLifecycleError(error: unknown): boolean {
  const code = clinicLifecycleErrorCode(error);
  return code !== null && EXPECTED.has(code);
}

export function clinicLifecycleErrorMessage(error: unknown): string {
  const hint = clinicLifecycleErrorHint(error);
  if (hint === "NOT_PLATFORM_ADMIN") {
    return "Apenas um operador da plataforma pode alterar o estado da clínica.";
  }
  if (hint === "CLINIC_ALREADY_SUSPENDED") {
    return "Esta clínica já está suspensa.";
  }
  if (hint === "CLINIC_ALREADY_ACTIVE") {
    return "Esta clínica já está ativa.";
  }
  if (hint === "REASON_REQUIRED") {
    return "Informe o motivo da suspensão.";
  }
  if (hint === "CLINIC_NOT_FOUND") {
    return "Esta clínica não existe mais.";
  }
  switch (clinicLifecycleErrorCode(error)) {
    case "42501":
      return "Apenas um operador da plataforma pode alterar o estado da clínica.";
    case "22023":
      return "Não foi possível concluir a alteração. Verifique o motivo e tente de novo.";
    case "P0002":
      return "Esta clínica não existe mais.";
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}
