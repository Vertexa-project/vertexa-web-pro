// Plural e concordância pt-BR em textos exibidos. Puro.

/** "1 dia" / "3 dias". `many` default = one + "s". */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

export const formatDays = (n: number): string => plural(n, "dia");

/** Sequência de dias ativos: 0 => "Sem sequência", 1 => "1 dia", N => "N dias". */
export function streakLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n <= 0) return "Sem sequência";
  return formatDays(n);
}

/** "Equipe da paciente" só quando o cadastro é feminino; caso contrário, neutro ("Equipe do paciente"). */
export function patientTeamTitle(sex: string | null | undefined): string {
  return (sex ?? "").trim().toLowerCase().startsWith("fem") ? "Equipe da paciente" : "Equipe do paciente";
}
