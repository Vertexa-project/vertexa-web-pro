// Regras de Billing Profile — PURAS (sem I/O). Autoridade continua no banco
// (get/upsert_my_clinic_billing_identity). Aqui é só UX: normalizar, mascarar
// e classificar erro. Nunca logar CPF/CNPJ.

export const BILLING_LEGAL_NAME_MIN = 2;
export const BILLING_LEGAL_NAME_MAX = 180;

export type BillingFieldValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

export type BillingPhoneValidation =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/** Remove tudo que não é dígito. Não valida checksum — isso é autoridade do servidor. */
export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function maskTaxId(raw: string): string {
  const digits = normalizeTaxId(raw);
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return "****";
}

function allSameDigits(digits: string): boolean {
  return digits.length > 0 && digits.split("").every((c) => c === digits[0]);
}

function cpfCheckDigits(digits: string): boolean {
  if (digits.length !== 11 || allSameDigits(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  let rest = sum % 11;
  const d1 = rest < 2 ? 0 : 11 - rest;
  if (d1 !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(digits[i]) * (11 - i);
  rest = sum % 11;
  const d2 = rest < 2 ? 0 : 11 - rest;
  return d2 === Number(digits[10]);
}

function cnpjCheckDigits(digits: string): boolean {
  if (digits.length !== 14 || allSameDigits(digits)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * w1[i];
  let rest = sum % 11;
  const d1 = rest < 2 ? 0 : 11 - rest;
  if (d1 !== Number(digits[12])) return false;
  sum = 0;
  for (let i = 0; i < 13; i += 1) sum += Number(digits[i]) * w2[i];
  rest = sum % 11;
  const d2 = rest < 2 ? 0 : 11 - rest;
  return d2 === Number(digits[13]);
}

/** UX only. O servidor recalcula o checksum. */
export function taxIdLooksValid(raw: string): boolean {
  const digits = normalizeTaxId(raw);
  if (digits.length === 11) return cpfCheckDigits(digits);
  if (digits.length === 14) return cnpjCheckDigits(digits);
  return false;
}

export function validateTaxId(raw: string): BillingFieldValidation {
  const value = normalizeTaxId(raw);
  if (value === "") return { ok: false, message: "Informe o CPF ou CNPJ." };
  if (!taxIdLooksValid(value)) {
    return { ok: false, message: "CPF ou CNPJ inválido. Confira os números." };
  }
  return { ok: true, value };
}

export function validateLegalName(raw: string): BillingFieldValidation {
  const value = raw.trim();
  if (value === "") return { ok: false, message: "Informe o nome ou a razão social." };
  if (value.length < BILLING_LEGAL_NAME_MIN) {
    return { ok: false, message: `O nome precisa ter ao menos ${BILLING_LEGAL_NAME_MIN} caracteres.` };
  }
  if (value.length > BILLING_LEGAL_NAME_MAX) {
    return { ok: false, message: `O nome pode ter no máximo ${BILLING_LEGAL_NAME_MAX} caracteres.` };
  }
  return { ok: true, value };
}

export function normalizeBillingEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateBillingEmail(raw: string): BillingFieldValidation {
  const value = normalizeBillingEmail(raw);
  if (value === "") return { ok: false, message: "Informe o e-mail de cobrança." };
  const at = value.indexOf("@");
  if (at < 1) return { ok: false, message: "Informe um e-mail válido." };
  const domain = value.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || value.includes(" ")) {
    return { ok: false, message: "Informe um e-mail válido." };
  }
  return { ok: true, value };
}

export function validateBillingPhone(raw: string): BillingPhoneValidation {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  return { ok: true, value };
}

const HINT_MESSAGES: Record<string, string> = {
  BILLING_NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente para continuar.",
  BILLING_NOT_CLINIC_ADMIN: "Apenas o administrador da clínica gerencia os dados de faturamento.",
  BILLING_CLINIC_REQUIRED: "Não foi possível identificar a clínica.",
  BILLING_INVALID_TAX_ID: "CPF ou CNPJ inválido. Confira os números.",
  BILLING_INVALID_LEGAL_NAME: "Informe um nome ou razão social válido.",
  BILLING_INVALID_EMAIL: "Informe um e-mail de cobrança válido.",
};

export function billingProfileErrorHint(error: unknown): string | null {
  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint in HINT_MESSAGES) return hint;
  }
  return null;
}

export function isExpectedBillingProfileError(error: unknown): boolean {
  return billingProfileErrorHint(error) !== null;
}

export function billingProfileErrorMessage(error: unknown): string {
  const hint = billingProfileErrorHint(error);
  if (hint) return HINT_MESSAGES[hint];
  return "Não foi possível salvar os dados de faturamento agora. Tente novamente em instantes.";
}

export interface ClinicBillingIdentity {
  clinicId: string;
  exists: boolean;
  isComplete: boolean;
  legalName: string | null;
  taxId: string | null;
  taxIdMasked: string | null;
  email: string | null;
  mobilePhone: string | null;
  updatedAt: string | null;
}
