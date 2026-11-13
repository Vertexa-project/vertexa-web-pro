// Licença sanitária da unidade (escopo-v1 §4.1): vencida, a vencer em 60 dias, válida ou sem cadastro.
export type LicenseState = "none" | "valid" | "expiring" | "expired";

export function licenseState(u: { license_number: string | null; license_valid_until: string | null }, today: Date = new Date()): LicenseState {
  if (!u.license_number && !u.license_valid_until) return "none";
  if (!u.license_valid_until) return "valid";
  const end = new Date(`${u.license_valid_until}T23:59:59`);
  if (end < today) return "expired";
  return end.getTime() - today.getTime() < 60 * 86_400_000 ? "expiring" : "valid";
}
