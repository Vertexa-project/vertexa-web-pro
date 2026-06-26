import type { AppointmentStatus, AppointmentType } from "@/types/db";

/**
 * Metadados das legendas do calendário (Sessão 12) — fonte única de rótulo + cor por TIPO e por
 * STATUS. As cores (HSL) espelham os tokens do tema (info/success/primary/muted/destructive) + um
 * rosa de marca p/ "previsão de retorno". Usadas inline nas legendas (à prova de purge do Tailwind)
 * e mantidas em sincronia com as classes .fc-evt-* de src/index.css (`className` abaixo).
 */
export const TYPE_META: Record<AppointmentType, { label: string; color: string; className: string }> = {
  consulta: { label: "Consulta", color: "hsl(207 90% 54%)", className: "fc-evt-consulta" },
  retorno: { label: "Retorno", color: "hsl(142 71% 45%)", className: "fc-evt-retorno" },
  previsao_retorno: { label: "Previsão de retorno", color: "hsl(330 81% 60%)", className: "fc-evt-previsao" },
  outros: { label: "Outros", color: "hsl(28 7% 42%)", className: "fc-evt-outros" },
};

/** Fonte fixa "google" (não é um AppointmentType) — laranja, read-only. */
export const GOOGLE_META = { label: "Google Agenda", color: "hsl(24 95% 53%)", className: "fc-evt-google" } as const;

// Status = barra de acento à ESQUERDA do evento (canal visual separado da cor de TIPO no
// preenchimento, p/ não colidir). 'desmarcado' ainda recebe risco + fundo esmaecido (ver index.css).
export const STATUS_META: Record<AppointmentStatus, { label: string; color: string; className: string }> = {
  confirmado: { label: "Confirmado", color: "hsl(142 71% 45%)", className: "fc-evt-st-confirmado" },
  pendente: { label: "Pendente", color: "hsl(45 93% 47%)", className: "fc-evt-st-pendente" },
  desmarcado: { label: "Desmarcado", color: "hsl(0 72% 51%)", className: "fc-evt-st-desmarcado" },
};

export const TYPE_LEGEND = (Object.keys(TYPE_META) as AppointmentType[]).map((k) => ({
  key: k,
  ...TYPE_META[k],
}));

export const STATUS_LEGEND = (Object.keys(STATUS_META) as AppointmentStatus[]).map((k) => ({
  key: k,
  ...STATUS_META[k],
}));
