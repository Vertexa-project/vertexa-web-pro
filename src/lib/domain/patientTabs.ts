/**
 * Ficha do paciente (redesign P2): de 10 abas para 6, com sub-abas.
 *   Resumo · Timeline · Prontuário · Planos (Plano alimentar, Suplementos, Treino) ·
 *   Evolução (Antropometria, Evolução/Fotos, Recuperação) · Documentos
 * Os valores antigos (overview, nutrition, supplements, workout, anthropometry, evolution, recovery, documents,
 * prontuario, timeline) continuam valendo em `?tab=` e nos links internos: `resolvePatientTab` mapeia para aba + sub-aba.
 */
export type PatientTabId = "resumo" | "timeline" | "prontuario" | "planos" | "evolucao" | "documentos";
export type PatientSubId = "alimentar" | "suplementos" | "treino" | "antropometria" | "fotos" | "recuperacao";

export interface PatientTabDef {
  id: PatientTabId;
  label: string;
  subs?: { id: PatientSubId; label: string; legacy: string }[];
}

export const PATIENT_TABS: PatientTabDef[] = [
  { id: "resumo", label: "Resumo" },
  { id: "timeline", label: "Timeline" },
  { id: "prontuario", label: "Prontuário" },
  {
    id: "planos",
    label: "Planos",
    subs: [
      { id: "alimentar", label: "Plano alimentar", legacy: "nutrition" },
      { id: "suplementos", label: "Suplementos", legacy: "supplements" },
      { id: "treino", label: "Treino", legacy: "workout" },
    ],
  },
  {
    id: "evolucao",
    label: "Evolução",
    subs: [
      { id: "antropometria", label: "Antropometria", legacy: "anthropometry" },
      { id: "fotos", label: "Evolução/Fotos", legacy: "evolution" },
      { id: "recuperacao", label: "Recuperação", legacy: "recovery" },
    ],
  },
  { id: "documentos", label: "Documentos" },
];

export interface PatientTabState {
  tab: PatientTabId;
  sub: PatientSubId | null;
}

/** As 10 abas antigas → aba + sub-aba. */
export const LEGACY_PATIENT_TABS: Record<string, PatientTabState> = {
  overview: { tab: "resumo", sub: null },
  timeline: { tab: "timeline", sub: null },
  prontuario: { tab: "prontuario", sub: null },
  nutrition: { tab: "planos", sub: "alimentar" },
  supplements: { tab: "planos", sub: "suplementos" },
  workout: { tab: "planos", sub: "treino" },
  anthropometry: { tab: "evolucao", sub: "antropometria" },
  evolution: { tab: "evolucao", sub: "fotos" },
  recovery: { tab: "evolucao", sub: "recuperacao" },
  documents: { tab: "documentos", sub: null },
};

const DEFAULT_STATE: PatientTabState = { tab: "resumo", sub: null };

export function defaultSub(tab: PatientTabId): PatientSubId | null {
  return PATIENT_TABS.find((t) => t.id === tab)?.subs?.[0]?.id ?? null;
}

/**
 * Resolve `?tab=` (valor antigo OU novo) e `?sub=` para o estado da ficha. Valor desconhecido → Resumo.
 * Aba com sub-abas sempre devolve uma sub-aba (a pedida, se válida; senão a primeira).
 */
export function resolvePatientTab(tab: string | null | undefined, sub?: string | null): PatientTabState {
  if (!tab) return DEFAULT_STATE;
  const legacy = LEGACY_PATIENT_TABS[tab];
  if (legacy) return legacy;
  const def = PATIENT_TABS.find((t) => t.id === tab);
  if (!def) return DEFAULT_STATE;
  if (!def.subs) return { tab: def.id, sub: null };
  const wanted = def.subs.find((s) => s.id === sub || s.legacy === sub);
  return { tab: def.id, sub: wanted?.id ?? def.subs[0].id };
}
