// CPF / CNPJ: só dígitos + validação dos dígitos verificadores (espelha private.fin_valid_tax_id no banco).
export const onlyDigits = (raw: string): string => raw.replace(/\D/g, "");

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + Number(digits[i]) * w, 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCpf(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const d1 = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

export function isValidCnpj(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const d1 = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export function isValidTaxId(raw: string): boolean {
  const d = onlyDigits(raw);
  return d.length === 11 ? isValidCpf(d) : d.length === 14 ? isValidCnpj(d) : false;
}

export function formatTaxId(raw: string): string {
  const d = onlyDigits(raw);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return raw;
}

/** CPF/CNPJ com só os 2 últimos dígitos (tela e log). */
export function maskTaxId(raw: string): string {
  const d = onlyDigits(raw);
  return d ? `•••${d.slice(-2)}` : "";
}
