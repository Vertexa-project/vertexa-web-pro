// Recado da equipe no resumo semanal do paciente (PDF do Ernâni, tela 17).
export const NOTE_MAX = 300;

/** Segunda-feira (yyyy-mm-dd) da semana da data local `d`. */
export function mondayKey(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** Pode salvar? Texto vazio é válido (apaga o recado e o paciente volta a ver o automático). */
export function noteError(text: string): string | null {
  return text.trim().length > NOTE_MAX ? `O recado pode ter até ${NOTE_MAX} caracteres.` : null;
}
