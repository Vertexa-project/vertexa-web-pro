// Revisão de peso suspeito (PDF do Ernâni, tela 03). Entra na curva: ok (padrão) e approved.
// pending (aguarda a equipe) e rejected ficam fora; linha antiga sem status conta como ok.
export type WeightReviewStatus = "ok" | "pending" | "approved" | "rejected";

export function isCountedWeight(status: WeightReviewStatus | null | undefined): boolean {
  return status == null || status === "ok" || status === "approved";
}

/** Variação em relação ao registro anterior, para a equipe julgar: "−12,3 kg desde 16/10". */
export function deltaLabel(prevKg: number | null, prevDate: string | null, kg: number): string {
  if (prevKg == null) return "sem registro anterior";
  const d = Math.round((kg - prevKg) * 10) / 10;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  const txt = `${sign}${Math.abs(d).toFixed(1).replace(".", ",")} kg`;
  return prevDate ? `${txt} desde ${new Date(prevDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}` : txt;
}
