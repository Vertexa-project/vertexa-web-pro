/**
 * Tokens do RELATÓRIO PDF (VERTEXA) — casca reutilizável por TODOS os relatórios
 * (Evolução hoje; Treino e Dieta depois). Espelham a identidade CLARA/corporativa do web
 * (src/index.css): base branco/off-white quente, texto quase-preto quente, LARANJA só como
 * ACENTO. @react-pdf/renderer não resolve `hsl(var(--x))`, então os tokens do CSS foram
 * convertidos para HEX literais aqui (única fonte de verdade da cor no PDF).
 *
 * REGRA DE OURO: laranja é acento (faixa da capa, marcador de seção, valor-herói, deltas de
 * melhora), nunca fundo de página. Status seguem o mesmo vocabulário do produto.
 */

// ---- Cores da marca (acento) ----
export const BRAND = {
  orange: "#F97316", // --primary hsl(24 95% 53%) → acento principal
  orangeDeep: "#C2410C", // laranja escuro p/ wordmark/título (contraste AA em branco)
  orangeTint: "#FDEBD9", // faixa/chip suave (fundo tintado quente)
  orangeTintSoft: "#FEF5EC", // tinta ainda mais leve (zebra/realce discreto)
} as const;

// ---- Neutros quentes (base) ----
export const NEUTRAL = {
  ink: "#26201D", // --foreground: texto quase-preto quente
  inkSoft: "#726B64", // --muted-foreground: texto secundário
  inkFaint: "#A79E96", // legendas/eixos/rótulos discretos
  hair: "#E7E3DE", // --border: linha/divisória
  hairStrong: "#D8D2CB", // divisória mais firme
  canvas: "#FAF8F5", // --background: off-white quente (fundo da página)
  surface: "#FFFFFF", // --card: branco (blocos)
  surfaceAlt: "#FBF9F6", // zebra de tabela / fundo de KPI
} as const;

// ---- Status (mesmo vocabulário do app/web) ----
export const STATUS = {
  success: "#16A34A", // verde — saudável / melhora
  successText: "#15803D",
  successTint: "#E7F6EC",
  danger: "#DC2626", // vermelho — risco / piora
  dangerText: "#B91C1C",
  dangerTint: "#FCEBEB",
  warning: "#D97706", // amarelo/âmbar — atenção
  warningText: "#B45309",
  warningTint: "#FBF0DD",
  info: "#2563EB", // azul — avaliação clínica / neutro
  infoText: "#1D4ED8",
  infoTint: "#E7EEFD",
  neutral: "#6B7280", // cinza — inativo
  neutralTint: "#EEF0F2",
} as const;

// Nível de adesão (VRI) → cor (espelha .claude/skills/clinical-ui-states).
export function vriColor(level: string | null | undefined): {
  fg: string;
  text: string;
  tint: string;
} {
  switch ((level ?? "").toLowerCase()) {
    case "alta":
      return { fg: STATUS.success, text: STATUS.successText, tint: STATUS.successTint };
    case "moderada":
      return { fg: STATUS.warning, text: STATUS.warningText, tint: STATUS.warningTint };
    case "baixa":
      return { fg: BRAND.orange, text: BRAND.orangeDeep, tint: BRAND.orangeTint };
    case "risco":
      return { fg: STATUS.danger, text: STATUS.dangerText, tint: STATUS.dangerTint };
    default:
      return { fg: STATUS.neutral, text: STATUS.neutral, tint: STATUS.neutralTint };
  }
}

// ---- Tipografia (famílias registradas em fonts.ts) ----
export const FONT = {
  body: "Inter", // corpo/UI
  display: "PlusJakarta", // títulos, números de métrica, wordmark
} as const;

// ---- Página (A4 em pontos PDF) ----
export const PAGE = {
  width: 595.28,
  height: 841.89,
  padX: 40,
  padTop: 44,
  padBottom: 54, // espaço para o rodapé fixo
} as const;

/** Largura útil do conteúdo (dentro das margens laterais). */
export const CONTENT_W = PAGE.width - PAGE.padX * 2; // ≈ 515.28

// ---- Escala de espaçamento (pt) ----
export const SP = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 28 } as const;

export const RADIUS = { sm: 4, md: 6, lg: 8, xl: 12 } as const;
