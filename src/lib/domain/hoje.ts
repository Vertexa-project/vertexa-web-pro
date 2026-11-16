// Tela Hoje — regras puras de data (Brasília) e textos. Sem I/O.
const TZ = "America/Sao_Paulo";

/** AAAA-MM-DD em Brasília. */
export function dayIsoBR(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Janela [início, fim) do dia de Brasília, em ISO (UTC-3 fixo). */
export function todayRangeBR(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(`${dayIsoBR(now)}T00:00:00-03:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

/** "segunda-feira, 16 de novembro" */
export function weekdayDateBR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now);
}

/** "09:30" no horário de Brasília. */
export function timeBR(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Subtítulo do Hoje: data · compromissos · pacientes que precisam de você. */
export function hojeSubtitle(date: string, compromissos: number | null, precisam: number | null): string {
  const parts = [date];
  if (compromissos != null) parts.push(plural(compromissos, "compromisso", "compromissos"));
  if (precisam != null) parts.push(precisam === 0 ? "ninguém precisa de você agora" : `${plural(precisam, "paciente precisa", "pacientes precisam")} de você`);
  return parts.join(" · ");
}
