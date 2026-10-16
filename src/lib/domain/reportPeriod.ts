// Período personalizado do relatório do paciente. A RPC export_patient_report aceita janelas de até
// 366 dias, com início ≤ fim; o front valida antes para dar mensagem clara em vez de erro do banco.
export const MAX_REPORT_WINDOW_DAYS = 366;

/** Valida o período (YYYY-MM-DD). Devolve a mensagem de erro, ou null quando válido. `today` = hoje local. */
export function validateCustomPeriod(from: string, to: string, today: string): string | null {
  if (!from || !to) return "Informe a data inicial e a final.";
  if (from > to) return "A data inicial não pode ser depois da final.";
  if (to > today) return "A data final não pode estar no futuro.";
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (days > MAX_REPORT_WINDOW_DAYS) return "O período máximo é de 12 meses.";
  return null;
}
